import { DriveFileStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const DRIVE_PENDING_UPLOAD_STALE_HOURS = 24;

export function getDrivePendingUploadCutoff(now = new Date()): Date {
  return new Date(now.getTime() - DRIVE_PENDING_UPLOAD_STALE_HOURS * 60 * 60 * 1000);
}

export async function cleanupStalePendingDriveFilesForOrg(orgId: string, now = new Date()): Promise<number> {
  const cutoff = getDrivePendingUploadCutoff(now);
  const result = await prisma.driveFile.updateMany({
    where: {
      orgId,
      status: DriveFileStatus.PENDING_UPLOAD,
      createdAt: { lt: cutoff },
    },
    data: {
      status: DriveFileStatus.DELETED,
      deletedAt: now,
    },
  });

  return result.count;
}