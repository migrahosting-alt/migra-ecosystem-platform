import { hostname } from "node:os";
import { writeAuditLog } from "@/lib/audit";
import { processVpsActionQueue } from "@/lib/vps/reconcile";

const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_BATCH_SIZE = 25;

function workerId(): string {
  return process.env.WORKER_INSTANCE_ID || `${hostname()}:${process.pid}`;
}

export async function reconcileVpsActions(limit = DEFAULT_BATCH_SIZE) {
  const processed = await processVpsActionQueue(limit);

  await writeAuditLog({
    action: "VPS_ACTION_RECONCILE_WORKER_HEARTBEAT",
    resourceType: "worker",
    resourceId: "vps-action-reconcile",
    riskTier: 0,
    metadata: {
      processed,
      workerId: workerId(),
    },
  });

  return processed;
}

export function startVpsActionReconcileWorker(intervalMs = DEFAULT_INTERVAL_MS): NodeJS.Timeout {
  return setInterval(() => {
    void reconcileVpsActions().catch((error) => {
      console.error("vps action reconcile worker iteration failed", error);
    });
  }, intervalMs);
}

if (process.env.RUN_VPS_ACTION_RECONCILE_WORKER === "true") {
  void reconcileVpsActions().catch((error) => {
    console.error("vps action reconcile worker startup failed", error);
    process.exitCode = 1;
  });

  startVpsActionReconcileWorker();
}