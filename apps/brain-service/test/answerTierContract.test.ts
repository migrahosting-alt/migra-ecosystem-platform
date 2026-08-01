// `POST /api/ai/answer` request contract.
//
// The defect: `tier: 'premium'` — a value this route has never offered — was
// accepted and silently ran locally. The caller got a plausible answer from a
// runner it did not choose, and the response said `runner: 'local'` as though
// that had been the request. Every test here is about that gap: unknown values
// are refused rather than substituted, and the response reports the runner that
// actually served the call. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import {
  ANSWER_TIERS,
  DEFAULT_ANSWER_TIER,
  registerAnswerRoutes,
  resolveRunner,
  validateAnswerRequest,
} from '../src/engine/answerRoutes.js';

const OPTS = { providerBaseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'local-model', cloudModel: 'gpt-oss:120b-cloud' };

test('the tier vocabulary is exactly local | cloud, and the default is documented', () => {
  assert.deepEqual([...ANSWER_TIERS], ['local', 'cloud']);
  assert.equal(DEFAULT_ANSWER_TIER, 'local');
});

test('an omitted tier uses the documented default and is reported as defaulted', () => {
  const r = validateAnswerRequest({ prompt: 'q', workspaceRoot: '/w' });
  assert.ok(r.ok);
  assert.equal(r.value.tier, 'local');
  assert.equal(r.value.tierSource, 'default');
  assert.deepEqual(resolveRunner(r.value, OPTS), { model: 'local-model', runner: 'local', source: 'default' });
});

test('tier: local routes locally', () => {
  const r = validateAnswerRequest({ prompt: 'q', workspaceRoot: '/w', tier: 'local' });
  assert.ok(r.ok);
  assert.equal(r.value.tierSource, 'explicit');
  assert.deepEqual(resolveRunner(r.value, OPTS), { model: 'local-model', runner: 'local', source: 'default' });
});

test('tier: cloud invokes the configured cloud path', () => {
  const r = validateAnswerRequest({ prompt: 'q', workspaceRoot: '/w', tier: 'cloud' });
  assert.ok(r.ok);
  assert.deepEqual(resolveRunner(r.value, OPTS), { model: 'gpt-oss:120b-cloud', runner: 'cloud', source: 'tier' });
});

test('tier: premium is a structured validation error — never a silent local fallback', () => {
  const r = validateAnswerRequest({ prompt: 'q', workspaceRoot: '/w', tier: 'premium' });
  assert.equal(r.ok, false);
  assert.ok(!r.ok);
  assert.equal(r.error.code, 'invalid_tier');
  assert.equal(r.error.field, 'tier');
  assert.equal(r.error.received, 'premium');
  assert.deepEqual([...(r.error.allowed ?? [])], ['local', 'cloud']);
});

test('every other invalid tier shape is refused too', () => {
  for (const bad of ['LOCAL', 'fast', 'balanced', 'deep', '', 'cloud ', 42, true, {}, []]) {
    const r = validateAnswerRequest({ prompt: 'q', workspaceRoot: '/w', tier: bad });
    assert.equal(r.ok, false, `tier ${JSON.stringify(bad)} must be refused`);
    assert.ok(!r.ok && r.error.code === 'invalid_tier', `tier ${JSON.stringify(bad)} → invalid_tier`);
  }
});

test('an explicit model overrides tier, and the runner reported follows the MODEL', () => {
  // Reporting `local` here because the caller asked for `tier: local` would be
  // describing the request, not the execution.
  const cloudByName = validateAnswerRequest({ prompt: 'q', workspaceRoot: '/w', tier: 'local', model: 'gpt-oss:120b-cloud' });
  assert.ok(cloudByName.ok);
  assert.deepEqual(resolveRunner(cloudByName.value, OPTS), { model: 'gpt-oss:120b-cloud', runner: 'cloud', source: 'explicit-model' });

  const localByName = validateAnswerRequest({ prompt: 'q', workspaceRoot: '/w', tier: 'cloud', model: 'qwen3-coder:30b' });
  assert.ok(localByName.ok);
  assert.deepEqual(resolveRunner(localByName.value, OPTS), { model: 'qwen3-coder:30b', runner: 'local', source: 'explicit-model' });
});

test('prompt and workspaceRoot keep their existing typed errors', () => {
  const noPrompt = validateAnswerRequest({ workspaceRoot: '/w' });
  assert.ok(!noPrompt.ok && noPrompt.error.code === 'BAD_REQUEST');
  const noRoot = validateAnswerRequest({ prompt: 'q' });
  assert.ok(!noRoot.ok && noRoot.error.code === 'workspace_not_open');
});

test('maxSteps is bounded rather than trusted', () => {
  for (const bad of [0, -1, 33, 2.5, 'eight']) {
    const r = validateAnswerRequest({ prompt: 'q', workspaceRoot: '/w', maxSteps: bad });
    assert.ok(!r.ok && r.error.code === 'invalid_max_steps', `maxSteps ${String(bad)} refused`);
  }
  const ok = validateAnswerRequest({ prompt: 'q', workspaceRoot: '/w', maxSteps: 4 });
  assert.ok(ok.ok && ok.value.maxSteps === 4);
});

test('over HTTP: an unknown tier is a 400 that names the allowed set', async () => {
  const app = Fastify();
  registerAnswerRoutes(app, OPTS);
  await app.ready();
  try {
    const res = await app.inject({ method: 'POST', url: '/api/ai/answer', payload: { prompt: 'q', workspaceRoot: '/tmp', tier: 'premium' } });
    assert.equal(res.statusCode, 400);
    const body = res.json() as { ok: boolean; code: string; allowed: string[]; received: string; traceId: string };
    assert.equal(body.ok, false);
    assert.equal(body.code, 'invalid_tier');
    assert.equal(body.received, 'premium');
    assert.deepEqual(body.allowed, ['local', 'cloud']);
    assert.ok(body.traceId.length > 0, 'the refusal is correlated');
  } finally {
    await app.close();
  }
});
