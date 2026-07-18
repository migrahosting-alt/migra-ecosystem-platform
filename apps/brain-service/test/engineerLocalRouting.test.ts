// Intelligent Provider Router — Slice 2, commit 2: engineer path local-first wiring.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { registerEngineerRoutes } from '../src/engine/engineerRoutes.js';
import { registerToolExecutionRoutes } from '../src/engine/toolRoutes.js';
import { ModelRegistry, type ModelDescriptor } from '../src/engine/modelRegistry.js';
import { FleetRegistry } from '../src/engine/providers/fleetRegistry.js';
import { ProviderRegistry } from '../src/engine/providers/providerRegistry.js';
import { PolicyEngine, type ExecutionPolicyId } from '../src/engine/providers/executionPolicy.js';
import type { LocalRoutingDeps } from '../src/engine/providers/localCodingRouter.js';
import type { Provider } from '../src/engine/providers/types.js';
import type { ProviderAdapter } from '../src/providers/providerRegistry.js';

const CAPS = { chat: true, vision: true, tools: true, embedding: true, reasoning: true, coding: true };
const STUB_ENV = { localProvider: 'stub', providerBaseUrl: '', openAiApiKey: undefined } as never;

function localProvider(): Provider {
  return { id: 'local', displayName: 'Local', kind: 'local', protocol: 'stub', capabilities: CAPS, priority: 100, cost: { inputPer1M: 0, outputPer1M: 0 }, dataLocality: 'on-device', enabled: true };
}
function cloudProvider(): Provider {
  return { id: 'anthropic', displayName: 'Claude', kind: 'cloud', protocol: 'anthropic', baseUrl: 'https://a', credentialEnv: 'ANTHROPIC_API_KEY', capabilities: { ...CAPS, embedding: false }, priority: 60, cost: { inputPer1M: 3, outputPer1M: 15 }, dataLocality: 'external', enabled: true };
}
function model(id: string): ModelDescriptor {
  return { id, provider: 'local', capabilities: { chat: true, vision: false, tools: true, embedding: false, reasoning: true, coding: true, insert: false }, tier: 'balanced' };
}
function routing(policy: ExecutionPolicyId, providers: Provider[], models: ModelDescriptor[], env: NodeJS.ProcessEnv = {}): LocalRoutingDeps {
  return { fleet: new FleetRegistry(new ProviderRegistry(providers, (n) => env[n]), new ModelRegistry({ sources: [], staticModels: models }), { now: () => 1 }), engine: new PolicyEngine(), policy };
}

/** A stub provider whose completion ends the loop with a final answer immediately. */
const stubAdapter: ProviderAdapter = {
  name: 'stub',
  async complete() {
    return { content: 'FINAL: applied the fix with a null check and a covering test.', model: 'stub', usage: { promptTokens: 1, completionTokens: 1 } } as never;
  },
  async *stream() {
    yield { delta: 'FINAL' } as never;
  },
  async isAvailable() {
    return true;
  },
} as never;

function frames(body: string): Array<{ event: string; data: Record<string, unknown> }> {
  const out: Array<{ event: string; data: Record<string, unknown> }> = [];
  for (const block of body.split('\n\n')) {
    const ev = /event: (.+)/.exec(block);
    const da = /data: (.+)/.exec(block);
    if (ev && da) { try { out.push({ event: ev[1]!, data: JSON.parse(da[1]!) }); } catch { /* skip */ } }
  }
  return out;
}

function appWith(route: LocalRoutingDeps | undefined, models: ModelDescriptor[]) {
  const app = Fastify({ logger: false });
  const toolDeps = registerToolExecutionRoutes(app);
  registerEngineerRoutes(app, STUB_ENV, new ModelRegistry({ sources: [], staticModels: models }), toolDeps, () => stubAdapter, route);
  return app;
}

test('no local model + cloud present → 503 NO_LOCAL_MODEL, fallbackRecommended, NO cloud invoked', async () => {
  const app = appWith(routing('auto', [localProvider(), cloudProvider()], [], { ANTHROPIC_API_KEY: 'present' }), []);
  const res = await app.inject({ method: 'POST', url: '/api/ai/engineer', payload: { rootPath: mkdtempSync(tmpdir() + '/eng-'), task: 'fix the bug' } });
  assert.equal(res.statusCode, 503);
  const j = res.json();
  assert.equal(j.code, 'NO_LOCAL_MODEL');
  assert.equal(j.fallbackRecommended, true);
  await app.close();
});

test('coding turn selects a LOCAL model and streams a route frame with policy + fallback flag', async () => {
  const app = appWith(routing('cloud-first', [localProvider(), cloudProvider()], [model('local-coder')], { ANTHROPIC_API_KEY: 'present' }), [model('local-coder')]);
  const res = await app.inject({ method: 'POST', url: '/api/ai/engineer', payload: { rootPath: mkdtempSync(tmpdir() + '/eng-'), task: 'fix the bug' } });
  const fr = frames(res.body);
  const route = fr.find((f) => f.event === 'route');
  assert.ok(route, 'a route frame is emitted');
  assert.equal(route!.data.model, 'local-coder', 'selected the LOCAL model, never cloud');
  assert.equal(route!.data.policy, 'cloud-first');
  assert.equal(route!.data.fallbackRecommended, true, 'cloud-first policy flags fallback but still runs local');
  const done = fr.find((f) => f.event === 'done');
  assert.ok(done && (done.data.routing as { fallbackRecommended: boolean }).fallbackRecommended === true);
  await app.close();
});

test('backward compatible: without provider routing the engineer still selects via the capability router', async () => {
  const app = appWith(undefined, [model('local-coder')]);
  const res = await app.inject({ method: 'POST', url: '/api/ai/engineer', payload: { rootPath: mkdtempSync(tmpdir() + '/eng-'), task: 'fix the bug' } });
  const route = frames(res.body).find((f) => f.event === 'route');
  assert.ok(route, 'route frame still emitted');
  assert.equal(route!.data.model, 'local-coder');
  assert.equal(route!.data.policy, undefined, 'no policy metadata when routing is not wired');
  await app.close();
});
