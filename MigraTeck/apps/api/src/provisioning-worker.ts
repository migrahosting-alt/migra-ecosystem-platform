import { hostname } from "node:os";
import { closeDb } from "./lib/db.js";
import {
  processProvisioningBatch,
  recoverStaleProvisioningJobs,
} from "./lib/provisioning-engine.js";

function workerId(): string {
  return process.env.WORKER_INSTANCE_ID || hostname() + ":" + process.pid;
}

function pollIntervalMs(): number {
  const parsed = Number(process.env.PROVISIONING_WORKER_INTERVAL_MS ?? 10_000);
  return Number.isFinite(parsed) && parsed >= 1_000 ? parsed : 10_000;
}

function batchSize(): number {
  const parsed = Number(process.env.PROVISIONING_WORKER_BATCH_SIZE ?? 25);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.floor(parsed), 100)
    : 25;
}

async function main(): Promise<void> {
  if (!process.env.JOB_ENVELOPE_SIGNING_SECRET?.trim()) {
    throw new Error("JOB_ENVELOPE_SIGNING_SECRET is required");
  }

  const id = workerId();
  let stopping = false;
  let wake: (() => void) | null = null;

  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log("[migrateck-provisioning-worker] stop requested", {
      signal,
      workerId: id,
    });
    wake?.();
  };

  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));

  const recovered = await recoverStaleProvisioningJobs();
  console.log("[migrateck-provisioning-worker] started", {
    workerId: id,
    recovered,
    intervalMs: pollIntervalMs(),
    batchSize: batchSize(),
  });

  while (!stopping) {
    const started = Date.now();
    try {
      const processed = await processProvisioningBatch(id, batchSize());
      if (processed > 0) {
        console.log("[migrateck-provisioning-worker] batch processed", {
          workerId: id,
          processed,
          durationMs: Date.now() - started,
        });
      }
    } catch (error) {
      console.error("[migrateck-provisioning-worker] iteration failed", {
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

  await closeDb();
  console.log("[migrateck-provisioning-worker] stopped", { workerId: id });
}

main().catch(async (error) => {
  console.error("[migrateck-provisioning-worker] fatal", {
    message: error instanceof Error ? error.message : "unknown error",
  });
  await closeDb().catch(() => undefined);
  process.exitCode = 1;
});
