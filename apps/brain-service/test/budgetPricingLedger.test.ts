// Intelligent Provider Router — Slice 4, commit 1: pricing + estimation + ledger.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PricingBook, isTrustedForHardEnforcement } from '../src/engine/providers/budget/pricing.js';
import { estimateCost, estimateTokens } from '../src/engine/providers/budget/costEstimation.js';
import { UsageLedger } from '../src/engine/providers/budget/usageLedger.js';

test('pricing book returns exact, provider-wildcard, or a truthful UNKNOWN (never silent $0)', () => {
  const book = new PricingBook([
    { providerId: 'anthropic', modelId: 'claude-sonnet-5', inputCostPerMillion: 3, outputCostPerMillion: 15, source: 'owner', pricingStatus: 'configured' },
    { providerId: 'openai', modelId: '*', inputCostPerMillion: 2.5, outputCostPerMillion: 10, source: 'owner', pricingStatus: 'configured' },
  ]);
  assert.equal(book.get('anthropic', 'claude-sonnet-5').outputCostPerMillion, 15);
  assert.equal(book.get('openai', 'gpt-4o-mini').inputCostPerMillion, 2.5); // wildcard
  const unknown = book.get('mystery', 'x');
  assert.equal(unknown.pricingStatus, 'unknown');
  assert.equal(unknown.inputCostPerMillion, 0); // but status makes clear it is not a real price
});

test('only verified / configured pricing may execute under hard enforcement', () => {
  assert.equal(isTrustedForHardEnforcement('verified'), true);
  assert.equal(isTrustedForHardEnforcement('configured'), true);
  assert.equal(isTrustedForHardEnforcement('estimated'), false);
  assert.equal(isTrustedForHardEnforcement('unknown'), false);
});

test('cost estimation is conservative: worst-case ≥ expected; request minimum applies; unknown flagged', () => {
  const price = { providerId: 'anthropic', modelId: 'm', inputCostPerMillion: 3, outputCostPerMillion: 15, source: 'owner', pricingStatus: 'configured' as const };
  const est = estimateCost(price, 1_000_000, 1_000_000, { expectedOutputTokens: 200_000 });
  assert.equal(est.estimatedInputTokens, 1_000_000);
  assert.equal(est.worstCaseCostUsd, 3 + 15); // 1M in @3 + 1M out @15
  assert.ok(est.estimatedCostUsd < est.worstCaseCostUsd); // expected output smaller
  const withMin = estimateCost({ ...price, requestMinimumUsd: 5 }, 10, 10, {});
  assert.equal(withMin.worstCaseCostUsd, 5); // floor applied
  const unknown = estimateCost({ ...price, pricingStatus: 'unknown' }, 10, 10, {});
  assert.equal(unknown.costUnavailable, true);
});

test('estimateTokens is a bounded ~4-char/token counter', () => {
  assert.equal(estimateTokens('12345678'), 2);
  assert.equal(estimateTokens(''), 0);
});

test('usage ledger is append-only, metadata-only, and drops forbidden fields', () => {
  const ledger = new UsageLedger(() => 1000, (() => { let n = 0; return () => `id${n++}`; })());
  // A caller mistakenly passes forbidden payloads alongside the metadata — they must be dropped.
  const dirty = {
    executionCorrelationId: 'corr-1', providerId: 'anthropic', modelId: 'claude-sonnet-5', executionMode: 'escalation', policy: 'auto', localOrCloud: 'cloud', outcome: 'ok', costUsd: 0.02, costStatus: 'actual',
    prompt: 'my secret prompt', response: 'the code', apiKey: 'sk-leak', rootPath: '/home/bonex/x',
  } as unknown as Parameters<typeof ledger.append>[0];
  const rec = ledger.append(dirty);
  assert.ok(rec.usageId.startsWith('use_'));
  const flat = JSON.stringify(ledger.query());
  assert.ok(!flat.includes('my secret prompt') && !flat.includes('sk-leak') && !flat.includes('/home/bonex/x'));
});

test('ledger query filters by correlation / provider / local-cloud, bounded page', () => {
  const ledger = new UsageLedger(() => 1000);
  ledger.append({ executionCorrelationId: 'a', providerId: 'local', modelId: 'q', executionMode: 'engineer', policy: 'auto', localOrCloud: 'local', outcome: 'ok', costStatus: 'estimated', estimatedSavingsUsd: 0.08, localCostStatus: 'estimated' });
  ledger.append({ executionCorrelationId: 'b', providerId: 'anthropic', modelId: 'c', executionMode: 'escalation', policy: 'auto', localOrCloud: 'cloud', outcome: 'ok', costUsd: 0.05, costStatus: 'actual' });
  assert.equal(ledger.query({ correlationId: 'a' }).length, 1);
  assert.equal(ledger.query({ localOrCloud: 'cloud' })[0]!.providerId, 'anthropic');
  assert.equal(ledger.query({ limit: 1 }).length, 1);
});

test('summary distinguishes local vs cloud; unknown local savings never reported as $0-confident', () => {
  const ledger = new UsageLedger(() => 1000);
  ledger.append({ executionCorrelationId: 'a', providerId: 'local', modelId: 'q', executionMode: 'engineer', policy: 'auto', localOrCloud: 'local', outcome: 'ok', costStatus: 'estimated', equivalentCloudCostUsd: 0.08, estimatedSavingsUsd: 0.08, localCostStatus: 'estimated' });
  ledger.append({ executionCorrelationId: 'b', providerId: 'anthropic', modelId: 'c', executionMode: 'escalation', policy: 'auto', localOrCloud: 'cloud', outcome: 'ok', costUsd: 0.05, costStatus: 'actual' });
  const s = ledger.summary();
  assert.equal(s.cloud.count, 1);
  assert.equal(s.cloud.costUsd, 0.05);
  assert.equal(s.local.count, 1);
  assert.equal(s.local.estimatedSavingsUsd, 0.08);
  assert.equal(s.local.savingsStatus, 'estimated');
  // an unknown-local-cost record flips the summary status to unknown (never a confident 0)
  ledger.append({ executionCorrelationId: 'd', providerId: 'local', modelId: 'q', executionMode: 'chat', policy: 'auto', localOrCloud: 'local', outcome: 'ok', costStatus: 'unknown', localCostStatus: 'unknown' });
  assert.equal(ledger.summary().local.savingsStatus, 'unknown');
});
