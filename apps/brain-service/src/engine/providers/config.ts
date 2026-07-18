// Intelligent Provider Router — Slice 1: provider declarations from env.
//
// Declares the first-class providers: a LOCAL provider (on-device, enabled) and
// two CLOUD providers — OpenAI-compatible and Anthropic/Claude — both DISABLED by
// default. Declaration only: no client is wired and no credential VALUE is read
// (only presence, elsewhere, via the env var name). Changes no routing.
//
// © MigraTeck LLC.

import type { Provider } from './types.js';
import { ProviderRegistry, type EnvAccessor } from './providerRegistry.js';

function parseBoolean(v: string | undefined, fallback: boolean): boolean {
  if (v == null) return fallback;
  const n = v.trim().toLowerCase();
  if (n === 'true' || n === '1' || n === 'yes') return true;
  if (n === 'false' || n === '0' || n === 'no') return false;
  return fallback;
}

/** Declare the default provider fleet from the environment. Local is enabled;
 * cloud providers require an explicit `MIGRAPILOT_PROVIDER_<ID>_ENABLED=true`. */
export function declareProviders(env: NodeJS.ProcessEnv = process.env): Provider[] {
  const localProtocol = (env.MIGRAPILOT_LOCAL_PROVIDER ?? 'stub') === 'stub' ? 'stub' : 'openai-compat';
  const local: Provider = {
    id: 'local',
    displayName: 'Local (on-device)',
    kind: 'local',
    protocol: localProtocol,
    baseUrl: env.MIGRAPILOT_PROVIDER_URL ?? 'http://127.0.0.1:11434/v1',
    capabilities: { chat: true, vision: true, tools: true, embedding: true, reasoning: true, coding: true },
    priority: 100,
    cost: { inputPer1M: 0, outputPer1M: 0 },
    dataLocality: 'on-device',
    enabled: true,
  };
  const openai: Provider = {
    id: 'openai',
    displayName: 'OpenAI (cloud)',
    kind: 'cloud',
    protocol: 'openai-compat',
    baseUrl: env.MIGRAPILOT_CLOUD_OPENAI_URL ?? 'https://api.openai.com/v1',
    credentialEnv: 'OPENAI_API_KEY',
    capabilities: { chat: true, vision: true, tools: true, embedding: true, reasoning: true, coding: true },
    priority: 50,
    cost: { inputPer1M: 2.5, outputPer1M: 10 },
    dataLocality: 'external',
    enabled: parseBoolean(env.MIGRAPILOT_PROVIDER_OPENAI_ENABLED, false),
  };
  const anthropic: Provider = {
    id: 'anthropic',
    displayName: 'Claude (cloud)',
    kind: 'cloud',
    protocol: 'anthropic',
    baseUrl: env.MIGRAPILOT_CLOUD_ANTHROPIC_URL ?? 'https://api.anthropic.com',
    credentialEnv: 'ANTHROPIC_API_KEY',
    capabilities: { chat: true, vision: true, tools: true, embedding: false, reasoning: true, coding: true },
    priority: 60,
    cost: { inputPer1M: 3, outputPer1M: 15 },
    dataLocality: 'external',
    enabled: parseBoolean(env.MIGRAPILOT_PROVIDER_ANTHROPIC_ENABLED, false),
  };
  return [local, openai, anthropic];
}

export function buildProviderRegistry(env: NodeJS.ProcessEnv = process.env): ProviderRegistry {
  const accessor: EnvAccessor = (n) => env[n];
  return new ProviderRegistry(declareProviders(env), accessor);
}
