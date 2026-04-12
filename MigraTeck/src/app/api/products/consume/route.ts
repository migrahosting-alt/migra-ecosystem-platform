import { EntitlementStatus, MembershipStatus, ProductKey } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { EntitlementEnforcementError, assertEntitlement } from "@/lib/security/enforcement";
import { consumeLaunchNonce } from "@/lib/security/launch-nonce";
import { assertMutationSecurity } from "@/lib/security/mutation-guard";
import { OperatorRiskError } from "@/lib/security/operator-risk";
import { PlatformLockdownError } from "@/lib/security/platform-lockdown";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { verifyLaunchToken } from "@/lib/security/launch-token";
import { isInternalOrg } from "@/lib/security/internal-org";
import { resolveProductRuntimeAccess } from "@/lib/products/runtime-access";

const schema = z.object({
  token: z.string().min(20),
  expectedAudience: z.string().min(3),
});

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const limiter = await assertRateLimit({
    key: ip,
    action: "product:consume",
    maxAttempts: 50,
    windowSeconds: 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Too many consume attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  if (env.PRODUCT_CONSUME_SHARED_SECRET) {
    const provided = request.headers.get("x-migrateck-consume-secret");
    if (!provided || provided !== env.PRODUCT_CONSUME_SHARED_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const payload = verifyLaunchToken(parsed.data.token, parsed.data.expectedAudience);

  if (!payload) {
    return NextResponse.json({ error: "Invalid launch token." }, { status: 401 });
  }

  const productParse = z.nativeEnum(ProductKey).safeParse(payload.product);
  if (!productParse.success) {
    return NextResponse.json({ error: "Invalid launch token." }, { status: 401 });
  }

  const nonceConsumed = await consumeLaunchNonce({
    nonce: payload.nonce,
    userId: payload.sub,
    orgId: payload.orgId,
    product: productParse.data,
  });

  if (!nonceConsumed) {
    return NextResponse.json({ error: "Invalid launch token." }, { status: 401 });
  }

  const membership = await prisma.membership.findFirst({
    where: {
      userId: payload.sub,
      orgId: payload.orgId,
      status: MembershipStatus.ACTIVE,
    },
    include: {
      org: true,
      user: {
        select: { id: true, email: true, name: true },
      },
    },
  });

  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await assertMutationSecurity({
      action: "product:consume",
      actorUserId: payload.sub,
      actorRole: membership.role,
      orgId: payload.orgId,
      riskTier: 1,
      ip,
      userAgent,
      route: "/api/products/consume",
    });
  } catch (error) {
    if (error instanceof PlatformLockdownError || error instanceof OperatorRiskError) {
      return NextResponse.json({ error: "Provisioning is temporarily unavailable." }, { status: error.httpStatus });
    }

    return NextResponse.json({ error: "Provisioning is temporarily unavailable." }, { status: 503 });
  }

  try {
    await assertEntitlement({
      orgId: payload.orgId,
      feature: productParse.data,
      requiredStatus: EntitlementStatus.ACTIVE,
      allowInternal: true,
      actorUserId: payload.sub,
      actorRole: membership.role,
      ip,
      userAgent,
      route: "/api/products/consume",
      resourceId: productParse.data,
    });
  } catch (error) {
    if (error instanceof EntitlementEnforcementError) {
      return NextResponse.json({ error: "Forbidden" }, { status: error.httpStatus });
    }

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const entitlements = await prisma.orgEntitlement.findMany({
    where: {
      orgId: payload.orgId,
      status: {
        in: [EntitlementStatus.ACTIVE, EntitlementStatus.TRIAL],
      },
    },
    orderBy: { product: "asc" },
  });

  if (productParse.data === ProductKey.MIGRADRIVE) {
    const entitlement = entitlements.find((item) => item.product === ProductKey.MIGRADRIVE) || null;
    const driveTenant = await prisma.driveTenant.findUnique({
      where: { orgId: payload.orgId },
      select: { status: true, restrictionReason: true, disableReason: true },
    });

    const runtime = resolveProductRuntimeAccess({
      productKey: productParse.data,
      entitlement,
      isMigraHostingClient: membership.org.isMigraHostingClient,
      isInternalOrg: isInternalOrg(membership.org),
      driveTenant,
    });

    if (!runtime.canLaunch) {
      return NextResponse.json(
        {
          error: "Forbidden",
          reason: runtime.reason,
          tenantLifecycleReason: runtime.tenantLifecycleReason,
        },
        { status: 403 },
      );
    }
  }

  await writeAuditLog({
    userId: payload.sub,
    orgId: payload.orgId,
    action: "PRODUCT_LAUNCH_TOKEN_CONSUMED",
    entityType: "product",
    entityId: productParse.data,
    ip,
    userAgent,
    metadata: {
      audience: payload.aud,
    },
  });

  return NextResponse.json({
    bootstrap: {
      user: membership.user,
      org: {
        id: membership.org.id,
        name: membership.org.name,
        slug: membership.org.slug,
        isMigraHostingClient: membership.org.isMigraHostingClient,
      },
      role: membership.role,
      product: productParse.data,
      entitlements: entitlements.map((item) => item.product),
    },
  });
}
