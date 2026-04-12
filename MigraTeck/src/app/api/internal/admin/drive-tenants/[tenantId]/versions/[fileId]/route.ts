import { NextRequest, NextResponse } from "next/server";
import { getDriveFileVersionsForOps } from "@/lib/drive/drive-ops";
import { isAuthorizedInternalDriveRequest, unauthorizedDriveResponse } from "@/lib/drive/drive-internal-auth";
import { getDriveTenantById } from "@/lib/drive/drive-tenant-lookup";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ tenantId: string; fileId: string }> },
) {
  if (!isAuthorizedInternalDriveRequest(request)) {
    return unauthorizedDriveResponse();
  }

  const { tenantId, fileId } = await context.params;
  const tenant = await getDriveTenantById(tenantId);
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const versions = await getDriveFileVersionsForOps(tenantId, fileId);
  if (!versions) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  return NextResponse.json({
    versioningMode: versions.versioningMode,
    items: versions.items.map((item) => ({
      ...item,
      sizeBytes: item.sizeBytes.toString(),
      createdAt: item.createdAt.toISOString(),
      uploadedAt: item.uploadedAt?.toISOString() ?? null,
      deletedAt: item.deletedAt?.toISOString() ?? null,
    })),
  });
}