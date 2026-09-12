/**
 * A provider that cannot generate must never look operationally healthy.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHAT THIS EXISTS TO STOP
 *
 * A MigraPilot Brain with NO inference configured at all reported, on staging:
 *
 *   status: "ok"
 *   providers: [ {local,true}, {cheap,true}, {default,true}, {premium,true} ]
 *
 * Every one of those lines was produced by the deterministic StubProvider, whose
 * `isAvailable()` returned `true` unconditionally, and by a reachability probe
 * that short-circuited stubs to `{ reachable: true, modelCount: 1 }`. The only
 * field telling the truth was `gpuCapacity: unavailable`.
 *
 * That is the worst shape an operational signal can take: not an error, not a
 * warning, but a confident green from the component that is supposed to be the
 * authority on whether the product works.
 *
 * These tests pin the three separate questions that were being collapsed into
 * one, so they cannot silently merge again:
 *
 *   CONFIGURED          — something is declared for this profile
 *   ENDPOINT REACHABLE  — an endpoint answered a probe
 *   CAN SERVE INFERENCE — it is a real model, not a canned-text placeholder
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveHealth, makeReachabilityProbe } from '../src/engine/providers/health.js';
import type { Provider } from '../src/engine/providers/types.js';
import { StubProvider } from '../src/providers/providerRegistry.js';
import { OpenAiCompatProvider } from '../src/providers/openAiCompatProvider.js';

const base: Provider = {
  id: 'local',
  displayName: 'Local (on-device)',
  kind: 'local',
  protocol: 'openai-compat',
  baseUrl: 'http://127.0.0.1:11434/v1',
  capabilities: { chat: true, vision: false, tools: false, embedding: false, reasoning: false, coding: false },
  priority: 100,
  cost: { inputPer1M: 0, outputPer1M: 0 },
  dataLocality: 'on-device',
  enabled: true,
};

const stub = (over: Partial<Provider> = {}): Provider => ({ ...base, protocol: 'stub', baseUrl: undefined, ...over });
const live = (over: Partial<Provider> = {}): Provider => ({ ...base, ...over });

// ── the defect itself ───────────────────────────────────────────────────────

test('a stub provider is NEVER healthy, however it is probed', () => {
  const now = 1_000;
  // Even handed the outcome the old probe used to fabricate.
  const optimistic = deriveHealth(stub(), true, { reachable: true, modelCount: 1 }, now);
  assert.equal(optimistic.status, 'stub');
  assert.equal(optimistic.reachable, false);
  assert.notEqual(optimistic.status, 'healthy');
});

test('the reachability probe does not claim a stub is reachable', async () => {
  const probe = makeReachabilityProbe(async () => {
    throw new Error('a stub must never be probed over the network');
  });
  const outcome = await probe(stub());
  assert.equal(outcome.reachable, false);
  assert.match(outcome.detail ?? '', /stub/i);
});

test('StubProvider.isAvailable() is false — it cannot serve inference', async () => {
  // `isAvailable()` feeds /health's `inferenceReady`, and through it the whole
  // service status. A stub answering `complete()` is not the same claim.
  assert.equal(await new StubProvider('default').isAvailable(), false);
});

test('a stub still WORKS — the correction is to its claim, not its behaviour', async () => {
  // Tests and offline development depend on the stub producing text. If this
  // ever fails, the fix above went too far.
  const out = await new StubProvider('default').complete({
    feature: 'chat',
    modelProfile: 'default',
    systemPromptId: 'chat.v1',
    userPrompt: 'hello',
    outputMode: 'markdown',
    context: {},
  });
  assert.ok(typeof out.content === 'string' && out.content.length > 0);
});

// ── the distinction stays visible ───────────────────────────────────────────

test('adapters declare what they ARE, so health does not have to infer it', () => {
  assert.equal(new StubProvider('default').kind, 'stub');
  assert.equal(
    new OpenAiCompatProvider({ profile: 'default', baseUrl: base.baseUrl!, model: 'm' }).kind,
    'live',
  );
});

test('the states stay separate: disabled / stub / credential-absent / unprobed / unreachable / degraded / healthy', () => {
  const now = 2_000;
  assert.equal(deriveHealth(live({ enabled: false }), true, null, now).status, 'disabled');
  assert.equal(deriveHealth(stub(), true, null, now).status, 'stub');
  assert.equal(
    deriveHealth(live({ credentialEnv: 'SOME_KEY' }), false, null, now).status,
    'unknown',
  );
  assert.equal(deriveHealth(live(), true, null, now).status, 'unknown');
  assert.equal(deriveHealth(live(), true, { reachable: false, detail: 'timeout' }, now).status, 'unreachable');
  assert.equal(deriveHealth(live(), true, { reachable: true, modelCount: 0 }, now).status, 'degraded');
  assert.equal(deriveHealth(live(), true, { reachable: true, modelCount: 3 }, now).status, 'healthy');
});

test('a disabled stub reads as disabled — the operator choice outranks the placeholder', () => {
  assert.equal(deriveHealth(stub({ enabled: false }), true, null, 3_000).status, 'disabled');
});

test('health never leaks a credential value', () => {
  const h = deriveHealth(live({ credentialEnv: 'OPENAI_API_KEY' }), false, null, 4_000);
  assert.equal(h.status, 'unknown');
  assert.equal(JSON.stringify(h).includes('sk-'), false);
});
