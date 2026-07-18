// Intelligent Provider Router — Slice 1: Provider Registry + Policy model.
//
// A first-class PROVIDER entity (local or cloud) layered over the existing
// discovery `ProviderSource` in modelRegistry.ts. This slice establishes the
// truthful registry, health, and policy MODEL only — it changes NO live routing.
// Providers are declared server-side; credentials are referenced by ENV VAR NAME
// and never carried as values.
//
// © MigraTeck LLC.

export type ProviderKind = 'local' | 'cloud';

/** How the engine would talk to this provider (declaration only in Slice 1; no
 * client is wired here). */
export type ProviderProtocol = 'ollama' | 'openai-compat' | 'anthropic' | 'stub';

/** Where a provider's data physically goes — drives the privacy-first policy. */
export type DataLocality = 'on-device' | 'external';

/** Declared provider capabilities (reconciled against real model capabilities by
 * the fleet in Slice 1, used by the policy engine). */
export interface ProviderCapabilities {
  chat: boolean;
  vision: boolean;
  tools: boolean;
  embedding: boolean;
  reasoning: boolean;
  coding: boolean;
}

/** Relative cost hints (USD per 1M tokens). Local providers are 0. Used by the
 * lowest-cost policy for ranking only — never billed here. */
export interface ProviderCost {
  inputPer1M?: number;
  outputPer1M?: number;
}

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'unreachable' | 'unknown' | 'disabled';

/** Truthful, inspectable provider health. Never fabricated: an unprobed provider
 * is `unknown`, a disabled one is `disabled`, a failed probe is `unreachable`. */
export interface ProviderHealth {
  status: ProviderHealthStatus;
  reachable: boolean;
  lastCheckedAt: number | null;
  latencyMs?: number;
  modelCount?: number;
  /** Safe, secret-free detail (e.g. "credential absent", "probe timed out"). */
  detail?: string;
}

/** A declared, first-class provider. Server-authoritative; clients never submit
 * one. `credentialEnv` is the ENV VAR NAME that supplies the key — the value is
 * never stored, logged, or serialized. */
export interface Provider {
  id: string;
  displayName: string;
  kind: ProviderKind;
  protocol: ProviderProtocol;
  /** Discovery/base endpoint (OpenAI-compatible …/v1 or provider-native). */
  baseUrl?: string;
  /** ENV VAR NAME supplying the credential (never the value). Absent for local. */
  credentialEnv?: string;
  capabilities: ProviderCapabilities;
  /** Preference weight within a tie (higher = preferred). Policies may override. */
  priority: number;
  cost?: ProviderCost;
  dataLocality: DataLocality;
  /** Cloud providers ship DISABLED by default; a disabled provider is never a
   * candidate and is never probed. */
  enabled: boolean;
}

/** Operator-safe provider view — NO credential value (only the env var name +
 * whether it is present) and no other secret. Safe to serialize. */
export interface ProviderSummary {
  id: string;
  displayName: string;
  kind: ProviderKind;
  protocol: ProviderProtocol;
  capabilities: ProviderCapabilities;
  priority: number;
  cost?: ProviderCost;
  dataLocality: DataLocality;
  enabled: boolean;
  credentialEnv?: string;
  /** True when the referenced env var is present — never the value itself. */
  hasCredential: boolean;
  health: ProviderHealth;
}
