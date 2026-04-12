import fs from "node:fs";
import { randomUUID } from "node:crypto";

import { listActivity } from "../../../activity/store";
import { listRuns } from "../../../server/store";
import type { AutonomyState } from "../../types";
import type { SystemEvent } from "../models";

const INVENTORY_PATH = process.env.MIGRAPILOT_INVENTORY_PATH ?? "/etc/migrapilot/inventory.json";
const INVENTORY_STALE_MS = Number(process.env.MIGRAPILOT_INVENTORY_STALE_MS ?? 10 * 60 * 1000);

function event(source: SystemEvent["source"], type: string, severity: SystemEvent["severity"], metadata: Record<string, unknown>): SystemEvent {
  return {
    id: `evt_${randomUUID()}`,
    source,
    type,
    severity,
    timestamp: new Date().toISOString(),
    metadata
  };
}

function readInventoryObservation(): {
  stale: boolean;
  error: string | null;
  generatedAt: string | null;
  ageMinutes: number | null;
  counts: {
    services: number;
    pods: number;
    tenants: number;
    domains: number;
    edges: number;
  };
} {
  try {
    const raw = JSON.parse(fs.readFileSync(INVENTORY_PATH, "utf8")) as Record<string, unknown>;
    const generatedAt = typeof raw.generatedAt === "string" ? raw.generatedAt : null;
    const generatedTs = generatedAt ? Date.parse(generatedAt) : Number.NaN;
    const ageMs = Number.isFinite(generatedTs) ? Date.now() - generatedTs : Number.NaN;
    const topology = raw.topology && typeof raw.topology === "object" ? (raw.topology as Record<string, unknown>) : {};
    return {
      stale: !Number.isFinite(ageMs) || ageMs > INVENTORY_STALE_MS,
      error: null,
      generatedAt,
      ageMinutes: Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 60000)) : null,
      counts: {
        services: Array.isArray(raw.services) ? raw.services.length : 0,
        pods: Array.isArray(raw.pods) ? raw.pods.length : 0,
        tenants: Array.isArray(raw.tenants) ? raw.tenants.length : 0,
        domains: Array.isArray(raw.domains) ? raw.domains.length : 0,
        edges: Array.isArray(topology.edges) ? topology.edges.length : 0,
      }
    };
  } catch (error) {
    return {
      stale: true,
      error: error instanceof Error ? error.message : "Inventory read failed",
      generatedAt: null,
      ageMinutes: null,
      counts: {
        services: 0,
        pods: 0,
        tenants: 0,
        domains: 0,
        edges: 0,
      }
    };
  }
}

export function observeSystem(state: AutonomyState): SystemEvent[] {
  const events: SystemEvent[] = [];
  const counts = state.queue.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  events.push(event("autonomy", state.config.enabled ? "autonomy_enabled" : "autonomy_disabled", state.config.enabled ? "info" : "warn", {
    enabled: state.config.enabled,
    defaultEnv: state.config.environmentPolicy.defaultEnv
  }));

  if (state.confidence.score < 0.5) {
    events.push(event("confidence", "confidence_drop", state.confidence.score < 0.3 ? "critical" : "warn", {
      score: state.confidence.score,
      recentFailures: state.confidence.recentFailures,
      recentSuccesses: state.confidence.recentSuccesses
    }));
  }

  if ((counts.awaiting_approval ?? 0) > 0 || (counts.failed ?? 0) > 0) {
    events.push(event("queue", "automation_backlog", (counts.failed ?? 0) > 0 ? "warn" : "info", {
      queued: counts.queued ?? 0,
      running: counts.running ?? 0,
      awaitingApproval: counts.awaiting_approval ?? 0,
      failed: counts.failed ?? 0
    }));
  }

  const inventory = readInventoryObservation();
  if (inventory.stale) {
    events.push(event("inventory", "inventory_stale", "critical", {
      path: INVENTORY_PATH,
      generatedAt: inventory.generatedAt,
      ageMinutes: inventory.ageMinutes,
      error: inventory.error,
      ...inventory.counts
    }));
  } else if (inventory.counts.services === 0 || inventory.counts.pods === 0) {
    events.push(event("inventory", "inventory_sparse", "warn", {
      path: INVENTORY_PATH,
      generatedAt: inventory.generatedAt,
      ageMinutes: inventory.ageMinutes,
      ...inventory.counts
    }));
  }

  for (const finding of state.findings.slice(0, 20)) {
    events.push(event("finding", finding.source, finding.severity, {
      findingId: finding.findingId,
      title: finding.title,
      details: finding.details,
      classification: finding.classification,
      tenantId: finding.tenantId
    }));
  }

  for (const activity of listActivity(20)) {
    const severity =
      activity.riskLevel === "critical"
        ? "critical"
        : activity.riskLevel === "warn"
          ? "warn"
          : "info";

    events.push(event("activity", activity.kind, severity, {
      title: activity.title,
      details: activity.detail,
      suggestion: activity.suggestion,
      confidence: activity.confidence,
      missionId: activity.missionId,
      findingId: activity.findingId,
      source: "activity_feed"
    }));
  }

  for (const run of listRuns(20)) {
    const severity =
      run.status === "failed"
        ? "critical"
        : run.status === "denied"
          ? "warn"
          : "info";

    events.push(event("run", run.overlay.toolName, severity, {
      title: run.overlay.toolName,
      details: run.error ?? run.output?.error?.message ?? `${run.overlay.env}:${run.overlay.runnerType}`,
      toolName: run.overlay.toolName,
      effectiveTier: run.overlay.effectiveTier,
      executionScope: run.overlay.executionScope,
      status: run.status,
      source: "command_runs"
    }));
  }

  return events;
}
