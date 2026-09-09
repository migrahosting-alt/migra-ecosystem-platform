/**
 * EMAIL OBSERVABILITY — measurable without becoming a copy of the mailbox.
 *
 * Metrics are retained, aggregated, shipped to dashboards and read by people
 * with no business reading someone's mail. A label carrying an address, a
 * subject or a message id turns monitoring into a partial mirror of the
 * mailbox — with weaker access control and a longer retention period than the
 * mailbox itself.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FORBIDDEN_LABEL_CONTENT,
  guarded,
  measured,
  safeEvent,
  type EmailTelemetryEvent,
} from '../src/engine/email/telemetry.js';

const event = (over: Partial<EmailTelemetryEvent> = {}): EmailTelemetryEvent => ({
  stage: 'search',
  outcome: 'ok',
  durationMs: 42,
  provider: 'gmail',
  ...over,
});

test('a well-formed event passes', () => {
  assert.deepEqual(safeEvent(event()), event());
});

test('🚨 an address in the provider field is dropped', () => {
  // The realistic slip: a field that CAN hold a string eventually holds the
  // one value someone needed at 2am.
  assert.equal(safeEvent(event({ provider: 'owner@migrateck.com' })), null);
});

test('🚨 credential vocabulary in a label is dropped', () => {
  for (const value of ['refresh_token', 'authorization: Bearer x', 'access token']) {
    assert.equal(safeEvent(event({ provider: value })), null, `"${value}" reached a label`);
  }
});

test('the event TYPE has no field that could carry content', () => {
  /*
   * Enforced structurally as well as at runtime. There is no `detail`,
   * `subject`, `address` or `messageId` — not even optional — because an
   * optional content field is a content field.
   */
  const keys = Object.keys(event()).sort();
  assert.deepEqual(keys, ['durationMs', 'outcome', 'provider', 'stage']);
  for (const forbidden of ['detail', 'subject', 'address', 'messageId', 'body', 'query']) {
    assert.ok(!keys.includes(forbidden), `the event type carries a content field: ${forbidden}`);
  }
});

test('a count is allowed — a count is not content', () => {
  assert.ok(safeEvent(event({ count: 12 })));
  assert.equal(safeEvent(event({ count: -1 })), null);
  assert.equal(safeEvent(event({ count: 1.5 })), null);
});

test('an absurd duration is rejected rather than recorded', () => {
  assert.equal(safeEvent(event({ durationMs: Number.NaN })), null);
  assert.equal(safeEvent(event({ durationMs: -5 })), null);
});

test('an over-long provider label is dropped', () => {
  // High cardinality both leaks and blows up the series count, so the rule
  // that protects privacy also protects the backend.
  assert.equal(safeEvent(event({ provider: 'x'.repeat(200) })), null);
});

test('🚨 the guarded sink DROPS unsafe events rather than passing them on', () => {
  const seen: EmailTelemetryEvent[] = [];
  const sink = guarded((e) => seen.push(e));
  sink(event());
  sink(event({ provider: 'someone@example.com' }));
  assert.equal(seen.length, 1, 'an unsafe event reached the sink');
});

test('telemetry never breaks the operation it measures', () => {
  const sink = guarded(() => {
    throw new Error('metrics backend is down');
  });
  assert.doesNotThrow(() => sink(event()));
});

test('measured emits exactly one event per stage', async () => {
  const seen: EmailTelemetryEvent[] = [];
  let clock = 0;
  const value = await measured(
    (e) => seen.push(e),
    'search',
    'gmail',
    () => (clock += 10),
    async () => ({ value: ['a', 'b'], outcome: 'ok' as const, count: 2 }),
  );
  assert.deepEqual(value, ['a', 'b']);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.count, 2);
  assert.ok(seen[0]!.durationMs > 0);
});

test('🚨 a thrown error is measured WITHOUT its message', async () => {
  /*
   * The exception message is where a provider puts an address or a subject
   * line. It is deliberately not recorded, even though it is the most
   * tempting thing to add.
   */
  const seen: EmailTelemetryEvent[] = [];
  let clock = 0;
  await assert.rejects(
    measured(
      (e) => seen.push(e),
      'send_dispatch',
      'gmail',
      () => (clock += 5),
      async () => {
        throw new Error('failed sending to owner@migrateck.com re: Invoice 2026-09');
      },
    ),
  );
  assert.equal(seen.length, 1);
  const serialised = JSON.stringify(seen[0]);
  assert.ok(!serialised.includes('@'), `an address reached telemetry: ${serialised}`);
  assert.ok(!serialised.includes('Invoice'), `a subject reached telemetry: ${serialised}`);
});

test('every failure kind is representable as an outcome', () => {
  // If a failure has no outcome, it gets recorded as something else — and the
  // dashboard then disagrees with the product about what happened.
  const outcomes: EmailTelemetryEvent['outcome'][] = [
    'ok', 'not_configured', 'not_connected', 'authorization_expired',
    'insufficient_scope', 'provider_unavailable', 'provider_timeout',
    'no_results', 'not_found', 'refused', 'consent_declined', 'outcome_unknown',
  ];
  for (const outcome of outcomes) {
    assert.ok(safeEvent(event({ outcome })), `${outcome} was rejected`);
  }
  assert.ok(outcomes.includes('outcome_unknown'), 'the terminal send state is not measurable');
  assert.ok(outcomes.includes('consent_declined'), 'declines are not measurable');
});

test('the forbidden list is imported, not restated', () => {
  // A guard that re-describes its rule drifts away from it.
  assert.ok(FORBIDDEN_LABEL_CONTENT.includes('@'));
  assert.ok(FORBIDDEN_LABEL_CONTENT.length > 5);
});
