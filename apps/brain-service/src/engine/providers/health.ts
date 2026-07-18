// Intelligent Provider Router — Slice 1: provider health model.
//
// Health is TRUTHFUL and never fabricated. A disabled provider is `disabled`
// (never probed). A provider with a missing required credential is `unknown`
// with a safe detail (never probed with a fake key). A probe failure is
// `unreachable`. Only a successful probe yields `healthy`/`degraded`. The probe
// is READ-ONLY (a discovery/list call) and injectable for tests.
//
// © MigraTeck LLC.

import type { Provider, ProviderHealth } from './types.js';

export interface ProbeOutcome {
  reachable: boolean;
  latencyMs?: number;
  modelCount?: number;
  /** Safe, secret-free detail. */
  detail?: string;
}

/** Read-only reachability probe for a provider. Implementations must never send a
 * completion or mutate anything — a discovery/list call only. */
export type ProviderProbe = (provider: Provider) => Promise<ProbeOutcome>;

/** Default read-only reachability probe: a discovery/list GET only. It sends NO
 * credential (any HTTP response — even 401 — proves the endpoint is reachable),
 * so it never handles a secret. Stub providers are reachable by definition. */
export function makeReachabilityProbe(fetchImpl: typeof fetch = fetch, timeoutMs = 3000): ProviderProbe {
  return async (provider: Provider): Promise<ProbeOutcome> => {
    if (provider.protocol === 'stub') return { reachable: true, modelCount: 1 };
    if (!provider.baseUrl) return { reachable: false, detail: 'no base url' };
    const url = provider.baseUrl.replace(/\/$/, '') + '/models';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const res = await fetchImpl(url, { method: 'GET', signal: controller.signal });
      const latencyMs = Date.now() - started;
      let modelCount: number | undefined;
      if (res.ok) {
        const body = (await res.json().catch(() => undefined)) as { data?: unknown[]; models?: unknown[] } | undefined;
        const arr = body?.data ?? body?.models;
        modelCount = Array.isArray(arr) ? arr.length : undefined;
      }
      // Any HTTP response = endpoint reachable (unauthenticated list may be 401).
      return { reachable: true, latencyMs, modelCount, detail: res.ok ? undefined : 'reachable (authenticated list not attempted)' };
    } catch (err) {
      return { reachable: false, latencyMs: Date.now() - started, detail: err instanceof Error ? err.name : 'unreachable' };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Derive health from a provider + optional probe outcome, without ever guessing
 * "healthy". `hasCredential` reflects env presence (never the value). */
export function deriveHealth(
  provider: Provider,
  hasCredential: boolean,
  outcome: ProbeOutcome | null,
  now: number,
): ProviderHealth {
  if (!provider.enabled) {
    return { status: 'disabled', reachable: false, lastCheckedAt: null, detail: 'provider disabled' };
  }
  if (provider.credentialEnv && !hasCredential) {
    // A cloud provider whose credential env var is absent is never probed.
    return { status: 'unknown', reachable: false, lastCheckedAt: null, detail: 'credential absent' };
  }
  if (!outcome) {
    return { status: 'unknown', reachable: false, lastCheckedAt: null, detail: 'not yet probed' };
  }
  if (!outcome.reachable) {
    return { status: 'unreachable', reachable: false, lastCheckedAt: now, latencyMs: outcome.latencyMs, detail: outcome.detail ?? 'probe failed' };
  }
  // Reachable but advertising zero models = degraded (up, but nothing to serve).
  const status = (outcome.modelCount ?? 0) > 0 ? 'healthy' : 'degraded';
  return {
    status,
    reachable: true,
    lastCheckedAt: now,
    latencyMs: outcome.latencyMs,
    modelCount: outcome.modelCount,
    detail: status === 'degraded' ? 'reachable but no models advertised' : undefined,
  };
}
