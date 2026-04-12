import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { safeApiHandler } from "@/lib/security/safe-api-handler";
import { getVpsCapabilities } from "@/lib/vps/access";
import { listVpsAlertEvents, syncVpsAlertState } from "@/lib/vps/alerts";
import { resolveActorRole } from "@/lib/vps/authz";

export const GET = safeApiHandler(async function GET(
  _request: Request,
  context: { params: Promise<{ serverId: string }> },
) {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const membership = await getActiveOrgContext(authResult.session.user.id);
  if (!membership) {
    return NextResponse.json({ error: "No active organization context." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const { serverId } = await context.params;
  const resolvedRole = await resolveActorRole({
    userId: authResult.session.user.id,
    orgId: membership.orgId,
    role: membership.role,
  }, serverId);

  if (!getVpsCapabilities(resolvedRole.role).canView) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const synced = await syncVpsAlertState(serverId, {
    actorUserId: authResult.session.user.id,
  });

  if (!synced) {
    return NextResponse.json({ error: "VPS server not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const alerts = await listVpsAlertEvents(serverId, membership.orgId, { includeResolved: true });
  return NextResponse.json({ items: alerts }, { headers: { "Cache-Control": "no-store" } });
});