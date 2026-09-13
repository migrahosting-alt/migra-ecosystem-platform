/**
 * Fitting in VRAM is not fitting in the deployment.
 *
 * Every number below is measured, from the 2026-09-13 Phase 2 campaign.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkEnvelope, WORKSTATION_24GB, type DeploymentEnvelope } from '../src/eval/deploymentEnvelope.js';

const Q14B = 15_900_000_000;
const Q8B = 11_500_000_000;

test('🚨 the actual finding: qwen3:14b fits alone and cannot coexist', () => {
  const v = checkEnvelope(Q14B, WORKSTATION_24GB);
  assert.equal(v.fits, false);
  assert.equal(v.failure, 'cannot_coexist');
  assert.ok(v.headroomBytes < 0, 'the combination is over the device');
  assert.match(v.detail, /fits alone but not beside qwen3:8b/);
  assert.match(v.detail, /evict one to load the other/);
  // And it plainly does fit alone — which is exactly why per-model fit misleads.
  assert.ok(Q14B < WORKSTATION_24GB.deviceTotalBytes);
});

test('a workload that may be evicted is not a constraint', () => {
  const relaxed: DeploymentEnvelope = {
    ...WORKSTATION_24GB,
    baseline: [{ model: 'qwen3:8b', peakBytes: Q8B, mustRemainResident: false }],
  };
  assert.equal(checkEnvelope(Q14B, relaxed).fits, true);
});

test('headroom is required, not optional', () => {
  // 🚨 MiB vs decimal GB, again. The device is 24576 MiB = 25.77e9 DECIMAL bytes,
  // while model footprints are quoted in decimal GB. A 22 GB candidate therefore
  // still leaves 3.7 GB and is fine; 24.5 GB is the one with no room to work in.
  // The same unit confusion that produced "26 MB" against the product's own
  // "25 MB" in the attachment limits.
  const empty: DeploymentEnvelope = { ...WORKSTATION_24GB, baseline: [] };
  assert.equal(checkEnvelope(22_000_000_000, empty).fits, true, '22 GB genuinely fits');
  const v = checkEnvelope(24_500_000_000, empty);
  assert.equal(v.fits, false);
  assert.equal(v.failure, 'insufficient_headroom');
});

test('a candidate larger than the device fails for the simplest reason', () => {
  const v = checkEnvelope(30_000_000_000, WORKSTATION_24GB);
  assert.equal(v.failure, 'exceeds_device');
});

test('🚨 MEASUREMENT OVERRULES ARITHMETIC', () => {
  // A candidate the sums approve, measured thrashing anyway.
  const empty: DeploymentEnvelope = { ...WORKSTATION_24GB, baseline: [] };
  const v = checkEnvelope(Q8B, empty, { residencyRatio: 0.44, transitions: 55, items: 54 });
  assert.equal(v.fits, false);
  assert.equal(v.failure, 'observed_eviction');
  assert.match(v.detail, /44%/);
  assert.match(v.detail, /overrules the sums/);
});

test('arithmetic may never rescue a candidate measured thrashing', () => {
  const empty: DeploymentEnvelope = { ...WORKSTATION_24GB, baseline: [] };
  // Same candidate, clean measurement -> fits. The only difference is evidence.
  const clean = checkEnvelope(Q8B, empty, { residencyRatio: 1, transitions: 0, items: 54 });
  assert.equal(clean.fits, true);
});

test('the idle measurement alone would have approved it — which is the trap', () => {
  // 0 transitions, 100% residency: exactly what qwen3:14b showed on an idle card.
  const empty: DeploymentEnvelope = { ...WORKSTATION_24GB, baseline: [] };
  assert.equal(checkEnvelope(Q14B, empty, { residencyRatio: 1, transitions: 0, items: 54 }).fits, true);
  // The same model against the REAL envelope is refused on arithmetic alone,
  // before any measurement is consulted.
  assert.equal(checkEnvelope(Q14B, WORKSTATION_24GB).fits, false);
});
