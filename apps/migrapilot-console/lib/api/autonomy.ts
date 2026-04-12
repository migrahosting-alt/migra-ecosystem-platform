import "server-only";
import { apiGet, apiPost } from "./client";

export type EnvState = "NORMAL" | "CAUTION" | "READ_ONLY";

export interface AutonomyStateEntry {
  state: EnvState;
  reason: string | null;
}

export interface AutonomyStatus {
  enabled: boolean;
  confidence: { score: number; lastUpdated: string; recentFailures: number; recentSuccesses: number };
  budgetsUsage: {
    missionsPerHour: { used: number; limit: number };
    tier2PerDay: { used: number; limit: number };
    failuresPerHour: { used: number; limit: number };
  };
  queueCounts: { queued: number; running: number; awaiting_approval: number; done: number; failed: number; skipped: number };
  lastRunTs?: string;
}

export async function getAutonomyConfig() {
  return apiGet<{ config: unknown; status: AutonomyStatus }>("/api/autonomy/config");
}

export async function getEnvStates() {
  return apiGet<{ states: Record<string, AutonomyStateEntry> }>("/api/autonomy/states");
}

export async function getMissions(env: string) {
  return apiGet<{ missions: unknown[] }>(`/api/autonomy/missions?env=${env}`);
}

export async function runTick(env?: string) {
  const q = env ? `?env=${env}` : "";
  return apiPost<{ results: Array<{ env: string; state: string; missionsRan: number }> }>(
    `/api/autonomy/tick${q}`
  );
}

export async function setEnvState(env: string, state: EnvState, reason?: string) {
  return apiPost<{ status: string }>("/api/autonomy/set-state", { env, state, reason });
}

export async function unlockEnv(env: string) {
  return apiPost<{ queued?: boolean; message?: string }>("/api/autonomy/unlock", {
    env,
    reason: "Manual operator unlock",
  });
}

export async function runMission(missionId: string, env: string) {
  return apiPost<{ status: string; proofs: string[] }>("/api/autonomy/run-mission", {
    missionId,
    env,
  });
}

export async function enableAutonomy() {
  return apiPost<AutonomyStatus>("/api/autonomy/enable");
}

export async function disableAutonomy() {
  return apiPost<AutonomyStatus>("/api/autonomy/disable");
}
