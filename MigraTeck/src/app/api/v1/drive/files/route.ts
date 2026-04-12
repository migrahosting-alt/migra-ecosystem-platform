import { DriveFileStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import {
  buildDriveObjectKey,
  DRIVE_SINGLE_UPLOAD_MAX_BYTES,
  normalizeDriveParentPath,
  serializeDriveFile,
} from "@/lib/drive/drive-files";
import { cleanupStalePendingDriveFilesForOrg } from "@/lib/drive/drive-file-maintenance";
import { recordDrivePendingUploadCleanup } from "@/lib/drive/drive-recent-events";
import { buildDriveUploadMetadata, signDriveUploadUrl } from "@/lib/drive/drive-storage";
import { getDriveTenantAccess, requireUploadPermission } from "@/lib/drive/drive-tenant-access";
import { recordDriveCleanupTrigger, recordDriveFileAction, recordDriveFileListLatency } from "@/lib/drive/drive-tenant-metrics";
import { driveSignedUrlTtlSeconds } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";

const createSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive().max(DRIVE_SINGLE_UPLOAD_MAX_BYTES),
  parentPath: z.string().trim().max(1024).optional().nullable(),
  checksumSha256: z.string().trim().regex(/^[a-fA-F0-9]{64}$/).optional().nullable(),
});

const GIB_IN_BYTES = 1024n * 1024n * 1024n;

export async function GET() {
  const startedAt = Date.now();
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const activeOrg = await getActiveOrgContext(authResult.session.user.id);
  if (!activeOrg) {
    return NextResponse.json({ ok: false, error: "organization_context_missing" }, { status: 404 });
  }

  const access = await getDriveTenantAccess(activeOrg.orgId);
  if (!access.ok) {
    return access.response;
  }

  const cleanedCount = await cleanupStalePendingDriveFilesForOrg(activeOrg.orgId);
  await recordDrivePendingUploadCleanup({
    actorId: authResult.session.user.id,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    cleanedCount,
  });
  if (cleanedCount > 0) {
    recordDriveCleanupTrigger(cleanedCount, {
      orgId: activeOrg.orgId,
      trigger: "request_time_list",
    });
  }

  const files = await prisma.driveFile.findMany({
    where: {
      orgId: activeOrg.orgId,
      status: {
        in: [DriveFileStatus.PENDING_UPLOAD, DriveFileStatus.ACTIVE],
      },
    },
    orderBy: [{ createdAt: "desc" }],
  });

  recordDriveFileListLatency(Date.now() - startedAt, {
    orgId: activeOrg.orgId,
  });

  return NextResponse.json({
    ok: true,
    data: files.map(serializeDriveFile),
  });
}

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const activeOrg = await getActiveOrgContext(authResult.session.user.id);
  if (!activeOrg) {
    return NextResponse.json({ ok: false, error: "organization_context_missing" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const access = await getDriveTenantAccess(activeOrg.orgId);
  if (!access.ok) {
    return access.response;
  }

  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  const cleanedCount = await cleanupStalePendingDriveFilesForOrg(activeOrg.orgId);
  await recordDrivePendingUploadCleanup({
    actorId: authResult.session.user.id,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    cleanedCount,
    ip,
    userAgent,
  });
  if (cleanedCount > 0) {
    recordDriveCleanupTrigger(cleanedCount, {
      orgId: activeOrg.orgId,
      trigger: "request_time_upload",
    });
  }

  const uploadPermissionFailure = requireUploadPermission(access.capabilities);
  if (uploadPermissionFailure) {
    return uploadPermissionFailure;
  }

  const pendingAggregate = await prisma.driveFile.aggregate({
    where: {
      orgId: activeOrg.orgId,
      status: DriveFileStatus.PENDING_UPLOAD,
    },
    _sum: {
      sizeBytes: true,
    },
  });

  const quotaBytes = BigInt(access.tenant.storageQuotaGb) * GIB_IN_BYTES;
  const pendingBytes = pendingAggregate._sum.sizeBytes ?? 0n;
  const requestedSizeBytes = BigInt(parsed.data.sizeBytes);
  const projectedUsageBytes = access.tenant.storageUsedBytes + pendingBytes + requestedSizeBytes;

  if (projectedUsageBytes > quotaBytes) {
    return NextResponse.json(
      {
        ok: false,
        error: "tenant_quota_exceeded",
        storageQuotaBytes: quotaBytes.toString(),
        projectedUsageBytes: projectedUsageBytes.toString(),
      },
      { status: 409 },
    );
  }

  const file = await prisma.driveFile.create({
    data: {
      tenantId: access.tenant.id,
      orgId: activeOrg.orgId,
      objectKey: "pending",
      fileName: parsed.data.fileName,
      parentPath: normalizeDriveParentPath(parsed.data.parentPath),
      mimeType: parsed.data.mimeType,
      sizeBytes: requestedSizeBytes,
      checksumSha256: parsed.data.checksumSha256 || null,
    },
  });

  const objectKey = buildDriveObjectKey({
    tenantId: access.tenant.id,
    fileId: file.id,
  });

  const updatedFile = await prisma.driveFile.update({
    where: { id: file.id },
    data: { objectKey },
  });

  const uploadUrl = await signDriveUploadUrl({
    fileKey: objectKey,
    mimeType: updatedFile.mimeType,
    ttlSeconds: driveSignedUrlTtlSeconds,
    metadata: buildDriveUploadMetadata({
      tenantId: access.tenant.id,
      fileId: updatedFile.id,
      versionId: "v1",
      planCode: access.tenant.planCode,
      checksum: updatedFile.checksumSha256,
      uploadedBy: authResult.session.user.id,
      origin: "web",
    }),
  });

  await writeAuditLog({
    actorId: authResult.session.user.id,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "DRIVE_FILE_UPLOAD_INITIATED",
    resourceType: "drive_file",
    resourceId: updatedFile.id,
    ip,
    userAgent,
    riskTier: 1,
    metadata: {
      fileName: updatedFile.fileName,
      objectKey,
      parentPath: updatedFile.parentPath,
      sizeBytes: updatedFile.sizeBytes.toString(),
      mimeType: updatedFile.mimeType,
    },
  });
  recordDriveFileAction("upload_initiated", {
    orgId: activeOrg.orgId,
  });

  return NextResponse.json({
    ok: true,
    data: {
      file: serializeDriveFile(updatedFile),
      uploadUrl,
      expiresInSeconds: driveSignedUrlTtlSeconds,
    },
  });
}