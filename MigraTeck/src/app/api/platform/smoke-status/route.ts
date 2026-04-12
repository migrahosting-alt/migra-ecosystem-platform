import { BillingProvider, ProvisioningJobStatus, ProvisioningTaskStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { downloadUrlTtlSeconds, env, stripeBillingEnabled } from "@/lib/env";
import { getPlatformConfig, isPlatformOwner } from "@/lib/platform-config";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { listVpsProviderRuntimeSummaries } from "@/lib/vps/providers/config";

export async function GET(request: NextRequest) {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const actorUserId = authResult.session.user.id;
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const owner = await isPlatformOwner(actorUserId);
  if (!owner) {
    await writeAuditLog({
      actorId: actorUserId,
      action: "AUTHZ_PERMISSION_DENIED",
      resourceType: "permission",
      resourceId: "platform:smoke-status:view",
      ip,
      userAgent,
      riskTier: 1,
      metadata: {
        route: "/api/platform/smoke-status",
        method: "GET",
      },
    });

    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limiter = await assertRateLimit({
    key: `${actorUserId}:${ip}`,
    action: "platform:smoke-status:view",
    maxAttempts: 120,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const config = await getPlatformConfig();
  const now = Date.now();
  const vpsProviderRuntime = await listVpsProviderRuntimeSummaries();

  const [lastStripeEvent, queueDepthLegacy, oldestQueuedTaskLegacy, queueDepthJobs, oldestQueuedJob] = await Promise.all([
    prisma.billingWebhookEvent.findFirst({
      where: {
        provider: BillingProvider.STRIPE,
      },
      orderBy: {
        receivedAt: "desc",
      },
      select: {
        eventId: true,
        eventType: true,
        status: true,
        reason: true,
        receivedAt: true,
        processedAt: true,
      },
    }),
    prisma.provisioningTask.count({
      where: {
        status: {
          in: [ProvisioningTaskStatus.PENDING, ProvisioningTaskStatus.PROCESSING],
        },
      },
    }),
    prisma.provisioningTask.findFirst({
      where: {
        status: {
          in: [ProvisioningTaskStatus.PENDING, ProvisioningTaskStatus.PROCESSING],
        },
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        createdAt: true,
      },
    }),
    prisma.provisioningJob.count({
      where: {
        status: {
          in: [ProvisioningJobStatus.PENDING, ProvisioningJobStatus.RUNNING],
        },
      },
    }),
    prisma.provisioningJob.findFirst({
      where: {
        status: {
          in: [ProvisioningJobStatus.PENDING, ProvisioningJobStatus.RUNNING],
        },
      },
      orderBy: {
        createdAt: "asc",
      },
      select: {
        createdAt: true,
      },
    }),
  ]);

  const oldestQueued = [oldestQueuedTaskLegacy?.createdAt.getTime() || null, oldestQueuedJob?.createdAt.getTime() || null]
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b)[0];

  const oldestJobAgeSeconds = oldestQueued ? Math.max(0, Math.floor((now - oldestQueued) / 1000)) : null;
  const queueDepth = queueDepthLegacy + queueDepthJobs;

  await writeAuditLog({
    actorId: actorUserId,
    actorRole: "OWNER",
    action: "PLATFORM_SMOKE_STATUS_VIEWED",
    resourceType: "platform_status",
    resourceId: "smoke_status",
    ip,
    userAgent,
    riskTier: 0,
      metadata: {
        queueDepth,
        queueDepthLegacy,
        queueDepthJobs,
        hasStripeEvent: Boolean(lastStripeEvent),
        downloadProvider: env.DOWNLOAD_STORAGE_PROVIDER || null,
        downloadTtlSeconds: downloadUrlTtlSeconds,
        signedJobsConfigured: Boolean(env.JOB_ENVELOPE_SIGNING_SECRET),
        maintenanceMode: config.maintenanceMode,
        freezeProvisioning: config.freezeProvisioning,
        pauseProvisioningWorker: config.pauseProvisioningWorker,
        pauseEntitlementExpiryWorker: config.pauseEntitlementExpiryWorker,
        vpsProvidersConfigured: vpsProviderRuntime.filter((provider) => provider.configured).length,
        vpsProvidersForcedStub: vpsProviderRuntime.filter((provider) => provider.forcedStubMode).map((provider) => provider.slug),
      },
  });

  return NextResponse.json({
    stripe: {
      enabled: stripeBillingEnabled,
      webhookSecretConfigured: Boolean(env.STRIPE_WEBHOOK_SECRET),
      secretKeyConfigured: Boolean(env.STRIPE_SECRET_KEY),
      lastEvent: lastStripeEvent,
    },
    workers: {
      provisioning: {
        envEnabled: env.RUN_PROVISIONING_ENGINE_WORKER === "true",
        pausedByConfig: config.maintenanceMode || config.pauseProvisioningWorker,
      },
      vpsActionReconcile: {
        envEnabled: env.RUN_VPS_ACTION_RECONCILE_WORKER === "true",
        pausedByConfig: config.maintenanceMode,
      },
      entitlementExpiry: {
        envEnabled: env.RUN_ENTITLEMENT_EXPIRY_WORKER === "true",
        pausedByConfig: config.maintenanceMode || config.pauseEntitlementExpiryWorker,
      },
    },
    vps: {
      providers: vpsProviderRuntime,
    },
    queue: {
      depth: queueDepth,
      depthLegacy: queueDepthLegacy,
      depthJobs: queueDepthJobs,
      oldestJobAgeSeconds,
    },
    downloads: {
      provider: env.DOWNLOAD_STORAGE_PROVIDER || null,
      ttlSeconds: downloadUrlTtlSeconds,
      providerConfigured: Boolean(env.DOWNLOAD_STORAGE_PROVIDER),
    },
    signedJobs: {
      signingSecretConfigured: Boolean(env.JOB_ENVELOPE_SIGNING_SECRET),
    },
    provisioningDispatch: {
      dryRun: env.PROVISIONING_ENGINE_DRY_RUN !== "false",
      defaultConfigured: Boolean(env.PROVISIONING_DISPATCH_URL && env.PROVISIONING_DISPATCH_TOKEN),
      timeoutMs: Number.parseInt(env.PROVISIONING_DISPATCH_TIMEOUT_MS || "10000", 10),
      specialized: {
        migrahostingAgent: Boolean(env.MIGRAHOSTING_AGENT_URL && env.MIGRAHOSTING_AGENT_KEY_ID && env.MIGRAHOSTING_AGENT_SECRET),
        migramailCore: Boolean(env.MIGRAMAIL_CORE_URL && env.MIGRAMAIL_CORE_API_KEY),
        migrapanelEdge: Boolean(env.MIGRAPANEL_EDGE_URL),
        migrapanelEdgeAuthenticated: Boolean(env.MIGRAPANEL_EDGE_URL && env.MIGRAPANEL_EDGE_TOKEN),
      },
      lanes: {
        migrateck: Boolean(env.MIGRATECK_PROVISION_URL && env.MIGRATECK_PROVISION_TOKEN),
        migrahosting: Boolean(env.MIGRAHOSTING_PROVISION_URL && env.MIGRAHOSTING_PROVISION_TOKEN),
        migrapanel: Boolean(env.MIGRAPANEL_PROVISION_URL && env.MIGRAPANEL_PROVISION_TOKEN),
        migravoice: Boolean(env.MIGRAVOICE_PROVISION_URL && env.MIGRAVOICE_PROVISION_TOKEN),
        migramail: Boolean(env.MIGRAMAIL_PROVISION_URL && env.MIGRAMAIL_PROVISION_TOKEN),
        migraintake: Boolean(env.MIGRAINTAKE_PROVISION_URL && env.MIGRAINTAKE_PROVISION_TOKEN),
        migramarket: Boolean(env.MIGRAMARKET_PROVISION_URL && env.MIGRAMARKET_PROVISION_TOKEN),
        migrapilot: Boolean(env.MIGRAPILOT_PROVISION_URL && env.MIGRAPILOT_PROVISION_TOKEN),
      },
    },
    platform: {
      maintenanceMode: config.maintenanceMode,
      freezeProvisioning: config.freezeProvisioning,
      pauseProvisioningWorker: config.pauseProvisioningWorker,
      pauseEntitlementExpiryWorker: config.pauseEntitlementExpiryWorker,
      updatedAt: config.updatedAt,
    },
    generatedAt: new Date().toISOString(),
  });
}
