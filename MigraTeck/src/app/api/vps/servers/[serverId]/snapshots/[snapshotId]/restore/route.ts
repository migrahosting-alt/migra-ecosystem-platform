import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { getClientIp } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { handleServerAction } from "@/lib/vps/handlers";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ serverId: string; snapshotId: string }> },
) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const membership = await getActiveOrgContext(authResult.session.user.id);
  if (!membership) {
    return NextResponse.json({ error: "No active organization context." }, { status: 404 });
  }

  const ip = getClientIp(request);
  const { serverId, snapshotId } = await context.params;
  const limiter = await assertRateLimit({
    key: `${authResult.session.user.id}:${membership.orgId}:${serverId}:${snapshotId}:${ip}`,
    action: "vps:snapshots:restore",
    maxAttempts: 4,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } });
  }

  return handleServerAction({
    actor: {
      userId: authResult.session.user.id,
      orgId: membership.orgId,
      role: membership.role,
      sourceIp: ip,
      membership,
    },
    serverId,
    actionType: "RESTORE_SNAPSHOT",
    allowedRoles: ["OWNER", "ADMIN"],
    eventType: "SNAPSHOT_RESTORE_REQUESTED",
    severity: "CRITICAL",
    requestJson: { snapshotId },
  });
}
