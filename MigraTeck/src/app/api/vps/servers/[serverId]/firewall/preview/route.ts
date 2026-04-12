import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { previewFirewallProfile } from "@/lib/vps/firewall/apply";
import { firewallProfileSchema } from "@/lib/vps/firewall/validation";
import { requireSameOrigin } from "@/lib/security/csrf";

export async function POST(request: NextRequest, context: { params: Promise<{ serverId: string }> }) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) return csrfFailure;

  const authResult = await requireApiSession();
  if (!authResult.ok) return authResult.response;

  const membership = await getActiveOrgContext(authResult.session.user.id);
  if (!membership) return NextResponse.json({ error: "No active organization context." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = body ? firewallProfileSchema.safeParse(body) : { success: true as const, data: undefined };
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid firewall payload.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { serverId } = await context.params;
    const preview = await previewFirewallProfile({
      serverId,
      orgId: membership.orgId,
      ...(parsed.data ? { state: parsed.data } : {}),
    });
    return NextResponse.json(preview, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof Error && "httpStatus" in error && typeof (error as { httpStatus?: unknown }).httpStatus === "number"
      ? (error as { httpStatus: number }).httpStatus
      : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to preview firewall changes." }, { status });
  }
}
