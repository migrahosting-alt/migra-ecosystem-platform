import fs from "node:fs";
import path from "node:path";

import { listActivity } from "../activity/store";
import type { ActivityEvent } from "../activity/types";

export type IncidentSeverity = "INFO" | "WARN" | "ERROR" | "CRITICAL";
export type IncidentStatus = "OPEN" | "ACK" | "RESOLVED";
export type IncidentEnv = "dev" | "staging" | "prod";

export interface IncidentRecord {
  id: string;
  env: IncidentEnv;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  dedupeKey: string | null;
  runId: string | null;
  missionId: string | null;
  createdAt: string;
  ackedAt: string | null;
  resolvedAt: string | null;
  evidence: Record<string, unknown>;
}

interface IncidentStoreState {
  incidents: IncidentRecord[];
}

const INCIDENTS_PATH = path.resolve(process.cwd(), ".data", "incidents.json");
const MAX_INCIDENTS = 500;

function ensureStoreFile(): void {
  fs.mkdirSync(path.dirname(INCIDENTS_PATH), { recursive: true });
  if (!fs.existsSync(INCIDENTS_PATH)) {
    fs.writeFileSync(INCIDENTS_PATH, JSON.stringify({ incidents: [] }, null, 2), "utf8");
  }
}

function isIncidentSeverity(value: unknown): value is IncidentSeverity {
  return value === "INFO" || value === "WARN" || value === "ERROR" || value === "CRITICAL";
}

function isIncidentStatus(value: unknown): value is IncidentStatus {
  return value === "OPEN" || value === "ACK" || value === "RESOLVED";
}

function isIncidentEnv(value: unknown): value is IncidentEnv {
  return value === "dev" || value === "staging" || value === "prod";
}

function normalizeIncident(input: unknown): IncidentRecord | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const root = input as Record<string, unknown>;
  if (typeof root.id !== "string" || !root.id.trim()) {
    return null;
  }

  return {
    id: root.id,
    env: isIncidentEnv(root.env) ? root.env : "prod",
    severity: isIncidentSeverity(root.severity) ? root.severity : "WARN",
    status: isIncidentStatus(root.status) ? root.status : "OPEN",
    title: typeof root.title === "string" && root.title.trim() ? root.title : "Operational incident",
    dedupeKey: typeof root.dedupeKey === "string" ? root.dedupeKey : null,
    runId: typeof root.runId === "string" ? root.runId : null,
    missionId: typeof root.missionId === "string" ? root.missionId : null,
    createdAt: typeof root.createdAt === "string" ? root.createdAt : new Date().toISOString(),
    ackedAt: typeof root.ackedAt === "string" ? root.ackedAt : null,
    resolvedAt: typeof root.resolvedAt === "string" ? root.resolvedAt : null,
    evidence: root.evidence && typeof root.evidence === "object" && !Array.isArray(root.evidence)
      ? root.evidence as Record<string, unknown>
      : {}
  };
}

function readStore(): IncidentStoreState {
  ensureStoreFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(INCIDENTS_PATH, "utf8")) as { incidents?: unknown };
    return {
      incidents: Array.isArray(parsed.incidents)
        ? parsed.incidents.map(normalizeIncident).filter((incident): incident is IncidentRecord => Boolean(incident))
        : []
    };
  } catch {
    return { incidents: [] };
  }
}

function writeStore(state: IncidentStoreState): void {
  ensureStoreFile();
  fs.writeFileSync(INCIDENTS_PATH, JSON.stringify(state, null, 2), "utf8");
}

function inferEnv(event: ActivityEvent): IncidentEnv {
  const haystack = `${event.title} ${event.detail ?? ""}`.toLowerCase();
  if (haystack.includes("staging")) return "staging";
  if (haystack.includes("dev")) return "dev";
  return "prod";
}

function severityFromActivity(event: ActivityEvent): IncidentSeverity | null {
  if (event.kind === "inventory_alert") return "CRITICAL";
  if (event.kind === "mission_failed") return event.riskLevel === "critical" ? "CRITICAL" : "ERROR";
  if (event.kind === "autonomy_action_failed") return event.riskLevel === "critical" ? "CRITICAL" : "ERROR";
  return null;
}

function incidentFromActivity(event: ActivityEvent): IncidentRecord | null {
  const severity = severityFromActivity(event);
  if (!severity) {
    return null;
  }

  return {
    id: `activity_${event.eventId}`,
    env: inferEnv(event),
    severity,
    status: "OPEN",
    title: event.title,
    dedupeKey: `${event.kind}:${event.missionId ?? event.findingId ?? event.title}`,
    runId: null,
    missionId: event.missionId ?? null,
    createdAt: event.ts,
    ackedAt: null,
    resolvedAt: null,
    evidence: {
      activityEventId: event.eventId,
      kind: event.kind,
      detail: event.detail ?? null,
      suggestion: event.suggestion ?? null,
      confidence: event.confidence ?? null,
      findingId: event.findingId ?? null,
      riskLevel: event.riskLevel ?? null
    }
  };
}

function syncIncidentsWithActivity(): IncidentStoreState {
  const current = readStore();
  const byId = new Map(current.incidents.map((incident) => [incident.id, incident]));

  for (const event of listActivity(250)) {
    const derived = incidentFromActivity(event);
    if (!derived) {
      continue;
    }

    const existing = byId.get(derived.id);
    byId.set(derived.id, {
      ...(existing ?? derived),
      ...derived,
      status: existing?.status ?? derived.status,
      ackedAt: existing?.ackedAt ?? derived.ackedAt,
      resolvedAt: existing?.resolvedAt ?? derived.resolvedAt
    });
  }

  const incidents = Array.from(byId.values())
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, MAX_INCIDENTS);

  const next = { incidents };
  writeStore(next);
  return next;
}

export function listIncidents(options?: {
  env?: string | null;
  status?: string | null;
  limit?: number;
}): IncidentRecord[] {
  const synced = syncIncidentsWithActivity();
  const env = options?.env && isIncidentEnv(options.env) ? options.env : null;
  const status = options?.status && isIncidentStatus(options.status) ? options.status : null;
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 200);

  return synced.incidents
    .filter((incident) => (env ? incident.env === env : true))
    .filter((incident) => (status ? incident.status === status : true))
    .slice(0, limit);
}

function updateIncident(
  id: string,
  updater: (incident: IncidentRecord) => IncidentRecord
): IncidentRecord | null {
  const synced = syncIncidentsWithActivity();
  const index = synced.incidents.findIndex((incident) => incident.id === id);
  if (index === -1) {
    return null;
  }

  synced.incidents[index] = updater(synced.incidents[index]);
  writeStore(synced);
  return synced.incidents[index];
}

export function acknowledgeIncident(id: string): IncidentRecord | null {
  return updateIncident(id, (incident) => {
    if (incident.status === "RESOLVED") {
      return incident;
    }

    return {
      ...incident,
      status: "ACK",
      ackedAt: incident.ackedAt ?? new Date().toISOString()
    };
  });
}

export function resolveIncident(id: string): IncidentRecord | null {
  return updateIncident(id, (incident) => ({
    ...incident,
    status: "RESOLVED",
    ackedAt: incident.ackedAt ?? new Date().toISOString(),
    resolvedAt: new Date().toISOString()
  }));
}
