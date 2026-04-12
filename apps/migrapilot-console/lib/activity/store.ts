import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { ActivityEvent, ActivityEventKind, ActivityIcon } from "./types";

const ACTIVITY_PATH = path.resolve(process.cwd(), ".data", "activity.json");
const MAX_EVENTS = 500;

function ensureFile(): void {
  fs.mkdirSync(path.dirname(ACTIVITY_PATH), { recursive: true });
  if (!fs.existsSync(ACTIVITY_PATH)) {
    fs.writeFileSync(ACTIVITY_PATH, "[]", "utf8");
  }
}

function readRaw(): ActivityEvent[] {
  ensureFile();
  try {
    const text = fs.readFileSync(ACTIVITY_PATH, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as ActivityEvent[];
  } catch {
    return [];
  }
}

function writeRaw(events: ActivityEvent[]): void {
  ensureFile();
  fs.writeFileSync(ACTIVITY_PATH, JSON.stringify(events, null, 2), "utf8");
}

export function appendActivity(
  input: Omit<ActivityEvent, "eventId" | "ts"> & { ts?: string }
): ActivityEvent {
  const event: ActivityEvent = {
    ...input,
    eventId: `evt_${randomUUID()}`,
    ts: input.ts ?? new Date().toISOString()
  };
  const existing = readRaw();
  const next = [event, ...existing].slice(0, MAX_EVENTS);
  writeRaw(next);
  return event;
}

export function listActivity(limit = 100): ActivityEvent[] {
  return readRaw().slice(0, limit);
}

export function emitInventoryAlert(input: {
  path: string;
  ageMinutes: number | null;
  error?: string | null;
  dedupeWindowMs?: number;
}): ActivityEvent | null {
  const detail = input.error
    ? `Inventory read failed at ${input.path} — ${input.error}`
    : `Inventory at ${input.path} is stale${input.ageMinutes === null ? "" : ` (${input.ageMinutes}m old)`}.`;
  const dedupeWindowMs = input.dedupeWindowMs ?? 15 * 60 * 1000;
  const now = Date.now();
  const existing = readRaw().find((event) => {
    if (event.kind !== "inventory_alert") {
      return false;
    }
    const ts = Date.parse(event.ts);
    if (!Number.isFinite(ts) || now - ts > dedupeWindowMs) {
      return false;
    }
    return event.detail === detail;
  });
  if (existing) {
    return null;
  }

  return appendActivity({
    kind: "inventory_alert",
    icon: "danger",
    title: "Inventory refresh alert",
    detail,
    riskLevel: "critical",
    suggestion: "Refresh inventory and inspect migrapilot-inventory-refresh.service if the alert persists."
  });
}

// Convenience emitters — named so callers are expressive
export function emitDriftSnapshot(input: {
  snapshotId: string;
  environment: string;
  severity: "info" | "warn" | "critical";
}): void {
  const icon: ActivityIcon =
    input.severity === "critical" ? "danger" : input.severity === "warn" ? "warn" : "ok";
  appendActivity({
    kind: "drift_snapshot",
    icon,
    title: `Drift snapshot captured — ${input.environment}`,
    detail: `${input.snapshotId} (${input.severity})`,
    riskLevel: input.severity
  });
}

export function emitDriftCorrelated(input: {
  snapshotId: string;
  summary: string;
  confidence?: number;
  missionId?: string;
}): void {
  appendActivity({
    kind: "drift_correlated",
    icon: "thinking",
    title: "Root cause correlated",
    detail: input.summary,
    missionId: input.missionId,
    confidence: input.confidence
  });
}

export function emitMissionProposed(input: {
  missionId: string;
  goal: string;
  confidence: number;
  riskLevel: "info" | "warn" | "critical";
}): void {
  const icon: ActivityIcon = input.riskLevel === "critical" ? "danger" : input.riskLevel === "warn" ? "warn" : "thinking";
  appendActivity({
    kind: "mission_proposed",
    icon,
    title: "Mission proposed — awaiting confirmation",
    detail: input.goal,
    missionId: input.missionId,
    confidence: input.confidence,
    riskLevel: input.riskLevel,
    suggestion: "Review proposal and execute or cancel."
  });
}

export function emitMissionStarted(input: {
  missionId: string;
  goal: string;
}): void {
  appendActivity({
    kind: "mission_started",
    icon: "info",
    title: "Mission started",
    detail: input.goal,
    missionId: input.missionId
  });
}

export function emitMissionCompleted(input: {
  missionId: string;
  goal: string;
}): void {
  appendActivity({
    kind: "mission_completed",
    icon: "ok",
    title: "Mission completed",
    detail: input.goal,
    missionId: input.missionId
  });
}

export function emitMissionFailed(input: {
  missionId: string;
  goal: string;
  error?: string;
}): void {
  appendActivity({
    kind: "mission_failed",
    icon: "danger",
    title: "Mission failed",
    detail: input.error ? `${input.goal} — ${input.error}` : input.goal,
    missionId: input.missionId
  });
}

export function emitFindingAdded(input: {
  findingId: string;
  title: string;
  severity: "info" | "warn" | "critical";
}): void {
  const icon: ActivityIcon = input.severity === "critical" ? "danger" : input.severity === "warn" ? "warn" : "info";
  appendActivity({
    kind: "finding_added",
    icon,
    title: `Finding: ${input.title}`,
    findingId: input.findingId,
    riskLevel: input.severity
  });
}

export function emitConfidenceChanged(input: {
  score: number;
  reason: string;
  prevScore?: number;
}): void {
  const icon: ActivityIcon = input.score < 0.4 ? "danger" : input.score < 0.7 ? "warn" : "ok";
  const delta = input.prevScore !== undefined ? input.score - input.prevScore : undefined;
  appendActivity({
    kind: "confidence_changed",
    icon,
    title: `Confidence ${(input.score * 100).toFixed(0)}%`,
    detail: input.reason,
    confidence: input.score,
    delta,
    suggestion: input.score < 0.55 ? "Consider reducing Tier 2 cap until confidence recovers." : undefined
  });
}

export function emitProposalConfirmed(input: {
  missionId: string;
  goal: string;
}): void {
  appendActivity({
    kind: "proposal_confirmed",
    icon: "ok",
    title: "Proposal confirmed — executing",
    detail: input.goal,
    missionId: input.missionId
  });
}

export function emitProposalCancelled(input: {
  missionId: string;
  goal: string;
}): void {
  appendActivity({
    kind: "proposal_cancelled",
    icon: "warn",
    title: "Proposal cancelled",
    detail: input.goal,
    missionId: input.missionId
  });
}

export function emitAutonomyAction(input: {
  actionType: string;
  targetSystem: string;
  status: "simulated" | "deferred" | "gated" | "executed" | "failed";
  detail: string;
  suggestedCommand?: string;
  riskLevel?: "info" | "warn" | "critical";
}): void {
  const icon: ActivityIcon =
    input.status === "executed" ? "ok" :
    input.status === "failed" ? "danger" :
    input.status === "gated" ? "warn" :
    input.status === "deferred" ? "info" :
    "thinking";
  appendActivity({
    kind: input.status === "failed" ? "autonomy_action_failed" : "autonomy_action",
    icon,
    title: `Autonomy action: ${input.actionType}`,
    detail: `${input.targetSystem} — ${input.detail}`,
    suggestion: input.suggestedCommand,
    riskLevel: input.riskLevel
  });
}

// Re-export kind type for consumers
export type { ActivityEventKind, ActivityIcon, ActivityEvent };
