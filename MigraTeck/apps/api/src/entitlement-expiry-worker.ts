import { hostname } from "node:os";
import { dirname } from "node:path";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { closeDb } from "./lib/db.js";
import { transitionExpiredEntitlements } from "./lib/entitlement-expiry.js";

function workerId(): string {
  return (
    process.env.ENTITLEMENT_EXPIRY_WORKER_INSTANCE_ID ||
    hostname() + ":" + process.pid
  );
}

function intervalMs(): number {
  const value = Number(
    process.env.ENTITLEMENT_EXPIRY_INTERVAL_MS ?? 10 * 60 * 1000,
  );
  return Number.isFinite(value) && value >= 10_000
    ? value
    : 10 * 60 * 1000;
}

function heartbeatFile(): string {
  return (
    process.env.ENTITLEMENT_EXPIRY_HEARTBEAT_FILE ??
    "/run/migrateck-entitlement-expiry/heartbeat.json"
  );
}

async function writeHeartbeat(
  id: string,
  result: Awaited<ReturnType<typeof transitionExpiredEntitlements>>,
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
  if (!process.env.JOB_ENVELOPE_SIGNING_SECRET?.trim()) {
    throw new Error("JOB_ENVELOPE_SIGNING_SECRET is required");
  }

  const id = workerId();
  let stopping = false;
  let wake: (() => void) | null = null;

  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log("[migrateck-entitlement-expiry-worker] stop requested", {
      signal,
      workerId: id,
    });
    wake?.();
  };

  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));

  console.log("[migrateck-entitlement-expiry-worker] started", {
    workerId: id,
    intervalMs: intervalMs(),
  });

  while (!stopping) {
    const started = Date.now();
    try {
      const result = await transitionExpiredEntitlements();
      await writeHeartbeat(id, result);
      if (
        result.restricted > 0 ||
        result.queuedJobs > 0 ||
        result.skippedProvisioning > 0
      ) {
        console.log("[migrateck-entitlement-expiry-worker] batch processed", {
          workerId: id,
          ...result,
          durationMs: Date.now() - started,
        });
      }
    } catch (error) {
      console.error("[migrateck-entitlement-expiry-worker] iteration failed", {
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
  console.log("[migrateck-entitlement-expiry-worker] stopped", {
    workerId: id,
  });
}

main().catch(async (error) => {
  console.error("[migrateck-entitlement-expiry-worker] fatal", {
    message: error instanceof Error ? error.message : "unknown error",
  });
  await closeDb().catch(() => undefined);
  process.exitCode = 1;
});
