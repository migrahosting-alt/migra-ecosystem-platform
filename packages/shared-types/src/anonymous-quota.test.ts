import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateAnonymousQuota, settleReservation } from './anonymous-quota.ts';

test('a fresh allowance is allowed, not warning, not exhausted', () => {
  const q = evaluateAnonymousQuota({ limit: 5, used: 0 });
  assert.equal(q.allowed, true);
  assert.equal(q.remaining, 5);
  assert.equal(q.warning, false);
  assert.equal(q.exhausted, false);
});

test('warning turns on at the threshold and stays on until exhaustion', () => {
  assert.equal(evaluateAnonymousQuota({ limit: 5, used: 2 }).warning, false, '3 left');
  assert.equal(evaluateAnonymousQuota({ limit: 5, used: 3 }).warning, true, '2 left');
  assert.equal(evaluateAnonymousQuota({ limit: 5, used: 4 }).warning, true, '1 left');
});

test('exhaustion is not a warning — warning means "soon", exhausted means "now"', () => {
  const q = evaluateAnonymousQuota({ limit: 5, used: 5 });
  assert.equal(q.exhausted, true);
  assert.equal(q.warning, false, 'an exhausted quota is not also warning');
  assert.equal(q.allowed, false);
});

test('over-spend clamps instead of rendering a negative remaining', () => {
  // Over-spend means a bug upstream. The user should still see a coherent
  // state rather than "-3 messages left".
  const q = evaluateAnonymousQuota({ limit: 5, used: 9 });
  assert.equal(q.remaining, 0);
  assert.equal(q.exhausted, true);
  assert.equal(q.allowed, false);
});

test('negative inputs clamp rather than propagating', () => {
  const q = evaluateAnonymousQuota({ limit: -5, used: -2 });
  assert.equal(q.limit, 0);
  assert.equal(q.used, 0);
  assert.equal(q.remaining, 0);
  assert.equal(q.exhausted, true);
});

test('a zero limit is exhausted from the start, never allowed', () => {
  // The switch for "anonymous chat is off".
  const q = evaluateAnonymousQuota({ limit: 0, used: 0 });
  assert.equal(q.allowed, false);
  assert.equal(q.exhausted, true);
});

test('the warning threshold is configurable', () => {
  assert.equal(evaluateAnonymousQuota({ limit: 10, used: 5, warningThreshold: 5 }).warning, true);
  assert.equal(evaluateAnonymousQuota({ limit: 10, used: 4, warningThreshold: 5 }).warning, false);
});

/* ── settlement policy ───────────────────────────────────────────────────── */

test('a completed turn CONSUMES quota', () => {
  const s = settleReservation({ reservationId: 'r1', producedOutput: true });
  assert.equal(s.kind, 'consume');
});

test('a completed turn consumes even when persistence then failed', () => {
  // The user got their answer. That it could not be SAVED is our failure to fix,
  // but the inference was really spent and the person really was served.
  const s = settleReservation({ reservationId: 'r1', producedOutput: true, failure: 'persistence_unavailable' });
  assert.equal(s.kind, 'consume');
});

test('infrastructure failure before any output RELEASES the reservation', () => {
  for (const failure of ['persistence_unavailable', 'brain_unreachable', 'model_timeout'] as const) {
    const s = settleReservation({ reservationId: 'r1', producedOutput: false, failure });
    assert.equal(s.kind, 'release', `${failure} must not consume quota`);
    assert.equal(s.kind === 'release' && s.reason, failure);
  }
});

test('a cancelled turn with no output releases', () => {
  const s = settleReservation({ reservationId: 'r1', producedOutput: false, failure: 'cancelled' });
  assert.equal(s.kind, 'release');
});

test('no output and no named failure still releases', () => {
  // Charging for nothing is the one outcome that is never defensible.
  const s = settleReservation({ reservationId: 'r1', producedOutput: false });
  assert.equal(s.kind, 'release');
  assert.equal(s.kind === 'release' && s.reason, 'no_output');
});
