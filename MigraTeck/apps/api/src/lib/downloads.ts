import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { FastifyRequest } from "fastify";
import { getDb } from "./db.js";
import { enforceRateLimit } from "./rate-limit.js";

export type DownloadEntitlementStatus =
  | "ACTIVE"
  | "TRIAL"
  | "RESTRICTED"
  | "INTERNAL_ONLY";

export type DownloadMemberRole =
  | "OWNER"
  | "ADMIN"
  | "BILLING_ADMIN"
  | "MEMBER";

const CLIENT_ONLY_PRODUCTS = new Set(["MIGRAHOSTING", "MIGRAPANEL"]);
const ALLOWED_RUNTIME_STATUSES = new Set<DownloadEntitlementStatus>([
  "ACTIVE",
  "TRIAL",
]);

type ArtifactRow = {
  id: string;
  name: string;
  product: string;
  version: string;
  fileKey: string;
  sha256: string;
  sizeBytes: string;
  createdAt: Date;
};

type EntitlementRow = {
  product: string;
  status: DownloadEntitlementStatus;
  startsAt: Date | null;
  endsAt: Date | null;
};

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  isMigraHostingClient: boolean;
};

export function isInternalDownloadOrganization(slug: string): boolean {
  return slug.trim().toLowerCase().startsWith("migra");
}

export function isClientOnlyDownloadProduct(product: string): boolean {
  return CLIENT_ONLY_PRODUCTS.has(product);
}

export function isDownloadEntitlementAllowed(input: {
  status: DownloadEntitlementStatus | null | undefined;
  startsAt?: Date | null;
  endsAt?: Date | null;
  now?: Date;
  isInternalOrg: boolean;
}): boolean {
  const now = input.now ?? new Date();

  if (!input.status) return false;
  if (input.startsAt && input.startsAt > now) return false;
  if (input.endsAt && input.endsAt <= now) return false;

  if (input.status === "INTERNAL_ONLY") {
    return input.isInternalOrg;
  }
  if (input.status === "RESTRICTED") {
    return false;
  }
  return ALLOWED_RUNTIME_STATUSES.has(input.status);
}

export function downloadAccessReason(input: {
  entitled: boolean;
  clientAllowed: boolean;
  status: DownloadEntitlementStatus;
}): string | null {
  if (!input.clientAllowed) return "CLIENT_ONLY_PRODUCT";
  if (input.entitled) return null;
  if (input.status === "INTERNAL_ONLY") return "INTERNAL_ONLY";
  return "ENTITLEMENT_REQUIRED";
}

function downloadStorageProvider(): "s3" | "minio" | "mock" | null {
  const value = process.env.DOWNLOAD_STORAGE_PROVIDER?.trim().toLowerCase();
  if (value === "s3" || value === "minio" || value === "mock") return value;
  return null;
}

function downloadTtlSeconds(): number {
  const raw = Number(process.env.DOWNLOAD_URL_TTL_SECONDS ?? 300);
  if (!Number.isFinite(raw)) return 300;
  return Math.max(30, Math.min(Math.floor(raw), 3600));
}

function getSignerConfig() {
  const provider = downloadStorageProvider();

  if (provider === "mock" && process.env.NODE_ENV === "production") {
    throw Object.assign(
      new Error("Mock download signing is disabled in production"),
      { statusCode: 503 },
    );
  }
  if (provider !== "s3" && provider !== "minio") {
    throw Object.assign(
      new Error("Download storage signer is not configured"),
      { statusCode: 503 },
    );
  }

  const endpoint = process.env.S3_ENDPOINT?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  const region = process.env.S3_REGION?.trim() || "us-east-1";

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw Object.assign(
      new Error("Download storage signer is incomplete"),
      { statusCode: 503 },
    );
  }

  let hostname: string;
  try {
    hostname = new URL(endpoint).hostname.toLowerCase();
  } catch {
    throw Object.assign(new Error("Download storage endpoint is invalid"), {
      statusCode: 503,
    });
  }

  const forcePathStyle =
    provider === "minio" ||
    hostname === "s3.migradrive.com" ||
    (!hostname.endsWith(".amazonaws.com") && hostname !== "s3.amazonaws.com");

  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    bucket,
    accessKeyId,
    secretAccessKey,
    region,
    forcePathStyle,
  };
}

async function loadOrganization(orgId: string): Promise<OrganizationRow> {
  const result = await getDb().query<OrganizationRow>(
    'SELECT id,name,slug,"isMigraHostingClient" FROM "Organization" WHERE id=$1',
    [orgId],
  );
  const organization = result.rows[0];
  if (!organization) {
    throw Object.assign(new Error("Organization not found"), { statusCode: 404 });
  }
  return organization;
}

async function writeDownloadAudit(input: {
  userId: string;
  orgId: string;
  action: string;
  artifactId?: string | null;
  request: FastifyRequest;
  metadata?: Record<string, unknown>;
}) {
  await getDb().query(
    'INSERT INTO "AuditLog" (id,"userId","orgId",action,"entityType","entityId",ip,"userAgent",metadata,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())',
    [
      randomUUID(),
      input.userId,
      input.orgId,
      input.action,
      input.artifactId ? "download_artifact" : "downloads",
      input.artifactId ?? null,
      input.request.ip ?? null,
      input.request.headers["user-agent"] ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

async function loadEntitlementMap(orgId: string) {
  const result = await getDb().query<EntitlementRow>(
    'SELECT product::text AS product,status::text AS status,"startsAt","endsAt" FROM "OrgEntitlement" WHERE "orgId"=$1',
    [orgId],
  );
  return new Map(result.rows.map((row) => [row.product, row]));
}

function artifactAccess(input: {
  artifact: ArtifactRow;
  entitlement: EntitlementRow | undefined;
  organization: OrganizationRow;
  role: DownloadMemberRole;
}) {
  const status = input.entitlement?.status ?? "RESTRICTED";
  const entitled = isDownloadEntitlementAllowed({
    status,
    startsAt: input.entitlement?.startsAt ?? null,
    endsAt: input.entitlement?.endsAt ?? null,
    isInternalOrg: isInternalDownloadOrganization(input.organization.slug),
  });
  const clientAllowed =
    !isClientOnlyDownloadProduct(input.artifact.product) ||
    input.organization.isMigraHostingClient ||
    input.role === "OWNER";

  return {
    entitled: entitled && clientAllowed,
    entitlementStatus: status,
    reason: downloadAccessReason({
      entitled,
      clientAllowed,
      status,
    }),
  };
}

export async function listDownloadArtifacts(input: {
  orgId: string;
  userId: string;
  role: DownloadMemberRole;
  request: FastifyRequest;
}) {
  const db = getDb();
  const [organization, artifactsResult, entitlementMap] = await Promise.all([
    loadOrganization(input.orgId),
    db.query<ArtifactRow>(
      'SELECT id,name,product::text AS product,version,"fileKey",sha256,"sizeBytes"::text AS "sizeBytes","createdAt" FROM "DownloadArtifact" WHERE "isActive"=true ORDER BY product ASC,"createdAt" DESC',
    ),
    loadEntitlementMap(input.orgId),
  ]);

  const downloads = artifactsResult.rows.map((artifact) => {
    const access = artifactAccess({
      artifact,
      entitlement: entitlementMap.get(artifact.product),
      organization,
      role: input.role,
    });
    return {
      id: artifact.id,
      name: artifact.name,
      product: artifact.product,
      version: artifact.version,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
      createdAt: artifact.createdAt,
      ...access,
    };
  });

  await writeDownloadAudit({
    userId: input.userId,
    orgId: input.orgId,
    action: "DOWNLOADS_VIEWED",
    request: input.request,
    metadata: {
      artifactCount: downloads.length,
      entitledCount: downloads.filter((row) => row.entitled).length,
    },
  });

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    },
    downloads,
    signing: {
      ttlSeconds: downloadTtlSeconds(),
      provider: downloadStorageProvider(),
    },
  };
}

export async function signDownloadArtifact(input: {
  orgId: string;
  userId: string;
  role: DownloadMemberRole;
  artifactId: string;
  request: FastifyRequest;
}) {
  const limiter = enforceRateLimit({
    key: "download-sign:" + input.userId + ":" + input.orgId,
    limit: Number(process.env.DOWNLOAD_SIGN_RATE_LIMIT_PER_HOUR ?? 120),
    windowMs: 60 * 60 * 1000,
  });
  if (!limiter.allowed) {
    throw Object.assign(new Error("Download signing rate limit exceeded"), {
      statusCode: 429,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((limiter.resetAt - Date.now()) / 1000),
      ),
    });
  }

  const db = getDb();
  const [organization, artifactResult, entitlementMap] = await Promise.all([
    loadOrganization(input.orgId),
    db.query<ArtifactRow>(
      'SELECT id,name,product::text AS product,version,"fileKey",sha256,"sizeBytes"::text AS "sizeBytes","createdAt" FROM "DownloadArtifact" WHERE id=$1 AND "isActive"=true',
      [input.artifactId],
    ),
    loadEntitlementMap(input.orgId),
  ]);

  const artifact = artifactResult.rows[0];
  if (!artifact) {
    throw Object.assign(new Error("Download artifact not found"), {
      statusCode: 404,
    });
  }

  const access = artifactAccess({
    artifact,
    entitlement: entitlementMap.get(artifact.product),
    organization,
    role: input.role,
  });

  if (!access.entitled) {
    await writeDownloadAudit({
      userId: input.userId,
      orgId: input.orgId,
      action: "DOWNLOAD_SIGNED_URL_DENIED",
      artifactId: artifact.id,
      request: input.request,
      metadata: {
        product: artifact.product,
        reason: access.reason,
        entitlementStatus: access.entitlementStatus,
      },
    });
    throw Object.assign(new Error("This organization is not entitled to this artifact"), {
      statusCode: 403,
    });
  }

  const config = getSignerConfig();
  const ttlSeconds = downloadTtlSeconds();
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  const filename = basename(artifact.fileKey).replace(/[\r\n"]/g, "_");
  const signedUrl = await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: artifact.fileKey,
      ResponseContentDisposition: 'attachment; filename="' + filename + '"',
    }),
    { expiresIn: ttlSeconds },
  );

  await writeDownloadAudit({
    userId: input.userId,
    orgId: input.orgId,
    action: "DOWNLOAD_SIGNED_URL_ISSUED",
    artifactId: artifact.id,
    request: input.request,
    metadata: {
      product: artifact.product,
      version: artifact.version,
      ttlSeconds,
    },
  });

  return {
    artifact: {
      id: artifact.id,
      name: artifact.name,
      product: artifact.product,
      version: artifact.version,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes,
    },
    signedUrl,
    expiresInSeconds: ttlSeconds,
  };
}
