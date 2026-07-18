// Intelligent Provider Router — Slice 4: budget + pricing configuration from env.
//
// Fail-closed by default: budget enforcement is OFF unless explicitly enabled, and
// with no configured scope a paid cloud call is denied (BUDGET_NOT_CONFIGURED).
// Pricing is CONFIGURED from the owner-set provider cost declarations (never
// scraped). No secrets are read here.
//
// © MigraTeck LLC.

import type { Provider } from '../types.js';
import { PricingBook, type PricingRecord } from './pricing.js';
import { BudgetManager, type BudgetScope } from './budgetManager.js';
import { UsageLedger } from './usageLedger.js';

const DAY_MS = 86_400_000;

function num(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function bool(v: string | undefined, fallback: boolean): boolean {
  if (v == null) return fallback;
  const n = v.trim().toLowerCase();
  return n === 'true' || n === '1' || n === 'yes' ? true : n === 'false' || n === '0' || n === 'no' ? false : fallback;
}

/** Pricing derived from owner-set provider cost declarations (status `configured`),
 * one wildcard record per provider that declares a cost. */
export function buildPricingBook(providers: Provider[]): PricingBook {
  const records: PricingRecord[] = [];
  for (const p of providers) {
    if (!p.cost) continue;
    records.push({
      providerId: p.id,
      modelId: '*',
      inputCostPerMillion: p.cost.inputPer1M ?? 0,
      outputCostPerMillion: p.cost.outputPer1M ?? 0,
      source: 'provider-config',
      pricingStatus: 'configured',
    });
  }
  return new PricingBook(records);
}

export function buildBudgetManager(env: NodeJS.ProcessEnv = process.env, now: () => number = () => Date.now()): BudgetManager {
  const enabled = bool(env.MIGRAPILOT_BUDGET_ENABLED, false);
  const warn = num(env.MIGRAPILOT_BUDGET_WARNING_THRESHOLD) ?? 0.8;
  const start = now();
  const scopes: BudgetScope[] = [];
  const add = (kind: BudgetScope['kind'], key: string, limit: number | undefined, periodMs?: number): void => {
    if (limit === undefined) return;
    scopes.push({ kind, key, enabled: true, currency: 'USD', hardLimitUsd: limit, warningThreshold: warn, periodMs, periodStart: start, spentUsd: 0, reservedUsd: 0 });
  };
  add('per_request', 'global', num(env.MIGRAPILOT_BUDGET_PER_REQUEST_USD));
  add('daily', 'global', num(env.MIGRAPILOT_BUDGET_DAILY_USD), DAY_MS);
  add('monthly', 'global', num(env.MIGRAPILOT_BUDGET_MONTHLY_USD), 30 * DAY_MS);
  add('provider', 'openai', num(env.MIGRAPILOT_BUDGET_PROVIDER_OPENAI_USD), 30 * DAY_MS);
  add('provider', 'anthropic', num(env.MIGRAPILOT_BUDGET_PROVIDER_ANTHROPIC_USD), 30 * DAY_MS);
  return new BudgetManager(enabled, scopes, now);
}

export function buildUsageLedger(): UsageLedger {
  return new UsageLedger();
}
