import { NextRequest, NextResponse } from "next/server";
import { firewallProfileSchema } from "@/lib/vps/firewall/validation";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { saveFirewallDraft } from "@/lib/vps/firewall/apply";
import { safeApiHandler } from "@/lib/security/safe-api-handler";
import { getVpsFirewallState } from "@/lib/vps/data";
import { requireSameOrigin } from "@/lib/security/csrf";

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
  const firewall = await getVpsFirewallState(serverId, membership.orgId);

  if (!firewall) {
    return NextResponse.json({ error: "VPS server not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(firewall, { headers: { "Cache-Control": "no-store" } });
});

export async function PUT(request: NextRequest, context: { params: Promise<{ serverId: string }> }) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) return csrfFailure;

  const authResult = await requireApiSession();
  if (!authResult.ok) return authResult.response;

  const membership = await getActiveOrgContext(authResult.session.user.id);
  if (!membership) {
    return NextResponse.json({ error: "No active organization context." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = firewallProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid firewall payload.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { serverId } = await context.params;
    const result = await saveFirewallDraft({
      serverId,
      orgId: membership.orgId,
      state: parsed.data,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof Error && "httpStatus" in error && typeof (error as { httpStatus?: unknown }).httpStatus === "number"
      ? (error as { httpStatus: number }).httpStatus
      : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to save firewall draft." }, { status });
  }
}
