import { OrgRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { getClientIp, getUserAgent } from "@/lib/request";
import { roleAtLeast } from "@/lib/rbac";
import { requireSameOrigin } from "@/lib/security/csrf";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { upsertImportedVpsServer, vpsImportSchema } from "@/lib/vps/import";

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
  const userAgent = getUserAgent(request);
  const limiter = await assertRateLimit({
    key: `${authResult.session.user.id}:${membership.orgId}:${ip}`,
    action: "vps:import",
    maxAttempts: 30,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = vpsImportSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const result = await upsertImportedVpsServer({
    orgId: membership.orgId,
    actorUserId: authResult.session.user.id,
    actorRole: membership.role,
    source: "manual_import",
    data: parsed.data,
    ip,
    userAgent,
  });

  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
