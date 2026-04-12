import { NextResponse } from "next/server";
import {
  isAuthorizedInternalDriveRequest,
  unauthorizedDriveResponse,
} from "@/lib/drive/drive-internal-auth";
import { getDriveTenantByEntitlementId } from "@/lib/drive/drive-tenant-lookup";
import { serializeDriveTenant } from "@/lib/drive/drive-tenant-serializers";

export async function GET(
  request: Request,
  context: { params: Promise<{ entitlementId: string }> },
) {
  if (!isAuthorizedInternalDriveRequest(request)) {
    return unauthorizedDriveResponse();
  }

  const { entitlementId } = await context.params;
  const tenant = await getDriveTenantByEntitlementId(entitlementId);

  if (!tenant) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(serializeDriveTenant(tenant));
}