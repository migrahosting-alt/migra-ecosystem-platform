import { readFile } from "node:fs/promises";
import { getDb } from "./db.js";
import { getHostCapacitySnapshot } from "./host-capacity.js";
import { getReleaseIntegritySnapshot } from "./release-provenance.js";
import { getReleaseOverlaySnapshot } from "./release-overlay.js";
import { getProvisioningDriftSnapshot } from "./provisioning-drift.js";
import { getSocialConnectionOperationsSnapshot } from "./social-connection-sync.js";

export type WorkerState = "healthy" | "stale" | "missing";

type HeartbeatPayload = {
  workerId?: string;
  pid?: number;
  lastSeenAt?: string;
  [key: string]: unknown;
};

type WorkerHealth = {
  key:
    | "provisioning"
    | "entitlement_expiry"
    | "usage"
    | "billing_reconciliation"
    | "social_connections"
    | "webhooks";
  label: string;
  state: WorkerState;
  heartbeatPath: string | null;
  workerId: string | null;
  pid: number | null;
  lastSeenAt: string | null;
  ageSeconds: number | null;
  expectedMaxAgeSeconds: number;
  detail: Record<string, unknown>;
};

export function workerStateForAge(
  ageSeconds: number | null,
  expectedMaxAgeSeconds: number,
): WorkerState {
  if (ageSeconds === null) return "stale";
  return ageSeconds <= expectedMaxAgeSeconds ? "healthy" : "stale";
}

const WORKERS = [
  {
    key: "provisioning" as const,
    label: "Provisioning engine",
    heartbeatPath: process.env.PROVISIONING_WORKER_HEARTBEAT_FILE ?? "/run/migrateck-provisioning/heartbeat.json",
    expectedMaxAgeSeconds: 45,
  },
  {
    key: "entitlement_expiry" as const,
    label: "Entitlement expiry",
    heartbeatPath: process.env.ENTITLEMENT_EXPIRY_HEARTBEAT_FILE ?? "/run/migrateck-entitlement-expiry/heartbeat.json",
    expectedMaxAgeSeconds: 15 * 60,
  },
  {
    key: "usage" as const,
    label: "Usage export",
    heartbeatPath: process.env.USAGE_WORKER_HEARTBEAT_FILE ?? "/run/migrateck-usage/heartbeat.json",
    expectedMaxAgeSeconds: 45,
  },
  {
    key: "billing_reconciliation" as const,
    label: "Billing reconciliation",
    heartbeatPath:
      process.env.BILLING_RECONCILIATION_HEARTBEAT_FILE ??
      "/run/migrateck-billing-reconcile/heartbeat.json",
    expectedMaxAgeSeconds: 195,
  },
  {
    key: "social_connections" as const,
    label: "Social connection sync",
    heartbeatPath:
      process.env.SOCIAL_CONNECTION_SYNC_HEARTBEAT_FILE ??
      "/run/migrateck-social-sync/heartbeat.json",
    expectedMaxAgeSeconds: 20 * 60,
  },
  {
    key: "webhooks" as const,
    label: "Webhook delivery",
    heartbeatPath: process.env.WEBHOOK_WORKER_HEARTBEAT_FILE ?? "/run/migrateck-webhook/heartbeat.json",
    expectedMaxAgeSeconds: 20,
  },
] as const;

async function readHeartbeat(
  input: (typeof WORKERS)[number],
  now: number,
): Promise<WorkerHealth> {
  try {
    const raw = await readFile(input.heartbeatPath, "utf8");
    const parsed = JSON.parse(raw) as HeartbeatPayload;
    const lastSeenAt =
      typeof parsed.lastSeenAt === "string" ? parsed.lastSeenAt : null;
    const lastSeenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : Number.NaN;
    const ageSeconds = Number.isFinite(lastSeenMs)
      ? Math.max(0, Math.round((now - lastSeenMs) / 1000))
      : null;
    const state = workerStateForAge(
      ageSeconds,
      input.expectedMaxAgeSeconds,
    );

    const detail = Object.fromEntries(
      Object.entries(parsed).filter(
        ([key]) => !["workerId", "pid", "lastSeenAt"].includes(key),
      ),
    );

    return {
      key: input.key,
      label: input.label,
      state,
      heartbeatPath: input.heartbeatPath,
      workerId:
        typeof parsed.workerId === "string" ? parsed.workerId : null,
      pid: typeof parsed.pid === "number" ? parsed.pid : null,
      lastSeenAt,
      ageSeconds,
      expectedMaxAgeSeconds: input.expectedMaxAgeSeconds,
      detail,
    };
  } catch {
    return {
      key: input.key,
      label: input.label,
      state: "missing",
      heartbeatPath: input.heartbeatPath,
      workerId: null,
      pid: null,
      lastSeenAt: null,
      ageSeconds: null,
      expectedMaxAgeSeconds: input.expectedMaxAgeSeconds,
      detail: {},
    };
  }
}

export async function getInfrastructureHealthSnapshot() {
  const now = Date.now();
  const db = getDb();

  const [
    workers,
    provisioning,
    provisioningDrift,
    webhooks,
    usageExports,
    entitlements,
    socialConnections,
    releaseIntegrity,
    releaseOverlay,
    hostCapacity,
  ] = await Promise.all([
    Promise.all(WORKERS.map((worker) => readHeartbeat(worker, now))),
    db.query(
      `SELECT
         count(*) FILTER (WHERE status='PENDING')::int AS pending,
         count(*) FILTER (WHERE status='RUNNING')::int AS running,
         count(*) FILTER (WHERE status='FAILED')::int AS failed,
         count(*) FILTER (WHERE status='DEAD')::int AS dead,
         count(*) FILTER (WHERE status='SUCCEEDED')::int AS succeeded,
         min("createdAt") FILTER (WHERE status IN ('PENDING','RUNNING','FAILED')) AS "oldestOpenAt",
         max("updatedAt") AS "lastUpdatedAt"
       FROM "ProvisioningJob"`,
    ),
    getProvisioningDriftSnapshot(),
    db.query(
      `SELECT
         count(*) FILTER (WHERE status='PENDING')::int AS pending,
         count(*) FILTER (WHERE status='FAILED')::int AS failed,
         count(*) FILTER (WHERE status='DELIVERED')::int AS delivered,
         count(*) FILTER (WHERE status='EXPIRED')::int AS expired,
         min("createdAt") FILTER (WHERE status='PENDING') AS "oldestPendingAt",
         max("updatedAt") AS "lastUpdatedAt"
       FROM "WebhookDelivery"`,
    ),
    db.query(
      `SELECT
         count(*) FILTER (WHERE "meterName" IS NOT NULL)::int AS total,
         count(*) FILTER (WHERE "exportStatus"='PENDING_EXPORT')::int AS pending,
         count(*) FILTER (WHERE "exportStatus"='RUNNING')::int AS running,
         count(*) FILTER (WHERE "exportStatus"='RETRY')::int AS retry,
         count(*) FILTER (WHERE "exportStatus"='FAILED')::int AS failed,
         count(*) FILTER (WHERE "exportStatus"='EXPORTED')::int AS exported,
         min(timestamp) FILTER (
           WHERE "exportStatus" IN ('PENDING_EXPORT','RUNNING','RETRY')
         ) AS "oldestOpenAt",
         max("updatedAt") FILTER (WHERE "meterName" IS NOT NULL) AS "lastUpdatedAt"
       FROM "UsageEvent"`,
    ),
    db.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE status='ACTIVE')::int AS active,
         count(*) FILTER (WHERE status='RESTRICTED')::int AS restricted,
         count(*) FILTER (WHERE "endsAt" IS NOT NULL AND "endsAt" <= NOW())::int AS overdue,
         min("endsAt") FILTER (WHERE status='ACTIVE' AND "endsAt" > NOW()) AS "nextExpiryAt",
         max("updatedAt") AS "lastUpdatedAt"
       FROM "OrgEntitlement"`,
    ),
    getSocialConnectionOperationsSnapshot(),
    getReleaseIntegritySnapshot(),
    getReleaseOverlaySnapshot(),
    getHostCapacitySnapshot(),
  ]);

  const allWorkers = workers;
  const unhealthyWorkers = allWorkers.filter((worker) => worker.state !== "healthy");
  const provisioningDriftHealth = {
    needsVerification: provisioningDrift.needsVerification,
    correlatedDeadJobs: provisioningDrift.correlatedDeadJobs,
    historicalNeedsReview: provisioningDrift.historicalNeedsReview,
    historicalCorrelatedDeadJobs: provisioningDrift.historicalCorrelatedDeadJobs,
    syntheticTestRows: provisioningDrift.syntheticTestRows,
    rolloutPolicyBlockedRows: provisioningDrift.rolloutPolicyBlockedRows,
    runtimeLinkRequiredRows: provisioningDrift.runtimeLinkRequiredRows,
  };
  const releaseIntegrityIssues = releaseIntegrity.filter(
    (release) => release.state !== "verified",
  ).length;

  const socialConnectionHealth = {
    total: socialConnections.summary.total,
    credentialed: socialConnections.rows.filter((row) => row.connected).length,
    missingCredential: socialConnections.rows.filter((row) => !row.connected).length,
    disconnected: socialConnections.rows.filter((row) => !row.connected).length,
    needsAttention: socialConnections.summary.needsAttention,
    reconnectRequired: socialConnections.summary.reconnectRequired,
    connectRequired: socialConnections.summary.connectRequired,
    providerSetupRequired: socialConnections.summary.providerSetupRequired,
    integrationRequired: socialConnections.summary.integrationRequired,
    refreshRequired: socialConnections.summary.refreshRequired,
    syncRequired: socialConnections.summary.syncRequired,
    tokenExpired: socialConnections.rows.filter((row) => row.health.tokenExpired).length,
    tokenExpiresSoon: socialConnections.rows.filter((row) => row.health.tokenExpiresSoon).length,
    verificationStale: socialConnections.rows.filter((row) => row.health.verificationStale).length,
    connections: socialConnections.rows.map((row) => ({
      id: row.id,
      orgId: row.orgId,
      orgName: row.orgName,
      platform: row.platform,
      handle: row.handle,
      status: row.status,
      state: row.health.state,
      summary: row.health.summary,
      recommendedAction: row.health.operatorAction,
      connected: row.connected,
      canAutoRefresh: row.health.canAutoRefresh,
      tokenExpired: row.health.tokenExpired,
      tokenExpiresSoon: row.health.tokenExpiresSoon,
      verificationStale: row.health.verificationStale,
      missingAccountBinding: row.health.missingAccountBinding ?? false,
      requiresReconnect: row.health.operatorAction === "reconnect",
      providerSetupRequired: row.health.providerSetupRequired,
      integrationRequired: row.health.operatorAction === "integration_required",
      needsAttention: row.health.needsAttention,
      expiresInHours: row.health.expiresInHours,
      tokenExpiresAt: row.tokenExpiresAt,
      lastVerifiedAt: row.lastVerifiedAt,
    })),
  };

  return {
    generatedAt: new Date(now).toISOString(),
    summary: {
      workers: allWorkers.length,
      healthyWorkers: allWorkers.length - unhealthyWorkers.length,
      unhealthyWorkers: unhealthyWorkers.length,
      provisioningBacklog:
        Number(provisioning.rows[0]?.pending ?? 0) +
        Number(provisioning.rows[0]?.running ?? 0) +
        Number(provisioning.rows[0]?.failed ?? 0),
      provisioningDeadLetters: Number(provisioning.rows[0]?.dead ?? 0),
      provisioningDriftNeedsVerification:
        provisioningDriftHealth.needsVerification,
      webhookBacklog: Number(webhooks.rows[0]?.pending ?? 0),
      entitlementOverdue: Number(entitlements.rows[0]?.overdue ?? 0),
      socialConnectionAttention: socialConnectionHealth.needsAttention,
      socialReconnectRequired: socialConnectionHealth.reconnectRequired,
      socialConnectRequired: socialConnectionHealth.connectRequired,
      socialProviderSetupRequired: socialConnectionHealth.providerSetupRequired,
      socialIntegrationRequired: socialConnectionHealth.integrationRequired,
      releaseIntegrityIssues,
      releaseOverlayState: releaseOverlay.state,
      releaseOverlayDifferences: releaseOverlay.summary.totalDifferences,
      releaseOverlayRuntimeReconciliation:
        releaseOverlay.summary.runtimeReconciliation,
      releaseOverlayHighCriticality: releaseOverlay.summary.highCriticality,
      releaseOverlayIntentionalExclusions:
        releaseOverlay.summary.intentionalExclusions,
      releaseOverlayOverdueExclusions:
        releaseOverlay.summary.overdueExclusions,
      hostCapacityState: hostCapacity.state,
      diskUsedPercent: hostCapacity.disk.usedPercent,
      diskAvailableBytes: hostCapacity.disk.availableBytes,
    },
    workers: allWorkers,
    queues: {
      provisioning: {
        ...(provisioning.rows[0] ?? {}),
        driftNeedsVerification: provisioningDriftHealth.needsVerification,
        driftCorrelatedDeadJobs: provisioningDriftHealth.correlatedDeadJobs,
      },
      webhooks: webhooks.rows[0] ?? {},
      usageExports: usageExports.rows[0] ?? {},
      entitlements: entitlements.rows[0] ?? {},
      socialConnections: socialConnectionHealth,
    },
    releases: releaseIntegrity,
    overlay: releaseOverlay,
    host: hostCapacity,
  };
}
