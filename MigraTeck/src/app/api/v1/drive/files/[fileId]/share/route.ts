import { DriveFileStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { serializeDriveFile } from "@/lib/drive/drive-files";
import { signDriveDownloadUrl } from "@/lib/drive/drive-storage";
import { getDriveTenantAccess, requireSharePermission } from "@/lib/drive/drive-tenant-access";
import { recordDriveFileAction } from "@/lib/drive/drive-tenant-metrics";
import { driveSignedUrlTtlSeconds } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";

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

  const sharePermissionFailure = requireSharePermission(access.capabilities);
  if (sharePermissionFailure) {
    return sharePermissionFailure;
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

  const shareUrl = await signDriveDownloadUrl(file.objectKey, driveSignedUrlTtlSeconds);
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  await writeAuditLog({
    actorId: authResult.session.user.id,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "DRIVE_FILE_SHARE_LINK_ISSUED",
    resourceType: "drive_file",
    resourceId: file.id,
    ip,
    userAgent,
    riskTier: 1,
    metadata: {
      fileName: file.fileName,
      objectKey: file.objectKey,
      ttlSeconds: driveSignedUrlTtlSeconds,
    },
  });
  recordDriveFileAction("share_link_issued", {
    orgId: activeOrg.orgId,
  });

  return NextResponse.json({
    ok: true,
    data: {
      file: serializeDriveFile(file),
      shareUrl,
      expiresInSeconds: driveSignedUrlTtlSeconds,
    },
  });
}