import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "../../../../lib/auth";
import { deleteWebsiteEnvVar, loadWebsiteTenantId } from "../../../../lib/modules/hosting-actions";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string; envId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id, envId } = await context.params;
  if (!id || !envId) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const tenantId = await loadWebsiteTenantId(id);
  if (!tenantId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const deleted = await deleteWebsiteEnvVar(tenantId, id, envId, { actorUserId: session.email });
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ deleted: true, id: envId, websiteId: id });
}