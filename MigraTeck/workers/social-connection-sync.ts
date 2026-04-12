import { hostname } from "node:os";
import { writeAuditLog } from "@/lib/audit";
import { runSocialConnectionSyncWorker, socialConnectionSyncBatchSize } from "@/lib/env";
import { assessSocialConnectionHealth } from "@/lib/migramarket-social-health";
import { ensureSocialConnectionOperationalForOrg } from "@/lib/migramarket-social-publisher";
import { getPlatformConfig } from "@/lib/platform-config";
import { prisma } from "@/lib/prisma";

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

function workerId(): string {
  return process.env.WORKER_INSTANCE_ID || `${hostname()}:${process.pid}`;
}

export async function processSocialConnectionSyncQueue(limit = socialConnectionSyncBatchSize) {
  const config = await getPlatformConfig();
  if (config.maintenanceMode) {
    await writeAuditLog({
      action: "SOCIAL_CONNECTION_SYNC_WORKER_HEARTBEAT",
      resourceType: "worker",
      resourceId: "social-connection-sync",
      riskTier: 0,
      metadata: {
        skipped: true,
        maintenanceMode: true,
      },
    });

    return {
      processed: 0,
      refreshed: 0,
      synced: 0,
      reconnectRequired: 0,
      failed: 0,
      skipped: 0,
      scanned: 0,
    };
  }

  const candidates = await prisma.migraMarketSocialConnection.findMany({
    where: {
      accessModel: "oauth",
      credentialCiphertext: { not: null },
      status: { not: "paused" },
    },
    orderBy: [{ tokenExpiresAt: "asc" }, { lastVerifiedAt: "asc" }, { updatedAt: "asc" }],
    take: Math.max(limit * 4, limit),
  });

  const stats = {
    processed: 0,
    refreshed: 0,
    synced: 0,
    reconnectRequired: 0,
    failed: 0,
    skipped: 0,
    scanned: candidates.length,
  };

  for (const candidate of candidates) {
    if (stats.processed >= limit) {
      break;
    }

    const health = assessSocialConnectionHealth(candidate);
    if (health.recommendedAction === "monitor") {
      stats.skipped += 1;
      continue;
    }

    try {
      const result = await ensureSocialConnectionOperationalForOrg(candidate.orgId, candidate.id);
      stats.processed += 1;
      if (result.refreshedToken) {
        stats.refreshed += 1;
      }
      if (result.profileSynced) {
        stats.synced += 1;
      }
      if (assessSocialConnectionHealth(result.connection).requiresReconnect) {
        stats.reconnectRequired += 1;
      }
    } catch {
      stats.processed += 1;
      stats.failed += 1;
    }
  }

  await writeAuditLog({
    action: "SOCIAL_CONNECTION_SYNC_WORKER_HEARTBEAT",
    resourceType: "worker",
    resourceId: "social-connection-sync",
    riskTier: 0,
    metadata: {
      ...stats,
      workerId: workerId(),
    },
  });

  return stats;
}

export function startSocialConnectionSyncWorker(intervalMs = DEFAULT_INTERVAL_MS): NodeJS.Timeout {
  const handle = setInterval(() => {
    void processSocialConnectionSyncQueue().catch((error) => {
      console.error("social connection sync worker iteration failed", error);
    });
  }, intervalMs);

  return handle;
}

if (runSocialConnectionSyncWorker) {
  void processSocialConnectionSyncQueue().catch((error) => {
    console.error("social connection sync worker startup failed", error);
    process.exitCode = 1;
  });

  startSocialConnectionSyncWorker();
}
