import { EntitlementStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { assertPermission } from "@/lib/authorization";
import { getActiveOrgContext } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import { isClientOnlyProduct } from "@/lib/constants";
import { getDownloadSigner } from "@/lib/download-signer";
import { downloadUrlTtlSeconds } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { EntitlementEnforcementError, assertEntitlement } from "@/lib/security/enforcement";
import { assertMutationSecurity } from "@/lib/security/mutation-guard";
import { OperatorRiskError } from "@/lib/security/operator-risk";
import { PlatformLockdownError } from "@/lib/security/platform-lockdown";
import { assertRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest, context: { params: Promise<{ artifactId: string }> }) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const { artifactId } = await context.params;
  const actorUserId = authResult.session.user.id;
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const limiter = await assertRateLimit({
    key: `${actorUserId}:${ip}`,
    action: "downloads:sign",
    maxAttempts: 120,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const activeOrg = await getActiveOrgContext(actorUserId);

  if (!activeOrg) {
    return NextResponse.json({ error: "No active organization." }, { status: 400 });
  }

  const allowed = await assertPermission({
    actorUserId,
    orgId: activeOrg.orgId,
    role: activeOrg.role,
    action: "downloads:sign",
    route: "/api/downloads/[artifactId]/sign",
    ip,
    userAgent,
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await assertMutationSecurity({
      action: "downloads:sign",
      actorUserId,
      actorRole: activeOrg.role,
      orgId: activeOrg.orgId,
      riskTier: 1,
      ip,
      userAgent,
      route: "/api/downloads/[artifactId]/sign",
    });
  } catch (error) {
    if (error instanceof PlatformLockdownError || error instanceof OperatorRiskError) {
      return NextResponse.json({ error: "Provisioning is temporarily unavailable." }, { status: error.httpStatus });
    }

    return NextResponse.json({ error: "Provisioning is temporarily unavailable." }, { status: 503 });
  }

  const artifact = await prisma.downloadArtifact.findFirst({
    where: {
      id: artifactId,
      isActive: true,
    },
  });

  if (!artifact) {
    return NextResponse.json({ error: "Download artifact not found." }, { status: 404 });
  }

  const clientAllowed =
    !isClientOnlyProduct(artifact.product) || activeOrg.org.isMigraHostingClient || activeOrg.role === "OWNER";

  try {
    await assertEntitlement({
      orgId: activeOrg.orgId,
      feature: "DOWNLOADS",
      product: artifact.product,
      requiredStatus: EntitlementStatus.ACTIVE,
      allowInternal: true,
      actorUserId,
      actorRole: activeOrg.role,
      ip,
      userAgent,
      route: "/api/downloads/[artifactId]/sign",
      resourceId: artifact.id,
    });
  } catch (error) {
    const entitlementCode = error instanceof EntitlementEnforcementError ? error.code : "UNKNOWN";

    await writeAuditLog({
      actorId: actorUserId,
      actorRole: activeOrg.role,
      orgId: activeOrg.orgId,
      action: "DOWNLOAD_SIGNED_URL_DENIED",
      resourceType: "download_artifact",
      resourceId: artifact.id,
      ip,
      userAgent,
      riskTier: 1,
      metadata: {
        artifactId: artifact.id,
        product: artifact.product,
        reason: entitlementCode,
        clientAllowed,
      },
    });

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!clientAllowed) {
    await writeAuditLog({
      actorId: actorUserId,
      actorRole: activeOrg.role,
      orgId: activeOrg.orgId,
      action: "DOWNLOAD_SIGNED_URL_DENIED",
      resourceType: "download_artifact",
      resourceId: artifact.id,
      ip,
      userAgent,
      riskTier: 1,
      metadata: {
        artifactId: artifact.id,
        product: artifact.product,
        reason: "CLIENT_ONLY_PRODUCT",
      },
    });

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const signer = getDownloadSigner();
  const signedUrl = await signer.sign(artifact.fileKey, downloadUrlTtlSeconds);

  await writeAuditLog({
    actorId: actorUserId,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: "DOWNLOAD_SIGNED_URL_ISSUED",
    resourceType: "download_artifact",
    resourceId: artifact.id,
    ip,
    userAgent,
    riskTier: 1,
    metadata: {
      artifactId: artifact.id,
      product: artifact.product,
      ttlSeconds: downloadUrlTtlSeconds,
    },
  });

  return NextResponse.json({
    signedUrl,
    expiresInSeconds: downloadUrlTtlSeconds,
  });
}
