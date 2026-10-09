import { hostname } from "node:os";
import { dirname } from "node:path";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { closeDb } from "./lib/db.js";
import {
  reconcileDueBillingOrganizations,
  type BillingReconciliationBatchResult,
} from "./lib/commerce-billing.js";

function workerId(): string {
  return (
    process.env.BILLING_RECONCILIATION_WORKER_INSTANCE_ID ||
    hostname() + ":" + process.pid
  );
}

function pollIntervalMs(): number {
  const parsed = Number(
    process.env.BILLING_RECONCILIATION_POLL_INTERVAL_MS ?? 60_000,
  );
  return Number.isFinite(parsed) && parsed >= 15_000 ? parsed : 60_000;
}

function minimumSyncAgeMs(): number {
  const parsed = Number(
    process.env.BILLING_RECONCILIATION_MIN_SYNC_AGE_MS ?? 15 * 60_000,
  );
  return Number.isFinite(parsed) && parsed >= 60_000
    ? Math.min(parsed, 24 * 60 * 60_000)
    : 15 * 60_000;
}

function batchSize(): number {
  const parsed = Number(process.env.BILLING_RECONCILIATION_BATCH_SIZE ?? 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.floor(parsed), 50)
    : 10;
}

function heartbeatFile(): string {
  return (
    process.env.BILLING_RECONCILIATION_HEARTBEAT_FILE ??
    "/run/migrateck-billing-reconcile/heartbeat.json"
  );
}

function billingEnabled(): boolean {
  const raw = (process.env.STRIPE_BILLING_ENABLED ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

type HeartbeatState = {
  workerId: string;
  pid: number;
  lastSeenAt: string;
  startedAt: string;
  pollIntervalMs: number;
  minimumSyncAgeMs: number;
  batchSize: number;
  cycles: number;
  lastCycleAt: string | null;
  lastSuccessAt: string | null;
  lastBatch: Omit<BillingReconciliationBatchResult, "failedOrgIds"> | null;
};

async function writeHeartbeat(state: HeartbeatState): Promise<void> {
  const path = heartbeatFile();
  const temporary = path + ".tmp";
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, JSON.stringify(state) + "\n", { mode: 0o644 });
  await rename(temporary, path);
}

async function removeHeartbeat(): Promise<void> {
  await unlink(heartbeatFile()).catch(() => undefined);
}

async function main(): Promise<void> {
  if (!process.env.STRIPE_SECRET_KEY?.trim()) {
    throw new Error("STRIPE_SECRET_KEY is required");
  }
  if (!billingEnabled()) {
    throw new Error("STRIPE_BILLING_ENABLED must be enabled");
  }

  const id = workerId();
  const startedAt = new Date().toISOString();
  const interval = pollIntervalMs();
  const minAge = minimumSyncAgeMs();
  const size = batchSize();
  let stopping = false;
  let wake: (() => void) | null = null;
  let cycles = 0;
  let lastSuccessAt: string | null = null;

  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log("[migrateck-billing-reconciliation-worker] stop requested", {
      signal,
      workerId: id,
    });
    wake?.();
  };

  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));

  await writeHeartbeat({
    workerId: id,
    pid: process.pid,
    lastSeenAt: new Date().toISOString(),
    startedAt,
    pollIntervalMs: interval,
    minimumSyncAgeMs: minAge,
    batchSize: size,
    cycles,
    lastCycleAt: null,
    lastSuccessAt,
    lastBatch: null,
  });

  console.log("[migrateck-billing-reconciliation-worker] started", {
    workerId: id,
    pollIntervalMs: interval,
    minimumSyncAgeMs: minAge,
    batchSize: size,
  });

  while (!stopping) {
    const cycleStartedAt = new Date().toISOString();
    let lastBatch: Omit<
      BillingReconciliationBatchResult,
      "failedOrgIds"
    > | null = null;

    try {
      const result = await reconcileDueBillingOrganizations({
        workerId: id,
        batchSize: size,
        minSyncAgeMs: minAge,
      });
      cycles += 1;
      if (result.succeeded > 0) {
        lastSuccessAt = new Date().toISOString();
      }
      const { failedOrgIds, ...safeResult } = result;
      lastBatch = safeResult;

      if (
        result.selected > 0 ||
        result.failed > 0 ||
        result.skippedLocked > 0
      ) {
        console.log("[migrateck-billing-reconciliation-worker] cycle", {
          workerId: id,
          ...safeResult,
          failedOrgIds,
        });
      }
    } catch (error) {
      cycles += 1;
      console.error("[migrateck-billing-reconciliation-worker] cycle failed", {
        workerId: id,
        message: error instanceof Error ? error.message : "unknown error",
      });
    }

    await writeHeartbeat({
      workerId: id,
      pid: process.pid,
      lastSeenAt: new Date().toISOString(),
      startedAt,
      pollIntervalMs: interval,
      minimumSyncAgeMs: minAge,
      batchSize: size,
      cycles,
      lastCycleAt: cycleStartedAt,
      lastSuccessAt,
      lastBatch,
    });

    if (stopping) break;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wake = null;
        resolve();
      }, interval);
      wake = () => {
        clearTimeout(timer);
        wake = null;
        resolve();
      };
    });
  }

  await removeHeartbeat();
  await closeDb();
  console.log("[migrateck-billing-reconciliation-worker] stopped", {
    workerId: id,
  });
}

main().catch(async (error) => {
  console.error("[migrateck-billing-reconciliation-worker] fatal", {
    message: error instanceof Error ? error.message : "unknown error",
  });
  await removeHeartbeat().catch(() => undefined);
  await closeDb().catch(() => undefined);
  process.exitCode = 1;
});
