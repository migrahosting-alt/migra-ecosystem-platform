import fs from "node:fs";
import path from "node:path";

import { readAutonomyState } from "./store";

export type RuntimeEnvName = "dev" | "staging" | "prod";
export type RuntimeEnvState = "NORMAL" | "CAUTION" | "READ_ONLY";

export interface RuntimeEnvStateEntry {
  state: RuntimeEnvState;
  reason: string | null;
  updatedAt?: string;
}

type RuntimeEnvStateMap = Record<RuntimeEnvName, RuntimeEnvStateEntry>;

const ENV_STATE_PATH = path.resolve(process.cwd(), ".data", "autonomy-env-states.json");
const ENV_NAMES: RuntimeEnvName[] = ["dev", "staging", "prod"];

function defaultEntryForEnv(env: RuntimeEnvName): RuntimeEnvStateEntry {
  const autonomy = readAutonomyState();
  if (env === "prod" && !autonomy.config.environmentPolicy.prodAllowed) {
    return {
      state: "READ_ONLY",
      reason: "Production writes disabled by policy"
    };
  }

  return {
    state: "NORMAL",
    reason: null
  };
}

function defaultStateMap(): RuntimeEnvStateMap {
  return {
    dev: defaultEntryForEnv("dev"),
    staging: defaultEntryForEnv("staging"),
    prod: defaultEntryForEnv("prod")
  };
}

function ensureStateFile(): void {
  fs.mkdirSync(path.dirname(ENV_STATE_PATH), { recursive: true });
  if (!fs.existsSync(ENV_STATE_PATH)) {
    fs.writeFileSync(ENV_STATE_PATH, JSON.stringify(defaultStateMap(), null, 2), "utf8");
  }
}

function isRuntimeEnvState(value: unknown): value is RuntimeEnvState {
  return value === "NORMAL" || value === "CAUTION" || value === "READ_ONLY";
}

function normalizeEntry(env: RuntimeEnvName, value: unknown): RuntimeEnvStateEntry {
  const fallback = defaultEntryForEnv(env);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  const root = value as Record<string, unknown>;
  return {
    state: isRuntimeEnvState(root.state) ? root.state : fallback.state,
    reason: typeof root.reason === "string" ? root.reason : fallback.reason,
    updatedAt: typeof root.updatedAt === "string" ? root.updatedAt : undefined
  };
}

function readStoredStateMap(): RuntimeEnvStateMap {
  ensureStateFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(ENV_STATE_PATH, "utf8")) as Record<string, unknown>;
    return {
      dev: normalizeEntry("dev", parsed.dev),
      staging: normalizeEntry("staging", parsed.staging),
      prod: normalizeEntry("prod", parsed.prod)
    };
  } catch {
    return defaultStateMap();
  }
}

function writeStateMap(stateMap: RuntimeEnvStateMap): void {
  ensureStateFile();
  fs.writeFileSync(ENV_STATE_PATH, JSON.stringify(stateMap, null, 2), "utf8");
}

export function getRuntimeEnvStates(): RuntimeEnvStateMap {
  const autonomy = readAutonomyState();
  const stored = readStoredStateMap();
  const defaults = defaultStateMap();

  if (!autonomy.config.environmentPolicy.prodAllowed && stored.prod.state === "NORMAL" && !stored.prod.updatedAt) {
    stored.prod = defaults.prod;
  }

  return stored;
}

export function setRuntimeEnvState(
  env: RuntimeEnvName,
  state: RuntimeEnvState,
  reason?: string | null
): RuntimeEnvStateMap {
  const current = readStoredStateMap();
  current[env] = {
    state,
    reason: typeof reason === "string" && reason.trim() ? reason.trim() : null,
    updatedAt: new Date().toISOString()
  };
  writeStateMap(current);
  return current;
}

export function unlockRuntimeEnv(env: RuntimeEnvName, reason?: string | null): RuntimeEnvStateMap {
  return setRuntimeEnvState(env, "NORMAL", reason ?? "Manual operator unlock");
}
