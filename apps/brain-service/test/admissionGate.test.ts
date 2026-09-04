// The gate: enforcement, and the properties that only exist because it is ONE
// component rather than a block copied into each route.
//
// 🚨 THE PROBE CONSUMES THE RESOURCE IT MEASURES. A one-token generation against a
// contended card is more load on the thing that is already the problem. So the
// cache and the single-flight latch are not optimisations — they are what stops
// monitoring from becoming the outage. They are tested as behaviour, with the
// clock and fetch both injected, so neither depends on real time or a real GPU.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AdmissionGate } from '../src/engine/admission/gate.js';
import { admissionCounters, resetAdmissionCounters } from '../src/engine/admission/telemetry.js';

const BASE = { providerBaseUrl: 'http://gpu:11434/v1', studioBaseUrl: 'http://gpu:8188', enabled: true };
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });

/** Counts every call, so probe amplification is measurable rather than assumed. */
function card(opts: { resident?: string; running?: number; generate?: 'ok' | 'hang'; studio?: 'up' | 'down' }) {
  const calls: string[] = [];
  const impl: typeof fetch = (async (url: any, init?: any) => {
    const href = String(url);
    calls.push(href.replace(/^https?:\/\/[^/]+/, ''));
    if (href.includes('/api/ps')) {
      return json({ models: opts.resident ? [{ name: opts.resident, size_vram: 15.3e9 }] : [] });
    }
    if (href.includes('/api/generate')) {
      if (opts.generate === 'hang') {
        return await new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
      }
      return json({ response: '.', done: true });
    }
    if (opts.studio === 'down') throw new Error('unreachable');
    if (href.includes('/queue')) return json({ queue_running: opts.running ? [['j', 1]] : [], queue_pending: [] });
    if (href.includes('/system_stats')) return json({ devices: [{ vram_free: 1.2e9, vram_total: 25.8e9 }] });
    throw new Error('unreachable');
  }) as typeof fetch;
  return { impl, calls };
}

test('a contended card refuses, with a code and a reason an operator can aggregate', async () => {
  const { impl } = card({ resident: 'coder:14b', studio: 'down', generate: 'hang' });
  const gate = new AdmissionGate({ ...BASE, fetchImpl: impl, thresholds: { computeTimeoutMs: 30 } });
  const d = await gate.admit({ model: 'coder:14b' });
  assert.equal(d.outcome, 'refused');
  assert.equal(d.code, 'GPU_BUSY');
  assert.equal(d.reason, 'compute-starved');
  assert.match(String(d.message), /Nothing was lost/);
});

test('concurrent turns share ONE probe — the gate must not amplify contention', async () => {
  const { impl, calls } = card({ resident: 'coder:14b', running: 1, generate: 'ok' });
  const gate = new AdmissionGate({ ...BASE, fetchImpl: impl });
  const results = await Promise.all(Array.from({ length: 8 }, () => gate.admit({ model: 'coder:14b' })));
  assert.equal(results.every((r) => r.outcome === 'admitted'), true);
  assert.equal(calls.filter((c) => c.includes('/api/generate')).length, 1,
    `8 concurrent turns issued ${calls.filter((c) => c.includes('/api/generate')).length} generations at a contended card`);
});

test('a reading is reused within its TTL, and re-probed after it', async () => {
  let now = 1_000;
  const { impl, calls } = card({ resident: 'coder:14b', running: 1, generate: 'ok' });
  const gate = new AdmissionGate({ ...BASE, fetchImpl: impl, now: () => now, thresholds: { cacheTtlMs: 3_000 } });

  const first = await gate.admit({ model: 'coder:14b' });
  assert.equal(first.cached, false);
  const probes = () => calls.filter((c) => c.includes('/api/ps')).length;
  assert.equal(probes(), 1);

  now += 2_000; // inside the TTL
  const second = await gate.admit({ model: 'coder:14b' });
  assert.equal(second.cached, true);
  assert.equal(second.ageMs, 2_000, 'staleness is reported, never hidden');
  assert.equal(probes(), 1, 'no second probe inside the TTL');

  now += 2_000; // past it
  const third = await gate.admit({ model: 'coder:14b' });
  assert.equal(third.cached, false);
  assert.equal(probes(), 2);
});

/*
 * FAIL-OPEN IS NARROW, AND THE BOUNDARY IS WORTH PINNING.
 *
 * An inference server that does not answer is a positively detected OUTAGE, and
 * refusing it fast is the honest result — every turn would fail anyway, slowly.
 * Failing open applies to `unknown`: signals we could not read at all. Writing
 * these as one test conflated them, which is how a safety gate quietly turns into
 * a gate that never fires.
 */
test('a detected outage refuses fast — it does not pretend to be unknown', async () => {
  const impl: typeof fetch = (async () => { throw new Error('everything is down'); }) as typeof fetch;
  const gate = new AdmissionGate({ ...BASE, fetchImpl: impl });
  const d = await gate.admit({ model: 'coder:14b' });
  assert.equal(d.outcome, 'refused');
  assert.equal(d.code, 'ENGINE_UNAVAILABLE');
  assert.equal(d.reason, 'inference-unreachable');
  assert.match(String(d.message), /not reachable/);
});

test('a studio outage alone does NOT refuse — the card is still asked', async () => {
  // Only the render-visibility probe is down. That is monitoring, not inference,
  // so the turn proceeds on the strength of the card actually answering.
  const { impl } = card({ resident: 'coder:14b', studio: 'down', generate: 'ok' });
  const gate = new AdmissionGate({ ...BASE, fetchImpl: impl });
  const d = await gate.admit({ model: 'coder:14b' });
  assert.equal(d.outcome, 'admitted');
  assert.equal(d.reason, 'compute-verified');
});

test('with no provider configured at all, nothing is probed and the turn proceeds', async () => {
  const { impl, calls } = card({});
  const gate = new AdmissionGate({ enabled: true, fetchImpl: impl });
  const d = await gate.admit({ model: 'coder:14b' });
  assert.equal(d.outcome, 'admitted');
  assert.equal(d.reason, 'signals-unreadable');
  assert.deepEqual(calls, [], 'no base URL means no probe, not a failed one');
});

test('a disabled gate admits without touching the network', async () => {
  const { impl, calls } = card({ resident: 'coder:14b', running: 1, generate: 'hang' });
  const gate = new AdmissionGate({ ...BASE, enabled: false, fetchImpl: impl });
  const d = await gate.admit({ model: 'coder:14b' });
  assert.equal(d.outcome, 'admitted');
  assert.equal(d.reason, 'not-applicable');
  assert.deepEqual(calls, [], 'a stub deployment must not depend on a workstation being awake');
});

test('a synchronously throwing fetch is still contained, never propagated', async () => {
  // The gate sits in front of every turn, so an exception escaping it would be an
  // outage of its own. It must always RETURN a decision, whatever it was handed.
  const exploding: typeof fetch = (() => { throw new Error('boom'); }) as unknown as typeof fetch;
  const gate = new AdmissionGate({ ...BASE, fetchImpl: exploding });
  const d = await gate.admit({ model: 'coder:14b' });
  assert.ok(['admitted', 'refused'].includes(d.outcome), 'a decision, not a thrown error');
  assert.ok(d.reason, 'and always an attributable reason');
});

test('telemetry counts by REASON, not just by state', async () => {
  resetAdmissionCounters();
  const busy = card({ resident: 'coder:14b', studio: 'down', generate: 'hang' });
  await new AdmissionGate({ ...BASE, fetchImpl: busy.impl, thresholds: { computeTimeoutMs: 20 } }).admit({ model: 'coder:14b' });
  const idle = card({ resident: 'coder:14b', generate: 'ok' });
  await new AdmissionGate({ ...BASE, fetchImpl: idle.impl }).admit({ model: 'coder:14b' });

  const c = admissionCounters();
  assert.equal(c.refused, 1);
  assert.equal(c.admitted, 1);
  assert.equal(c.byReason['compute-starved'], 1);
  assert.equal(c.byReason['resident-idle'], 1);
  assert.equal(c.computeProbe.count, 1, 'probe latency is tracked so a rising trend shows before it refuses');
  assert.equal(c.last?.outcome, 'admitted');
  resetAdmissionCounters();
});
