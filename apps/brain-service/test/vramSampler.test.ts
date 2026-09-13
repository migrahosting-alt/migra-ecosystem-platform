import { test } from 'node:test';
import assert from 'node:assert/strict';

import { profile, startSampling, type VramSample } from '../src/eval/vramSampler.js';

const s = (modelBytes: number, totalBytes = modelBytes, residentModels = modelBytes > 0 ? 1 : 0): VramSample =>
  ({ atMs: 0, modelBytes, totalBytes, residentModels });

test('🚨 peak is measured, not guessed from one late sample', () => {
  // The old harness sampled once AFTER generation and recorded 0 for a model
  // that had peaked at 15.9 GB and then unloaded.
  const p = profile([s(0), s(15_900_000_000), s(15_900_000_000), s(0)]);
  assert.equal(p.peakModelBytes, 15_900_000_000);
  assert.equal(p.residencyRatio, 0.5);
});

test('🚨 load/unload churn is visible, which a single sample cannot show', () => {
  // qwen3:8b: resident, gone, resident again — the cause of its 35x latency spread.
  const p = profile([s(11_000_000_000), s(0), s(11_000_000_000)]);
  assert.equal(p.transitions, 2);
});

test('a stable model shows no transitions', () => {
  assert.equal(profile([s(15e9), s(15e9), s(15e9)]).transitions, 0);
});

test('sharing the device with another workload is recorded', () => {
  const p = profile([{ atMs: 0, modelBytes: 15e9, totalBytes: 22e9, residentModels: 2 }]);
  assert.equal(p.sharedDevice, true);
  assert.equal(p.maxOtherModels, 1);
  assert.equal(p.peakTotalBytes, 22e9);
});

test('minimum-while-resident ignores the unloaded samples', () => {
  const p = profile([s(0), s(12e9), s(15e9), s(0)]);
  assert.equal(p.minModelBytesWhileResident, 12e9);
});

test('no samples produces no claims', () => {
  const p = profile([]);
  assert.equal(p.peakModelBytes, 0);
  assert.equal(p.minModelBytesWhileResident, null);
  assert.equal(p.residencyRatio, 0);
});

test('🚨 a FAILED read is dropped, never recorded as zero', async () => {
  // One unreachable poll mid-generation would otherwise invent an unload,
  // fabricating a transition and dragging residency down.
  let n = 0;
  const handle = startSampling(async () => {
    n += 1;
    if (n === 2) throw new Error('unreachable');
    return s(15e9);
  }, 5);
  await new Promise((r) => setTimeout(r, 60));
  const samples = handle.stop();
  assert.ok(samples.length >= 2, 'sampling should have collected several');
  assert.ok(samples.every((x) => x.modelBytes === 15e9), 'a dropped read must not appear as 0');
  assert.equal(profile(samples).transitions, 0, 'no phantom unload');
});
