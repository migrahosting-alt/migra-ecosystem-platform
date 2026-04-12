import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedInternalDriveRequest, unauthorizedDriveResponse } from "@/lib/drive/drive-internal-auth";
import { getDriveTenantById } from "@/lib/drive/drive-tenant-lookup";
import { serializeDriveTenant } from "@/lib/drive/drive-tenant-serializers";

export async function GET(request: NextRequest, context: { params: Promise<{ tenantId: string }> }) {
  if (!isAuthorizedInternalDriveRequest(request)) {
    return unauthorizedDriveResponse();
  }

  const { tenantId } = await context.params;
  const tenant = await getDriveTenantById(tenantId);

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  return NextResponse.json(serializeDriveTenant(tenant));
}
