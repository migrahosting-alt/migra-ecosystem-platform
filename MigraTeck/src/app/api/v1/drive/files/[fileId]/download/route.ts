import { DriveFileStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { serializeDriveFile } from "@/lib/drive/drive-files";
import { signDriveDownloadUrl } from "@/lib/drive/drive-storage";
import { getDriveTenantAccess, requireDownloadPermission } from "@/lib/drive/drive-tenant-access";
import { recordDriveFileAction } from "@/lib/drive/drive-tenant-metrics";
import { driveSignedUrlTtlSeconds } from "@/lib/env";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
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

  const downloadPermissionFailure = requireDownloadPermission(access.capabilities);
  if (downloadPermissionFailure) {
    return downloadPermissionFailure;
  }

  const { fileId } = await context.params;
  const file = await prisma.driveFile.findFirst({
    where: {
      id: fileId,
      orgId: activeOrg.orgId,
      status: DriveFileStatus.ACTIVE,
    },
  });

  if (!file) {
    return NextResponse.json({ ok: false, error: "file_not_found" }, { status: 404 });
  }

  const signedUrl = await signDriveDownloadUrl(file.objectKey, driveSignedUrlTtlSeconds);

  await writeAuditLog({
    actorId: authResult.session.user.id,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "DRIVE_FILE_DOWNLOAD_SIGNED_URL_ISSUED",
    resourceType: "drive_file",
    resourceId: file.id,
    riskTier: 1,
    metadata: {
      fileName: file.fileName,
      objectKey: file.objectKey,
      ttlSeconds: driveSignedUrlTtlSeconds,
    },
  });
  recordDriveFileAction("download_url_issued", {
    orgId: activeOrg.orgId,
  });

  return NextResponse.json({
    ok: true,
    data: {
      file: serializeDriveFile(file),
      signedUrl,
      expiresInSeconds: driveSignedUrlTtlSeconds,
    },
  });
}