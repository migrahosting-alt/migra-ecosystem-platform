// Intelligent Provider Router — Slice 4, commit 4: concurrency + no-cloud invariants.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { EscalationController } from '../src/engine/providers/escalationController.js';
import { EscalationOfferStore } from '../src/engine/providers/escalationStore.js';
import { CloudEscalationExecutor, type CloudProviderFactory } from '../src/engine/providers/cloudEscalationExecutor.js';
import { registerEscalationRoutes } from '../src/engine/providers/escalationRoutes.js';
import { FleetRegistry } from '../src/engine/providers/fleetRegistry.js';
import { ProviderRegistry } from '../src/engine/providers/providerRegistry.js';
import { PricingBook } from '../src/engine/providers/budget/pricing.js';
import { BudgetManager, type BudgetScope } from '../src/engine/providers/budget/budgetManager.js';
import { UsageLedger } from '../src/engine/providers/budget/usageLedger.js';
import { ModelRegistry } from '../src/engine/modelRegistry.js';
import type { Provider } from '../src/engine/providers/types.js';
import type { ChatTurnRequest } from '@migrapilot/shared-types';

const CAPS = { chat: true, vision: true, tools: true, embedding: false, reasoning: true, coding: true };
const REQ: ChatTurnRequest = { feature: 'chat', modelProfile: 'default', systemPromptId: 'x', userPrompt: 'fix the bug', context: {}, outputMode: 'markdown' };
const OUTCOME = { hadLocalModel: true as const, terminal: 'failed' as const, output: '', errorMessage: 'boom' };

function providers(): Provider[] {
  return [
    { id: 'local', displayName: 'Local', kind: 'local', protocol: 'stub', capabilities: CAPS, priority: 100, cost: { inputPer1M: 0, outputPer1M: 0 }, dataLocality: 'on-device', enabled: true },
    { id: 'anthropic', displayName: 'Claude', kind: 'cloud', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', credentialEnv: 'ANTHROPIC_API_KEY', defaultModel: 'claude-sonnet-5', capabilities: CAPS, priority: 60, cost: { inputPer1M: 3, outputPer1M: 15 }, dataLocality: 'external', enabled: true },
  ];
}
function scope(kind: BudgetScope['kind'], key: string, limit: number): BudgetScope {
  return { kind, key, enabled: true, currency: 'USD', hardLimitUsd: limit, warningThreshold: 0.8, periodStart: 0, spentUsd: 0, reservedUsd: 0 };
}
function build(monthlyLimit: number) {
  const env = { ANTHROPIC_API_KEY: 'present' } as NodeJS.ProcessEnv;
  const registry = new ProviderRegistry(providers(), (n) => env[n]);
  const fleet = new FleetRegistry(registry, new ModelRegistry({ sources: [], staticModels: [] }), { now: () => 1 });
  const pricing = new PricingBook([{ providerId: 'anthropic', modelId: '*', inputCostPerMillion: 3, outputCostPerMillion: 15, source: 't', pricingStatus: 'configured' }]);
  const budget = new BudgetManager(true, [scope('monthly', 'global', monthlyLimit)], () => 1);
  let cloudCalls = 0;
  const factory: CloudProviderFactory = () => ({ name: 'c', async complete() { cloudCalls++; return { content: 'ok', telemetry: { inputTokens: 5, outputTokens: 10, latencyMs: 1 } } as never; }, async *stream() {}, async isAvailable() { return true; } } as never);
  const controller = new EscalationController(new EscalationOfferStore(), new CloudEscalationExecutor(factory, env), fleet, registry, pricing, budget, new UsageLedger(() => 1), 500);
  return { controller, budget, calls: () => cloudCalls };
}

test('Run E — two requests compete for the last budget: exactly one cloud call, one denied, no overspend', async () => {
  // Worst-case per call ≈ 7/1e6*3 + 500/1e6*15 ≈ 0.007521. Budget fits exactly one.
  const { controller, budget, calls } = build(0.0076);
  const o1 = await controller.offer({ correlationId: 'e1', policy: 'auto', outcome: OUTCOME, request: REQ });
  const o2 = await controller.offer({ correlationId: 'e2', policy: 'auto', outcome: OUTCOME, request: REQ });
  assert.ok(o1.offered && o2.offered, 'both offers pass preflight (budget still open)');

  const app = Fastify({ logger: false });
  registerEscalationRoutes(app, controller);
  const [r1, r2] = await Promise.all([
    app.inject({ method: 'POST', url: '/api/ai/escalation/approve', payload: { offerId: o1.offerId, token: o1.token, request: REQ } }),
    app.inject({ method: 'POST', url: '/api/ai/escalation/approve', payload: { offerId: o2.offerId, token: o2.token, request: REQ } }),
  ]);
  const codes = [r1.statusCode, r2.statusCode].sort();
  assert.deepEqual(codes, [200, 403], 'exactly one succeeds, one is denied');
  assert.equal(calls(), 1, 'exactly one cloud call — no overspend');
  const monthly = budget.status().find((s) => s.kind === 'monthly')!;
  assert.ok(monthly.spentUsd <= monthly.hardLimitUsd, 'never overspent');
  await app.close();
});

test('INVARIANT: a budget denial prevents the cloud call entirely (no reservation → no attempt)', async () => {
  const { controller, calls } = build(0.000001); // far below one call
  const off = await controller.offer({ correlationId: 'z1', policy: 'auto', outcome: OUTCOME, request: REQ });
  // Offer itself is denied at preflight → nothing to approve.
  assert.equal(off.offered, false);
  assert.equal(calls(), 0);
});

test('INVARIANT: budget APIs cannot raise a limit — reserve remains the sole spend gate', () => {
  const { budget } = build(1);
  const before = budget.status().find((s) => s.kind === 'monthly')!.hardLimitUsd;
  // There is no public method to increase a limit; status() is read-only.
  assert.equal(before, 1);
  const snap = budget.status();
  (snap[0] as { hardLimitUsd: number }).hardLimitUsd = 9999; // mutating the snapshot must not affect the manager
  assert.equal(budget.status().find((s) => s.kind === 'monthly')!.hardLimitUsd, 1);
});
