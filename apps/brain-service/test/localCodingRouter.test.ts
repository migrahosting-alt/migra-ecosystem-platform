// Intelligent Provider Router — Slice 2, commit 1: local-first selection + assessment.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectLocalCoding, rankLocalModels } from '../src/engine/providers/localCodingRouter.js';
import { assessCodingOutcome } from '../src/engine/providers/codingAssessment.js';
import { FleetRegistry } from '../src/engine/providers/fleetRegistry.js';
import { ProviderRegistry } from '../src/engine/providers/providerRegistry.js';
import { PolicyEngine } from '../src/engine/providers/executionPolicy.js';
import { ModelRegistry, type ModelDescriptor } from '../src/engine/modelRegistry.js';
import type { Provider } from '../src/engine/providers/types.js';

const CAPS = { chat: true, vision: true, tools: true, embedding: true, reasoning: true, coding: true };
function localProvider(): Provider {
  return { id: 'local', displayName: 'Local', kind: 'local', protocol: 'openai-compat', baseUrl: 'http://x/v1', capabilities: CAPS, priority: 100, cost: { inputPer1M: 0, outputPer1M: 0 }, dataLocality: 'on-device', enabled: true };
}
function cloudProvider(enabled: boolean): Provider {
  return { id: 'anthropic', displayName: 'Claude', kind: 'cloud', protocol: 'anthropic', baseUrl: 'https://a', credentialEnv: 'ANTHROPIC_API_KEY', capabilities: { ...CAPS, embedding: false }, priority: 60, cost: { inputPer1M: 3, outputPer1M: 15 }, dataLocality: 'external', enabled };
}
function model(id: string, over: Partial<ModelDescriptor> = {}): ModelDescriptor {
  return { id, provider: 'local', capabilities: { chat: true, vision: false, tools: true, embedding: false, reasoning: true, coding: true, insert: false }, tier: 'balanced', ...over };
}
function fleet(providers: Provider[], models: ModelDescriptor[], env: NodeJS.ProcessEnv = {}) {
  return new FleetRegistry(new ProviderRegistry(providers, (n) => env[n]), new ModelRegistry({ sources: [], staticModels: models }), { now: () => 1 });
}
const engine = new PolicyEngine();

test('selects the highest-ranked eligible local coding model', async () => {
  const f = fleet([localProvider()], [model('small', { tier: 'fast' }), model('deepseek-r1:14b', { tier: 'deep' })]);
  const d = await selectLocalCoding({ fleet: f, engine, policy: 'local-first' }, { preferCoding: true, tier: 'deep' });
  assert.equal(d.localModel?.id, 'deepseek-r1:14b');
  assert.equal(d.localProviderId, 'local');
  assert.equal(d.fallbackRecommended, false);
});

test('does NOT hard-code a family: whatever real local model ranks best under the hints wins', async () => {
  const f = fleet([localProvider()], [model('qwen2.5-coder', { tier: 'balanced' }), model('llama-generic', { tier: 'balanced', capabilities: { chat: true, vision: false, tools: true, embedding: false, reasoning: false, coding: false, insert: false } })]);
  const ranked = rankLocalModels((await f.snapshot()).providers, { preferCoding: true });
  assert.equal(ranked[0]!.id, 'qwen2.5-coder', 'coding-capable model ranks above a generic one via metadata, not a name');
});

test('policy that prefers cloud still selects local + flags fallbackRecommended (no cloud invoked)', async () => {
  const f = fleet([localProvider(), cloudProvider(true)], [model('local-coder')], { ANTHROPIC_API_KEY: 'present' });
  const d = await selectLocalCoding({ fleet: f, engine, policy: 'cloud-first' }, { preferCoding: true });
  assert.equal(d.localModel?.id, 'local-coder', 'executes best local');
  assert.equal(d.fallbackRecommended, true);
  assert.ok(d.fallbackReasons.some((r) => /prefers a cloud|ranks a cloud/.test(r)));
});

test('no eligible local model → localModel null + fallbackRecommended (still no cloud)', async () => {
  const f = fleet([localProvider(), cloudProvider(true)], [], { ANTHROPIC_API_KEY: 'present' });
  const d = await selectLocalCoding({ fleet: f, engine, policy: 'auto' }, { preferCoding: true });
  assert.equal(d.localModel, null);
  assert.equal(d.fallbackRecommended, true);
  assert.ok(d.fallbackReasons.some((r) => /no eligible local model/.test(r)));
});

test('local-only policy: cloud never appears; local chosen', async () => {
  const f = fleet([localProvider(), cloudProvider(true)], [model('local-coder')], { ANTHROPIC_API_KEY: 'present' });
  const d = await selectLocalCoding({ fleet: f, engine, policy: 'local-only' }, { preferCoding: true });
  assert.equal(d.localModel?.id, 'local-coder');
  assert.equal(d.fallbackRecommended, false);
  assert.ok(d.plan.excluded.some((e) => e.providerId === 'anthropic'));
});

test('assessCodingOutcome flags empty / refusal / low-signal, passes real output', () => {
  assert.equal(assessCodingOutcome({ output: '' }).fallbackRecommended, true);
  assert.equal(assessCodingOutcome({ output: "I can't help with that." }).fallbackRecommended, true);
  assert.equal(assessCodingOutcome({ output: 'ok' }).fallbackRecommended, true); // below signal
  assert.equal(assessCodingOutcome({ output: 'x', failed: true }).fallbackRecommended, true);
  const good = assessCodingOutcome({ output: 'Here is the corrected function with the null-check added on line 42 and a test.' });
  assert.equal(good.ok, true);
  assert.equal(good.fallbackRecommended, false);
});
