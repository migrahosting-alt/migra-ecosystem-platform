import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encryptValue, decryptValue } from "@/lib/secrets";

// ─── Store Encrypted Blob Metadata ──────────────────────────────────────

export async function registerEncryptedBlob(input: {
  orgId?: string | undefined;
  bucketName: string;
  objectKey: string;
  mimeType?: string | undefined;
  sizeBytes?: bigint | undefined;
  checksumSha256?: string | undefined;
  keyVersion?: number | undefined;
  metadata?: Prisma.InputJsonValue | undefined;
  expiresAt?: Date | undefined;
  createdById?: string | undefined;
}) {
  const data: Record<string, unknown> = {
    bucketName: input.bucketName,
    objectKey: input.objectKey,
  };
  if (input.orgId !== undefined) data.orgId = input.orgId;
  if (input.mimeType !== undefined) data.mimeType = input.mimeType;
  if (input.sizeBytes !== undefined) data.sizeBytes = input.sizeBytes;
  if (input.checksumSha256 !== undefined) data.checksumSha256 = input.checksumSha256;
  if (input.keyVersion !== undefined) data.keyVersion = input.keyVersion;
  if (input.metadata !== undefined) data.metadata = input.metadata;
  if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt;
  if (input.createdById !== undefined) data.createdById = input.createdById;

  return prisma.encryptedBlob.create({
    data: data as Parameters<typeof prisma.encryptedBlob.create>[0]["data"],
  });
}

// ─── Encrypt + Register ─────────────────────────────────────────────────

export function computeSha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function encryptBuffer(
  plaintext: Buffer,
  keyVersion = 1
): { ciphertext: Buffer; iv: string; authTag: string; keyVersion: number } {
  const result = encryptValue(plaintext.toString("base64"), keyVersion);
  return {
    ciphertext: Buffer.from(result.encryptedValue, "base64"),
    iv: result.iv,
    authTag: result.authTag,
    keyVersion: result.keyVersion,
  };
}

export function decryptBuffer(
  ciphertext: Buffer,
  iv: string,
  authTag: string,
  keyVersion = 1
): Buffer {
  const plainB64 = decryptValue(ciphertext.toString("base64"), iv, authTag, keyVersion);
  return Buffer.from(plainB64, "base64");
}

// ─── Query ──────────────────────────────────────────────────────────────

export async function getBlob(bucketName: string, objectKey: string) {
  return prisma.encryptedBlob.findUnique({
    where: { bucketName_objectKey: { bucketName, objectKey } },
  });
}

export async function listBlobs(
  bucketName: string,
  orgId?: string | undefined
) {
  const where: Record<string, unknown> = { bucketName };
  if (orgId !== undefined) where.orgId = orgId;

  return prisma.encryptedBlob.findMany({
    where: where as Prisma.EncryptedBlobWhereInput,
    orderBy: { createdAt: "desc" },
  });
}

export async function deleteBlob(bucketName: string, objectKey: string) {
  return prisma.encryptedBlob.delete({
    where: { bucketName_objectKey: { bucketName, objectKey } },
  });
}

export async function cleanupExpiredBlobs() {
  const result = await prisma.encryptedBlob.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return result.count;
}
