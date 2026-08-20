// The timeout chain, and the five terminal states.
//
// Every assertion here corresponds to a defect the benchmark actually produced:
// a still-generating model reported as HTTP 500, a connect budget used as a
// generation budget, and a stream that stopped mid-answer being indistinguishable
// from one that finished. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_TIMEOUTS, checkHierarchy, type TimeoutHierarchy } from '../src/config/timeoutHierarchy.js';
import { classifyOutcome, describeOutcome } from '../src/engine/operationOutcome.js';
import { readEnv } from '../src/config/env.js';

/** The SHIPPED defaults, read with an empty environment. */
const env = readEnv({});
const responseMs = env.providerResponseTimeoutMs ?? 0;
const connectMs = env.providerConnectTimeoutMs ?? 0;
const absoluteMs = env.providerAbsoluteTimeoutMs ?? 0;

// ── the hierarchy holds ──────────────────────────────────────────────────────

test('the shipped hierarchy has no violations', () => {
  assert.deepEqual(checkHierarchy(DEFAULT_TIMEOUTS), []);
});

test('HARD CEILINGS GROW OUTWARDS so the inner layer names the failure', () => {
  const { provider, brain, ui } = DEFAULT_TIMEOUTS.ceiling;
  assert.ok(provider < brain, `provider ${provider} must expire before brain ${brain}`);
  assert.ok(brain < ui, `brain ${brain} must expire before ui ${ui}`);
  // The inversion that shipped in the first draft of this file.
  const inverted: TimeoutHierarchy = { ...DEFAULT_TIMEOUTS, ceiling: { provider: 900_000, brain: 960_000, ui: 600_000 } };
  assert.ok(checkHierarchy(inverted).some((v) => v.rule === 'ceiling-order'), 'a UI ceiling below the inner ones must be caught');
});

test('PATIENCE FOR SILENCE does not grow inwards', () => {
  const { ui, brain, provider } = DEFAULT_TIMEOUTS.idle;
  assert.ok(ui <= brain && brain <= provider);
  const impatientInner: TimeoutHierarchy = { ...DEFAULT_TIMEOUTS, idle: { ui: 120_000, brain: 30_000, provider: 120_000 } };
  assert.ok(checkHierarchy(impatientInner).some((v) => v.rule === 'idle-order'));
});

test('keepalive is frequent enough that two missed frames do not look like death', () => {
  const smallest = Math.min(...Object.values(DEFAULT_TIMEOUTS.idle));
  assert.ok(DEFAULT_TIMEOUTS.keepaliveMs * 3 <= smallest);
  const slow: TimeoutHierarchy = { ...DEFAULT_TIMEOUTS, keepaliveMs: 90_000 };
  assert.ok(checkHierarchy(slow).some((v) => v.rule === 'keepalive-too-slow'));
});

// ── the defaults are actually usable for local inference ─────────────────────

test('a NON-STREAMING generation gets a response budget, not a connect budget', () => {
  // The measured failure: "still generating after 58 058ms" aborted at 60 000ms
  // and surfaced as HTTP 500, because connect was used as the total.
  assert.ok(responseMs >= 300_000, `a local generation needs minutes, got ${responseMs}ms`);
  assert.ok(responseMs > connectMs, 'the response budget must exceed the connect budget');
});

test('the provider has a real hard ceiling rather than being unbounded', () => {
  assert.ok(absoluteMs > 0, 'unbounded means no layer owns the final stop');
  assert.equal(absoluteMs, DEFAULT_TIMEOUTS.ceiling.provider);
});

// ── the five terminal states ─────────────────────────────────────────────────

test('a deadline that fires while work is running is TIMED OUT, never a failure', () => {
  const outcome = classifyOutcome({ timedOut: { clock: 'response', limitMs: 60_000, elapsedMs: 58_058 }, error: { message: 'aborted' } });
  assert.equal(outcome, 'timed_out');
  assert.match(describeOutcome(outcome, { timedOut: { clock: 'response', limitMs: 60_000, elapsedMs: 58_058 } }),
    /deadline, not a failure of the answer/);
});

test('a human stop is CANCELLED even when it also looks like a broken stream', () => {
  assert.equal(classifyOutcome({ cancelled: true, streamEndedEarly: true, error: { message: 'aborted' } }), 'cancelled');
});

test('a stream that ends without a done frame is INTERRUPTED, never completed', () => {
  assert.equal(classifyOutcome({ streamEndedEarly: true }), 'stream_interrupted');
  assert.equal(classifyOutcome({}), 'stream_interrupted', 'no completion signal is not success');
});

test('only an engine-signalled end is COMPLETED', () => {
  assert.equal(classifyOutcome({ engineCompleted: true }), 'completed');
  assert.equal(classifyOutcome({ engineCompleted: true, streamEndedEarly: true }), 'completed');
});

test('a genuine error is FAILED, and says what went wrong', () => {
  assert.equal(classifyOutcome({ error: { message: 'model refused' } }), 'failed');
  assert.match(describeOutcome('failed', { error: { message: 'model refused' } }), /model refused/);
});

test('the five states are distinguishable and none describes itself as another', () => {
  const seen = new Set([
    classifyOutcome({ engineCompleted: true }),
    classifyOutcome({ error: { message: 'x' } }),
    classifyOutcome({ timedOut: { clock: 'idle', limitMs: 1, elapsedMs: 2 } }),
    classifyOutcome({ cancelled: true }),
    classifyOutcome({ streamEndedEarly: true }),
  ]);
  assert.equal(seen.size, 5, `expected five distinct outcomes, got ${[...seen].join(', ')}`);
  assert.doesNotMatch(describeOutcome('timed_out'), /failed/i);
  assert.doesNotMatch(describeOutcome('cancelled'), /fail/i);
});
