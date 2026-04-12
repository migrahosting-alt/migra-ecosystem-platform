import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { safeApiHandler } from "@/lib/security/safe-api-handler";
import { getVpsCapabilities } from "@/lib/vps/access";
import { resolveActorRole } from "@/lib/vps/authz";
import { getVpsDiagnosticsState } from "@/lib/vps/data";

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
  if (!getVpsCapabilities(resolvedRole.role).canOpenSupport) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const diagnostics = await getVpsDiagnosticsState(serverId, membership.orgId);

  if (!diagnostics) {
    return NextResponse.json({ error: "VPS server not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(diagnostics, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="vps-${serverId}-diagnostics.json"`,
    },
  });
});