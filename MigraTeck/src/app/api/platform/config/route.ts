import { MembershipStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { getPlatformConfig, isPlatformOwner, PlatformConfigPermissionError, updatePlatformConfig } from "@/lib/platform-config";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { assertMutationSecurity } from "@/lib/security/mutation-guard";
import { MutationIntentError } from "@/lib/security/intent";
import { OperatorRiskError } from "@/lib/security/operator-risk";
import { PlatformLockdownError } from "@/lib/security/platform-lockdown";
import { assertRateLimit } from "@/lib/security/rate-limit";
import type { PlatformConfigPatch } from "@/lib/platform-config";

const patchSchema = z
  .object({
    allowPublicSignup: z.boolean().optional(),
    allowOrgCreate: z.boolean().optional(),
    waitlistMode: z.boolean().optional(),
    maintenanceMode: z.boolean().optional(),
    freezeProvisioning: z.boolean().optional(),
    pauseProvisioningWorker: z.boolean().optional(),
    pauseEntitlementExpiryWorker: z.boolean().optional(),
    intentId: z.string().cuid().optional(),
  })
  .refine(
    (payload) =>
      payload.allowPublicSignup !== undefined ||
      payload.allowOrgCreate !== undefined ||
      payload.waitlistMode !== undefined ||
      payload.maintenanceMode !== undefined ||
      payload.freezeProvisioning !== undefined ||
      payload.pauseProvisioningWorker !== undefined ||
      payload.pauseEntitlementExpiryWorker !== undefined,
    {
    message: "No fields provided.",
  },
  );

async function getAuditOrgId(userId: string): Promise<string | null> {
  const membership = await prisma.membership.findFirst({
    where: {
      userId,
      status: MembershipStatus.ACTIVE,
    },
    select: {
      orgId: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return membership?.orgId || null;
}

export async function GET(request: NextRequest) {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const actorUserId = authResult.session.user.id;
  const owner = await isPlatformOwner(actorUserId);

  if (!owner) {
    await writeAuditLog({
      userId: actorUserId,
      orgId: await getAuditOrgId(actorUserId),
      action: "AUTHZ_PERMISSION_DENIED",
      entityType: "permission",
      entityId: "platform:config:manage",
      ip: getClientIp(request),
      userAgent: getUserAgent(request),
      metadata: {
        route: "/api/platform/config",
        method: "GET",
      },
    });

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const config = await getPlatformConfig();

  return NextResponse.json({
    config: {
      allowPublicSignup: config.allowPublicSignup,
      allowOrgCreate: config.allowOrgCreate,
      waitlistMode: config.waitlistMode,
      maintenanceMode: config.maintenanceMode,
      freezeProvisioning: config.freezeProvisioning,
      pauseProvisioningWorker: config.pauseProvisioningWorker,
      pauseEntitlementExpiryWorker: config.pauseEntitlementExpiryWorker,
      updatedAt: config.updatedAt,
    },
  });
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

  const limiter = await assertRateLimit({
    key: `${actorUserId}:${ip}`,
    action: "platform:config:update",
    maxAttempts: 20,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const { intentId, ...patchPayload } = parsed.data;
  const patch: PlatformConfigPatch = {
    ...(patchPayload.allowPublicSignup !== undefined ? { allowPublicSignup: patchPayload.allowPublicSignup } : {}),
    ...(patchPayload.allowOrgCreate !== undefined ? { allowOrgCreate: patchPayload.allowOrgCreate } : {}),
    ...(patchPayload.waitlistMode !== undefined ? { waitlistMode: patchPayload.waitlistMode } : {}),
    ...(patchPayload.maintenanceMode !== undefined ? { maintenanceMode: patchPayload.maintenanceMode } : {}),
    ...(patchPayload.freezeProvisioning !== undefined ? { freezeProvisioning: patchPayload.freezeProvisioning } : {}),
    ...(patchPayload.pauseProvisioningWorker !== undefined ? { pauseProvisioningWorker: patchPayload.pauseProvisioningWorker } : {}),
    ...(patchPayload.pauseEntitlementExpiryWorker !== undefined
      ? { pauseEntitlementExpiryWorker: patchPayload.pauseEntitlementExpiryWorker }
      : {}),
  };

  try {
    await assertMutationSecurity({
      action: "platform:config:update",
      actorUserId,
      actorRole: owner ? "OWNER" : null,
      riskTier: 2,
      ip,
      userAgent,
      route: "/api/platform/config",
      intentId,
      payload: patch,
    });
  } catch (error) {
    if (error instanceof PlatformLockdownError || error instanceof OperatorRiskError || error instanceof MutationIntentError) {
      return NextResponse.json({ error: "Forbidden" }, { status: error.httpStatus });
    }

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const updated = await updatePlatformConfig({
      actorUserId,
      patch,
      ip,
      userAgent,
    });

    return NextResponse.json({
      config: {
        allowPublicSignup: updated.allowPublicSignup,
        allowOrgCreate: updated.allowOrgCreate,
        waitlistMode: updated.waitlistMode,
        maintenanceMode: updated.maintenanceMode,
        freezeProvisioning: updated.freezeProvisioning,
        pauseProvisioningWorker: updated.pauseProvisioningWorker,
        pauseEntitlementExpiryWorker: updated.pauseEntitlementExpiryWorker,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    if (error instanceof PlatformConfigPermissionError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ error: "Unable to update platform config." }, { status: 500 });
  }
}
