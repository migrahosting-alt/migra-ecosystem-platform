import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  probeGpuCapacity, shouldRefuse, BUSY_MESSAGE, UNAVAILABLE_MESSAGE,
} from '../src/engine/capacity/gpuCapacity.js';

const GB = 1024 * 1024 * 1024;

/** A fetch double keyed by path suffix; anything unlisted 404s. */
function serve(routes: Record<string, unknown>, failing: string[] = []): typeof fetch {
  return (async (url: any) => {
    const href = String(url);
    for (const f of failing) if (href.includes(f)) throw new Error('unreachable');
    for (const [suffix, body] of Object.entries(routes)) {
      if (href.endsWith(suffix)) {
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
}

const BASE = { providerBaseUrl: 'http://gpu:11434/v1', studioBaseUrl: 'http://gpu:8188' };
const idle = { queue_running: [], queue_pending: [] };
const busyQueue = { queue_running: [['job', 1]], queue_pending: [] };
const roomy = { devices: [{ vram_free: 24.4e9, vram_total: 25.8e9 }] };
const tight = { devices: [{ vram_free: 1.2e9, vram_total: 25.8e9 }] };

test('a free card with room is ready', async () => {
  const r = await probeGpuCapacity({
    ...BASE, model: 'qwen2.5vl:7b',
    fetchImpl: serve({ '/api/ps': { models: [] }, '/queue': idle, '/system_stats': roomy }),
  });
  assert.equal(r.state, 'ready');
  assert.equal(shouldRefuse(r), false);
});

/*
 * The defect itself. A ComfyUI render owns the card, the turn needs a cold load
 * behind it, and the old code would have submitted anyway because /models
 * answers fine.
 */
test('a running render makes a cold-load turn busy, not ready', async () => {
  const r = await probeGpuCapacity({
    ...BASE, model: 'qwen2.5vl:7b',
    fetchImpl: serve({ '/api/ps': { models: [] }, '/queue': busyQueue, '/system_stats': roomy }),
  });
  assert.equal(r.state, 'busy');
  assert.equal(shouldRefuse(r), true);
  assert.equal(r.message, BUSY_MESSAGE);
  // The user is told their work did NOT start. A spinner implies the opposite.
  assert.match(r.message!, /has not started/);
  assert.equal(r.signals.comfyRunning, 1);
});

/*
 * The line that keeps this from being a blunt "GPU busy => refuse". A model
 * already in VRAM answered in 0.29 s while a render was running; refusing there
 * would deny work the card can demonstrably do.
 */
test('an ALREADY-RESIDENT model stays ready even while a render runs', async () => {
  const r = await probeGpuCapacity({
    ...BASE, model: 'qwen2.5vl:7b',
    fetchImpl: serve({
      '/api/ps': { models: [{ name: 'qwen2.5vl:7b', size_vram: 13.5e9 }] },
      '/queue': busyQueue, '/system_stats': tight,
    }),
  });
  assert.equal(r.state, 'ready');
  assert.equal(r.signals.modelResident, true);
});

test('no headroom for a cold load is busy', async () => {
  const r = await probeGpuCapacity({
    ...BASE, model: 'qwen2.5vl:7b',
    fetchImpl: serve({ '/api/ps': { models: [] }, '/queue': idle, '/system_stats': tight }),
  });
  assert.equal(r.state, 'busy');
  assert.ok(r.signals.vramFreeBytes! < 14 * GB);
});

test('an unreachable inference server is unavailable, not busy', async () => {
  const r = await probeGpuCapacity({
    ...BASE, model: 'qwen2.5vl:7b',
    fetchImpl: serve({ '/queue': idle, '/system_stats': roomy }, ['/api/ps']),
  });
  assert.equal(r.state, 'unavailable');
  assert.equal(r.message, UNAVAILABLE_MESSAGE);
  // Telling someone to retry in a moment would be wrong: nothing is going to
  // free up, the engine is down.
  assert.notEqual(r.message, BUSY_MESSAGE);
});

/*
 * FAILS OPEN, on purpose. A monitoring outage must never become a chat outage —
 * the bounded first-token deadline is what protects this turn instead.
 */
test('unreadable probes are unknown and do NOT refuse', async () => {
  const r = await probeGpuCapacity({
    studioBaseUrl: 'http://gpu:8188',
    fetchImpl: serve({}, ['/queue', '/system_stats']),
  });
  assert.equal(r.state, 'unknown');
  assert.equal(shouldRefuse(r), false);
});

test('a probe that hangs does not hang the turn', async () => {
  const started = Date.now();
  const r = await probeGpuCapacity({
    ...BASE, timeoutMs: 150,
    fetchImpl: (async (_u: any, init: any) => new Promise((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
    })) as typeof fetch,
  });
  assert.equal(r.state, 'unavailable');
  assert.ok(Date.now() - started < 2_000, 'the probe budget is enforced');
});

test('the model name matches with or without an explicit tag', async () => {
  for (const asked of ['qwen2.5vl', 'qwen2.5vl:7b']) {
    const r = await probeGpuCapacity({
      ...BASE, model: asked,
      fetchImpl: serve({
        '/api/ps': { models: [{ name: 'qwen2.5vl:7b' }] }, '/queue': busyQueue, '/system_stats': tight,
      }),
    });
    assert.equal(r.state, 'ready', asked);
  }
});

/*
 * THE MEASURED CASE THAT NEARLY GOT THROUGH.
 *
 * A genuinely pinned card — 23.2 GB of models resident, ~1 GB actually free —
 * and ComfyUI still reported 14.2 GB free. Trusting that number alone calls this
 * card ready and submits a turn it cannot serve, which is the original defect.
 *
 * Residency arithmetic is exact, so the pessimistic estimate is what decides.
 */
test('a pinned card is busy even when ComfyUI claims 14.2 GB free', async () => {
  const r = await probeGpuCapacity({
    ...BASE, model: 'qwen2.5vl:7b',
    fetchImpl: serve({
      '/api/ps': { models: [{ name: 'deepseek-r1:32b', size_vram: 23.2e9 }] },
      '/queue': idle,
      '/system_stats': { devices: [{ vram_free: 14.2e9, vram_total: 25.77e9 }] },
    }),
  });
  assert.equal(r.state, 'busy');
  // ~2.6 GB by residency, not the 14.2 GB ComfyUI advertised.
  assert.ok(r.signals.effectiveFreeBytes! < 3e9, 'the pessimistic estimate is used');
  assert.equal(r.signals.vramFreeBytes, 14.2e9, 'the optimistic figure is still reported');
});

test('the optimistic figure still wins when IT is the lower one', async () => {
  // Neither signal is trusted over the other: whichever says less room decides.
  const r = await probeGpuCapacity({
    ...BASE, model: 'qwen2.5vl:7b',
    fetchImpl: serve({
      '/api/ps': { models: [] },
      '/queue': idle,
      '/system_stats': { devices: [{ vram_free: 2e9, vram_total: 25.77e9 }] },
    }),
  });
  assert.equal(r.state, 'busy');
  assert.equal(r.signals.effectiveFreeBytes, 2e9);
});
