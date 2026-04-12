import { DriveFileStatus, DriveTenantStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { serializeDriveFile } from "@/lib/drive/drive-files";
import { getDriveTenantAccess } from "@/lib/drive/drive-tenant-access";
import { restrictTenant } from "@/lib/drive/drive-tenant-lifecycle";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";

const GIB_IN_BYTES = 1024n * 1024n * 1024n;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ fileId: string }> },
) {
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

  const access = await getDriveTenantAccess(activeOrg.orgId);
  if (!access.ok) {
    return access.response;
  }

  const { fileId } = await context.params;
  const file = await prisma.driveFile.findFirst({
    where: {
      id: fileId,
      orgId: activeOrg.orgId,
    },
  });

  if (!file || file.status === DriveFileStatus.DELETED) {
    return NextResponse.json({ ok: false, error: "file_not_found" }, { status: 404 });
  }

  if (file.status === DriveFileStatus.ACTIVE) {
    return NextResponse.json({ ok: true, data: { file: serializeDriveFile(file) } });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const currentFile = await tx.driveFile.findUniqueOrThrow({ where: { id: file.id } });
    const currentTenant = await tx.driveTenant.findUniqueOrThrow({ where: { id: access.tenant.id } });

    if (currentFile.status === DriveFileStatus.ACTIVE) {
      return {
        file: currentFile,
        tenant: currentTenant,
      };
    }

    if (currentFile.status !== DriveFileStatus.PENDING_UPLOAD) {
      throw new Error("file_not_finalizable");
    }

    const updatedFile = await tx.driveFile.update({
      where: { id: currentFile.id },
      data: {
        status: DriveFileStatus.ACTIVE,
        uploadedAt: new Date(),
      },
    });

    const updatedTenant = await tx.driveTenant.update({
      where: { id: currentTenant.id },
      data: {
        storageUsedBytes: {
          increment: currentFile.sizeBytes,
        },
      },
    });

    return {
      file: updatedFile,
      tenant: updatedTenant,
    };
  });

  const quotaBytes = BigInt(updated.tenant.storageQuotaGb) * GIB_IN_BYTES;
  if (
    updated.tenant.status === DriveTenantStatus.ACTIVE
    && updated.tenant.storageUsedBytes > quotaBytes
  ) {
    await restrictTenant({
      tenantId: updated.tenant.id,
      reason: "quota_exceeded",
      actorType: "SYSTEM",
      actorId: "drive-file-finalize",
      metadata: {
        fileId: updated.file.id,
      },
    });
  }

  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  await writeAuditLog({
    actorId: authResult.session.user.id,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "DRIVE_FILE_UPLOAD_FINALIZED",
    resourceType: "drive_file",
    resourceId: updated.file.id,
    ip,
    userAgent,
    riskTier: 1,
    metadata: {
      fileName: updated.file.fileName,
      objectKey: updated.file.objectKey,
      sizeBytes: updated.file.sizeBytes.toString(),
      storageUsedBytes: updated.tenant.storageUsedBytes.toString(),
    },
  });

  return NextResponse.json({
    ok: true,
    data: {
      file: serializeDriveFile(updated.file),
      storageUsedBytes: updated.tenant.storageUsedBytes.toString(),
    },
  });
}