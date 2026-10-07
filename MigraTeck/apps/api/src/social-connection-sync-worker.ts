import { hostname } from "node:os";
import { dirname } from "node:path";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { closeDb } from "./lib/db.js";
import {
  processSocialConnectionSyncQueue,
  socialConnectionEncryptionReady,
} from "./lib/social-connection-sync.js";

function workerId(): string {
  return (
    process.env.SOCIAL_CONNECTION_SYNC_WORKER_INSTANCE_ID ||
    hostname() + ":" + process.pid
  );
}

function intervalMs(): number {
  const raw = Number(
    process.env.SOCIAL_CONNECTION_SYNC_INTERVAL_MS ?? 15 * 60 * 1000,
  );
  return Number.isFinite(raw) && raw >= 10_000
    ? raw
    : 15 * 60 * 1000;
}

function heartbeatFile(): string {
  return (
    process.env.SOCIAL_CONNECTION_SYNC_HEARTBEAT_FILE ??
    "/run/migrateck-social-sync/heartbeat.json"
  );
}

async function writeHeartbeat(
  id: string,
  result: Awaited<ReturnType<typeof processSocialConnectionSyncQueue>>,
): Promise<void> {
  const path = heartbeatFile();
  const temporary = path + ".tmp";
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    temporary,
    JSON.stringify({
      workerId: id,
      pid: process.pid,
      lastSeenAt: new Date().toISOString(),
      ...result,
    }) + "\n",
    { mode: 0o644 },
  );
  await rename(temporary, path);
}

async function removeHeartbeat(): Promise<void> {
  await unlink(heartbeatFile()).catch(() => undefined);
}

async function main(): Promise<void> {
  if (!socialConnectionEncryptionReady()) {
    throw new Error(
      "Social OAuth encryption key is not configured for the sync worker.",
    );
  }

  const id = workerId();
  let stopping = false;
  let wake: (() => void) | null = null;

  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log("[migrateck-social-sync-worker] stop requested", {
      signal,
      workerId: id,
    });
    wake?.();
  };

  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));

  console.log("[migrateck-social-sync-worker] started", {
    workerId: id,
    intervalMs: intervalMs(),
  });

  while (!stopping) {
    const started = Date.now();
    try {
      const result = await processSocialConnectionSyncQueue(undefined, id);
      await writeHeartbeat(id, result);
      if (
        result.processed > 0 ||
        result.failed > 0 ||
        result.reconnectRequired > 0
      ) {
        console.log("[migrateck-social-sync-worker] batch processed", {
          workerId: id,
          processed: result.processed,
          refreshed: result.refreshed,
          synced: result.synced,
          reconnectRequired: result.reconnectRequired,
          failed: result.failed,
          skipped: result.skipped,
          scanned: result.scanned,
          paused: result.paused,
          durationMs: Date.now() - started,
        });
      }
    } catch (error) {
      console.error("[migrateck-social-sync-worker] iteration failed", {
        workerId: id,
        message: error instanceof Error ? error.message : "unknown error",
      });
    }

    if (stopping) break;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        wake = null;
        resolve();
      }, intervalMs());
      wake = () => {
        clearTimeout(timer);
        wake = null;
        resolve();
      };
    });
  }

  await removeHeartbeat();
  await closeDb();
  console.log("[migrateck-social-sync-worker] stopped", {
    workerId: id,
  });
}

main().catch(async (error) => {
  console.error("[migrateck-social-sync-worker] fatal", {
    message: error instanceof Error ? error.message : "unknown error",
  });
  await closeDb().catch(() => undefined);
  process.exitCode = 1;
});
