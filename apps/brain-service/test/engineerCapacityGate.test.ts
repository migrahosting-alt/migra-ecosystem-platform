// The coding agent must not spend the user's four minutes on a card that is busy.
//
// MEASURED 2026-09-03. A build-from-mockup turn sat for the full 240 s provider
// deadline and returned a generic failure, while a ComfyUI render held the GPU.
// The chat path had gated on capacity for a while; THIS path — the coding agent,
// which is the product — never consulted it at all.
//
// The shape reproduced here is the live one: the model IS resident, and ComfyUI's
// /queue has gone silent because a long node execution is blocking its event loop.
// Both of those individually look benign, which is exactly why the turn proceeded.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { registerEngineerRoutes } from '../src/engine/engineerRoutes.js';
import { registerToolExecutionRoutes } from '../src/engine/toolRoutes.js';
import { ModelRegistry, type ModelDescriptor } from '../src/engine/modelRegistry.js';
import type { ProviderAdapter } from '../src/providers/providerRegistry.js';

/** `openai-compat` is what makes the route treat the GPU as real and probe it. */
const REAL_ENV = {
  localProvider: 'openai-compat',
  providerBaseUrl: 'http://gpu:11434/v1',
  openAiApiKey: undefined,
  providerConnectTimeoutMs: 1_000,
} as never;

function model(id: string): ModelDescriptor {
  return { id, provider: 'local', capabilities: { chat: true, vision: false, tools: true, embedding: false, reasoning: true, coding: true, insert: false }, tier: 'balanced' };
}

function frames(body: string): Array<{ event: string; data: Record<string, unknown> }> {
  const out: Array<{ event: string; data: Record<string, unknown> }> = [];
  for (const block of body.split('\n\n')) {
    const ev = /event: (.+)/.exec(block);
    const da = /data: (.+)/.exec(block);
    if (ev && da) { try { out.push({ event: ev[1]!, data: JSON.parse(da[1]!) }); } catch { /* skip */ } }
  }
  return out;
}

/** Records whether the model was ever asked to do anything. */
function countingAdapter(calls: string[]): ProviderAdapter {
  return {
    name: 'stub',
    async complete() { calls.push('complete'); return { content: '{"final":"done"}', model: 'stub', usage: {} } as never; },
    async *stream() { calls.push('stream'); yield { delta: '{"final":"done"}' } as never; },
    async isAvailable() { return true; },
  } as never;
}

async function runTurn(fetchImpl: typeof fetch): Promise<{ frames: ReturnType<typeof frames>; modelCalls: string[] }> {
  const prevStudio = process.env.MIGRAPILOT_STUDIO_URL;
  const prevFetch = globalThis.fetch;
  process.env.MIGRAPILOT_STUDIO_URL = 'http://studio:8188';
  globalThis.fetch = fetchImpl;
  try {
    const calls: string[] = [];
    const app = Fastify({ logger: false });
    const toolDeps = registerToolExecutionRoutes(app);
    registerEngineerRoutes(
      app, REAL_ENV,
      new ModelRegistry({ sources: [], staticModels: [model('qwen2.5-coder:14b')] }),
      toolDeps, () => countingAdapter(calls),
    );
    const res = await app.inject({
      method: 'POST', url: '/api/ai/engineer',
      payload: { rootPath: mkdtempSync(tmpdir() + '/cap-'), task: 'build this page' },
    });
    await app.close();
    return { frames: frames(res.body), modelCalls: calls };
  } finally {
    globalThis.fetch = prevFetch;
    if (prevStudio === undefined) delete process.env.MIGRAPILOT_STUDIO_URL;
    else process.env.MIGRAPILOT_STUDIO_URL = prevStudio;
  }
}

/** Resident model; ComfyUI silent; generation never returns. The live shape. */
const contendedCard: typeof fetch = (async (url: any, init?: any) => {
  const href = String(url);
  if (href.includes('/api/ps')) {
    return new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:14b', size_vram: 15.3e9 }] }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (href.includes('/api/generate')) {
    return await new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
  }
  throw new Error('unreachable'); // ComfyUI /queue and /system_stats have gone silent
}) as typeof fetch;

/** Same card, but it answers a token — work it can still do must not be refused. */
const servingCard: typeof fetch = (async (url: any) => {
  const href = String(url);
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
  if (href.includes('/api/ps')) return json({ models: [{ name: 'qwen2.5-coder:14b', size_vram: 15.3e9 }] });
  if (href.includes('/api/generate')) return json({ response: '.', done: true });
  if (href.includes('/queue')) return json({ queue_running: [['job', 1]], queue_pending: [] });
  if (href.includes('/system_stats')) return json({ devices: [{ vram_free: 1.2e9, vram_total: 25.8e9 }] });
  throw new Error('unreachable');
}) as typeof fetch;

test('a contended card refuses the turn BEFORE any model call', async () => {
  const { frames: fs, modelCalls } = await runTurn(contendedCard);
  const refusal = fs.find((f) => f.event === 'refusal');
  assert.ok(refusal, `expected a refusal frame, got: ${fs.map((f) => f.event).join(', ')}`);
  assert.equal(refusal.data.code, 'GPU_BUSY');
  assert.equal(refusal.data.capacity, 'busy');
  assert.match(String(refusal.data.message), /Nothing was lost/);
  assert.deepEqual(modelCalls, [], 'the whole point: no 240s wait on a model that cannot run');
  const done = fs.find((f) => f.event === 'done');
  assert.equal(done?.data.ok, false);
  assert.equal(done?.data.code, 'GPU_BUSY');
});

test('a card that still answers is NOT refused, render or no render', async () => {
  const { frames: fs, modelCalls } = await runTurn(servingCard);
  assert.equal(fs.find((f) => f.event === 'refusal'), undefined, 'work the card can do must not be denied');
  assert.ok(modelCalls.length > 0, 'the turn must actually run');
});
