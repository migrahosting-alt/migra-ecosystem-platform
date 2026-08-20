// A run must not claim more than it achieved.
//
// Two defects the frozen benchmark produced, both of which reported success or
// spent a full budget while the truth was available:
//   - an Explain returned 67 bytes of punctuation and was presented as an answer;
//   - a coding run broke three tests that passed at baseline and kept going.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyOutcome, describeOutcome, isSubstantive } from '../src/engine/operationOutcome.js';
import { assessProgress, failureSignature } from '../src/engine/coding/verificationProgress.js';
import type { ValidationRecord } from '../src/engine/coding/validationRun.js';

const record = (patch: Partial<ValidationRecord> = {}): ValidationRecord => ({
  id: 'tests', stage: 'final', command: ['npm', 'test'], cwd: '.',
  admitted: true, startedAt: 0, endedAt: 1, durationMs: 1,
  exitCode: 1, timedOut: false, stdout: '', stderr: '', truncated: false, passed: false,
  ...patch,
});

const tap = (names: string[]): string =>
  ['TAP version 13', ...names.map((n, i) => `not ok ${i + 1} - ${n}`), `# fail ${names.length}`].join('\n');

// ── an empty answer is not a completed one ───────────────────────────────────

test('THE EXACT 67-BYTE ANSWER from the benchmark is not substantive', () => {
  const observed = '# MigraPilot: Explain Selection\n\n_op chat-mt1rtspt-6 · rev 4_\n\n```';
  assert.equal(isSubstantive(observed), false, 'a title, a stamp and a fence is not an answer');
});

test('a real answer IS substantive', () => {
  assert.equal(isSubstantive('submitOrder validates the order, reserves stock, then prices it: member discount, coupon, tax.'), true);
});

test('an engine that ended normally with nothing to show is EMPTY_COMPLETION, not completed', () => {
  assert.equal(classifyOutcome({ engineCompleted: true, content: '```' }), 'empty_completion');
  assert.equal(classifyOutcome({ engineCompleted: true, content: 'a genuine, sufficiently long explanation of the code path' }), 'completed');
  // No content supplied = nothing claimed about substance.
  assert.equal(classifyOutcome({ engineCompleted: true }), 'completed');
});

test('an empty completion does not blame the user or the tool', () => {
  const message = describeOutcome('empty_completion');
  assert.match(message, /no usable answer/i);
  // It says "Nothing failed" — the point is that it does not ATTRIBUTE a failure,
  // not that the word never appears. (A /fail/i check flagged the reassurance.)
  assert.match(message, /nothing failed/i);
  assert.notEqual(message, describeOutcome('failed'));
});

// ── the repair loop knows when it is going backwards ─────────────────────────

test('a failure signature is the failing test names and the reported count', () => {
  const sig = failureSignature(record({ stdout: tap(['b test', 'a test']) }));
  assert.deepEqual(sig.names, ['a test', 'b test'], 'sorted, so two runs are comparable');
  assert.equal(sig.count, 2);
  assert.equal(sig.unusable, false);
});

test('a passing or unusable record yields no signature to compare', () => {
  assert.deepEqual(failureSignature(record({ passed: true, exitCode: 0 })).names, []);
  assert.equal(failureSignature(record({ admitted: false })).unusable, true);
  assert.equal(failureSignature(record({ timedOut: true })).unusable, true);
  assert.equal(failureSignature(undefined).unusable, true);
});

test('BREAKING A TEST THAT PASSED AT BASELINE STOPS THE LOOP', () => {
  // The measured t3 failure: three tests that passed before the run now fail.
  const baseline = record({ stdout: tap(['the new feature is refused past the limit']) });
  const current = record({
    stdout: tap([
      'the new feature is refused past the limit',
      'a plain order is priced subtotal + tax',
      'stock is decremented on a confirmed order',
    ]),
  });
  const verdict = assessProgress({ baseline, previous: undefined, current });
  assert.equal(verdict.kind, 'regressed');
  if (verdict.kind !== 'regressed') return;
  assert.match(verdict.detail, /passed before this run now fail/);
  assert.match(verdict.detail, /a plain order is priced/);
});

test('still failing the SAME baseline test is not a regression', () => {
  const same = tap(['the new feature is refused past the limit']);
  const verdict = assessProgress({ baseline: record({ stdout: same }), previous: undefined, current: record({ stdout: same }) });
  assert.equal(verdict.kind, 'continue', 'no progress yet, but no harm done either');
});

test('THE IDENTICAL FAILURE TWICE STOPS THE LOOP', () => {
  const baseline = record({ stdout: tap(['x fails', 'y fails']) });
  const same = record({ stdout: tap(['x fails', 'y fails']) });
  const verdict = assessProgress({ baseline, previous: same, current: same });
  assert.equal(verdict.kind, 'no-progress');
  if (verdict.kind !== 'no-progress') return;
  assert.match(verdict.detail, /same 2 failure\(s\)/);
});

test('genuine progress continues', () => {
  const baseline = record({ stdout: tap(['x fails', 'y fails']) });
  const previous = record({ stdout: tap(['x fails', 'y fails']) });
  const current = record({ stdout: tap(['x fails']) });
  assert.equal(assessProgress({ baseline, previous, current }).kind, 'continue');
});

test('a passing current run never stops the loop as a regression', () => {
  const verdict = assessProgress({
    baseline: record({ stdout: tap(['x fails']) }),
    previous: record({ stdout: tap(['x fails']) }),
    current: record({ passed: true, exitCode: 0, stdout: '# fail 0' }),
  });
  assert.equal(verdict.kind, 'continue');
});

test('an unmeasurable current run concludes nothing in either direction', () => {
  const verdict = assessProgress({
    baseline: record({ stdout: tap(['x fails']) }),
    previous: record({ stdout: tap(['x fails']) }),
    current: record({ admitted: false, refusedReason: 'off-allowlist' }),
  });
  assert.equal(verdict.kind, 'continue', 'nothing was measured, so nothing can be claimed');
});
