import { createHash, randomUUID } from "node:crypto";
import { promises as dns } from "node:dns";
import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { getDb } from "./db.js";
import {
  downloadStorageProvider,
  downloadTtlSeconds,
  getDownloadSignerConfig,
} from "./downloads.js";
import type { ProductKey } from "./commerce-catalog.js";

type ArtifactRow = {
  id: string;
  name: string;
  product: ProductKey;
  version: string;
  fileKey: string;
  sha256: string;
  sizeBytes: string;
  isActive: boolean;
  createdAt: Date;
};

type QueryClient = Pick<PoolClient, "query">;

const DEFAULT_VERIFY_MAX_BYTES = 5 * 1024 * 1024 * 1024;
const DEFAULT_VERIFY_TIMEOUT_MS = 180_000;

function verificationMaxBytes(): number {
  const raw = Number(process.env.DOWNLOAD_VERIFY_MAX_BYTES ?? DEFAULT_VERIFY_MAX_BYTES);
  if (!Number.isFinite(raw)) return DEFAULT_VERIFY_MAX_BYTES;
  return Math.max(1024 * 1024, Math.min(Math.floor(raw), 50 * 1024 * 1024 * 1024));
}

function verificationTimeoutMs(): number {
  const raw = Number(process.env.DOWNLOAD_VERIFY_TIMEOUT_MS ?? DEFAULT_VERIFY_TIMEOUT_MS);
  if (!Number.isFinite(raw)) return DEFAULT_VERIFY_TIMEOUT_MS;
  return Math.max(10_000, Math.min(Math.floor(raw), 10 * 60_000));
}

export function normalizeDownloadFileKey(raw: string): string {
  const value = raw.trim();
  if (!value || value.length > 1024) {
    throw Object.assign(new Error("Object key must be between 1 and 1024 characters."), {
      statusCode: 400,
    });
  }
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw Object.assign(new Error("Object key contains an unsafe path segment."), {
      statusCode: 400,
    });
  }
  return value;
}

function createStorageClient() {
  const config = getDownloadSignerConfig();
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return { client, config };
}

export async function getDownloadStorageReadiness() {
  const provider = downloadStorageProvider();
  const ttlSeconds = downloadTtlSeconds();
  const endpoint = process.env.S3_ENDPOINT?.trim() ?? "";
  const bucket = process.env.S3_BUCKET?.trim() ?? "";
  const region = process.env.S3_REGION?.trim() || "us-east-1";
  const hasAccessKey = Boolean(process.env.S3_ACCESS_KEY_ID?.trim());
  const hasSecret = Boolean(process.env.S3_SECRET_ACCESS_KEY?.trim());

  let endpointHost: string | null = null;
  let resolvedAddresses: string[] = [];
  try {
    endpointHost = endpoint ? new URL(endpoint).hostname.toLowerCase() : null;
    if (endpointHost) {
      const addresses = await dns.lookup(endpointHost, { all: true, verbatim: true });
      resolvedAddresses = [...new Set(addresses.map((entry) => entry.address))];
    }
  } catch {
    endpointHost = null;
  }

  const configured =
    (provider === "s3" || provider === "minio") &&
    Boolean(endpointHost && bucket && hasAccessKey && hasSecret);

  return {
    configured,
    provider,
    endpointHost,
    bucket: bucket || null,
    region,
    ttlSeconds,
    resolvedAddresses,
    internalRoute: resolvedAddresses.some(
      (address) =>
        address.startsWith("10.") ||
        address.startsWith("100.") ||
        address.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(address),
    ),
    verifyMaxBytes: verificationMaxBytes(),
    verifyTimeoutMs: verificationTimeoutMs(),
  };
}

async function streamObjectIntegrity(fileKey: string) {
  const safeKey = normalizeDownloadFileKey(fileKey);
  const { client, config } = createStorageClient();
  const abortSignal = AbortSignal.timeout(verificationTimeoutMs());

  try {
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: safeKey,
      }),
      { abortSignal },
    );
    const expectedLength = Number(head.ContentLength ?? 0);
    if (!Number.isFinite(expectedLength) || expectedLength < 0) {
      throw Object.assign(new Error("Object storage returned an invalid content length."), {
        statusCode: 502,
      });
    }
    if (expectedLength > verificationMaxBytes()) {
      throw Object.assign(
        new Error("Artifact exceeds the configured integrity-verification size limit."),
        { statusCode: 413 },
      );
    }

    const object = await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: safeKey,
      }),
      { abortSignal },
    );
    if (!object.Body) {
      throw Object.assign(new Error("Object storage returned an empty body."), {
        statusCode: 502,
      });
    }

    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      bytes += chunk.byteLength;
      if (bytes > verificationMaxBytes()) {
        throw Object.assign(
          new Error("Artifact exceeds the configured integrity-verification size limit."),
          { statusCode: 413 },
        );
      }
    }

    if (bytes !== expectedLength) {
      throw Object.assign(
        new Error("Object changed while integrity verification was in progress."),
        { statusCode: 409 },
      );
    }

    return {
      fileKey: safeKey,
      sizeBytes: String(bytes),
      sha256: hash.digest("hex"),
      etag: head.ETag ?? null,
      lastModified: head.LastModified ?? null,
      contentType: head.ContentType ?? null,
    };
  } catch (error) {
    const candidate = error as Error & { statusCode?: number; name?: string };
    if (candidate.statusCode) throw candidate;
    if (candidate.name === "NoSuchKey" || candidate.name === "NotFound") {
      throw Object.assign(new Error("Artifact object does not exist in storage."), {
        statusCode: 404,
      });
    }
    if (candidate.name === "TimeoutError" || candidate.name === "AbortError") {
      throw Object.assign(new Error("Artifact verification timed out."), {
        statusCode: 504,
      });
    }
    throw Object.assign(new Error("Object storage verification failed."), {
      statusCode: 503,
    });
  } finally {
    client.destroy();
  }
}

async function writeDistributionAudit(
  client: QueryClient,
  input: {
    actorId: string;
    action: string;
    artifactId: string;
    request: FastifyRequest;
    metadata?: Record<string, unknown>;
  },
) {
  await client.query(
    'INSERT INTO "AuditLog" (id,"userId","orgId",action,"entityType","entityId",ip,"userAgent",metadata,"createdAt") VALUES ($1,$2,NULL,$3,\'download_artifact\',$4,$5,$6,$7::jsonb,NOW())',
    [
      randomUUID(),
      input.actorId,
      input.action,
      input.artifactId,
      input.request.ip ?? null,
      input.request.headers["user-agent"] ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export async function getDistributionSnapshot() {
  const db = getDb();
  const [artifacts, activity, storage] = await Promise.all([
    db.query(
      `SELECT
         a.id,
         a.name,
         a.product::text AS product,
         a.version,
         a."fileKey",
         a.sha256,
         a."sizeBytes"::text AS "sizeBytes",
         a."isActive",
         a."createdAt",
         latest.action AS "lastAuditAction",
         latest.metadata AS "lastAuditMetadata",
         latest."createdAt" AS "lastAuditAt"
       FROM "DownloadArtifact" a
       LEFT JOIN LATERAL (
         SELECT action,metadata,"createdAt"
         FROM "AuditLog"
         WHERE "entityType"='download_artifact' AND "entityId"=a.id
         ORDER BY "createdAt" DESC
         LIMIT 1
       ) latest ON true
       ORDER BY a."createdAt" DESC, a.name ASC`,
    ),
    db.query(
      `SELECT id,action,"entityId",metadata,"createdAt"
       FROM "AuditLog"
       WHERE "entityType"='download_artifact'
         AND action LIKE 'DOWNLOAD_ARTIFACT_%'
       ORDER BY "createdAt" DESC
       LIMIT 60`,
    ),
    getDownloadStorageReadiness(),
  ]);

  const active = artifacts.rows.filter((row) => row.isActive);
  const totalBytes = active.reduce(
    (sum, row) => sum + BigInt(row.sizeBytes ?? "0"),
    BigInt(0),
  );

  return {
    storage,
    metrics: {
      artifacts: artifacts.rows.length,
      activeArtifacts: active.length,
      inactiveArtifacts: artifacts.rows.length - active.length,
      activeBytes: totalBytes.toString(),
      products: new Set(active.map((row) => row.product)).size,
    },
    artifacts: artifacts.rows,
    activity: activity.rows,
  };
}

export async function registerDistributionArtifact(input: {
  actorId: string;
  name: string;
  product: ProductKey;
  version: string;
  fileKey: string;
  request: FastifyRequest;
}) {
  const db = getDb();
  const fileKey = normalizeDownloadFileKey(input.fileKey);
  const duplicate = await db.query(
    'SELECT id FROM "DownloadArtifact" WHERE "fileKey"=$1 LIMIT 1',
    [fileKey],
  );
  if (duplicate.rows[0]) {
    throw Object.assign(
      new Error("That storage object is already registered as a release artifact."),
      { statusCode: 409 },
    );
  }

  const verified = await streamObjectIntegrity(fileKey);
  const id = randomUUID();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      'INSERT INTO "DownloadArtifact" (id,name,product,version,"fileKey",sha256,"sizeBytes","isActive","createdAt") VALUES ($1,$2,$3::"ProductKey",$4,$5,$6,$7,false,NOW())',
      [
        id,
        input.name.trim(),
        input.product,
        input.version.trim(),
        fileKey,
        verified.sha256,
        verified.sizeBytes,
      ],
    );
    await writeDistributionAudit(client, {
      actorId: input.actorId,
      action: "DOWNLOAD_ARTIFACT_REGISTERED",
      artifactId: id,
      request: input.request,
      metadata: {
        product: input.product,
        version: input.version.trim(),
        fileKey,
        sizeBytes: verified.sizeBytes,
        sha256: verified.sha256,
        objectLastModified: verified.lastModified?.toISOString() ?? null,
        active: false,
      },
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return {
    id,
    name: input.name.trim(),
    product: input.product,
    version: input.version.trim(),
    fileKey,
    sha256: verified.sha256,
    sizeBytes: verified.sizeBytes,
    isActive: false,
  };
}

async function loadArtifact(artifactId: string): Promise<ArtifactRow> {
  const result = await getDb().query<ArtifactRow>(
    'SELECT id,name,product::text AS product,version,"fileKey",sha256,"sizeBytes"::text AS "sizeBytes","isActive","createdAt" FROM "DownloadArtifact" WHERE id=$1',
    [artifactId],
  );
  const artifact = result.rows[0];
  if (!artifact) {
    throw Object.assign(new Error("Download artifact not found."), {
      statusCode: 404,
    });
  }
  return artifact;
}

export async function verifyDistributionArtifact(input: {
  actorId: string;
  artifactId: string;
  request: FastifyRequest;
}) {
  const artifact = await loadArtifact(input.artifactId);
  const actual = await streamObjectIntegrity(artifact.fileKey);
  const sizeMatches = actual.sizeBytes === artifact.sizeBytes;
  const shaMatches = actual.sha256 === artifact.sha256;
  const verified = sizeMatches && shaMatches;

  await writeDistributionAudit(getDb(), {
    actorId: input.actorId,
    action: verified
      ? "DOWNLOAD_ARTIFACT_VERIFIED"
      : "DOWNLOAD_ARTIFACT_INTEGRITY_FAILED",
    artifactId: artifact.id,
    request: input.request,
    metadata: {
      expectedSizeBytes: artifact.sizeBytes,
      actualSizeBytes: actual.sizeBytes,
      expectedSha256: artifact.sha256,
      actualSha256: actual.sha256,
      sizeMatches,
      shaMatches,
      active: artifact.isActive,
    },
  });

  return {
    artifactId: artifact.id,
    verified,
    sizeMatches,
    shaMatches,
    expected: {
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
    },
    actual: {
      sizeBytes: actual.sizeBytes,
      sha256: actual.sha256,
      lastModified: actual.lastModified,
    },
  };
}

export async function activateDistributionArtifact(input: {
  actorId: string;
  artifactId: string;
  reason: string;
  request: FastifyRequest;
}) {
  const before = await loadArtifact(input.artifactId);
  const actual = await streamObjectIntegrity(before.fileKey);
  if (actual.sizeBytes !== before.sizeBytes || actual.sha256 !== before.sha256) {
    await writeDistributionAudit(getDb(), {
      actorId: input.actorId,
      action: "DOWNLOAD_ARTIFACT_ACTIVATION_BLOCKED",
      artifactId: before.id,
      request: input.request,
      metadata: {
        reason: input.reason,
        expectedSizeBytes: before.sizeBytes,
        actualSizeBytes: actual.sizeBytes,
        expectedSha256: before.sha256,
        actualSha256: actual.sha256,
      },
    });
    throw Object.assign(
      new Error("Artifact bytes no longer match the registered release metadata."),
      { statusCode: 409 },
    );
  }

  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<ArtifactRow>(
      'SELECT id,name,product::text AS product,version,"fileKey",sha256,"sizeBytes"::text AS "sizeBytes","isActive","createdAt" FROM "DownloadArtifact" WHERE id=$1 FOR UPDATE',
      [before.id],
    );
    const current = locked.rows[0];
    if (
      !current ||
      current.fileKey !== before.fileKey ||
      current.sha256 !== before.sha256 ||
      current.sizeBytes !== before.sizeBytes
    ) {
      throw Object.assign(
        new Error("Artifact metadata changed while activation was being verified."),
        { statusCode: 409 },
      );
    }

    await client.query(
      'UPDATE "DownloadArtifact" SET "isActive"=true WHERE id=$1',
      [before.id],
    );
    await writeDistributionAudit(client, {
      actorId: input.actorId,
      action: "DOWNLOAD_ARTIFACT_ACTIVATED",
      artifactId: before.id,
      request: input.request,
      metadata: {
        reason: input.reason,
        product: before.product,
        version: before.version,
        fileKey: before.fileKey,
        sizeBytes: before.sizeBytes,
        sha256: before.sha256,
        integrityVerified: true,
      },
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { artifactId: before.id, active: true };
}

export async function deactivateDistributionArtifact(input: {
  actorId: string;
  artifactId: string;
  reason: string;
  request: FastifyRequest;
}) {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<ArtifactRow>(
      'SELECT id,name,product::text AS product,version,"fileKey",sha256,"sizeBytes"::text AS "sizeBytes","isActive","createdAt" FROM "DownloadArtifact" WHERE id=$1 FOR UPDATE',
      [input.artifactId],
    );
    const artifact = locked.rows[0];
    if (!artifact) {
      throw Object.assign(new Error("Download artifact not found."), {
        statusCode: 404,
      });
    }

    await client.query(
      'UPDATE "DownloadArtifact" SET "isActive"=false WHERE id=$1',
      [artifact.id],
    );
    await writeDistributionAudit(client, {
      actorId: input.actorId,
      action: "DOWNLOAD_ARTIFACT_DEACTIVATED",
      artifactId: artifact.id,
      request: input.request,
      metadata: {
        reason: input.reason,
        product: artifact.product,
        version: artifact.version,
        fileKey: artifact.fileKey,
        wasActive: artifact.isActive,
      },
    });
    await client.query("COMMIT");
    return { artifactId: artifact.id, active: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
