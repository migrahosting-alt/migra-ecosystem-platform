import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedInternalDriveRequest, unauthorizedDriveResponse } from "@/lib/drive/drive-internal-auth";
import { getDriveTenantByOrgSlug } from "@/lib/drive/drive-tenant-lookup";
import { serializeDriveTenant } from "@/lib/drive/drive-tenant-serializers";

export async function GET(request: NextRequest, context: { params: Promise<{ orgSlug: string }> }) {
  if (!isAuthorizedInternalDriveRequest(request)) {
    return unauthorizedDriveResponse();
  }

  const { orgSlug } = await context.params;
  const tenant = await getDriveTenantByOrgSlug(orgSlug);

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  return NextResponse.json(serializeDriveTenant(tenant));
}
