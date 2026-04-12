import type { DriveFile } from "@prisma/client";
import { driveMaxUploadSizeBytes } from "@/lib/env";

export const DRIVE_SINGLE_UPLOAD_MAX_BYTES = driveMaxUploadSizeBytes;

function sanitizePathSegment(value: string): string {
  return value
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "file";
}

export function normalizeDriveParentPath(parentPath?: string | null): string | null {
  if (!parentPath) {
    return null;
  }

  const normalized = parentPath
    .split("/")
    .map((segment) => sanitizePathSegment(segment))
    .filter(Boolean)
    .join("/");

  return normalized || null;
}

export function buildDriveObjectKey(input: {
  tenantId: string;
  fileId: string;
  version?: number;
}): string {
  const version = Math.max(1, input.version ?? 1);
  return `tenants/${input.tenantId}/files/${input.fileId}/v${version}`;
}

export function serializeDriveFile(file: DriveFile) {
  return {
    id: file.id,
    tenantId: file.tenantId,
    orgId: file.orgId,
    objectKey: file.objectKey,
    fileName: file.fileName,
    parentPath: file.parentPath,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes.toString(),
    checksumSha256: file.checksumSha256,
    status: file.status,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
    uploadedAt: file.uploadedAt?.toISOString() ?? null,
    deletedAt: file.deletedAt?.toISOString() ?? null,
  };
}