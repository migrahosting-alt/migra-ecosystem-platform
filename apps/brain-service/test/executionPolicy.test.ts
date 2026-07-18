// Intelligent Provider Router — Slice 1, commit 3: execution policy engine.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PolicyEngine, EXECUTION_POLICIES, isExecutionPolicyId, DEFAULT_POLICY } from '../src/engine/providers/executionPolicy.js';
import type { FleetProvider, FleetSnapshot } from '../src/engine/providers/fleetRegistry.js';
import type { ProviderCapabilities, ProviderHealth, ProviderKind } from '../src/engine/providers/types.js';

const CAPS: ProviderCapabilities = { chat: true, vision: true, tools: true, embedding: true, reasoning: true, coding: true };
const HEALTHY: ProviderHealth = { status: 'healthy', reachable: true, lastCheckedAt: 1, modelCount: 1 };

function fp(id: string, kind: ProviderKind, over: Partial<FleetProvider['provider']> = {}, caps: ProviderCapabilities = CAPS, models: FleetProvider['models'] = []): FleetProvider {
  return {
    provider: {
      id, displayName: id, kind, protocol: kind === 'local' ? 'openai-compat' : 'anthropic',
      capabilities: caps, priority: kind === 'local' ? 100 : 60, cost: kind === 'local' ? { inputPer1M: 0, outputPer1M: 0 } : { inputPer1M: 3, outputPer1M: 15 },
      dataLocality: kind === 'local' ? 'on-device' : 'external', enabled: true, hasCredential: true, health: HEALTHY, ...over,
    },
    models,
    declaredCapabilities: caps,
    modelBackedCapabilities: caps,
    effectiveCapabilities: caps,
  };
}
function snap(...providers: FleetProvider[]): FleetSnapshot {
  return { providers, generatedAt: 1 };
}
const engine = new PolicyEngine();

test('policy catalog has all seven named policies + custom, and a default', () => {
  assert.deepEqual(Object.keys(EXECUTION_POLICIES).sort(), ['auto', 'best-quality', 'cloud-first', 'custom', 'local-first', 'local-only', 'lowest-cost', 'privacy-first'].sort());
  assert.ok(isExecutionPolicyId(DEFAULT_POLICY));
  assert.ok(!isExecutionPolicyId('restart'));
});

test('every plan is dry-run (never executes)', () => {
  const plan = engine.plan('auto', {}, snap(fp('local', 'local')));
  assert.equal(plan.dryRun, true);
});

test('local-first ranks local above cloud; both remain candidates', () => {
  const plan = engine.plan('local-first', {}, snap(fp('local', 'local'), fp('anthropic', 'cloud')));
  assert.equal(plan.chosen?.providerId, 'local');
  assert.deepEqual(plan.ranked.map((c) => c.providerId), ['local', 'anthropic']);
});

test('local-only EXCLUDES cloud entirely', () => {
  const plan = engine.plan('local-only', {}, snap(fp('local', 'local'), fp('anthropic', 'cloud')));
  assert.deepEqual(plan.ranked.map((c) => c.providerId), ['local']);
  assert.ok(plan.excluded.some((e) => e.providerId === 'anthropic' && /local-only/.test(e.reason)));
});

test('cloud-first ranks cloud above local', () => {
  const plan = engine.plan('cloud-first', {}, snap(fp('local', 'local'), fp('anthropic', 'cloud')));
  assert.equal(plan.chosen?.providerId, 'anthropic');
});

test('privacy-first excludes external without consent, includes it with consent', () => {
  const noConsent = engine.plan('privacy-first', {}, snap(fp('local', 'local'), fp('anthropic', 'cloud')));
  assert.deepEqual(noConsent.ranked.map((c) => c.providerId), ['local']);
  assert.ok(noConsent.excluded.some((e) => e.providerId === 'anthropic' && /privacy-first/.test(e.reason)));
  const consented = engine.plan('privacy-first', { consentExternal: true }, snap(fp('local', 'local'), fp('anthropic', 'cloud')));
  assert.equal(consented.chosen?.providerId, 'local'); // on-device still preferred
  assert.ok(consented.ranked.some((c) => c.providerId === 'anthropic'));
});

test('lowest-cost prefers the free local provider', () => {
  const plan = engine.plan('lowest-cost', {}, snap(fp('anthropic', 'cloud'), fp('local', 'local')));
  assert.equal(plan.chosen?.providerId, 'local');
  assert.ok(plan.chosen?.reasons.some((r) => /no marginal cost/.test(r)));
});

test('best-quality can rank a cloud provider first when it has the deeper model', () => {
  const localFast = fp('local', 'local', {}, CAPS, [{ id: 'small', provider: 'local', capabilities: { chat: true, vision: true, tools: true, embedding: true, reasoning: false, coding: false, insert: false }, tier: 'fast' }]);
  const cloudDeep = fp('anthropic', 'cloud', {}, CAPS, [{ id: 'opus', provider: 'anthropic', capabilities: { chat: true, vision: true, tools: true, embedding: false, reasoning: true, coding: true, insert: false }, tier: 'deep' }]);
  const plan = engine.plan('best-quality', { tier: 'deep' }, snap(localFast, cloudDeep));
  assert.equal(plan.chosen?.providerId, 'anthropic');
  assert.equal(plan.chosen?.modelId, 'opus');
});

test('hard capability requirement excludes a provider that cannot satisfy it', () => {
  const noVision: ProviderCapabilities = { ...CAPS, vision: false };
  const plan = engine.plan('auto', { needsVision: true }, snap(fp('local', 'local', {}, noVision), fp('anthropic', 'cloud')));
  assert.ok(plan.excluded.some((e) => e.providerId === 'local' && /vision/.test(e.reason)));
  assert.equal(plan.chosen?.providerId, 'anthropic');
});

test('disabled + unreachable + credential-absent providers are excluded fail-closed', () => {
  const plan = engine.plan('auto', {}, snap(
    fp('disabled', 'cloud', { enabled: false }),
    fp('down', 'cloud', { health: { status: 'unreachable', reachable: false, lastCheckedAt: 1 } }),
    fp('nocred', 'cloud', { credentialEnv: 'K', hasCredential: false }),
    fp('local', 'local'),
  ));
  assert.equal(plan.chosen?.providerId, 'local');
  const reasons = new Map(plan.excluded.map((e) => [e.providerId, e.reason]));
  assert.match(reasons.get('disabled')!, /disabled/);
  assert.match(reasons.get('down')!, /unreachable/);
  assert.match(reasons.get('nocred')!, /credential absent/);
});

test('when all providers are excluded, chosen is null with an explanatory note', () => {
  const plan = engine.plan('local-only', {}, snap(fp('anthropic', 'cloud')));
  assert.equal(plan.chosen, null);
  assert.ok(plan.notes.some((n) => /no eligible provider/.test(n)));
});
