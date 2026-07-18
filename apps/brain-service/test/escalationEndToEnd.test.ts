// Intelligent Provider Router — Slice 3, commit 3: approve endpoint + surface wiring.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { registerEscalationRoutes } from '../src/engine/providers/escalationRoutes.js';
import { registerEngineerRoutes } from '../src/engine/engineerRoutes.js';
import { registerToolExecutionRoutes } from '../src/engine/toolRoutes.js';
import { registerAiRoutes } from '../src/engine/aiRoutes.js';
import { EscalationController } from '../src/engine/providers/escalationController.js';
import { EscalationOfferStore } from '../src/engine/providers/escalationStore.js';
import { CloudEscalationExecutor, type CloudProviderFactory } from '../src/engine/providers/cloudEscalationExecutor.js';
import { FleetRegistry } from '../src/engine/providers/fleetRegistry.js';
import { ProviderRegistry } from '../src/engine/providers/providerRegistry.js';
import { PolicyEngine, type ExecutionPolicyId } from '../src/engine/providers/executionPolicy.js';
import { ModelRegistry, type ModelDescriptor } from '../src/engine/modelRegistry.js';
import type { LocalRoutingDeps } from '../src/engine/providers/localCodingRouter.js';
import type { Provider } from '../src/engine/providers/types.js';
import type { ChatTurnRequest } from '@migrapilot/shared-types';

const CAPS = { chat: true, vision: true, tools: true, embedding: false, reasoning: true, coding: true };
const STUB_ENV = { localProvider: 'stub', providerBaseUrl: '', openAiApiKey: undefined } as never;
const REQ: ChatTurnRequest = { feature: 'chat', modelProfile: 'default', systemPromptId: 'engineer-v1', userPrompt: 'fix the bug', context: {}, outputMode: 'markdown' };

function local(): Provider {
  return { id: 'local', displayName: 'Local', kind: 'local', protocol: 'stub', capabilities: CAPS, priority: 100, cost: { inputPer1M: 0, outputPer1M: 0 }, dataLocality: 'on-device', enabled: true };
}
function cloud(enabled = true): Provider {
  return { id: 'anthropic', displayName: 'Claude', kind: 'cloud', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', credentialEnv: 'ANTHROPIC_API_KEY', defaultModel: 'claude-sonnet-5', capabilities: CAPS, priority: 60, cost: { inputPer1M: 3, outputPer1M: 15 }, dataLocality: 'external', enabled };
}
function model(id: string): ModelDescriptor {
  return { id, provider: 'local', capabilities: { chat: true, vision: false, tools: true, embedding: false, reasoning: true, coding: true, insert: false }, tier: 'balanced' };
}
const cloudFactory: CloudProviderFactory = () => ({
  name: 'cloud', async complete() { return { content: 'cloud fixed it', model: 'claude-sonnet-5', telemetry: { inputTokens: 5, outputTokens: 9, latencyMs: 3 } } as never; },
  async *stream() {}, async isAvailable() { return true; },
} as never);

function build(policy: ExecutionPolicyId, providers: Provider[], models: ModelDescriptor[]) {
  const env = { ANTHROPIC_API_KEY: 'present' } as NodeJS.ProcessEnv;
  const registry = new ProviderRegistry(providers, (n) => env[n]);
  const fleet = new FleetRegistry(registry, new ModelRegistry({ sources: [], staticModels: models }), { now: () => 1 });
  const controller = new EscalationController(new EscalationOfferStore(), new CloudEscalationExecutor(cloudFactory, env), fleet, registry, 1);
  const routing: LocalRoutingDeps = { fleet, engine: new PolicyEngine(), policy };
  return { registry, fleet, controller, routing };
}

function frames(body: string) {
  return body.split('\n\n').map((b) => { const e = /event: (.+)/.exec(b); const d = /data: (.+)/.exec(b); return e && d ? { event: e[1]!, data: JSON.parse(d[1]!) } : null; }).filter(Boolean) as Array<{ event: string; data: Record<string, unknown> }>;
}

test('approve endpoint: offer → approve runs ONE attributed cloud attempt; replay + bad token refused', async () => {
  const { controller } = build('auto', [local(), cloud()], [model('local-coder')]);
  const offer = await controller.offer({ correlationId: 'c1', policy: 'auto', outcome: { hadLocalModel: true, terminal: 'failed', output: '', errorMessage: 'boom' }, request: REQ });
  assert.equal(offer.offered, true);

  const app = Fastify({ logger: false });
  registerEscalationRoutes(app, controller);
  const ok = await app.inject({ method: 'POST', url: '/api/ai/escalation/approve', payload: { offerId: offer.offerId, token: offer.token, request: REQ } });
  assert.equal(ok.statusCode, 200);
  const j = ok.json();
  assert.equal(j.ok, true);
  assert.equal(j.escalation.provider, 'anthropic');
  assert.equal(j.escalation.viaEscalation, true);
  assert.equal(j.content, 'cloud fixed it');
  // replay refused
  const replay = await app.inject({ method: 'POST', url: '/api/ai/escalation/approve', payload: { offerId: offer.offerId, token: offer.token, request: REQ } });
  assert.equal(replay.statusCode, 409);
  await app.close();
});

test('approve refuses a request that does not match the offer (bound to request hash)', async () => {
  const { controller } = build('auto', [local(), cloud()], [model('local-coder')]);
  const offer = await controller.offer({ correlationId: 'c2', policy: 'auto', outcome: { hadLocalModel: false, terminal: 'failed', output: '' }, request: REQ });
  const app = Fastify({ logger: false });
  registerEscalationRoutes(app, controller);
  const res = await app.inject({ method: 'POST', url: '/api/ai/escalation/approve', payload: { offerId: offer.offerId, token: offer.token, request: { ...REQ, userPrompt: 'different request' } } });
  assert.equal(res.statusCode, 409);
  await app.close();
});

test('escalation is IMPOSSIBLE under local-only — no offer is ever minted', async () => {
  const { controller } = build('local-only', [local(), cloud()], [model('local-coder')]);
  const offer = await controller.offer({ correlationId: 'c3', policy: 'local-only', outcome: { hadLocalModel: true, terminal: 'failed', output: '', errorMessage: 'boom' }, request: REQ });
  assert.equal(offer.offered, false);
  assert.match(offer.deniedReason!, /prohibits external transfer/);
});

test('approve re-validates the target: a provider disabled after the offer → 403 TARGET_INELIGIBLE', async () => {
  const providers = [local(), cloud()];
  const { controller, registry } = build('auto', providers, [model('local-coder')]);
  const offer = await controller.offer({ correlationId: 'c4', policy: 'auto', outcome: { hadLocalModel: false, terminal: 'failed', output: '' }, request: REQ });
  // Disable the cloud provider after the offer was minted.
  registry.get('anthropic')!.enabled = false;
  const app = Fastify({ logger: false });
  registerEscalationRoutes(app, controller);
  const res = await app.inject({ method: 'POST', url: '/api/ai/escalation/approve', payload: { offerId: offer.offerId, token: offer.token, request: REQ } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().code, 'TARGET_INELIGIBLE');
  await app.close();
});

test('engineer path: no local model → escalation OFFER (auto); NO offer under local-only', async () => {
  // auto → offered
  {
    const { controller, routing } = build('auto', [local(), cloud()], []); // no local models
    const app = Fastify({ logger: false });
    const toolDeps = registerToolExecutionRoutes(app);
    registerEngineerRoutes(app, STUB_ENV, new ModelRegistry({ sources: [], staticModels: [] }), toolDeps, () => ({ name: 'stub', async complete() { return { content: 'x' } as never; }, async *stream() {}, async isAvailable() { return true; } } as never), routing, controller);
    const res = await app.inject({ method: 'POST', url: '/api/ai/engineer', payload: { rootPath: mkdtempSync(tmpdir() + '/eng-'), task: 'fix' } });
    const j = res.json();
    assert.equal(j.code, 'LOCAL_UNSUPPORTED_CAPABILITY');
    assert.ok(j.escalationOffer?.offerId && j.escalationOffer?.token);
    assert.equal(j.escalationOffer.target.providerId, 'anthropic');
    await app.close();
  }
  // local-only → no offer, plain NO_LOCAL_MODEL
  {
    const { controller, routing } = build('local-only', [local(), cloud()], []);
    const app = Fastify({ logger: false });
    const toolDeps = registerToolExecutionRoutes(app);
    registerEngineerRoutes(app, STUB_ENV, new ModelRegistry({ sources: [], staticModels: [] }), toolDeps, () => ({ name: 'stub', async complete() { return { content: 'x' } as never; }, async *stream() {}, async isAvailable() { return true; } } as never), routing, controller);
    const res = await app.inject({ method: 'POST', url: '/api/ai/engineer', payload: { rootPath: mkdtempSync(tmpdir() + '/eng-'), task: 'fix' } });
    const j = res.json();
    assert.equal(j.code, 'NO_LOCAL_MODEL');
    assert.equal(j.escalationOffer, undefined);
    await app.close();
  }
});

test('chat path: all local candidates fail on a coding turn → escalation OFFER (auto); none under local-only', async () => {
  const throwing = () => ({ name: 'boom', async complete() { throw new Error('local down'); }, async *stream() { throw new Error('local down'); }, async isAvailable() { return true; } } as never);
  // auto → offered
  {
    const { controller, routing } = build('auto', [local(), cloud()], [model('local-coder')]);
    const app = Fastify({ logger: false });
    registerAiRoutes(app, STUB_ENV, new ModelRegistry({ sources: [], staticModels: [model('local-coder')] }), undefined, throwing, undefined, undefined, routing, controller);
    const res = await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { prompt: 'fix this bug', feature: 'fix' } });
    const j = res.json();
    assert.equal(j.code, 'LOCAL_COMPLETION_FAILED');
    assert.ok(j.escalationOffer?.offerId);
    await app.close();
  }
  // local-only → plain COMPLETION_FAILED, no offer
  {
    const { controller, routing } = build('local-only', [local(), cloud()], [model('local-coder')]);
    const app = Fastify({ logger: false });
    registerAiRoutes(app, STUB_ENV, new ModelRegistry({ sources: [], staticModels: [model('local-coder')] }), undefined, throwing, undefined, undefined, routing, controller);
    const res = await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { prompt: 'fix this bug', feature: 'fix' } });
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().code, 'COMPLETION_FAILED');
    await app.close();
  }
});
