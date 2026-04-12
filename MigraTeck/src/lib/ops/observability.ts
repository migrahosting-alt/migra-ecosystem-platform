import {
  BillingWebhookEventStatus,
  MembershipStatus,
  OrgRole,
  ProvisioningJobStatus,
  type AuditLog,
  type Prisma,
} from "@prisma/client";
import { assertPermission } from "@/lib/authorization";
import {
  env,
  opsAlertAutoRestrictBurstThreshold,
  opsAlertLockdownBlockBurstThreshold,
  opsAlertQueueStuckSeconds,
  opsAlertRetryThreshold,
  opsAlertSocialReconnectThreshold,
  opsAlertSocialStaleThreshold,
  opsAlertWebhookFailureThreshold,
  socialConnectionSyncRefreshWindowHours,
  socialConnectionVerificationStaleHours,
} from "@/lib/env";
import { isPlatformOwner } from "@/lib/platform-config";
import { prisma } from "@/lib/prisma";

export class OpsAccessError extends Error {
  httpStatus: number;

  constructor(message: string, httpStatus = 403) {
    super(message);
    this.name = "OpsAccessError";
    this.httpStatus = httpStatus;
  }
}

interface ResolveOpsScopeInput {
  actorUserId: string;
  requestedOrgId?: string | null | undefined;
  route: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

interface OpsScope {
  orgId: string;
  role: OrgRole;
  platformOwner: boolean;
}

export interface OpsAuditFilters {
  actorId?: string | undefined;
  action?: string | undefined;
  riskTier?: 0 | 1 | 2 | undefined;
  route?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  limit?: number | undefined;
}

interface ParsedMetadata {
  riskTier: 0 | 1 | 2 | null;
  route: string | null;
  reason: string | null;
}

function parseMetadata(metadata: Prisma.JsonValue | null): ParsedMetadata {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {
      riskTier: null,
      route: null,
      reason: null,
    };
  }

  const root = metadata as Record<string, unknown>;
  const details = root.details && typeof root.details === "object" && !Array.isArray(root.details)
    ? (root.details as Record<string, unknown>)
    : null;

  const riskCandidate = typeof root.riskTier === "number" ? root.riskTier : typeof details?.riskTier === "number" ? details.riskTier : null;
  const routeCandidate = typeof root.route === "string" ? root.route : typeof details?.route === "string" ? details.route : null;
  const reasonCandidate = typeof root.reason === "string" ? root.reason : typeof details?.reason === "string" ? details.reason : null;

  return {
    riskTier: riskCandidate === 0 || riskCandidate === 1 || riskCandidate === 2 ? riskCandidate : null,
    route: routeCandidate,
    reason: reasonCandidate,
  };
}

export async function resolveOpsScope(input: ResolveOpsScopeInput): Promise<OpsScope> {
  const platformOwner = await isPlatformOwner(input.actorUserId);

  if (input.requestedOrgId) {
    const [org, membership] = await Promise.all([
      prisma.organization.findUnique({ where: { id: input.requestedOrgId }, select: { id: true } }),
      prisma.membership.findFirst({
        where: {
          userId: input.actorUserId,
          orgId: input.requestedOrgId,
          status: MembershipStatus.ACTIVE,
        },
        select: {
          role: true,
        },
      }),
    ]);

    if (!org) {
      throw new OpsAccessError("Organization not found.", 404);
    }

    const role = membership?.role || (platformOwner ? OrgRole.OWNER : null);
    if (!role) {
      throw new OpsAccessError("Forbidden", 403);
    }

    const allowed = await assertPermission({
      actorUserId: input.actorUserId,
      orgId: input.requestedOrgId,
      role,
      action: "ops:read",
      route: input.route,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    if (!allowed) {
      throw new OpsAccessError("Forbidden", 403);
    }

    return {
      orgId: input.requestedOrgId,
      role,
      platformOwner,
    };
  }

  const membership = await prisma.membership.findFirst({
    where: {
      userId: input.actorUserId,
      status: MembershipStatus.ACTIVE,
    },
    orderBy: { createdAt: "asc" },
    select: {
      orgId: true,
      role: true,
    },
  });

  if (!membership) {
    throw new OpsAccessError("No active organization.", 400);
  }

  const allowed = await assertPermission({
    actorUserId: input.actorUserId,
    orgId: membership.orgId,
    role: membership.role,
    action: "ops:read",
    route: input.route,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  if (!allowed) {
    throw new OpsAccessError("Forbidden", 403);
  }

  return {
    orgId: membership.orgId,
    role: membership.role,
    platformOwner,
  };
}

export async function getFilteredAuditEvents(orgId: string, filters: OpsAuditFilters) {
  const limit = Math.min(Math.max(filters.limit || 100, 1), 500);

  const rows = await prisma.auditLog.findMany({
    where: {
      orgId,
      ...(filters.actorId ? { userId: filters.actorId } : {}),
      ...(filters.action ? { action: { contains: filters.action, mode: "insensitive" } } : {}),
      ...((filters.from || filters.to)
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit * 3,
  });

  const events = rows
    .map((row) => {
      const parsed = parseMetadata(row.metadata as Prisma.JsonValue | null);

      return {
        ...row,
        riskTier: parsed.riskTier,
        route: parsed.route,
        reason: parsed.reason,
      };
    })
    .filter((row) => {
      if (filters.riskTier !== undefined && row.riskTier !== filters.riskTier) {
        return false;
      }

      if (filters.route && !(row.route || "").toLowerCase().includes(filters.route.toLowerCase())) {
        return false;
      }

      return true;
    })
    .slice(0, limit);

  const byAction = new Map<string, number>();
  for (const event of events) {
    byAction.set(event.action, (byAction.get(event.action) || 0) + 1);
  }

  return {
    events,
    totals: {
      count: events.length,
      byAction: Array.from(byAction.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([action, count]) => ({ action, count })),
    },
  };
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] || null;
}

async function maybeDispatchOpsAlert(orgId: string, alerts: string[]): Promise<void> {
  if (alerts.length === 0 || !env.OPS_ALERT_WEBHOOK_URL) {
    return;
  }

  const signature = alerts.slice().sort().join("|");
  const key = `ops-alert:${orgId}:${signature}`;
  const now = new Date();
  const windowStart = new Date(now.getTime() - 10 * 60 * 1000);

  await prisma.rateLimitEvent.deleteMany({
    where: {
      action: "ops:alert",
      createdAt: {
        lt: windowStart,
      },
    },
  });

  const existing = await prisma.rateLimitEvent.findFirst({
    where: {
      key,
      action: "ops:alert",
      createdAt: {
        gte: windowStart,
      },
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    return;
  }

  await prisma.rateLimitEvent.create({
    data: {
      key,
      action: "ops:alert",
    },
  });

  try {
    const response = await fetch(env.OPS_ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.OPS_ALERT_WEBHOOK_TOKEN ? { Authorization: `Bearer ${env.OPS_ALERT_WEBHOOK_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        source: "migrateck-ops-observability",
        orgId,
        alerts,
        timestamp: now.toISOString(),
      }),
    });

    if (!response.ok) {
      console.error("Ops alert webhook request failed", response.status);
    }
  } catch (error) {
    console.error("Ops alert webhook dispatch failed", error);
  }
}

export async function getWorkerDashboard(orgId: string) {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const refreshThreshold = new Date(Date.now() + socialConnectionSyncRefreshWindowHours * 60 * 60 * 1000);
  const staleThreshold = new Date(Date.now() - socialConnectionVerificationStaleHours * 60 * 60 * 1000);

  const [
    pendingCount,
    processingCount,
    failedCount,
    highRetryCount,
    oldestPending,
    deadLetterItems,
    lastProvisioningHeartbeat,
    lastEntitlementHeartbeat,
    lastSocialSyncHeartbeat,
    webhookFailuresHour,
    autoRestrictBursts,
    lockdownBlocks,
    reconnectRequiredCount,
    verificationStaleCount,
    tokenExpiringSoonCount,
  ] = await Promise.all([
    prisma.provisioningJob.count({ where: { orgId, status: ProvisioningJobStatus.PENDING } }),
    prisma.provisioningJob.count({ where: { orgId, status: ProvisioningJobStatus.RUNNING } }),
    prisma.provisioningJob.count({ where: { orgId, status: { in: [ProvisioningJobStatus.FAILED, ProvisioningJobStatus.DEAD] } } }),
    prisma.provisioningJob.count({
      where: {
        orgId,
        attempts: { gte: 2 },
        status: { in: [ProvisioningJobStatus.PENDING, ProvisioningJobStatus.RUNNING] },
      },
    }),
    prisma.provisioningJob.findFirst({
      where: { orgId, status: ProvisioningJobStatus.PENDING },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.provisioningJob.findMany({
      where: { orgId, status: ProvisioningJobStatus.DEAD },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        type: true,
        attempts: true,
        lastError: true,
        updatedAt: true,
      },
    }),
    prisma.auditLog.findFirst({
      where: {
        action: "PROVISIONING_WORKER_HEARTBEAT",
        OR: [{ orgId }, { orgId: null }],
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.auditLog.findFirst({
      where: {
        action: "ENTITLEMENT_EXPIRY_WORKER_HEARTBEAT",
        OR: [{ orgId }, { orgId: null }],
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.auditLog.findFirst({
      where: {
        action: "SOCIAL_CONNECTION_SYNC_WORKER_HEARTBEAT",
        OR: [{ orgId }, { orgId: null }],
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.billingWebhookEvent.count({
      where: {
        status: BillingWebhookEventStatus.FAILED,
        receivedAt: {
          gte: hourAgo,
        },
      },
    }),
    prisma.auditLog.count({
      where: {
        orgId,
        action: "ORG_ENTITLEMENT_AUTO_RESTRICTED",
        createdAt: { gte: hourAgo },
      },
    }),
    prisma.auditLog.count({
      where: {
        orgId,
        action: "PLATFORM_LOCKDOWN_BLOCKED",
        createdAt: { gte: hourAgo },
      },
    }),
    prisma.migraMarketSocialConnection.count({
      where: {
        orgId,
        accessModel: "oauth",
        credentialCiphertext: { not: null },
        status: "reconnect_required",
      },
    }),
    prisma.migraMarketSocialConnection.count({
      where: {
        orgId,
        accessModel: "oauth",
        credentialCiphertext: { not: null },
        OR: [{ lastVerifiedAt: null }, { lastVerifiedAt: { lt: staleThreshold } }],
      },
    }),
    prisma.migraMarketSocialConnection.count({
      where: {
        orgId,
        accessModel: "oauth",
        credentialCiphertext: { not: null },
        tokenExpiresAt: { lte: refreshThreshold },
      },
    }),
  ]);

  const oldestAgeSeconds = oldestPending ? Math.floor((Date.now() - oldestPending.createdAt.getTime()) / 1000) : null;

  const alerts: string[] = [];

  if (webhookFailuresHour >= opsAlertWebhookFailureThreshold) {
    alerts.push("webhook_failures_high");
  }

  if (oldestAgeSeconds !== null && oldestAgeSeconds >= opsAlertQueueStuckSeconds) {
    alerts.push("queue_stuck");
  }

  if (highRetryCount >= opsAlertRetryThreshold) {
    alerts.push("retry_rate_high");
  }

  if (autoRestrictBursts >= opsAlertAutoRestrictBurstThreshold) {
    alerts.push("entitlement_auto_restrict_burst");
  }

  if (lockdownBlocks >= opsAlertLockdownBlockBurstThreshold) {
    alerts.push("lockdown_blocks_burst");
  }

  if (reconnectRequiredCount >= opsAlertSocialReconnectThreshold) {
    alerts.push("social_reconnect_required");
  }

  if (verificationStaleCount >= opsAlertSocialStaleThreshold) {
    alerts.push("social_verification_stale");
  }

  await maybeDispatchOpsAlert(orgId, alerts);

  return {
    queue: {
      pending: pendingCount,
      processing: processingCount,
      failed: failedCount,
      highRetry: highRetryCount,
      oldestAgeSeconds,
      deadLetterCount: deadLetterItems.length,
      deadLetterItems,
    },
    workers: {
      provisioning: {
        lastSuccessAt: lastProvisioningHeartbeat?.createdAt || null,
      },
      entitlementExpiry: {
        lastSuccessAt: lastEntitlementHeartbeat?.createdAt || null,
      },
      socialConnectionSync: {
        lastSuccessAt: lastSocialSyncHeartbeat?.createdAt || null,
      },
    },
    socialConnections: {
      reconnectRequired: reconnectRequiredCount,
      verificationStale: verificationStaleCount,
      tokenExpiringSoon: tokenExpiringSoonCount,
    },
    alerts,
  };
}

export async function getSloMetrics(orgId: string) {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const [processedWebhooks, completedProvisioning, recentAudit] = await Promise.all([
    prisma.billingWebhookEvent.findMany({
      where: {
        status: BillingWebhookEventStatus.PROCESSED,
        processedAt: { not: null },
        receivedAt: { gte: hourAgo },
      },
      select: {
        receivedAt: true,
        processedAt: true,
      },
      take: 500,
      orderBy: { receivedAt: "desc" },
    }),
    prisma.provisioningJob.findMany({
      where: {
        orgId,
        status: ProvisioningJobStatus.SUCCEEDED,
        updatedAt: { gte: hourAgo },
      },
      select: {
        createdAt: true,
        updatedAt: true,
      },
      take: 500,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.auditLog.findMany({
      where: {
        orgId,
        createdAt: {
          gte: hourAgo,
        },
      },
      select: {
        action: true,
        metadata: true,
      },
      take: 2000,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const webhookDurations = processedWebhooks
    .map((event: { processedAt: Date | null; receivedAt: Date }) => {
      if (!event.processedAt) {
        return null;
      }

      return event.processedAt.getTime() - event.receivedAt.getTime();
    })
    .filter((value: number | null): value is number => typeof value === "number" && value >= 0);

  const provisioningDurations = completedProvisioning
    .map((task: { updatedAt: Date; createdAt: Date }) => task.updatedAt.getTime() - task.createdAt.getTime())
    .filter((value: number): value is number => Number.isFinite(value) && value >= 0);

  const mutationRows = recentAudit.filter((row: { action: string; metadata: Prisma.JsonValue | null }) => {
    const normalized = row.action.toUpperCase();
    if (normalized.includes("READ") || normalized.includes("VIEW") || normalized.includes("LIST")) {
      return false;
    }

    return true;
  });

  const denialRows = mutationRows.filter((row: { action: string; metadata: Prisma.JsonValue | null }) =>
    row.action === "AUTHZ_PERMISSION_DENIED" || row.action === "AUTHZ_RISK_TIER_DENIED" || row.action === "PLATFORM_LOCKDOWN_BLOCKED",
  );

  const denialByReason = new Map<string, number>();
  for (const row of denialRows) {
    const metadata = parseMetadata(row.metadata as Prisma.JsonValue | null);
    const reason = metadata.reason || row.action;
    denialByReason.set(reason, (denialByReason.get(reason) || 0) + 1);
  }

  return {
    stripeWebhookProcessingLatencyMs: {
      avg: webhookDurations.length ? Math.round(webhookDurations.reduce((sum: number, value: number) => sum + value, 0) / webhookDurations.length) : null,
      p95: percentile(webhookDurations, 0.95),
      sampleSize: webhookDurations.length,
    },
    provisioningJobCompletionTimeMs: {
      avg: provisioningDurations.length ? Math.round(provisioningDurations.reduce((sum: number, value: number) => sum + value, 0) / provisioningDurations.length) : null,
      p95: percentile(provisioningDurations, 0.95),
      sampleSize: provisioningDurations.length,
    },
    mutationDenialRateByReason: {
      totalMutations: mutationRows.length,
      totalDenied: denialRows.length,
      denialRate: mutationRows.length ? denialRows.length / mutationRows.length : 0,
      reasons: Array.from(denialByReason.entries()).map(([reason, count]) => ({ reason, count })),
    },
  };
}

export function toApiEventRow(event: AuditLog & { riskTier: 0 | 1 | 2 | null; route: string | null; reason: string | null }) {
  return {
    id: event.id,
    createdAt: event.createdAt,
    action: event.action,
    actorId: event.userId,
    orgId: event.orgId,
    resourceType: event.entityType,
    resourceId: event.entityId,
    riskTier: event.riskTier,
    route: event.route,
    reason: event.reason,
    metadata: event.metadata,
  };
}
