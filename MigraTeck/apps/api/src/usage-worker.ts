import { hostname } from "node:os";
import { dirname } from "node:path";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { closeDb } from "./lib/db.js";
import {
  failExpiredUsageExports,
  processUsageExportBatch,
  recoverStaleUsageExports,
} from "./lib/usage-export-engine.js";

function workerId(): string {
  return process.env.WORKER_INSTANCE_ID || hostname() + ":" + process.pid;
}

function pollIntervalMs(): number {
  const parsed = Number(process.env.USAGE_WORKER_INTERVAL_MS ?? 10_000);
  return Number.isFinite(parsed) && parsed >= 1_000 ? parsed : 10_000;
}

function batchSize(): number {
  const parsed = Number(process.env.USAGE_WORKER_BATCH_SIZE ?? 25);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.floor(parsed), 100)
    : 25;
}

function heartbeatFile(): string {
  return (
    process.env.USAGE_WORKER_HEARTBEAT_FILE ??
    "/run/migrateck-usage/heartbeat.json"
  );
}

async function writeHeartbeat(id: string): Promise<void> {
  const path = heartbeatFile();
  const temporary = path + ".tmp";
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    temporary,
    JSON.stringify({
      workerId: id,
      pid: process.pid,
      lastSeenAt: new Date().toISOString(),
    }) + "\n",
    { mode: 0o644 },
  );
  await rename(temporary, path);
}

async function removeHeartbeat(): Promise<void> {
  await unlink(heartbeatFile()).catch(() => undefined);
}

function billingEnabled(): boolean {
  const raw = (process.env.STRIPE_BILLING_ENABLED ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

async function main(): Promise<void> {
  if (!process.env.STRIPE_SECRET_KEY?.trim()) {
    throw new Error("STRIPE_SECRET_KEY is required");
  }
  if (!billingEnabled()) {
    throw new Error("STRIPE_BILLING_ENABLED must be enabled");
  }

  const id = workerId();
  let stopping = false;
  let wake: (() => void) | null = null;

  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log("[migrateck-usage-worker] stop requested", {
      signal,
      workerId: id,
    });
    wake?.();
  };

  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));

  const recovered = await recoverStaleUsageExports();
  const expired = await failExpiredUsageExports();
  await writeHeartbeat(id);

  console.log("[migrateck-usage-worker] started", {
    workerId: id,
    recovered,
    expired,
    intervalMs: pollIntervalMs(),
    batchSize: batchSize(),
  });

  while (!stopping) {
    const started = Date.now();
    try {
      const expiredNow = await failExpiredUsageExports();
      const processed = await processUsageExportBatch(batchSize());
      await writeHeartbeat(id);

      if (processed > 0 || expiredNow > 0) {
        console.log("[migrateck-usage-worker] batch processed", {
          workerId: id,
          processed,
          expired: expiredNow,
          durationMs: Date.now() - started,
        });
      }
    } catch (error) {
      console.error("[migrateck-usage-worker] iteration failed", {
        workerId: id,
        message: error instanceof Error ? error.message : "unknown error",
      });
    }

    if (stopping) break;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wake = null;
        resolve();
      }, pollIntervalMs());
      wake = () => {
        clearTimeout(timer);
        wake = null;
        resolve();
      };
    });
  }

  await removeHeartbeat();
  await closeDb();
  console.log("[migrateck-usage-worker] stopped", { workerId: id });
}

main().catch(async (error) => {
  console.error("[migrateck-usage-worker] fatal", {
    message: error instanceof Error ? error.message : "unknown error",
  });
  await closeDb().catch(() => undefined);
  process.exitCode = 1;
});
