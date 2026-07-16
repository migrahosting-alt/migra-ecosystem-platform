import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import type { ChatTurnRequest } from '@migrapilot/shared-types';
import type { BrainEnv } from '../src/config/env.js';
import { ProviderRegistry } from '../src/providers/providerRegistry.js';
import { selectEffectiveProfile } from '../src/providers/selectProvider.js';
import { registerAiRoutes } from '../src/engine/aiRoutes.js';

// Proves the /api/ai/* migration is ADDITIVE and REVERSIBLE: the new engine
// facade and the legacy /chat endpoint coexist on the same server, each working
// independently. Uses Fastify inject() (no socket) + the deterministic stub
// backend, so no inference provider is required.

const STUB_ENV: BrainEnv = {
  host: '127.0.0.1',
  port: 0,
  mode: 'hybrid',
  enableTelemetry: false,
  localProvider: 'stub',
  providerBaseUrl: 'http://127.0.0.1:11434/v1',
  visionModel: 'llava:latest',
};

function buildApp() {
  const app = Fastify();
  // Legacy /chat — mirrors server.ts handleChat (kept as a compatibility path).
  const registry = new ProviderRegistry(STUB_ENV);
  app.post('/chat', async (request) => {
    const input = request.body as ChatTurnRequest;
    const profile = selectEffectiveProfile(input.modelProfile, STUB_ENV);
    return registry.get(profile).complete({ ...input, modelProfile: profile });
  });
  // New engine facade.
  registerAiRoutes(app, STUB_ENV);
  return app;
}

const CHAT_REQUEST = {
  feature: 'chat',
  modelProfile: 'cheap',
  systemPromptId: 'chat-chat-v1',
  userPrompt: 'hello',
  context: {},
  outputMode: 'markdown',
};

test('legacy POST /chat still works independently (compatibility path)', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'POST', url: '/chat', payload: CHAT_REQUEST });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { content?: string; modelProfile?: string };
  assert.ok(body.content && body.content.length > 0, 'legacy /chat returns content');
  await app.close();
});

test('new GET /api/ai/models works alongside legacy /chat', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/api/ai/models' });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { count: number; models: Array<{ id: string }> };
  assert.ok(body.count >= 1);
  await app.close();
});

test('new POST /api/ai/chat (buffered) works alongside legacy /chat', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { prompt: 'hello', tier: 'fast' } });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { ok: boolean; content?: string; model?: string };
  assert.equal(body.ok, true);
  assert.ok(body.content && body.content.length > 0);
  await app.close();
});

test('both endpoints answer on the SAME server instance (additive, reversible)', async () => {
  const app = buildApp();
  const legacy = await app.inject({ method: 'POST', url: '/chat', payload: CHAT_REQUEST });
  const engine = await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { prompt: 'hello' } });
  assert.equal(legacy.statusCode, 200);
  assert.equal(engine.statusCode, 200);
  await app.close();
});
