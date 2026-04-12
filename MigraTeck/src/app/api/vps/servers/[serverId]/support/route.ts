import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { safeApiHandler } from "@/lib/security/safe-api-handler";
import { getVpsCapabilities } from "@/lib/vps/access";
import { resolveActorRole } from "@/lib/vps/authz";
import { getVpsSupportState } from "@/lib/vps/data";
import { createVpsSupportRequest } from "@/lib/vps/support";

const createSupportRequestSchema = z.object({
  title: z.string().min(3).max(140),
  category: z.string().min(2).max(64),
  priority: z.string().min(2).max(32),
  details: z.string().min(10).max(4000),
  includeDiagnostics: z.boolean().default(true),
});

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

  const support = await getVpsSupportState(serverId, membership.orgId);

  if (!support) {
    return NextResponse.json({ error: "VPS server not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(support, { headers: { "Cache-Control": "no-store" } });
});

export async function POST(request: NextRequest, context: { params: Promise<{ serverId: string }> }) {
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

  const body = await request.json().catch(() => null);
  const parsed = createSupportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid support request.", details: parsed.error.flatten() }, { status: 400 });
  }

  const ip = getClientIp(request);
  const { serverId } = await context.params;
  const resolvedRole = await resolveActorRole({
    userId: authResult.session.user.id,
    orgId: membership.orgId,
    role: membership.role,
  }, serverId);
  if (!getVpsCapabilities(resolvedRole.role).canOpenSupport) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limiter = await assertRateLimit({
    key: `${authResult.session.user.id}:${membership.orgId}:${serverId}:${ip}`,
    action: "vps:support:create",
    maxAttempts: 12,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  try {
    const result = await createVpsSupportRequest({
      serverId,
      orgId: membership.orgId,
      actorUserId: authResult.session.user.id,
      title: parsed.data.title,
      category: parsed.data.category,
      priority: parsed.data.priority,
      details: parsed.data.details,
      includeDiagnostics: parsed.data.includeDiagnostics,
      sourceIp: ip,
      userAgent: getUserAgent(request),
    });

    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof Error && "httpStatus" in error && typeof (error as { httpStatus?: unknown }).httpStatus === "number"
      ? (error as { httpStatus: number }).httpStatus
      : 500;

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create support request." },
      { status },
    );
  }
}
