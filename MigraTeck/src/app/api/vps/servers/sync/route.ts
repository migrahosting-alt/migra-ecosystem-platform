import { OrgRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { getClientIp, getUserAgent } from "@/lib/request";
import { roleAtLeast } from "@/lib/rbac";
import { requireSameOrigin } from "@/lib/security/csrf";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { syncVpsFleetForOrg, vpsFleetSyncSchema } from "@/lib/vps/import";

export async function POST(request: NextRequest) {
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

  if (!roleAtLeast(membership.role, OrgRole.ADMIN)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ip = getClientIp(request);
  const limiter = await assertRateLimit({
    key: `${authResult.session.user.id}:${membership.orgId}:${ip}`,
    action: "vps:fleet-sync",
    maxAttempts: 20,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = vpsFleetSyncSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  try {
    const result = await syncVpsFleetForOrg({
      orgId: membership.orgId,
      actorUserId: authResult.session.user.id,
      actorRole: membership.role,
      providerSlug: parsed.data.providerSlug,
      ip,
      userAgent: getUserAgent(request),
    });

    const status = result.okCount > 0 ? 200 : 502;
    return NextResponse.json(result, { status, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof Error && "httpStatus" in error && typeof (error as { httpStatus?: unknown }).httpStatus === "number"
      ? (error as { httpStatus: number }).httpStatus
      : 500;

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Fleet sync failed." },
      { status },
    );
  }
}