// Intelligent Provider Router — Slice 2, commit 3: /api/ai/chat coding path.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { registerAiRoutes } from '../src/engine/aiRoutes.js';
import { ModelRegistry, type ModelDescriptor } from '../src/engine/modelRegistry.js';
import { StubProvider } from '../src/providers/providerRegistry.js';
import { FleetRegistry } from '../src/engine/providers/fleetRegistry.js';
import { ProviderRegistry } from '../src/engine/providers/providerRegistry.js';
import { PolicyEngine, type ExecutionPolicyId } from '../src/engine/providers/executionPolicy.js';
import type { LocalRoutingDeps } from '../src/engine/providers/localCodingRouter.js';
import type { Provider } from '../src/engine/providers/types.js';

const STUB_ENV = { localProvider: 'stub', providerBaseUrl: '', openAiApiKey: undefined } as never;
const CAPS = { chat: true, vision: true, tools: true, embedding: true, reasoning: true, coding: true };

function localProvider(): Provider {
  return { id: 'local', displayName: 'Local', kind: 'local', protocol: 'stub', capabilities: CAPS, priority: 100, cost: { inputPer1M: 0, outputPer1M: 0 }, dataLocality: 'on-device', enabled: true };
}
function cloudProvider(): Provider {
  return { id: 'anthropic', displayName: 'Claude', kind: 'cloud', protocol: 'anthropic', baseUrl: 'https://a', credentialEnv: 'ANTHROPIC_API_KEY', capabilities: { ...CAPS, embedding: false }, priority: 60, cost: { inputPer1M: 3, outputPer1M: 15 }, dataLocality: 'external', enabled: true };
}
// The registry's synthetic stub model id — mirror it so fleet localIds intersect
// the capability router's ranked set.
const STUB_ID = 'stub-1';
function stubModel(): ModelDescriptor {
  return { id: STUB_ID, provider: 'local', capabilities: { chat: true, vision: true, tools: true, embedding: true, reasoning: true, coding: true, insert: false }, tier: 'balanced' };
}
function routing(policy: ExecutionPolicyId, env: NodeJS.ProcessEnv = {}): LocalRoutingDeps {
  return { fleet: new FleetRegistry(new ProviderRegistry([localProvider(), cloudProvider()], (n) => env[n]), new ModelRegistry({ sources: [], staticModels: [stubModel()] }), { now: () => 1 }), engine: new PolicyEngine(), policy };
}
function appWith(route: LocalRoutingDeps | undefined) {
  const reg = new ModelRegistry({ sources: [], staticModels: [stubModel()] });
  const app = Fastify({ logger: false });
  registerAiRoutes(app, STUB_ENV, reg, undefined, () => new StubProvider('default') as never, undefined, undefined, route);
  return app;
}

test('a CODING chat turn selects local + surfaces fallbackRecommended under a cloud-preferring policy', async () => {
  const app = appWith(routing('cloud-first', { ANTHROPIC_API_KEY: 'present' }));
  const res = await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { prompt: 'fix this bug', feature: 'fix' } });
  assert.equal(res.statusCode, 200);
  const j = res.json();
  assert.equal(j.provider, 'local', 'served by the LOCAL provider (cloud never invoked)');
  assert.equal(j.routing.policy, 'cloud-first');
  assert.equal(j.routing.fallbackRecommended, true);
  assert.ok(String(j.routing.reason).includes('local-first'));
  await app.close();
});

test('a CODING chat turn under local-first has no fallback recommendation', async () => {
  const app = appWith(routing('local-first'));
  const j = (await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { prompt: 'refactor this', feature: 'refactor' } })).json();
  assert.equal(j.routing.fallbackRecommended, false);
  // Slice 5: requested local-first; with no usable cloud provider the effective
  // policy truthfully downgrades to local-only (never a silent substitution).
  assert.equal(j.routing.requestedPolicy, 'local-first');
  assert.equal(j.routing.effectivePolicy, 'local-only');
  assert.match(String(j.routing.policyReason), /disabled or unavailable/);
  await app.close();
});

test('Slice 5: a per-request policy is applied by the server and reported requested-vs-effective', async () => {
  // cloud-first WITH a usable cloud credential stays cloud-first (still local-first architecture).
  const app = appWith(routing('local-first', { ANTHROPIC_API_KEY: 'present' }));
  const j = (await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { prompt: 'fix this', feature: 'fix', policy: 'cloud-first' } })).json();
  assert.equal(j.routing.requestedPolicy, 'cloud-first');
  assert.equal(j.routing.effectivePolicy, 'cloud-first');
  assert.equal(j.provider, 'local', 'local still runs first regardless of policy');
  await app.close();
});

test('a NON-coding chat turn is unaffected (no routing policy metadata)', async () => {
  const app = appWith(routing('cloud-first', { ANTHROPIC_API_KEY: 'present' }));
  const j = (await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { prompt: 'what is the capital of France?' } })).json();
  assert.equal(j.ok, true);
  assert.equal(j.routing.policy, undefined, 'non-coding turn carries no local-first policy metadata');
  await app.close();
});

test('backward compatible: without provider routing, chat selection is unchanged', async () => {
  const app = appWith(undefined);
  const j = (await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { prompt: 'fix this bug', feature: 'fix' } })).json();
  assert.equal(j.ok, true);
  assert.equal(j.routing.policy, undefined);
  await app.close();
});

test('streaming coding turn emits fallbackRecommended in the done frame', async () => {
  const app = appWith(routing('cloud-first', { ANTHROPIC_API_KEY: 'present' }));
  const res = await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { prompt: 'fix this bug', feature: 'fix', stream: true } });
  const done = res.body.split('\n\n').map((b) => { const e = /event: (.+)/.exec(b); const d = /data: (.+)/.exec(b); return e && d ? { event: e[1], data: JSON.parse(d[1]!) } : null; }).filter(Boolean).find((f) => f!.event === 'done');
  assert.ok(done, 'a done frame is emitted');
  assert.equal((done!.data as { fallbackRecommended?: boolean }).fallbackRecommended, true);
  await app.close();
});
