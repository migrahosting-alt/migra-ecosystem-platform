import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiKeyStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

const API_KEY_PREFIX = "mk_";
const KEY_BYTES = 32;

// ── Key generation ──

function generateRawKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(KEY_BYTES).toString("base64url")}`;
}

function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function extractPrefix(raw: string): string {
  return raw.slice(0, 8);
}

// ── Create key ──

interface CreateApiKeyInput {
  orgId: string;
  name: string;
  scopes?: string[] | undefined;
  expiresAt?: Date | undefined;
  createdById: string;
}

interface CreateApiKeyResult {
  id: string;
  name: string;
  prefixHint: string;
  rawKey: string; // only returned once at creation time
  scopes: string[];
  expiresAt: Date | null;
  createdAt: Date;
}

export async function createApiKey(input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
  const rawKey = generateRawKey();
  const keyHash = hashApiKey(rawKey);
  const prefixHint = extractPrefix(rawKey);

  const key = await prisma.apiKey.create({
    data: {
      orgId: input.orgId,
      name: input.name,
      prefixHint,
      keyHash,
      scopes: input.scopes ?? [],
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      createdById: input.createdById,
    },
  });

  await writeAuditLog({
    userId: input.createdById,
    orgId: input.orgId,
    action: "API_KEY_CREATED",
    entityType: "api_key",
    entityId: key.id,
    metadata: { name: input.name, prefixHint },
  });

  return {
    id: key.id,
    name: key.name,
    prefixHint,
    rawKey,
    scopes: key.scopes,
    expiresAt: key.expiresAt,
    createdAt: key.createdAt,
  };
}

// ── Validate key (for auth middleware) ──

interface ValidatedApiKey {
  id: string;
  orgId: string;
  name: string;
  scopes: string[];
}

export async function validateApiKey(raw: string): Promise<ValidatedApiKey | null> {
  if (!raw.startsWith(API_KEY_PREFIX)) {
    return null;
  }

  const keyHash = hashApiKey(raw);

  const key = await prisma.apiKey.findUnique({
    where: { keyHash },
    select: {
      id: true,
      orgId: true,
      name: true,
      scopes: true,
      status: true,
      expiresAt: true,
    },
  });

  if (!key) {
    return null;
  }

  if (key.status !== ApiKeyStatus.ACTIVE) {
    return null;
  }

  if (key.expiresAt && key.expiresAt <= new Date()) {
    // Auto-expire
    await prisma.apiKey.update({
      where: { id: key.id },
      data: { status: ApiKeyStatus.EXPIRED },
    });
    return null;
  }

  // Touch last used
  await prisma.apiKey.update({
    where: { id: key.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    id: key.id,
    orgId: key.orgId,
    name: key.name,
    scopes: key.scopes,
  };
}

// ── List keys (hides secrets) ──

export async function listApiKeys(orgId: string) {
  return prisma.apiKey.findMany({
    where: { orgId, status: { not: ApiKeyStatus.REVOKED } },
    select: {
      id: true,
      name: true,
      prefixHint: true,
      scopes: true,
      status: true,
      expiresAt: true,
      lastUsedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

// ── Revoke key ──

export async function revokeApiKey(orgId: string, keyId: string, actorId: string): Promise<boolean> {
  const result = await prisma.apiKey.updateMany({
    where: { id: keyId, orgId, status: ApiKeyStatus.ACTIVE },
    data: { status: ApiKeyStatus.REVOKED, revokedAt: new Date() },
  });

  if (result.count > 0) {
    await writeAuditLog({
      userId: actorId,
      orgId,
      action: "API_KEY_REVOKED",
      entityType: "api_key",
      entityId: keyId,
    });
    return true;
  }

  return false;
}

// ── API key auth middleware helper ──

export async function requireApiKeyAuth(request: Request): Promise<
  | { ok: true; apiKey: ValidatedApiKey }
  | { ok: false; error: string; status: number }
> {
  const header = request.headers.get("x-api-key") || request.headers.get("authorization") || "";

  let raw = header;
  if (header.toLowerCase().startsWith("bearer ")) {
    raw = header.slice(7);
  }

  if (!raw || !raw.startsWith(API_KEY_PREFIX)) {
    return { ok: false, error: "Missing or invalid API key.", status: 401 };
  }

  const validated = await validateApiKey(raw);
  if (!validated) {
    return { ok: false, error: "Invalid or expired API key.", status: 401 };
  }

  return { ok: true, apiKey: validated };
}

export function hasScope(apiKey: ValidatedApiKey, required: string): boolean {
  if (apiKey.scopes.length === 0) {
    return true; // empty scopes = full access
  }

  return apiKey.scopes.some((scope) => {
    if (scope === required) return true;
    // Wildcard matching: "billing:*" matches "billing:read"
    if (scope.endsWith(":*")) {
      const prefix = scope.slice(0, -1);
      return required.startsWith(prefix);
    }
    return false;
  });
}
