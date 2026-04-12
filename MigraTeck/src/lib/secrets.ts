import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { Prisma, type SecretScope } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─── Encryption Envelope ────────────────────────────────────────────────

const ALGO = "aes-256-gcm";
const KEY_ENV = "PLATFORM_ENCRYPTION_KEY"; // 64-char hex = 32 bytes

function getMasterKey(): Buffer {
  const hex = process.env[KEY_ENV];
  if (!hex || hex.length < 64) {
    throw new Error(`${KEY_ENV} must be a 64-char hex string (32 bytes)`);
  }
  return Buffer.from(hex.slice(0, 64), "hex");
}

function deriveVersionedKey(masterKey: Buffer, version: number): Buffer {
  return createHash("sha256")
    .update(Buffer.concat([masterKey, Buffer.from(`v${version}`)]))
    .digest();
}

export function encryptValue(
  plaintext: string,
  keyVersion = 1
): { encryptedValue: string; iv: string; authTag: string; keyVersion: number } {
  const key = deriveVersionedKey(getMasterKey(), keyVersion);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedValue: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    keyVersion,
  };
}

export function decryptValue(
  encryptedValue: string,
  iv: string,
  authTag: string,
  keyVersion = 1
): string {
  const key = deriveVersionedKey(getMasterKey(), keyVersion);
  const decipher = createDecipheriv(ALGO, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

// ─── Secret CRUD ────────────────────────────────────────────────────────

export async function createSecret(input: {
  orgId?: string | undefined;
  scope: SecretScope;
  name: string;
  value: string;
  rotateAfterDays?: number | undefined;
  expiresAt?: Date | undefined;
  createdById?: string | undefined;
}) {
  const envelope = encryptValue(input.value);
  const data: Record<string, unknown> = {
    scope: input.scope,
    name: input.name,
    encryptedValue: envelope.encryptedValue,
    iv: envelope.iv,
    authTag: envelope.authTag,
    keyVersion: envelope.keyVersion,
  };
  if (input.orgId !== undefined) data.orgId = input.orgId;
  if (input.rotateAfterDays !== undefined) data.rotateAfterDays = input.rotateAfterDays;
  if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt;
  if (input.createdById !== undefined) data.createdById = input.createdById;

  return prisma.secretEntry.create({
    data: data as Parameters<typeof prisma.secretEntry.create>[0]["data"],
  });
}

export async function getSecretValue(secretId: string): Promise<string> {
  const entry = await prisma.secretEntry.findUniqueOrThrow({ where: { id: secretId } });
  return decryptValue(entry.encryptedValue, entry.iv, entry.authTag, entry.keyVersion);
}

export async function getSecretByName(
  name: string,
  scope: SecretScope,
  orgId?: string | undefined
): Promise<string | null> {
  const entry = await prisma.secretEntry.findUnique({
    where: { orgId_scope_name: { orgId: orgId ?? "", scope, name } },
  });
  if (!entry) return null;
  return decryptValue(entry.encryptedValue, entry.iv, entry.authTag, entry.keyVersion);
}

export async function rotateSecret(secretId: string, newValue: string) {
  const existing = await prisma.secretEntry.findUniqueOrThrow({ where: { id: secretId } });
  const envelope = encryptValue(newValue, existing.keyVersion + 1);
  return prisma.secretEntry.update({
    where: { id: secretId },
    data: {
      encryptedValue: envelope.encryptedValue,
      iv: envelope.iv,
      authTag: envelope.authTag,
      keyVersion: envelope.keyVersion,
      lastRotatedAt: new Date(),
    },
  });
}

export async function listSecrets(
  scope?: SecretScope | undefined,
  orgId?: string | undefined
) {
  const where: Record<string, unknown> = {};
  if (scope !== undefined) where.scope = scope;
  if (orgId !== undefined) where.orgId = orgId;

  return prisma.secretEntry.findMany({
    where: where as Prisma.SecretEntryWhereInput,
    select: {
      id: true,
      name: true,
      scope: true,
      orgId: true,
      keyVersion: true,
      rotateAfterDays: true,
      lastRotatedAt: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { name: "asc" },
  });
}

export async function deleteSecret(secretId: string) {
  return prisma.secretEntry.delete({ where: { id: secretId } });
}

// ─── Key Rotation Scheduling ────────────────────────────────────────────

export async function createRotationSchedule(input: {
  secretId: string;
  cronExpression?: string | undefined;
}) {
  const nextRun = new Date();
  nextRun.setDate(nextRun.getDate() + 30); // default: 30 days from now

  const data: Record<string, unknown> = {
    secretId: input.secretId,
    nextRunAt: nextRun,
  };
  if (input.cronExpression !== undefined) data.cronExpression = input.cronExpression;

  return prisma.keyRotationSchedule.create({
    data: data as Parameters<typeof prisma.keyRotationSchedule.create>[0]["data"],
  });
}

export async function getDueRotations() {
  return prisma.keyRotationSchedule.findMany({
    where: {
      isActive: true,
      nextRunAt: { lte: new Date() },
    },
    include: { secret: true },
    orderBy: { nextRunAt: "asc" },
  });
}

export async function markRotationComplete(scheduleId: string, nextRunAt: Date) {
  return prisma.keyRotationSchedule.update({
    where: { id: scheduleId },
    data: { lastRunAt: new Date(), nextRunAt, failCount: 0, lastError: null },
  });
}

export async function markRotationFailed(scheduleId: string, error: string) {
  return prisma.keyRotationSchedule.update({
    where: { id: scheduleId },
    data: { failCount: { increment: 1 }, lastError: error },
  });
}

export async function getSecretsNeedingRotation() {
  const now = new Date();
  return prisma.secretEntry.findMany({
    where: {
      rotateAfterDays: { not: null },
      OR: [
        { lastRotatedAt: null },
        {
          lastRotatedAt: {
            lt: new Date(now.getTime() - 1), // will need refinement per-secret
          },
        },
      ],
    },
    orderBy: { lastRotatedAt: "asc" },
  });
}
