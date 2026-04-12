import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedInternalDriveRequest, unauthorizedDriveResponse } from "@/lib/drive/drive-internal-auth";
import { getDriveTenantByOrgId } from "@/lib/drive/drive-tenant-lookup";
import { serializeDriveTenant } from "@/lib/drive/drive-tenant-serializers";

export async function GET(request: NextRequest, context: { params: Promise<{ orgId: string }> }) {
  if (!isAuthorizedInternalDriveRequest(request)) {
    return unauthorizedDriveResponse();
  }

  const { orgId } = await context.params;
  const tenant = await getDriveTenantByOrgId(orgId);

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  return NextResponse.json(serializeDriveTenant(tenant));
}
