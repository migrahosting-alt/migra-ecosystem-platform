import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { safeApiHandler } from "@/lib/security/safe-api-handler";
import { listVpsActivity } from "@/lib/vps/data";

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
  const activity = await listVpsActivity(serverId, membership.orgId);

  if (!activity) {
    return NextResponse.json({ error: "VPS server not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(activity, { headers: { "Cache-Control": "no-store" } });
});
