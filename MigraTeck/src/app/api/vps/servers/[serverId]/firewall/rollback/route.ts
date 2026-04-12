import { NextRequest, NextResponse } from "next/server";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { rollbackFirewallProfile } from "@/lib/vps/firewall/apply";
import { getClientIp } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";

export async function POST(request: NextRequest, context: { params: Promise<{ serverId: string }> }) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) return csrfFailure;

  const authResult = await requireApiSession();
  if (!authResult.ok) return authResult.response;

  const membership = await getActiveOrgContext(authResult.session.user.id);
  if (!membership) return NextResponse.json({ error: "No active organization context." }, { status: 404 });

  const { serverId } = await context.params;
  const ip = getClientIp(request);
  const limiter = await assertRateLimit({
    key: `${authResult.session.user.id}:${membership.orgId}:${serverId}:${ip}`,
    action: "vps:firewall:rollback",
    maxAttempts: 6,
    windowSeconds: 15 * 60,
  });
  if (!limiter.ok) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } });
  }

  try {
    const result = await rollbackFirewallProfile({
      serverId,
      orgId: membership.orgId,
      actorUserId: authResult.session.user.id,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof Error && "httpStatus" in error && typeof (error as { httpStatus?: unknown }).httpStatus === "number"
      ? (error as { httpStatus: number }).httpStatus
      : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to roll back firewall profile." }, { status });
  }
}
