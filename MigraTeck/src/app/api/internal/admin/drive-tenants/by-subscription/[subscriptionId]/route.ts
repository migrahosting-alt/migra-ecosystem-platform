import { NextResponse } from "next/server";
import {
  isAuthorizedInternalDriveRequest,
  unauthorizedDriveResponse,
} from "@/lib/drive/drive-internal-auth";
import { getDriveTenantBySubscriptionId } from "@/lib/drive/drive-tenant-lookup";
import { serializeDriveTenant } from "@/lib/drive/drive-tenant-serializers";

export async function GET(
  request: Request,
  context: { params: Promise<{ subscriptionId: string }> },
) {
  if (!isAuthorizedInternalDriveRequest(request)) {
    return unauthorizedDriveResponse();
  }

  const { subscriptionId } = await context.params;
  const tenant = await getDriveTenantBySubscriptionId(subscriptionId);

  if (!tenant) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(serializeDriveTenant(tenant));
}