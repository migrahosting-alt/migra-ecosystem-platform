// Intelligent Provider Router — Slice 4, commit 3: budget-gated escalation + APIs.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { EscalationController } from '../src/engine/providers/escalationController.js';
import { EscalationOfferStore } from '../src/engine/providers/escalationStore.js';
import { CloudEscalationExecutor, type CloudProviderFactory } from '../src/engine/providers/cloudEscalationExecutor.js';
import { registerEscalationRoutes } from '../src/engine/providers/escalationRoutes.js';
import { registerBudgetRoutes } from '../src/engine/providers/budget/budgetRoutes.js';
import { FleetRegistry } from '../src/engine/providers/fleetRegistry.js';
import { ProviderRegistry } from '../src/engine/providers/providerRegistry.js';
import { PricingBook } from '../src/engine/providers/budget/pricing.js';
import { BudgetManager, type BudgetScope } from '../src/engine/providers/budget/budgetManager.js';
import { UsageLedger } from '../src/engine/providers/budget/usageLedger.js';
import { ModelRegistry } from '../src/engine/modelRegistry.js';
import type { Provider } from '../src/engine/providers/types.js';
import type { ChatTurnRequest } from '@migrapilot/shared-types';

const CAPS = { chat: true, vision: true, tools: true, embedding: false, reasoning: true, coding: true };
const REQ: ChatTurnRequest = { feature: 'chat', modelProfile: 'default', systemPromptId: 'x', userPrompt: 'fix the bug in the parser', context: {}, outputMode: 'markdown' };
const OUTCOME = { hadLocalModel: true as const, terminal: 'failed' as const, output: '', errorMessage: 'boom' };

function providers(): Provider[] {
  return [
    { id: 'local', displayName: 'Local', kind: 'local', protocol: 'stub', capabilities: CAPS, priority: 100, cost: { inputPer1M: 0, outputPer1M: 0 }, dataLocality: 'on-device', enabled: true },
    { id: 'anthropic', displayName: 'Claude', kind: 'cloud', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', credentialEnv: 'ANTHROPIC_API_KEY', defaultModel: 'claude-sonnet-5', capabilities: CAPS, priority: 60, cost: { inputPer1M: 3, outputPer1M: 15 }, dataLocality: 'external', enabled: true },
  ];
}
const cloudFactory: CloudProviderFactory = () => ({ name: 'c', async complete() { return { content: 'cloud fixed it', telemetry: { inputTokens: 40, outputTokens: 120, latencyMs: 3 } } as never; }, async *stream() {}, async isAvailable() { return true; } } as never);
function scope(kind: BudgetScope['kind'], key: string, limit: number): BudgetScope {
  return { kind, key, enabled: true, currency: 'USD', hardLimitUsd: limit, warningThreshold: 0.8, periodStart: 0, spentUsd: 0, reservedUsd: 0 };
}
function build(opts: { enabled?: boolean; scopes?: BudgetScope[]; pricing?: PricingBook; store?: EscalationOfferStore } = {}) {
  const env = { ANTHROPIC_API_KEY: 'present' } as NodeJS.ProcessEnv;
  const registry = new ProviderRegistry(providers(), (n) => env[n]);
  const fleet = new FleetRegistry(registry, new ModelRegistry({ sources: [], staticModels: [] }), { now: () => 1 });
  const pricing = opts.pricing ?? new PricingBook([{ providerId: 'anthropic', modelId: '*', inputCostPerMillion: 3, outputCostPerMillion: 15, source: 'test', pricingStatus: 'configured' }]);
  const budget = new BudgetManager(opts.enabled ?? true, opts.scopes ?? [scope('monthly', 'global', 100)], () => 1);
  const ledger = new UsageLedger(() => 1);
  const controller = new EscalationController(opts.store ?? new EscalationOfferStore(), new CloudEscalationExecutor(cloudFactory, env), fleet, registry, pricing, budget, ledger, 500);
  return { controller, budget, ledger, pricing, registry };
}

test('offer carries cost estimate + remaining budget + ceiling; approve reserves, reconciles, ledgers', async () => {
  const { controller, budget, ledger } = build({ scopes: [scope('monthly', 'global', 100)] });
  const off = await controller.offer({ correlationId: 'c1', policy: 'auto', outcome: OUTCOME, request: REQ });
  assert.equal(off.offered, true);
  assert.ok(off.estimate && off.worstCaseCostUsd! > 0);
  assert.equal(off.costCeilingUsd, off.worstCaseCostUsd);
  assert.equal(off.remainingBudgetUsd, 100);
  assert.equal(off.dataLeavesLocal, true);

  const app = Fastify({ logger: false });
  registerEscalationRoutes(app, controller);
  const res = await app.inject({ method: 'POST', url: '/api/ai/escalation/approve', headers: { 'x-correlation-id': 'c1' }, payload: { offerId: off.offerId, token: off.token, request: REQ } });
  assert.equal(res.statusCode, 200);
  const j = res.json();
  assert.equal(j.ok, true);
  assert.equal(j.escalation.provider, 'anthropic');
  // reconciled: actual cost from returned usage (40 in @3 + 120 out @15 per 1M)
  const usage = ledger.byCorrelation('c1').find((r) => r.localOrCloud === 'cloud');
  assert.ok(usage && usage.costStatus === 'actual' && usage.costUsd! > 0);
  // reservation consumed → monthly spent reflects actual, reserved back to 0
  const monthly = budget.status().find((s) => s.kind === 'monthly')!;
  assert.equal(monthly.reservedUsd, 0);
  assert.ok(monthly.spentUsd > 0 && monthly.spentUsd < 1);
  await app.close();
});

test('budget DISABLED → no offer (paid cloud impossible)', async () => {
  const { controller } = build({ enabled: false });
  const off = await controller.offer({ correlationId: 'c2', policy: 'auto', outcome: OUTCOME, request: REQ });
  assert.equal(off.offered, false);
  assert.match(off.deniedReason!, /BUDGET_DISABLED/);
});

test('unknown pricing under hard enforcement → no offer', async () => {
  const { controller } = build({ pricing: new PricingBook([]) }); // no anthropic price → unknown
  const off = await controller.offer({ correlationId: 'c3', policy: 'auto', outcome: OUTCOME, request: REQ });
  assert.equal(off.offered, false);
  assert.match(off.deniedReason!, /pricing not trustworthy/);
});

test('per-request limit below worst-case → no offer; monthly exhausted → no offer', async () => {
  const tiny = build({ scopes: [scope('per_request', 'global', 0.0000001), scope('monthly', 'global', 100)] });
  assert.equal((await tiny.controller.offer({ correlationId: 'c4', policy: 'auto', outcome: OUTCOME, request: REQ })).deniedReason?.includes('REQUEST_COST_LIMIT_EXCEEDED'), true);
  const exhausted = build({ scopes: [{ ...scope('monthly', 'global', 100), spentUsd: 100 }] });
  assert.equal((await exhausted.controller.offer({ correlationId: 'c5', policy: 'auto', outcome: OUTCOME, request: REQ })).deniedReason?.includes('BUDGET_EXCEEDED'), true);
});

test('consent binds the ceiling: a price increase between offer and approve → CEILING_EXCEEDED, no cloud', async () => {
  const store = new EscalationOfferStore();
  const cheap = build({ store, pricing: new PricingBook([{ providerId: 'anthropic', modelId: '*', inputCostPerMillion: 3, outputCostPerMillion: 15, source: 't', pricingStatus: 'configured' }]) });
  const off = await cheap.controller.offer({ correlationId: 'c6', policy: 'auto', outcome: OUTCOME, request: REQ });
  assert.equal(off.offered, true);
  // A DIFFERENT controller sharing the same offer store but with a much higher price.
  const dear = build({ store, pricing: new PricingBook([{ providerId: 'anthropic', modelId: '*', inputCostPerMillion: 3000, outputCostPerMillion: 15000, source: 't', pricingStatus: 'configured' }]) });
  const app = Fastify({ logger: false });
  registerEscalationRoutes(app, dear.controller);
  const res = await app.inject({ method: 'POST', url: '/api/ai/escalation/approve', payload: { offerId: off.offerId, token: off.token, request: REQ } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().code, 'CEILING_EXCEEDED');
  await app.close();
});

test('budget + usage APIs are read-only and metadata-only', async () => {
  const { controller, budget, ledger, pricing } = build();
  const off = await controller.offer({ correlationId: 'c7', policy: 'auto', outcome: OUTCOME, request: REQ });
  const app = Fastify({ logger: false });
  registerEscalationRoutes(app, controller);
  registerBudgetRoutes(app, { budget, ledger, pricing });
  await app.inject({ method: 'POST', url: '/api/ai/escalation/approve', payload: { offerId: off.offerId, token: off.token, request: REQ } });

  const b = (await app.inject({ method: 'GET', url: '/api/ai/providers/budget' })).json();
  assert.equal(b.enabled, true);
  assert.ok(b.scopes.some((s: { kind: string }) => s.kind === 'monthly'));
  const u = (await app.inject({ method: 'GET', url: '/api/ai/providers/usage?localOrCloud=cloud' }));
  assert.ok(!u.body.includes('fix the bug in the parser'), 'no prompt in usage API');
  assert.equal(u.json().records[0].localOrCloud, 'cloud');
  const est = (await app.inject({ method: 'POST', url: '/api/ai/providers/budget/estimate', payload: { providerId: 'anthropic', modelId: 'claude-sonnet-5', promptChars: 4000 } })).json();
  assert.equal(est.estimate.label, 'estimated');
  // no mutation route
  assert.ok([404, 405].includes((await app.inject({ method: 'DELETE', url: '/api/ai/providers/budget' })).statusCode));
  await app.close();
});

test('local execution records estimated avoided cloud cost (never a confident $0)', () => {
  const { controller, ledger } = build();
  const s = controller.recordLocalUsage({ correlationId: 'c8', providerId: 'local', modelId: 'qwen', mode: 'engineer', policy: 'auto', outcome: 'ok', request: REQ });
  assert.equal(s.localCostStatus, 'estimated');
  assert.ok((s.estimatedSavingsUsd ?? 0) > 0);
  const rec = ledger.byCorrelation('c8')[0]!;
  assert.equal(rec.localOrCloud, 'local');
  assert.equal(rec.costStatus, 'unknown'); // local marginal cost not asserted as $0
  assert.equal(rec.localCostStatus, 'estimated');
});

test('local savings report UNKNOWN when no cloud price reference exists', () => {
  const { controller } = build({ pricing: new PricingBook([]) });
  const s = controller.recordLocalUsage({ correlationId: 'c9', providerId: 'local', modelId: 'qwen', mode: 'chat', policy: 'local-only', outcome: 'ok', request: REQ });
  assert.equal(s.localCostStatus, 'unknown');
  assert.equal(s.estimatedSavingsUsd, undefined);
});
