import { EntitlementStatus, ProductKey } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { isPlatformOwner } from "@/lib/platform-config";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { MutationIntentError } from "@/lib/security/intent";
import { assertMutationSecurity } from "@/lib/security/mutation-guard";
import { OperatorRiskError } from "@/lib/security/operator-risk";
import { PlatformLockdownError } from "@/lib/security/platform-lockdown";
import { assertRateLimit } from "@/lib/security/rate-limit";

const createSchema = z.object({
  externalPriceId: z.string().min(3).max(255),
  product: z.nativeEnum(ProductKey),
  statusOnActive: z.nativeEnum(EntitlementStatus).optional(),
  notes: z.string().max(2000).optional(),
  intentId: z.string().cuid().optional(),
});

export async function GET() {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const actorUserId = authResult.session.user.id;
  const owner = await isPlatformOwner(actorUserId);

  if (!owner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const bindings = await prisma.billingEntitlementBinding.findMany({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ bindings });
}

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

  const owner = await isPlatformOwner(actorUserId);
  if (!owner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limiter = await assertRateLimit({
    key: `${actorUserId}:${ip}`,
    action: "platform:billing:binding:create",
    maxAttempts: 60,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const { intentId, ...payload } = parsed.data;

  try {
    await assertMutationSecurity({
      actorUserId,
      actorRole: "OWNER",
      action: "platform:billing:binding:create",
      riskTier: 2,
      ip,
      userAgent,
      route: "/api/platform/billing/bindings",
      intentId,
      payload,
    });
  } catch (error) {
    if (error instanceof PlatformLockdownError || error instanceof OperatorRiskError || error instanceof MutationIntentError) {
      return NextResponse.json({ error: "Forbidden" }, { status: error.httpStatus });
    }

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const binding = await prisma.billingEntitlementBinding.upsert({
    where: {
      externalPriceId: payload.externalPriceId,
    },
    create: {
      externalPriceId: payload.externalPriceId,
      product: payload.product,
      statusOnActive: payload.statusOnActive || EntitlementStatus.ACTIVE,
      notes: payload.notes || null,
    },
    update: {
      product: payload.product,
      statusOnActive: payload.statusOnActive || EntitlementStatus.ACTIVE,
      notes: payload.notes || null,
    },
  });

  await writeAuditLog({
    actorId: actorUserId,
    action: "BILLING_BINDING_UPSERTED",
    resourceType: "billing_entitlement_binding",
    resourceId: binding.id,
    ip,
    userAgent,
    riskTier: 2,
    metadata: {
      externalPriceId: binding.externalPriceId,
      product: binding.product,
      statusOnActive: binding.statusOnActive,
    },
  });

  return NextResponse.json({ binding }, { status: 201 });
}
