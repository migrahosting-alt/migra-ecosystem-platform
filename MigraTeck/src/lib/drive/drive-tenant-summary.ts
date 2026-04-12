import type { DriveTenant } from "@prisma/client";
import { DriveFileStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDrivePendingUploadCutoff } from "./drive-file-maintenance";
import { getDriveLastCleanupAt } from "./drive-recent-events";

export interface DriveTenantSummary {
  storageQuotaGb: number;
  storageUsedBytes: string;
  activeFileCount: number;
  pendingUploadCount: number;
  stalePendingUploadCount: number;
  lastCleanupAt: string | null;
}

type DriveTenantSummaryShape = Pick<DriveTenant, "storageQuotaGb" | "storageUsedBytes">;

export function mapDriveTenantSummary(
  tenant: DriveTenantSummaryShape,
  counts: {
    activeFileCount: number;
    pendingUploadCount: number;
    stalePendingUploadCount: number;
    lastCleanupAt: string | null;
  },
): DriveTenantSummary {
  return {
    storageQuotaGb: tenant.storageQuotaGb,
    storageUsedBytes:
      typeof tenant.storageUsedBytes === "bigint"
        ? tenant.storageUsedBytes.toString()
        : String(tenant.storageUsedBytes),
    activeFileCount: counts.activeFileCount,
    pendingUploadCount: counts.pendingUploadCount,
    stalePendingUploadCount: counts.stalePendingUploadCount,
    lastCleanupAt: counts.lastCleanupAt,
  };
}

export async function getDriveTenantSummary(
  orgId: string,
  tenant: DriveTenantSummaryShape | null | undefined,
): Promise<DriveTenantSummary | null> {
  if (!tenant) {
    return null;
  }

  const pendingCutoff = getDrivePendingUploadCutoff();
  const [activeFileCount, pendingUploadCount, stalePendingUploadCount, lastCleanupAt] = await Promise.all([
    prisma.driveFile.count({
      where: {
        orgId,
        status: DriveFileStatus.ACTIVE,
      },
    }),
    prisma.driveFile.count({
      where: {
        orgId,
        status: DriveFileStatus.PENDING_UPLOAD,
        createdAt: { gte: pendingCutoff },
      },
    }),
    prisma.driveFile.count({
      where: {
        orgId,
        status: DriveFileStatus.PENDING_UPLOAD,
        createdAt: { lt: pendingCutoff },
      },
    }),
    getDriveLastCleanupAt(orgId),
  ]);

  return mapDriveTenantSummary(tenant, {
    activeFileCount,
    pendingUploadCount,
    stalePendingUploadCount,
    lastCleanupAt,
  });
}