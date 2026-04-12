import fs from "node:fs";
import path from "node:path";

import { DEFAULT_AUTONOMY_CONFIG, normalizeAutonomyConfig, normalizeConfidenceState, normalizeFinding, normalizeQueueItem } from "./schemas";
import type { AutonomyConfig, AutonomyState, Finding, AutonomyMissionQueueItem } from "./types";

interface RawAutonomyState {
  config?: unknown;
  findings?: unknown;
  queue?: unknown;
  confidence?: unknown;
  usage?: unknown;
  dedupe?: unknown;
  lastRunTs?: unknown;
}

const statePath = path.resolve(process.cwd(), ".data", "autonomy.json");

function defaultState(): AutonomyState {
  const now = new Date().toISOString();
  return {
    config: DEFAULT_AUTONOMY_CONFIG,
    findings: [],
    queue: [],
    confidence: {
      score: 1,
      lastUpdated: now,
      recentFailures: 0,
      recentSuccesses: 0
    },
    usage: {
      missionStarts: [],
      tier2Runs: [],
      failures: []
    },
    dedupe: [],
    lastRunTs: undefined
  };
}

function ensureStateFile(): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  if (!fs.existsSync(statePath)) {
    fs.writeFileSync(statePath, JSON.stringify(defaultState(), null, 2), "utf8");
  }
}

function normalizeUsage(value: unknown): AutonomyState["usage"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { missionStarts: [], tier2Runs: [], failures: [] };
  }
  const source = value as Record<string, unknown>;
  return {
    missionStarts: Array.isArray(source.missionStarts)
      ? source.missionStarts.filter((entry): entry is string => typeof entry === "string")
      : [],
    tier2Runs: Array.isArray(source.tier2Runs)
      ? source.tier2Runs.filter((entry): entry is string => typeof entry === "string")
      : [],
    failures: Array.isArray(source.failures)
      ? source.failures.filter((entry): entry is string => typeof entry === "string")
      : []
  };
}

function normalizeDedupe(value: unknown): AutonomyState["dedupe"] {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: AutonomyState["dedupe"] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const row = item as Record<string, unknown>;
    if (typeof row.hash === "string" && typeof row.ts === "string") {
      rows.push({ hash: row.hash, ts: row.ts });
    }
  }
  return rows;
}

function normalizeState(raw: RawAutonomyState): AutonomyState {
  return {
    config: normalizeAutonomyConfig(raw.config),
    findings: Array.isArray(raw.findings)
      ? raw.findings.map((item) => normalizeFinding(item)).filter((item): item is Finding => Boolean(item))
      : [],
    queue: Array.isArray(raw.queue)
      ? raw.queue.map((item) => normalizeQueueItem(item)).filter((item): item is AutonomyMissionQueueItem => Boolean(item))
      : [],
    confidence: normalizeConfidenceState(raw.confidence),
    usage: normalizeUsage(raw.usage),
    dedupe: normalizeDedupe(raw.dedupe),
    lastRunTs: typeof raw.lastRunTs === "string" ? raw.lastRunTs : undefined
  };
}

export function readAutonomyState(): AutonomyState {
  ensureStateFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as RawAutonomyState;
    return normalizeState(parsed);
  } catch {
    return defaultState();
  }
}

export function writeAutonomyState(state: AutonomyState): void {
  ensureStateFile();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

export function updateAutonomyState(updater: (state: AutonomyState) => AutonomyState): AutonomyState {
  const current = readAutonomyState();
  const updated = updater(current);
  writeAutonomyState(updated);
  return updated;
}

export function mergeAutonomyConfig(partial: Partial<AutonomyConfig>): AutonomyState {
  return updateAutonomyState((state) => {
    const merged = {
      ...state.config,
      ...partial,
      runnerPolicy: {
        ...state.config.runnerPolicy,
        ...(partial.runnerPolicy ?? {})
      },
      environmentPolicy: {
        ...state.config.environmentPolicy,
        ...(partial.environmentPolicy ?? {})
      },
      budgets: {
        ...state.config.budgets,
        ...(partial.budgets ?? {})
      },
      confidenceGate: {
        ...state.config.confidenceGate,
        ...(partial.confidenceGate ?? {})
      }
    };
    return {
      ...state,
      config: normalizeAutonomyConfig(merged)
    };
  });
}

export function trimAutonomyState(state: AutonomyState): AutonomyState {
  return {
    ...state,
    findings: state.findings.slice(0, 500),
    queue: state.queue.slice(0, 500),
    usage: {
      missionStarts: state.usage.missionStarts.slice(-1000),
      tier2Runs: state.usage.tier2Runs.slice(-5000),
      failures: state.usage.failures.slice(-1000)
    },
    dedupe: state.dedupe.slice(-2000)
  };
}

export function getAutonomyStatePath(): string {
  return statePath;
}
