import { hostname } from "node:os";
import { dirname } from "node:path";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { closeDb } from "./lib/db.js";
import { processWebhookBatch } from "./lib/webhooks.js";

function workerId(): string {
  return process.env.WORKER_INSTANCE_ID || hostname() + ":" + process.pid;
}

function heartbeatFile(): string {
  return (
    process.env.WEBHOOK_WORKER_HEARTBEAT_FILE ??
    "/run/migrateck-webhook/heartbeat.json"
  );
}

async function writeHeartbeat(id: string, processed = 0): Promise<void> {
  const path = heartbeatFile();
  const temporary = path + ".tmp";
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    temporary,
    JSON.stringify({
      workerId: id,
      pid: process.pid,
      lastSeenAt: new Date().toISOString(),
      lastBatchProcessed: processed,
    }) + "\n",
    { mode: 0o644 },
  );
  await rename(temporary, path);
}

async function removeHeartbeat(): Promise<void> {
  await unlink(heartbeatFile()).catch(() => undefined);
}

function idleDelayMs(processed: number): number {
  return processed > 0 ? 500 : 4_000;
}

async function main(): Promise<void> {
  const id = workerId();
  let stopping = false;
  let wake: (() => void) | null = null;

  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log("[migrateck-webhook-worker] stop requested", {
      signal,
      workerId: id,
    });
    wake?.();
  };

  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));

  await writeHeartbeat(id);
  console.log("[migrateck-webhook-worker] started", { workerId: id });

  while (!stopping) {
    let delay = 5_000;
    try {
      const processed = await processWebhookBatch(20);
      await writeHeartbeat(id, processed);
      delay = idleDelayMs(processed);
      if (processed > 0) {
        console.log("[migrateck-webhook-worker] batch processed", {
          workerId: id,
          processed,
        });
      }
    } catch (error) {
      console.error("[migrateck-webhook-worker] batch failed", {
        workerId: id,
        message: error instanceof Error ? error.message : "unknown error",
      });
    }

    if (stopping) break;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wake = null;
        resolve();
      }, delay);
      wake = () => {
        clearTimeout(timer);
        wake = null;
        resolve();
      };
    });
  }

  await removeHeartbeat();
  await closeDb();
  console.log("[migrateck-webhook-worker] stopped", { workerId: id });
}

main().catch(async (error) => {
  console.error("[migrateck-webhook-worker] fatal", {
    message: error instanceof Error ? error.message : "unknown error",
  });
  await removeHeartbeat().catch(() => undefined);
  await closeDb().catch(() => undefined);
  process.exitCode = 1;
});
