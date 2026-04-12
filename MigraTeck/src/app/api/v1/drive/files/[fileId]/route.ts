import { DriveFileStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import {
  normalizeDriveParentPath,
  serializeDriveFile,
} from "@/lib/drive/drive-files";
import {
  getDriveTenantAccess,
  requireDeletePermission,
  requireMovePermission,
  requireRenamePermission,
} from "@/lib/drive/drive-tenant-access";
import { recordDriveFileAction } from "@/lib/drive/drive-tenant-metrics";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";

const patchSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255).optional(),
    parentPath: z.string().trim().max(1024).optional().nullable(),
  })
  .refine((value) => value.fileName !== undefined || value.parentPath !== undefined, {
    message: "At least one field must be provided.",
  });

async function authorize(request: NextRequest) {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult;
  }

  const activeOrg = await getActiveOrgContext(authResult.session.user.id);
  if (!activeOrg) {
    return {
      ok: false as const,
      response: NextResponse.json({ ok: false, error: "organization_context_missing" }, { status: 404 }),
    };
  }

  const access = await getDriveTenantAccess(activeOrg.orgId);
  if (!access.ok) {
    return access;
  }

  return {
    ok: true as const,
    authResult,
    activeOrg,
    access,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
  };
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ fileId: string }> },
) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const auth = await authorize(request);
  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }

  const { fileId } = await context.params;
  const file = await prisma.driveFile.findFirst({
    where: {
      id: fileId,
      orgId: auth.activeOrg.orgId,
      status: {
        not: DriveFileStatus.DELETED,
      },
    },
  });

  if (!file) {
    return NextResponse.json({ ok: false, error: "file_not_found" }, { status: 404 });
  }

  if (file.status !== DriveFileStatus.ACTIVE) {
    return NextResponse.json({ ok: false, error: "file_not_mutable" }, { status: 409 });
  }

  const normalizedParentPath =
    parsed.data.parentPath === undefined
      ? file.parentPath
      : normalizeDriveParentPath(parsed.data.parentPath);
  const nextFileName = parsed.data.fileName ?? file.fileName;
  const renameRequested = parsed.data.fileName !== undefined && nextFileName !== file.fileName;
  const moveRequested = parsed.data.parentPath !== undefined && normalizedParentPath !== file.parentPath;

  if (renameRequested) {
    const renamePermissionFailure = requireRenamePermission(auth.access.capabilities);
    if (renamePermissionFailure) {
      return renamePermissionFailure;
    }
  }

  if (moveRequested) {
    const movePermissionFailure = requireMovePermission(auth.access.capabilities);
    if (movePermissionFailure) {
      return movePermissionFailure;
    }
  }

  if (!renameRequested && !moveRequested) {
    return NextResponse.json({ ok: true, data: { file: serializeDriveFile(file) } });
  }

  const updatedFile = await prisma.driveFile.update({
    where: { id: file.id },
    data: {
      fileName: nextFileName,
      parentPath: normalizedParentPath,
    },
  });

  await writeAuditLog({
    actorId: auth.authResult.session.user.id,
    actorRole: auth.activeOrg.role,
    orgId: auth.activeOrg.orgId,
    action: "DRIVE_FILE_METADATA_UPDATED",
    resourceType: "drive_file",
    resourceId: updatedFile.id,
    ip: auth.ip,
    userAgent: auth.userAgent,
    riskTier: 1,
    metadata: {
      fileName: nextFileName,
      renameRequested,
      moveRequested,
      previousFileName: file.fileName,
      nextFileName,
      previousParentPath: file.parentPath,
      nextParentPath: normalizedParentPath,
      objectKey: updatedFile.objectKey,
    },
  });
  recordDriveFileAction(renameRequested ? "metadata_rename" : "metadata_move", {
    orgId: auth.activeOrg.orgId,
  });

  return NextResponse.json({
    ok: true,
    data: {
      file: serializeDriveFile(updatedFile),
    },
  });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ fileId: string }> },
) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const auth = await authorize(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { fileId } = await context.params;
  const file = await prisma.driveFile.findFirst({
    where: {
      id: fileId,
      orgId: auth.activeOrg.orgId,
      status: {
        not: DriveFileStatus.DELETED,
      },
    },
  });

  if (!file) {
    return NextResponse.json({ ok: false, error: "file_not_found" }, { status: 404 });
  }

  if (file.status === DriveFileStatus.ACTIVE) {
    const deletePermissionFailure = requireDeletePermission(auth.access.capabilities);
    if (deletePermissionFailure) {
      return deletePermissionFailure;
    }
  }

  const deleted = await prisma.$transaction(async (tx) => {
    const currentFile = await tx.driveFile.findUniqueOrThrow({ where: { id: file.id } });
    const currentTenant = await tx.driveTenant.findUniqueOrThrow({ where: { id: auth.access.tenant.id } });
    const nextStorageUsedBytes =
      currentFile.status === DriveFileStatus.ACTIVE
        ? currentTenant.storageUsedBytes > currentFile.sizeBytes
          ? currentTenant.storageUsedBytes - currentFile.sizeBytes
          : 0n
        : currentTenant.storageUsedBytes;

    const updatedFile = await tx.driveFile.update({
      where: { id: currentFile.id },
      data: {
        status: DriveFileStatus.DELETED,
        deletedAt: new Date(),
      },
    });

    const updatedTenant =
      currentFile.status === DriveFileStatus.ACTIVE
        ? await tx.driveTenant.update({
            where: { id: currentTenant.id },
            data: {
              storageUsedBytes: nextStorageUsedBytes,
            },
          })
        : currentTenant;

    return {
      file: updatedFile,
      tenant: updatedTenant,
      releasedBytes: currentFile.status === DriveFileStatus.ACTIVE ? currentFile.sizeBytes : 0n,
    };
  });

  await writeAuditLog({
    actorId: auth.authResult.session.user.id,
    actorRole: auth.activeOrg.role,
    orgId: auth.activeOrg.orgId,
    action:
      deleted.releasedBytes > 0n
        ? "DRIVE_FILE_DELETED"
        : "DRIVE_FILE_PENDING_UPLOAD_CANCELED",
    resourceType: "drive_file",
    resourceId: deleted.file.id,
    ip: auth.ip,
    userAgent: auth.userAgent,
    riskTier: 1,
    metadata: {
      fileName: deleted.file.fileName,
      objectKey: deleted.file.objectKey,
      previousStatus: file.status,
      releasedBytes: deleted.releasedBytes.toString(),
      storageUsedBytes: deleted.tenant.storageUsedBytes.toString(),
    },
  });
  recordDriveFileAction(
    deleted.releasedBytes > 0n ? "delete" : "pending_cancel",
    {
      orgId: auth.activeOrg.orgId,
    },
  );

  return NextResponse.json({
    ok: true,
    data: {
      file: serializeDriveFile(deleted.file),
      storageUsedBytes: deleted.tenant.storageUsedBytes.toString(),
      releasedBytes: deleted.releasedBytes.toString(),
    },
  });
}