import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { FastifyRequest } from "fastify";
import { getDb } from "./db.js";
import { publishPlatformEvent } from "./platform-events.js";

const KEY_PREFIX = "mk_live";
const DEFAULT_SCOPES = ["platform:read"] as const;

export const allowedApiKeyScopes = [
  "platform:read",
  "products:read",
  "billing:read",
  "billing:write",
  "usage:read",
  "usage:write",
  "webhooks:read",
  "webhooks:write",
] as const;

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function normalizeScopes(scopes?: string[]): string[] {
  const requested = scopes?.length ? scopes : [...DEFAULT_SCOPES];
  const allowed = new Set<string>(allowedApiKeyScopes);
  const unique = [...new Set(requested)];

  for (const scope of unique) {
    if (!allowed.has(scope)) {
      throw Object.assign(new Error("Unsupported API-key scope: " + scope), {
        statusCode: 400,
      });
    }
  }

  return unique;
}

export async function listApiKeys(platformOrgId: string) {
  const db = getDb();
  const result = await db.query(
    'SELECT id, name, "publicKeyId", status, scopes, "expiresAt", "revokedAt", "lastUsedAt", "createdAt" FROM "ApiKey" WHERE "orgId" = $1 ORDER BY "createdAt" DESC',
    [platformOrgId],
  );

  return result.rows;
}

export async function createApiKey(input: {
  platformOrgId: string;
  platformUserId: string;
  name: string;
  scopes?: string[];
  expiresAt?: Date | null;
  request: FastifyRequest;
}) {
  const scopes = normalizeScopes(input.scopes);
  const publicKeyId = randomBytes(9).toString("base64url");
  const secret = randomBytes(32).toString("base64url");
  const secretHash = hashSecret(secret);
  const id = randomUUID();
  const rawKey = KEY_PREFIX + "_" + publicKeyId + "_" + secret;
  const db = getDb();

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const created = await client.query(
      'INSERT INTO "ApiKey" (id, "orgId", name, "publicKeyId", "secretHash", status, scopes, "expiresAt", "createdByUserId", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, \'ACTIVE\', $6::text[], $7, $8, NOW(), NOW()) RETURNING id, name, "publicKeyId", status, scopes, "expiresAt", "lastUsedAt", "createdAt"',
      [
        id,
        input.platformOrgId,
        input.name,
        publicKeyId,
        secretHash,
        scopes,
        input.expiresAt ?? null,
        input.platformUserId,
      ],
    );

    await client.query(
      'INSERT INTO "AuditLog" (id, "userId", "orgId", action, "entityType", "entityId", ip, "userAgent", metadata, "createdAt") VALUES ($1, $2, $3, \'API_KEY_CREATED\', \'api_key\', $4, $5, $6, $7::jsonb, NOW())',
      [
        randomUUID(),
        input.platformUserId,
        input.platformOrgId,
        id,
        input.request.ip ?? null,
        input.request.headers["user-agent"] ?? null,
        JSON.stringify({ name: input.name, publicKeyId, scopes }),
      ],
    );

    await publishPlatformEvent(client, {
      eventType: "api_key.created",
      source: "migrateck-platform-api",
      orgId: input.platformOrgId,
      actorId: input.platformUserId,
      entityType: "api_key",
      entityId: id,
      payload: {
        name: input.name,
        public_key_id: publicKeyId,
        scopes,
        expires_at: input.expiresAt?.toISOString() ?? null,
      },
    });

    await client.query("COMMIT");

    return {
      ...created.rows[0],
      key: rawKey,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeApiKey(input: {
  platformOrgId: string;
  platformUserId: string;
  keyId: string;
  request: FastifyRequest;
}) {
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const revoked = await client.query(
      'UPDATE "ApiKey" SET status = \'REVOKED\', "revokedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1 AND "orgId" = $2 AND status = \'ACTIVE\' RETURNING id, name, "publicKeyId", status, scopes, "revokedAt"',
      [input.keyId, input.platformOrgId],
    );

    if (!revoked.rows[0]) {
      throw Object.assign(new Error("Active API key not found"), { statusCode: 404 });
    }

    await client.query(
      'INSERT INTO "AuditLog" (id, "userId", "orgId", action, "entityType", "entityId", ip, "userAgent", metadata, "createdAt") VALUES ($1, $2, $3, \'API_KEY_REVOKED\', \'api_key\', $4, $5, $6, $7::jsonb, NOW())',
      [
        randomUUID(),
        input.platformUserId,
        input.platformOrgId,
        input.keyId,
        input.request.ip ?? null,
        input.request.headers["user-agent"] ?? null,
        JSON.stringify({ publicKeyId: revoked.rows[0].publicKeyId }),
      ],
    );

    await publishPlatformEvent(client, {
      eventType: "api_key.revoked",
      source: "migrateck-platform-api",
      orgId: input.platformOrgId,
      actorId: input.platformUserId,
      entityType: "api_key",
      entityId: input.keyId,
      payload: {
        public_key_id: revoked.rows[0].publicKeyId,
        name: revoked.rows[0].name,
        scopes: revoked.rows[0].scopes,
      },
    });

    await client.query("COMMIT");
    return revoked.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function validateApiKey(rawKey: string) {
  const match = /^mk_live_([^_]+)_(.+)$/.exec(rawKey);
  if (!match) return null;

  const publicKeyId = match[1];
  const secret = match[2];
  if (!publicKeyId || !secret) return null;

  const db = getDb();
  const result = await db.query(
    'SELECT id, "orgId", name, "secretHash", status, scopes, "expiresAt" FROM "ApiKey" WHERE "publicKeyId" = $1 LIMIT 1',
    [publicKeyId],
  );
  const key = result.rows[0];
  if (!key || key.status !== "ACTIVE") return null;
  if (key.expiresAt && new Date(key.expiresAt) <= new Date()) {
    await db.query(
      'UPDATE "ApiKey" SET status = \'EXPIRED\', "updatedAt" = NOW() WHERE id = $1 AND status = \'ACTIVE\'',
      [key.id],
    );
    return null;
  }

  const actual = Buffer.from(hashSecret(secret), "hex");
  const expected = Buffer.from(String(key.secretHash), "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  await db.query(
    'UPDATE "ApiKey" SET "lastUsedAt" = NOW(), "updatedAt" = NOW() WHERE id = $1',
    [key.id],
  );

  return {
    id: key.id as string,
    orgId: key.orgId as string,
    name: key.name as string,
    publicKeyId: publicKeyId as string,
    scopes: (key.scopes ?? []) as string[],
  };
}
