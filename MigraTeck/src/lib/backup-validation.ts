import { createHash } from "node:crypto";
import { type BackupStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ─── Backup CRUD ────────────────────────────────────────────────────────

export async function createBackupRecord(input: {
  orgId?: string | undefined;
  backupType: string;
  storagePath?: string | undefined;
  retentionDays?: number | undefined;
  encryptionKeyVer?: number | undefined;
  initiatedById?: string | undefined;
  metadata?: Prisma.InputJsonValue | undefined;
}) {
  const data: Record<string, unknown> = {
    backupType: input.backupType,
    status: "PENDING",
  };
  if (input.orgId !== undefined) data.orgId = input.orgId;
  if (input.storagePath !== undefined) data.storagePath = input.storagePath;
  if (input.retentionDays !== undefined) data.retentionDays = input.retentionDays;
  if (input.encryptionKeyVer !== undefined) data.encryptionKeyVer = input.encryptionKeyVer;
  if (input.initiatedById !== undefined) data.initiatedById = input.initiatedById;
  if (input.metadata !== undefined) data.metadata = input.metadata;

  return prisma.backupRecord.create({
    data: data as Parameters<typeof prisma.backupRecord.create>[0]["data"],
  });
}

export async function startBackup(backupId: string) {
  return prisma.backupRecord.update({
    where: { id: backupId },
    data: { status: "IN_PROGRESS", startedAt: new Date() },
  });
}

export async function completeBackup(
  backupId: string,
  input: {
    storagePath: string;
    sizeBytes: bigint;
    checksumSha256: string;
  }
) {
  const expiresAt = new Date();
  const record = await prisma.backupRecord.findUniqueOrThrow({ where: { id: backupId } });
  expiresAt.setDate(expiresAt.getDate() + record.retentionDays);

  return prisma.backupRecord.update({
    where: { id: backupId },
    data: {
      status: "COMPLETED",
      storagePath: input.storagePath,
      sizeBytes: input.sizeBytes,
      checksumSha256: input.checksumSha256,
      completedAt: new Date(),
      expiresAt,
    },
  });
}

export async function failBackup(backupId: string, errorMessage: string) {
  return prisma.backupRecord.update({
    where: { id: backupId },
    data: { status: "FAILED", errorMessage },
  });
}

// ─── Validation ─────────────────────────────────────────────────────────

export async function validateBackupIntegrity(
  backupId: string,
  actualChecksum: string,
  validatedById?: string | undefined
) {
  const backup = await prisma.backupRecord.findUniqueOrThrow({ where: { id: backupId } });
  const passed = backup.checksumSha256 === actualChecksum;

  const data: Record<string, unknown> = {
    backupId,
    validationType: "integrity",
    passed,
    details: {
      expectedChecksum: backup.checksumSha256,
      actualChecksum,
      matched: passed,
    } as unknown as Prisma.InputJsonValue,
  };
  if (validatedById !== undefined) data.validatedById = validatedById;

  const validation = await prisma.backupValidation.create({
    data: data as Parameters<typeof prisma.backupValidation.create>[0]["data"],
  });

  if (passed) {
    await prisma.backupRecord.update({
      where: { id: backupId },
      data: { status: "VERIFIED" },
    });
  }

  return validation;
}

export async function recordRestoreTest(
  backupId: string,
  passed: boolean,
  details: Prisma.InputJsonValue,
  validatedById?: string | undefined
) {
  const data: Record<string, unknown> = {
    backupId,
    validationType: "restore_test",
    passed,
    details,
  };
  if (validatedById !== undefined) data.validatedById = validatedById;

  return prisma.backupValidation.create({
    data: data as Parameters<typeof prisma.backupValidation.create>[0]["data"],
  });
}

// ─── Query ──────────────────────────────────────────────────────────────

export async function listBackups(input?: {
  orgId?: string | undefined;
  backupType?: string | undefined;
  status?: BackupStatus | undefined;
}) {
  const where: Record<string, unknown> = {};
  if (input?.orgId !== undefined) where.orgId = input.orgId;
  if (input?.backupType !== undefined) where.backupType = input.backupType;
  if (input?.status !== undefined) where.status = input.status;

  return prisma.backupRecord.findMany({
    where: where as Prisma.BackupRecordWhereInput,
    include: {
      validations: { orderBy: { validatedAt: "desc" as const }, take: 3 },
      initiatedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getBackup(backupId: string) {
  return prisma.backupRecord.findUniqueOrThrow({
    where: { id: backupId },
    include: {
      validations: { orderBy: { validatedAt: "desc" as const } },
      initiatedBy: { select: { id: true, name: true } },
    },
  });
}

export async function getBackupValidations(backupId: string) {
  return prisma.backupValidation.findMany({
    where: { backupId },
    include: { validatedBy: { select: { id: true, name: true } } },
    orderBy: { validatedAt: "desc" },
  });
}

// ─── Cleanup ────────────────────────────────────────────────────────────

export async function cleanupExpiredBackups() {
  const expired = await prisma.backupRecord.findMany({
    where: {
      expiresAt: { lte: new Date() },
      status: { not: "EXPIRED" },
    },
  });

  for (const backup of expired) {
    await prisma.backupRecord.update({
      where: { id: backup.id },
      data: { status: "EXPIRED" },
    });
  }

  return expired.length;
}

export async function getBackupSummary() {
  const [total, verified, failed, expired] = await Promise.all([
    prisma.backupRecord.count(),
    prisma.backupRecord.count({ where: { status: "VERIFIED" } }),
    prisma.backupRecord.count({ where: { status: "FAILED" } }),
    prisma.backupRecord.count({ where: { status: "EXPIRED" } }),
  ]);

  const latestByType = await prisma.backupRecord.groupBy({
    by: ["backupType"],
    _max: { completedAt: true },
    _count: true,
  });

  return {
    total,
    verified,
    failed,
    expired,
    byType: latestByType.map((g) => ({
      type: g.backupType,
      count: g._count,
      lastCompleted: g._max.completedAt,
    })),
  };
}
