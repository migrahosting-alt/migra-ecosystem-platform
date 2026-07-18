// Operational Readiness Slice 5 — provider configuration + target loading.
//
// Disabled by default. Enablement, the environment allowlist, the operator
// allowlist, and the target registry are all read from explicit configuration —
// local coding-agent availability never enables production diagnostics.
//
// © MigraTeck LLC.

import { readFileSync } from 'node:fs';
import { ProductionDiagnosticsProvider, type ProviderConfig } from './provider.js';
import type { Environment, ProductionTarget } from './targetRegistry.js';
import { ProductionTargetRegistry } from './targetRegistry.js';
import { defaultCapabilities } from './capabilities.js';
import { NetworkProber } from './networkProber.js';

function parseBoolean(v: string | undefined, fallback: boolean): boolean {
  if (v == null) return fallback;
  const n = v.trim().toLowerCase();
  if (n === 'true' || n === '1' || n === 'yes') return true;
  if (n === 'false' || n === '0' || n === 'no') return false;
  return fallback;
}

function parseList(v: string | undefined): string[] {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

function parseEnvironments(v: string | undefined): Environment[] {
  return parseList(v).filter((e): e is Environment => e === 'production' || e === 'staging');
}

/** Build the provider config from the environment. FAIL CLOSED: `enabled` defaults
 * to false, so an unset environment yields a disabled provider. */
export function readProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  return {
    enabled: parseBoolean(env.MIGRAPILOT_PROD_DIAGNOSTICS_ENABLED, false),
    approvedEnvironments: parseEnvironments(env.MIGRAPILOT_PROD_DIAGNOSTICS_ENVIRONMENTS),
    operators: new Set(parseList(env.MIGRAPILOT_PROD_DIAGNOSTICS_OPERATORS)),
    maxTimeoutMs: Number(env.MIGRAPILOT_PROD_DIAGNOSTICS_MAX_TIMEOUT_MS ?? 10_000) || 10_000,
  };
}

/** Load the server-authoritative target registry from an optional JSON file.
 * When unset or unreadable, the registry is EMPTY — every target then fails closed
 * as TARGET_NOT_ALLOWED. The file is trusted operator configuration, never a
 * client input. */
export function loadTargetRegistry(env: NodeJS.ProcessEnv = process.env): ProductionTargetRegistry {
  const file = env.MIGRAPILOT_PROD_DIAGNOSTICS_TARGETS_FILE;
  if (!file) return new ProductionTargetRegistry([]);
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    const arr = Array.isArray(raw) ? raw : Array.isArray((raw as { targets?: unknown }).targets) ? (raw as { targets: unknown[] }).targets : [];
    const targets = arr.filter(isTargetShape);
    return new ProductionTargetRegistry(targets);
  } catch {
    // Unreadable/malformed config → empty (fail closed), never throw at startup.
    return new ProductionTargetRegistry([]);
  }
}

/** Operator bearer-token → principal map. This token space is DISTINCT from the
 * workspace ToolApprovalStore — a workspace approval token can never authorize a
 * production diagnostic. Format: `principal=token,principal2=token2`. */
export function readOperatorTokens(env: NodeJS.ProcessEnv = process.env): Map<string, string> {
  const map = new Map<string, string>(); // token → principal
  for (const pair of parseList(env.MIGRAPILOT_PROD_DIAGNOSTICS_OPERATOR_TOKENS)) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const principal = pair.slice(0, eq).trim();
    const token = pair.slice(eq + 1).trim();
    if (principal && token) map.set(token, principal);
  }
  return map;
}

/** Assemble the process-wide provider from the environment. Uses the real
 * read-only NetworkProber (DNS/TLS/HTTP); infra checks report unknown until a
 * credentialed read-only backend is wired. Disabled by default. */
export function buildProductionDiagnosticsProvider(
  env: NodeJS.ProcessEnv = process.env,
): { provider: ProductionDiagnosticsProvider; operatorTokens: Map<string, string> } {
  const provider = new ProductionDiagnosticsProvider(
    readProviderConfig(env),
    loadTargetRegistry(env),
    defaultCapabilities(),
    new NetworkProber(),
  );
  return { provider, operatorTokens: readOperatorTokens(env) };
}

function isTargetShape(v: unknown): v is ProductionTarget {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.targetId === 'string' &&
    typeof t.tenantId === 'string' &&
    (t.environment === 'production' || t.environment === 'staging') &&
    typeof t.serviceType === 'string' &&
    Array.isArray(t.approvedEndpoints) &&
    Array.isArray(t.approvedCapabilities) &&
    typeof t.timeoutMs === 'number' &&
    typeof t.rateLimitPerMinute === 'number' &&
    typeof t.enabled === 'boolean'
  );
}
