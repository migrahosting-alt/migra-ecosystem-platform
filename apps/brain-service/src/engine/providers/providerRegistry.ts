// Intelligent Provider Router — Slice 1: the first-class provider registry.
//
// NOTE: distinct from the LEGACY profile registry at src/providers/providerRegistry.ts
// (cheap/default/premium profiles). This registry holds first-class Provider
// entities (local + cloud) for the canonical capability-routed stack and changes
// NO live routing in Slice 1. Server-authoritative; credentials referenced by env
// var name only.
//
// © MigraTeck LLC.

import type { Provider, ProviderHealth, ProviderSummary } from './types.js';

export type EnvAccessor = (name: string) => string | undefined;

export class ProviderRegistry {
  private readonly byId = new Map<string, Provider>();

  constructor(
    providers: Provider[] = [],
    private readonly env: EnvAccessor = (n) => process.env[n],
  ) {
    for (const p of providers) this.byId.set(p.id, p);
  }

  list(): Provider[] {
    return [...this.byId.values()].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  }

  get(id: string): Provider | undefined {
    return this.byId.get(id);
  }

  /** Enabled providers only (disabled providers are never candidates). */
  enabled(): Provider[] {
    return this.list().filter((p) => p.enabled);
  }

  /** Whether the provider's referenced credential env var is PRESENT. Returns the
   * boolean only — the value is never read out, logged, or returned. Local
   * providers (no credentialEnv) are always considered credentialed. */
  hasCredential(provider: Provider): boolean {
    if (!provider.credentialEnv) return true;
    const v = this.env(provider.credentialEnv);
    return typeof v === 'string' && v.trim().length > 0;
  }

  size(): number {
    return this.byId.size;
  }

  /** Build operator-safe summaries. NO credential value ever appears — only the
   * env var name + a presence boolean. Health is supplied by the caller (fleet). */
  summaries(healthById: Map<string, ProviderHealth>): ProviderSummary[] {
    return this.list().map((p) => ({
      id: p.id,
      displayName: p.displayName,
      kind: p.kind,
      protocol: p.protocol,
      capabilities: p.capabilities,
      priority: p.priority,
      cost: p.cost,
      dataLocality: p.dataLocality,
      enabled: p.enabled,
      credentialEnv: p.credentialEnv,
      defaultModel: p.defaultModel,
      hasCredential: this.hasCredential(p),
      health: healthById.get(p.id) ?? { status: p.enabled ? 'unknown' : 'disabled', reachable: false, lastCheckedAt: null },
    }));
  }
}
