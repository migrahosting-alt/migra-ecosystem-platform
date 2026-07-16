import { config as loadDotEnv } from 'dotenv';

export interface BrainEnv {
  host: string;
  port: number;
  mode: 'hybrid' | 'offline' | 'cloud';
  enableTelemetry: boolean;
  /** Provider kind for real completions: 'stub' (default, deterministic) or
   * 'openai-compat' (a real /chat/completions endpoint). Any other value is
   * treated as 'stub' so the safe default is never bypassed by a typo. */
  localProvider: string;
  /** Base URL for the openai-compat provider (must expose POST /chat/completions). */
  providerBaseUrl: string;
  localModel?: string;
  cheapModel?: string;
  defaultModel?: string;
  premiumModel?: string;
  /** Vision-capable model used automatically for turns that carry image
   * attachments on the generic provider path. Defaults to the qualified vision
   * default (`qwen2.5vl:7b`, Apache-2.0). The engine chat path does NOT use this —
   * it routes vision through the Capability Router + Vision Registry. */
  visionModel?: string;
  openAiApiKey?: string;
  /** Pilot Runtime Adapter (agent runs delegated to pilot-api). Delegation is
   * OFF unless `pilotRuntimeEnabled` is true AND a URL is configured; otherwise a
   * `runtime: 'pilot'` agent FAILS closed (never a local mutating fallback). */
  pilotRuntimeEnabled?: boolean;
  pilotApiUrl?: string;
  pilotApiToken?: string;
  pilotApiAuthMode?: 'bearer' | 'none';
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): BrainEnv {
  if (env === process.env) {
    loadDotEnv();
  }

  return {
    host: env.MIGRAPILOT_BRAIN_HOST ?? '127.0.0.1',
    port: parseInteger(env.MIGRAPILOT_BRAIN_PORT, 3988),
    mode: parseMode(env.MIGRAPILOT_MODE),
    enableTelemetry: parseBoolean(env.MIGRAPILOT_ENABLE_TELEMETRY, true),
    localProvider: env.MIGRAPILOT_LOCAL_PROVIDER ?? 'stub',
    providerBaseUrl: env.MIGRAPILOT_PROVIDER_URL ?? 'http://127.0.0.1:11434/v1',
    localModel: env.MIGRAPILOT_LOCAL_MODEL,
    cheapModel: env.MIGRAPILOT_CHEAP_MODEL,
    defaultModel: env.MIGRAPILOT_DEFAULT_MODEL,
    premiumModel: env.MIGRAPILOT_PREMIUM_MODEL,
    visionModel: env.MIGRAPILOT_VISION_MODEL ?? 'qwen2.5vl:7b',
    openAiApiKey: env.OPENAI_API_KEY,
    // Fail-closed by default: delegation requires an explicit opt-in AND a URL.
    pilotRuntimeEnabled: parseBoolean(env.MIGRAPILOT_PILOT_RUNTIME_ENABLED, false),
    pilotApiUrl: env.MIGRAPILOT_PILOT_API_URL,
    pilotApiToken: env.MIGRAPILOT_PILOT_API_TOKEN,
    pilotApiAuthMode: env.MIGRAPILOT_PILOT_API_AUTH_MODE === 'none' ? 'none' : 'bearer',
  };
}

function parseInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return fallback;
}

function parseMode(value: string | undefined): BrainEnv['mode'] {
  if (value === 'offline' || value === 'cloud' || value === 'hybrid') {
    return value;
  }
  return 'hybrid';
}