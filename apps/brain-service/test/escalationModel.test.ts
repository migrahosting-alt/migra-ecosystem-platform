// Intelligent Provider Router — Slice 3, commit 1: escalation model + offer store.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyLocalFailure, evaluateEscalation, estimateCostUsd, type LocalOutcome } from '../src/engine/providers/escalation.js';
import { EscalationOfferStore, hashRequest } from '../src/engine/providers/escalationStore.js';
import type { FleetProvider, FleetSnapshot } from '../src/engine/providers/fleetRegistry.js';
import type { ExecutionPolicyId } from '../src/engine/providers/executionPolicy.js';
import type { ProviderCapabilities, ProviderKind } from '../src/engine/providers/types.js';

const CAPS: ProviderCapabilities = { chat: true, vision: true, tools: true, embedding: false, reasoning: true, coding: true };
function fp(id: string, kind: ProviderKind, over: Partial<FleetProvider['provider']> = {}): FleetProvider {
  return {
    provider: { id, displayName: id, kind, protocol: kind === 'cloud' ? 'anthropic' : 'openai-compat', capabilities: CAPS, priority: kind === 'cloud' ? 60 : 100, cost: kind === 'cloud' ? { inputPer1M: 3, outputPer1M: 15 } : { inputPer1M: 0, outputPer1M: 0 }, dataLocality: kind === 'cloud' ? 'external' : 'on-device', enabled: true, hasCredential: true, defaultModel: kind === 'cloud' ? 'claude-sonnet-5' : undefined, health: { status: 'healthy', reachable: true, lastCheckedAt: 1 }, ...over },
    models: [], declaredCapabilities: CAPS, modelBackedCapabilities: CAPS, effectiveCapabilities: CAPS,
  };
}
function snap(...p: FleetProvider[]): FleetSnapshot {
  return { providers: p, generatedAt: 1 };
}
function evalWith(policy: ExecutionPolicyId, reason: Parameters<typeof classifyLocalFailure>[0] extends never ? never : ReturnType<typeof classifyLocalFailure>, fleet: FleetSnapshot, budgetCapUsd = 1) {
  return evaluateEscalation({ policy, reason, fleet, requiredCaps: { coding: true }, estInputTokens: 2000, estOutputTokens: 800, budgetCapUsd });
}

test('classifier: only DEFINED reasons; a valid-but-imperfect result never qualifies', () => {
  const base: LocalOutcome = { hadLocalModel: true, terminal: 'completed', output: 'here is a decent answer with enough content' };
  assert.equal(classifyLocalFailure({ ...base, hadLocalModel: false }), 'LOCAL_UNSUPPORTED_CAPABILITY');
  assert.equal(classifyLocalFailure({ ...base, terminal: 'failed', errorMessage: 'context length exceeded' }), 'LOCAL_CONTEXT_LIMIT');
  assert.equal(classifyLocalFailure({ ...base, terminal: 'failed', errorMessage: 'request timed out' }), 'LOCAL_TIMEOUT');
  assert.equal(classifyLocalFailure({ ...base, terminal: 'failed', errorMessage: 'segfault' }), 'LOCAL_MALFORMED_OUTPUT');
  assert.equal(classifyLocalFailure({ ...base, terminal: 'completed', output: '   ' }), 'LOCAL_MALFORMED_OUTPUT');
  assert.equal(classifyLocalFailure(base), null, 'a valid result does not qualify');
});

test('escalation is IMPOSSIBLE under local-only and privacy-first regardless of reason', () => {
  for (const policy of ['local-only', 'privacy-first'] as ExecutionPolicyId[]) {
    const d = evalWith(policy, 'LOCAL_CONTEXT_LIMIT', snap(fp('local', 'local'), fp('anthropic', 'cloud')));
    assert.equal(d.offered, false);
    assert.match(d.deniedReason!, /prohibits external transfer/);
  }
});

test('no defined reason → never offered', () => {
  const d = evalWith('auto', null, snap(fp('local', 'local'), fp('anthropic', 'cloud')));
  assert.equal(d.offered, false);
  assert.match(d.deniedReason!, /no defined escalation reason/);
});

test('offered when reason + permitting policy + eligible cloud + within budget', () => {
  const d = evalWith('auto', 'LOCAL_TIMEOUT', snap(fp('local', 'local'), fp('anthropic', 'cloud')), 1);
  assert.equal(d.offered, true);
  assert.equal(d.target?.providerId, 'anthropic');
  assert.equal(d.target?.modelId, 'claude-sonnet-5');
  assert.ok(typeof d.estCostUsd === 'number');
});

test('denied when no eligible cloud provider (disabled / no credential / unreachable)', () => {
  const disabled = fp('anthropic', 'cloud', { enabled: false });
  const nocred = fp('openai', 'cloud', { hasCredential: false, credentialEnv: 'K' });
  const down = fp('cohere', 'cloud', { health: { status: 'unreachable', reachable: false, lastCheckedAt: 1 } });
  const d = evalWith('auto', 'LOCAL_TIMEOUT', snap(fp('local', 'local'), disabled, nocred, down));
  assert.equal(d.offered, false);
  assert.match(d.deniedReason!, /no eligible cloud provider/);
});

test('denied when estimated cost exceeds the budget cap', () => {
  const d = evalWith('auto', 'LOCAL_TIMEOUT', snap(fp('local', 'local'), fp('anthropic', 'cloud')), 0.0001);
  assert.equal(d.offered, false);
  assert.match(d.deniedReason!, /exceeds cloud budget cap/);
});

test('cost estimate is proportional to tokens + provider price', () => {
  assert.equal(estimateCostUsd({ inputPer1M: 3, outputPer1M: 15 }, 1_000_000, 0), 3);
  assert.equal(estimateCostUsd({ inputPer1M: 0, outputPer1M: 0 }, 5000, 5000), 0);
});

test('offer store: single-use, request-bound, token-bound, expiring', () => {
  let t = 1000;
  const store = new EscalationOfferStore(() => t, (() => { let n = 0; return () => `id${n++}`; })(), 5000);
  const reqHash = hashRequest({ task: 'fix', rootPath: '/w' });
  const offer = store.mint({ requestHash: reqHash, reason: 'LOCAL_TIMEOUT', target: { providerId: 'anthropic', modelId: 'claude-sonnet-5' }, estCostUsd: 0.01 });
  assert.ok(offer.offerId.startsWith('esc_') && offer.token.startsWith('escok_'));
  // wrong token
  assert.deepEqual(store.consume(offer.offerId, 'nope', reqHash), { ok: false, reason: 'TOKEN_MISMATCH' });
  // wrong request
  assert.deepEqual(store.consume(offer.offerId, offer.token, hashRequest({ task: 'other' })), { ok: false, reason: 'REQUEST_MISMATCH' });
  // correct
  assert.equal(store.consume(offer.offerId, offer.token, reqHash).ok, true);
  // replay refused
  assert.deepEqual(store.consume(offer.offerId, offer.token, reqHash), { ok: false, reason: 'ALREADY_USED' });
  // get() never leaks the token
  const o2 = store.mint({ requestHash: reqHash, reason: 'LOCAL_TIMEOUT', target: { providerId: 'anthropic', modelId: 'claude-sonnet-5' }, estCostUsd: 0.01 });
  assert.ok(!('token' in (store.get(o2.offerId) as object)));
  // expiry
  t = 100000;
  assert.deepEqual(store.consume(o2.offerId, o2.token, reqHash), { ok: false, reason: 'EXPIRED' });
});
