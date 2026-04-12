import { NextRequest, NextResponse } from "next/server";
import { getDriveStorageHealth } from "@/lib/drive/drive-ops";
import { isAuthorizedInternalDriveRequest, unauthorizedDriveResponse } from "@/lib/drive/drive-internal-auth";
import { serializeDriveTenantOperation } from "@/lib/drive/drive-tenant-serializers";

export async function GET(request: NextRequest) {
  if (!isAuthorizedInternalDriveRequest(request)) {
    return unauthorizedDriveResponse();
  }

  const health = await getDriveStorageHealth();

  return NextResponse.json({
    ...health,
    lastReconcilerRun: health.lastReconcilerRun ? serializeDriveTenantOperation(health.lastReconcilerRun) : null,
    lastFailedStorageAction: health.lastFailedStorageAction ? serializeDriveTenantOperation(health.lastFailedStorageAction) : null,
  });
}