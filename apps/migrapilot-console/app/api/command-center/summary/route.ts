import fs from "node:fs";

import { NextResponse } from "next/server";

import { readAutonomyState } from "../../../../lib/autonomy/store";
import { buildAutonomyReport } from "../../../../lib/autonomy/engine/services/report";
import { emitInventoryAlert, listActivity } from "../../../../lib/activity/store";
import { listRuns } from "../../../../lib/server/store";

const INVENTORY_PATH = process.env.MIGRAPILOT_INVENTORY_PATH ?? "/etc/migrapilot/inventory.json";
const INVENTORY_STALE_MS = Number(process.env.MIGRAPILOT_INVENTORY_STALE_MS ?? 10 * 60 * 1000);

type InventorySummary = {
  path: string;
  generatedAt: string | null;
  ageMinutes: number | null;
  stale: boolean;
  counts: {
    tenants: number;
    pods: number;
    domains: number;
    services: number;
    edges: number;
  };
  error: string | null;
};

function readInventorySummary(): InventorySummary {
  try {
    const raw = JSON.parse(fs.readFileSync(INVENTORY_PATH, "utf8")) as Record<string, unknown>;
    const generatedAt = typeof raw.generatedAt === "string" ? raw.generatedAt : null;
    const generatedTs = generatedAt ? Date.parse(generatedAt) : Number.NaN;
    const ageMs = Number.isFinite(generatedTs) ? Date.now() - generatedTs : Number.NaN;
    const ageMinutes = Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 60000)) : null;
    const topology = raw.topology && typeof raw.topology === "object" ? (raw.topology as Record<string, unknown>) : {};

    return {
      path: INVENTORY_PATH,
      generatedAt,
      ageMinutes,
      stale: !Number.isFinite(ageMs) || ageMs > INVENTORY_STALE_MS,
      counts: {
        tenants: Array.isArray(raw.tenants) ? raw.tenants.length : 0,
        pods: Array.isArray(raw.pods) ? raw.pods.length : 0,
        domains: Array.isArray(raw.domains) ? raw.domains.length : 0,
        services: Array.isArray(raw.services) ? raw.services.length : 0,
        edges: Array.isArray(topology.edges) ? topology.edges.length : 0,
      },
      error: null,
    };
  } catch (error) {
    return {
      path: INVENTORY_PATH,
      generatedAt: null,
      ageMinutes: null,
      stale: true,
      counts: {
        tenants: 0,
        pods: 0,
        domains: 0,
        services: 0,
        edges: 0,
      },
      error: error instanceof Error ? error.message : "Inventory read failed",
    };
  }
}

export async function GET() {
  const state = readAutonomyState();
  const report = buildAutonomyReport();
  const runs = listRuns(50);
  const inventory = readInventorySummary();
  if (inventory.stale) {
    emitInventoryAlert({
      path: inventory.path,
      ageMinutes: inventory.ageMinutes,
      error: inventory.error
    });
  }
  const activity = listActivity(10);

  const openApprovals = state.queue.filter((item) => item.status === "awaiting_approval").length;
  const failedQueue = state.queue.filter((item) => item.status === "failed").length;
  const executedRuns = runs.filter((run) => run.status === "completed").length;
  const failedRuns = runs.filter((run) => run.status === "failed").length;

  return NextResponse.json({
    ok: true,
    data: {
      generatedAt: new Date().toISOString(),
      autonomy: {
        enabled: state.config.enabled,
        confidence: state.confidence.score,
        openRisks: report.dashboard.openRisks,
        recommendedActions: report.dashboard.recommendedActions,
        topSignal: report.dashboard.topSignal ?? null,
      },
      operations: {
        queuedMissions: state.queue.filter((item) => item.status === "queued").length,
        runningMissions: state.queue.filter((item) => item.status === "running").length,
        openApprovals,
        failedQueue,
      },
      inventory,
      commandCenter: {
        executedRuns,
        failedRuns,
        recentActivity: activity,
      },
      strategy: report.strategy.slice(0, 5),
      actions: report.actions.slice(0, 5),
      commands: report.supportedCommands,
    }
  });
}
