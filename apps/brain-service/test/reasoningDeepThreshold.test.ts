/**
 * The bar, and the two things that invalidate a run rather than costing points.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DIMENSION_MINIMUMS, OVERALL_MINIMUM, verdictFor, type Dimension, type DimensionScore,
} from '../src/eval/reasoningDeep/threshold.js';
import { CASES, CASES_BY_DIMENSION } from '../src/eval/reasoningDeep/cases.js';
import {
  score, noResult, tally, isScored, coverage, MINIMUM_COVERAGE,
} from '../src/eval/outcome.js';

const all = (rate: number): DimensionScore[] =>
  (Object.keys(DIMENSION_MINIMUMS) as Dimension[]).map((d) => ({
    dimension: d, rate: d === 'negative_control' ? 1 : rate, scored: 3, notScored: 0,
  }));

test('a strong run passes', () => {
  const v = verdictFor(all(0.95), 1, MINIMUM_COVERAGE);
  assert.equal(v.passed, true);
  assert.ok((v.overall ?? 0) >= OVERALL_MINIMUM);
});

test('🚨 one failed NEGATIVE CONTROL invalidates the run, it does not cost points', () => {
  const s = all(1);
  s.find((x) => x.dimension === 'negative_control')!.rate = 0.66;
  const v = verdictFor(s, 1, MINIMUM_COVERAGE);
  assert.equal(v.passed, false);
  assert.equal(v.invalidatedBy, 'negative_control');
  // Everything else was perfect, and that is exactly the point.
  assert.match(v.reason, /degenerate strategy/);
});

test('🚨 low COVERAGE invalidates the run — an honest rate over a dishonest sample', () => {
  const v = verdictFor(all(1), 0.3, MINIMUM_COVERAGE);
  assert.equal(v.passed, false);
  assert.equal(v.invalidatedBy, 'coverage');
  assert.match(v.reason, /too small to support/);
});

test('🚨 an average must not hide a broken dimension', () => {
  const s = all(1);
  s.find((x) => x.dimension === 'absence_claims')!.rate = 0.2;
  const v = verdictFor(s, 1, MINIMUM_COVERAGE);
  assert.equal(v.passed, false);
  assert.deepEqual(v.failedFloors, ['absence_claims']);
  // The weighted overall is still high — which is why the floor exists.
  assert.ok((v.overall ?? 0) > 0.8);
});

test('🚨 an UNMEASURED dimension is never a pass', () => {
  const s = all(1);
  s.find((x) => x.dimension === 'long_context')!.rate = null;
  const v = verdictFor(s, 1, MINIMUM_COVERAGE);
  assert.equal(v.passed, false);
  assert.deepEqual(v.unmeasured, ['long_context']);
  assert.match(v.reason, /has not been cleared/);
});

test('the fabrication-adjacent dimensions carry the highest floors', () => {
  // This programme has spent a week on invented observations; the bar reflects it.
  assert.ok(DIMENSION_MINIMUMS.absence_claims >= 0.9);
  assert.ok(DIMENSION_MINIMUMS.uncertainty_calibration >= 0.85);
  assert.ok(DIMENSION_MINIMUMS.structured_under_load >= 0.85);
  assert.equal(DIMENSION_MINIMUMS.negative_control, 1);
});

/* ── outcome vs verdict ─────────────────────────────────────────────────── */

test('🚨 a non-completed run CANNOT carry a verdict — it throws', () => {
  assert.throws(() => score('timeout', 1000, 'fail'), /cannot carry the verdict/);
  assert.throws(() => score('truncated', 1000, 'pass'), /cannot carry the verdict/);
  // The only legal pairing.
  assert.doesNotThrow(() => score('timeout', 1000, 'not_scored'));
});

test('🚨 not-scored items leave the denominator, they do not count as failures', () => {
  const results = [
    score('completed', 10, 'pass'),
    score('completed', 10, 'pass'),
    noResult('timeout', 780000),
    noResult('truncated', 5000),
  ];
  const t = tally(results);
  assert.equal(t.scored, 2);
  assert.equal(t.notScored, 2);
  assert.equal(t.rate, 1);          // 2/2, not 2/4
  assert.equal(coverage(t), 0.5);   // and the sample is visibly thin
  assert.equal(t.byOutcome.timeout, 1);
});

test('a slow model is not penalised twice', () => {
  // Counting timeouts as failures would mark it down in latency AND in quality.
  const t = tally([score('completed', 10, 'pass'), noResult('timeout', 780000)]);
  assert.equal(t.rate, 1);
  assert.ok(coverage(t) < MINIMUM_COVERAGE, 'but coverage must expose the thin sample');
});

test('isScored is the single definition of "counts"', () => {
  assert.equal(isScored(score('completed', 1, 'pass')), true);
  assert.equal(isScored(score('completed', 1, 'unclear')), true);
  assert.equal(isScored(noResult('empty', 1)), false);
});

/* ── the suite itself ───────────────────────────────────────────────────── */

test('every dimension has at least one case, and every case names its trap', () => {
  const byDim = CASES_BY_DIMENSION();
  for (const d of Object.keys(DIMENSION_MINIMUMS) as Dimension[]) {
    assert.ok((byDim.get(d) ?? []).length > 0, `no case for ${d}`);
  }
  for (const c of CASES) {
    assert.ok(c.trap && c.trap.length > 15, `${c.id} does not name the mistake it catches`);
  }
});

test('negative controls are answerable, confident and brief — the three degenerate strategies', () => {
  const nc = CASES.filter((c) => c.dimension === 'negative_control');
  assert.ok(nc.length >= 3, 'each degenerate strategy needs its own control');
  assert.equal(nc.find((c) => c.id === 'nc-answerable')!.check('Tokyo'), true);
  assert.equal(nc.find((c) => c.id === 'nc-brevity')!.check('Blue'), true);
  assert.equal(nc.find((c) => c.id === 'nc-brevity')!.check('The sky is blue because of Rayleigh scattering.'), false);
});

test('the checkers accept a correct answer in the formats models actually use', () => {
  const stateful = CASES.find((c) => c.id === 'compound-stock')!;
  assert.equal(stateful.check('...so the final total is $$\\boxed{315}$$ units.'), true);
  assert.equal(stateful.check('The answer is 360 units.'), false);

  const retention = CASES.find((c) => c.id === 'late-inconvenient-constraint')!;
  assert.equal(retention.check('It finishes on **Tuesday**.'), true);
  assert.equal(retention.check('It finishes on Sunday.'), false);
});
