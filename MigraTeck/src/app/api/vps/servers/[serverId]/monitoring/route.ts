import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { safeApiHandler } from "@/lib/security/safe-api-handler";
import { assertProviderCapability } from "@/lib/vps/provider-support";
import { getServerProviderContext } from "@/lib/vps/queries";
import { getVpsProviderAdapter } from "@/lib/vps/providers";
import { getVpsMonitoringState } from "@/lib/vps/data";

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
  const server = await getServerProviderContext(serverId, membership.orgId);
  if (!server) {
    return NextResponse.json({ error: "VPS server not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const provider = getVpsProviderAdapter(server.providerSlug);
  assertProviderCapability({ providerSlug: server.providerSlug, capabilities: provider.capabilities, capability: "metrics" });

  const monitoring = await getVpsMonitoringState(serverId, membership.orgId);

  if (!monitoring) {
    return NextResponse.json({ error: "VPS server not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(monitoring, { headers: { "Cache-Control": "no-store" } });
});
