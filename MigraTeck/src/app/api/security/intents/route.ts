import { MembershipStatus, OrgRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { assertPermission } from "@/lib/authorization";
import { createMutationIntent, MutationIntentError } from "@/lib/security/intent";
import { isPlatformOwner } from "@/lib/platform-config";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { assertMutationSecurity } from "@/lib/security/mutation-guard";
import { OperatorRiskError } from "@/lib/security/operator-risk";
import { PlatformLockdownError } from "@/lib/security/platform-lockdown";
import { assertRateLimit } from "@/lib/security/rate-limit";

const payloadSchema = z.object({
  action: z.string().min(3).max(160),
  orgId: z.string().optional(),
  payload: z.unknown(),
  reason: z.string().max(2000).optional(),
  stepUp: z
    .object({
      password: z.string().min(8).max(256).optional(),
      totpCode: z.string().min(6).max(12).optional(),
      passkeyAssertion: z.string().max(20000).optional(),
    })
    .optional(),
});

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const actorUserId = authResult.session.user.id;
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const limiter = await assertRateLimit({
    key: `${actorUserId}:${ip}`,
    action: "security:intent:create",
    maxAttempts: 120,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const orgId = parsed.data.orgId || null;
  let actorRole: OrgRole | null = null;

  if (orgId) {
    const membership = await prisma.membership.findFirst({
      where: {
        userId: actorUserId,
        orgId,
        status: MembershipStatus.ACTIVE,
      },
      select: {
        role: true,
      },
    });

    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    actorRole = membership.role;

    const allowed = await assertPermission({
      actorUserId,
      orgId,
      role: membership.role,
      action: "ops:read",
      route: "/api/security/intents",
      ip,
      userAgent,
    });

    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else {
    const owner = await isPlatformOwner(actorUserId);
    if (!owner) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    actorRole = "OWNER";
  }

  try {
    await assertMutationSecurity({
      action: parsed.data.action,
      actorUserId,
      actorRole,
      orgId,
      riskTier: 2,
      ip,
      userAgent,
      route: "/api/security/intents",
      payload: parsed.data.payload,
      skipTier2IntentRequirement: true,
    });
  } catch (error) {
    if (error instanceof PlatformLockdownError || error instanceof OperatorRiskError || error instanceof MutationIntentError) {
      return NextResponse.json({ error: "Forbidden" }, { status: error.httpStatus });
    }

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const intent = await createMutationIntent({
      actorId: actorUserId,
      orgId,
      action: parsed.data.action,
      payload: parsed.data.payload,
      reason: parsed.data.reason,
      ip,
      userAgent,
      stepUp: parsed.data.stepUp,
    });

    return NextResponse.json(
      {
        intentId: intent.id,
        expiresAt: intent.expiresAt,
        stepUpMethod: intent.stepUpMethod,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof MutationIntentError) {
      return NextResponse.json({ error: "Intent creation failed." }, { status: error.httpStatus });
    }

    return NextResponse.json({ error: "Intent creation failed." }, { status: 500 });
  }
}
