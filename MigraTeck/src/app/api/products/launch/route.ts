import { EntitlementStatus, ProductKey } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { assertPermission } from "@/lib/authorization";
import { getActiveOrgContext } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import { getProductConfig, isClientOnlyProduct, resolveProductLaunchUrl } from "@/lib/constants";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { EntitlementEnforcementError, assertEntitlement } from "@/lib/security/enforcement";
import { registerLaunchNonce } from "@/lib/security/launch-nonce";
import { assertMutationSecurity } from "@/lib/security/mutation-guard";
import { OperatorRiskError } from "@/lib/security/operator-risk";
import { PlatformLockdownError } from "@/lib/security/platform-lockdown";
import { createLaunchToken } from "@/lib/security/launch-token";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { generateToken } from "@/lib/tokens";
import { isInternalOrg } from "@/lib/security/internal-org";
import { resolveProductRuntimeAccess } from "@/lib/products/runtime-access";
import { isVpsPortalHost } from "@/lib/migradrive-auth-branding";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  product: z.nativeEnum(ProductKey),
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
  const { session } = authResult;
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const limiter = await assertRateLimit({
    key: `${session.user.id}:${ip}`,
    action: "product:launch",
    maxAttempts: 20,
    windowSeconds: 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Too many launch attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const activeOrg = await getActiveOrgContext(session.user.id);

  if (!activeOrg) {
    return NextResponse.json({ error: "No active organization." }, { status: 400 });
  }

  const allowed = await assertPermission({
    actorUserId: session.user.id,
    orgId: activeOrg.orgId,
    role: activeOrg.role,
    action: "product:launch",
    route: "/api/products/launch",
    ip,
    userAgent,
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await assertMutationSecurity({
      action: "product:launch",
      actorUserId: session.user.id,
      actorRole: activeOrg.role,
      orgId: activeOrg.orgId,
      riskTier: 1,
      ip,
      userAgent,
      route: "/api/products/launch",
    });
  } catch (error) {
    if (error instanceof PlatformLockdownError || error instanceof OperatorRiskError) {
      return NextResponse.json({ error: "Provisioning is temporarily unavailable." }, { status: error.httpStatus });
    }

    return NextResponse.json({ error: "Provisioning is temporarily unavailable." }, { status: 503 });
  }

  try {
    await assertEntitlement({
      orgId: activeOrg.orgId,
      feature: parsed.data.product,
      requiredStatus: EntitlementStatus.ACTIVE,
      allowInternal: true,
      actorUserId: session.user.id,
      actorRole: activeOrg.role,
      ip,
      userAgent,
      route: "/api/products/launch",
      resourceId: parsed.data.product,
    });
  } catch (error) {
    if (error instanceof EntitlementEnforcementError) {
      return NextResponse.json({ error: "Product access is not active." }, { status: error.httpStatus });
    }

    return NextResponse.json({ error: "Product access is not active." }, { status: 403 });
  }

  if (isClientOnlyProduct(parsed.data.product) && !activeOrg.org.isMigraHostingClient) {
    return NextResponse.json({ error: "This product is client-only." }, { status: 403 });
  }

  if (parsed.data.product === ProductKey.MIGRADRIVE) {
    const [entitlement, driveTenant] = await Promise.all([
      prisma.orgEntitlement.findFirst({
        where: {
          orgId: activeOrg.orgId,
          product: ProductKey.MIGRADRIVE,
        },
        select: { status: true, startsAt: true, endsAt: true },
      }),
      prisma.driveTenant.findUnique({
        where: { orgId: activeOrg.orgId },
        select: { status: true, restrictionReason: true, disableReason: true },
      }),
    ]);

    const runtime = resolveProductRuntimeAccess({
      productKey: parsed.data.product,
      entitlement,
      isMigraHostingClient: activeOrg.org.isMigraHostingClient,
      isInternalOrg: isInternalOrg(activeOrg.org),
      driveTenant,
    });

    if (!runtime.canLaunch) {
      const error =
        runtime.reason === "TENANT_PENDING"
          ? "MigraDrive tenant setup is still pending."
          : "MigraDrive tenant access is disabled.";

      return NextResponse.json(
        {
          error,
          reason: runtime.reason,
          tenantLifecycleReason: runtime.tenantLifecycleReason,
        },
        { status: 403 },
      );
    }
  }

  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const requestProtocol = forwardedProto || request.nextUrl.protocol.replace(/:$/, "");
  const requestHost = forwardedHost || request.nextUrl.host;
  const requestOrigin = `${requestProtocol}://${requestHost}`;
  const vpsHost = isVpsPortalHost(requestHost);
  const config = getProductConfig(parsed.data.product);

  if (!config) {
    return NextResponse.json({ error: "Product not configured." }, { status: 404 });
  }

  const targetUrl = vpsHost && parsed.data.product === ProductKey.MIGRAHOSTING
    ? `${requestOrigin}/app/vps`
    : resolveProductLaunchUrl(parsed.data.product);
  const fallbackLaunchUrl = parsed.data.product === ProductKey.MIGRADRIVE
    ? `${requestOrigin}/app/drive`
    : parsed.data.product === ProductKey.MIGRAHOSTING && vpsHost
      ? `${requestOrigin}/app/vps`
      : null;

  if (!targetUrl && !fallbackLaunchUrl) {
    return NextResponse.json({ error: "Launch URL missing for product." }, { status: 503 });
  }

  const normalizedTargetUrl = new URL(targetUrl || fallbackLaunchUrl || requestOrigin);

  let launchUrl = normalizedTargetUrl.toString();

  if (normalizedTargetUrl.origin !== requestOrigin) {
    const launchTtlSeconds = 60;
    const launchNonce = generateToken(16);
    await registerLaunchNonce({
      nonce: launchNonce,
      userId: session.user.id,
      orgId: activeOrg.orgId,
      product: parsed.data.product,
      ttlSeconds: launchTtlSeconds,
    });

    const launchToken = createLaunchToken({
      sub: session.user.id,
      orgId: activeOrg.orgId,
      product: parsed.data.product,
      aud: normalizedTargetUrl.host,
      nonce: launchNonce,
      iat: Math.floor(Date.now() / 1000),
    }, launchTtlSeconds);

    normalizedTargetUrl.searchParams.set("token", launchToken);
    launchUrl = normalizedTargetUrl.toString();
  }

  await writeAuditLog({
    userId: session.user.id,
    orgId: activeOrg.orgId,
    action: "PRODUCT_LAUNCH_TOKEN_ISSUED",
    entityType: "product",
    entityId: parsed.data.product,
    ip,
    userAgent,
  });

  return NextResponse.json({ launchUrl });
}
