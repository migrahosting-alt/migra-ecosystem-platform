import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ExecutionStateMachine,
  FORBIDDEN_TRANSITIONS,
  isLegalTransition,
  recoverFromRecord,
  type Clock,
  type ExecutionState,
} from '../../services/executionState.js';

/**
 * Truthfulness tests for Brain execution state.
 *
 * The governing rule: a success result may be emitted ONLY after the success
 * evidence was observed. Several of these tests assert the ABSENCE of success in
 * situations where an optimistic implementation would report it.
 */

/** Deterministic clock so transition history is assertable. */
function fixedClock(): Clock {
  let n = 0;
  return { now: () => `T${String(++n).padStart(3, '0')}` };
}

const make = (action = 'chat') =>
  new ExecutionStateMachine(
    { operationId: 'op-1', requestedAction: action, brainEndpoint: 'http://127.0.0.1:3988' },
    fixedClock(),
  );

/** Drive a machine to `running` through the legal path, with the precondition
 * genuinely confirmed. */
function toRunning(m: ExecutionStateMachine): void {
  m.transition('connecting', 'connect');
  m.transition('ready', 'health ok');
  m.requestPrecondition('brain ready');
  m.confirmPrecondition(true, 'health observed');
  assert.equal(m.mayAttemptAction(), true);
  m.markActionAttempted('/chat');
  m.transition('running', 'dispatched');
}

// ── 1. successful connection and completion ─────────────────────────────────

test('1 · successful connection and completion reaches completed with observed evidence', () => {
  const m = make();
  toRunning(m);
  m.markResponseReceived();
  assert.equal(m.observeTerminal(true, 'terminal response observed'), true);
  assert.equal(m.state, 'completed');
  const r = m.snapshot();
  assert.equal(r.terminalObserved, true);
  assert.equal(r.phase, 'terminal_verified');
  assert.equal(r.invariantViolations.length, 0);
  assert.match(m.statusLine(), /Completed/);
});

// ── 2. connection refused ───────────────────────────────────────────────────

test('2 · connection refused fails with the exact category and never reports ready', () => {
  const m = make();
  m.transition('connecting', 'connect');
  m.fail('connection_refused', 'ECONNREFUSED 127.0.0.1:3988');
  assert.equal(m.state, 'failed');
  assert.equal(m.snapshot().failureCategory, 'connection_refused');
  assert.doesNotMatch(m.statusLine(), /Ready|Completed/);
});

// ── 3. connection lost mid-operation ────────────────────────────────────────

test('3 · connection lost mid-operation fails and never completes', () => {
  const m = make();
  toRunning(m);
  m.fail('connection_lost', 'socket closed before response');
  assert.equal(m.state, 'failed');
  assert.equal(m.snapshot().terminalObserved, false);
  assert.doesNotMatch(m.statusLine(), /Completed/);
});

test('3b · connection lost while merely ready degrades rather than failing outright', () => {
  const m = make();
  m.transition('connecting', 'connect');
  m.transition('ready', 'health ok');
  m.fail('connection_lost', 'idle socket dropped');
  assert.equal(m.state, 'degraded');
  assert.match(m.statusLine(), /Degraded/);
});

// ── 4. timeout before response ──────────────────────────────────────────────

test('4 · timeout before response never synthesises a result', () => {
  const m = make();
  toRunning(m);
  m.fail('request_timeout', 'no response within 30000ms');
  assert.equal(m.state, 'failed');
  assert.equal(m.snapshot().failureCategory, 'request_timeout');
  assert.equal(m.snapshot().terminalObserved, false);
});

// ── 5. cancel before dispatch ───────────────────────────────────────────────

test('5 · cancel before dispatch never enters running and never completes', () => {
  const m = make();
  m.transition('connecting', 'connect');
  m.transition('ready', 'health ok');
  m.requestCancellation('user cancelled before dispatch');
  m.resolveCancellation(true, 'nothing was dispatched');
  assert.notEqual(m.state, 'completed');
  assert.equal(m.snapshot().terminalObserved, false);
});

// ── 6. cancel during transport ──────────────────────────────────────────────

test('6 · cancel during transport goes running -> cancelling -> cancelled', () => {
  const m = make();
  toRunning(m);
  m.requestCancellation('user pressed stop');
  assert.equal(m.state, 'cancelling');
  assert.match(m.statusLine(), /Cancelling/);
  m.resolveCancellation(true, 'brain acknowledged abort');
  assert.equal(m.state, 'cancelled');
  assert.match(m.statusLine(), /Cancelled/);
  assert.equal(m.snapshot().terminalObserved, false);
});

// ── 7. cancel after terminal completion ─────────────────────────────────────

test('7 · cancelling an already completed operation does not rewrite its outcome', () => {
  const m = make();
  toRunning(m);
  m.markResponseReceived();
  m.observeTerminal(true, 'terminal response observed');
  assert.equal(m.state, 'completed');
  m.requestCancellation('user pressed stop after the fact');
  // Still completed: a late cancel cannot retroactively un-succeed an observed result.
  assert.equal(m.state, 'completed');
});

// ── 8. cancellation requested but not acknowledged ──────────────────────────

test('8 · unacknowledged cancellation reports cancellation_unconfirmed, NOT cancelled', () => {
  const m = make();
  toRunning(m);
  m.requestCancellation('user pressed stop');
  m.resolveCancellation(false, 'no ack within 5000ms');
  assert.notEqual(m.state, 'cancelled');
  assert.equal(m.state, 'failed');
  assert.equal(m.snapshot().failureCategory, 'cancellation_unconfirmed');
  assert.equal(m.statusLine(), 'Cancellation requested but not confirmed');
});

// ── 9. late success arriving after cancellation ─────────────────────────────

test('9 · a late success after cancellation is discarded, never promoted to completed', () => {
  const m = make();
  toRunning(m);
  m.requestCancellation('user pressed stop');
  const promoted = m.observeTerminal(true, 'late 200 OK arrived');
  assert.equal(promoted, false);
  assert.notEqual(m.state, 'completed');
  assert.equal(m.snapshot().terminalObserved, false);
  assert.ok(
    m.snapshot().failures.some((f) => /late terminal response discarded/.test(f)),
    'the discarded late response must be recorded, not silently dropped',
  );
});

// ── 10. failed precondition prevents the destructive action ─────────────────

test('10 · a failed precondition blocks the action and yields precondition_failed', () => {
  const m = make('merge');
  m.transition('connecting', 'connect');
  m.transition('ready', 'health ok');
  m.requestPrecondition('unresolved review thread exists');
  const confirmed = m.confirmPrecondition(false, 'review creation returned 422');
  assert.equal(confirmed, false);
  assert.equal(m.mayAttemptAction(), false);
  assert.equal(m.snapshot().failureCategory, 'precondition_failed');
  assert.notEqual(m.state, 'completed');
});

// ── 11. invalid transitions ─────────────────────────────────────────────────

test('11 · forbidden transitions are rejected and recorded as invariant failures', () => {
  for (const [from, to] of FORBIDDEN_TRANSITIONS) {
    assert.equal(isLegalTransition(from, to), false, `${from} -> ${to} must be illegal`);
  }
});

test('11b · a rejected transition leaves state unchanged and is logged', () => {
  const m = make();
  m.transition('connecting', 'connect');
  m.fail('brain_process_exit', 'brain exited with code 1');
  assert.equal(m.state, 'failed');
  const applied = m.transition('completed', 'optimistic close');
  assert.equal(applied, false);
  assert.equal(m.state, 'failed', 'state must not move on a rejected transition');
  const r = m.snapshot();
  assert.equal(r.invariantViolations.length, 1);
  assert.match(r.invariantViolations[0]!, /illegal transition failed -> completed/);
  assert.ok(r.transitions.some((t) => t.rejected === true));
});

test('11c · observeTerminal cannot rescue a failed operation', () => {
  const m = make();
  toRunning(m);
  m.fail('invalid_response', 'body was not JSON');
  assert.equal(m.state, 'failed');
  assert.equal(m.observeTerminal(true, 'retroactive success'), false);
  assert.notEqual(m.state, 'completed');
});

// ── 12. restart recovery ────────────────────────────────────────────────────

test('12 · an in-flight operation recovered after restart is not reported as completed', () => {
  const m = make();
  toRunning(m);
  const recovered = recoverFromRecord(m.snapshot());
  assert.equal(recovered.state, 'failed');
  assert.equal(recovered.failureCategory, 'terminal_state_unverified');
  assert.equal(recovered.terminalObserved, false);
  assert.ok(recovered.remainingWork.some((w) => /outcome unknown/i.test(w)));
});

test('12b · a cancelling operation recovered after restart reports cancellation_unconfirmed', () => {
  const m = make();
  toRunning(m);
  m.requestCancellation('stop');
  const recovered = recoverFromRecord(m.snapshot());
  assert.equal(recovered.failureCategory, 'cancellation_unconfirmed');
  assert.notEqual(recovered.state, 'cancelled');
});

test('12c · a terminal record is returned unchanged by recovery', () => {
  const m = make();
  toRunning(m);
  m.markResponseReceived();
  m.observeTerminal(true, 'observed');
  const before = m.snapshot();
  const after = recoverFromRecord(before);
  assert.deepEqual(after, before);
});

// ── The regression that mirrors the governance incident ─────────────────────

test('REGRESSION · precondition creation fails => destructive action must not execute', () => {
  const m = make('merge pull request');
  m.transition('connecting', 'connect');
  m.transition('ready', 'health ok');

  // Phase 1: we ask for the precondition (an unresolved review thread) that would
  // make the destructive action be refused.
  m.requestPrecondition('create unresolved review thread');

  // Phase 2: creating it FAILED — exactly the 422 that occurred in the real incident.
  const confirmed = m.confirmPrecondition(false, 'HTTP 422 Line could not be resolved');

  // The action must now be impossible, and must not be attempted "to see what happens".
  assert.equal(confirmed, false);
  const mayAttempt = m.mayAttemptAction();
  assert.equal(mayAttempt, false, 'the destructive action must be refused');

  const r = m.snapshot();
  assert.equal(r.failureCategory, 'precondition_failed');
  assert.equal(r.terminalObserved, false);
  assert.notEqual(r.state, 'completed');

  // No success may be emitted anywhere the operator can see.
  assert.doesNotMatch(m.statusLine(), /Completed|success|merged/i);
  assert.equal(
    r.transitions.some((t) => t.to === 'completed' && !t.rejected),
    false,
    'no path may reach completed',
  );
});

test('REGRESSION · expectation is never evidence — mayAttemptAction is false while merely requested', () => {
  const m = make('destructive');
  m.transition('connecting', 'connect');
  m.transition('ready', 'health ok');
  m.requestPrecondition('thing that would block the action');
  // Deliberately NOT confirmed. An implementation that assumed the request implied
  // the condition would return true here.
  assert.equal(m.mayAttemptAction(), false);
});

// ── status/record agreement ─────────────────────────────────────────────────

test('user-facing status and durable record derive from the same state', () => {
  const cases: ReadonlyArray<[(m: ExecutionStateMachine) => void, ExecutionState]> = [
    [(m) => { toRunning(m); m.markResponseReceived(); m.observeTerminal(true, 'ok'); }, 'completed'],
    [(m) => { toRunning(m); m.requestCancellation('x'); m.resolveCancellation(true, 'ack'); }, 'cancelled'],
    [(m) => { toRunning(m); m.requestCancellation('x'); m.resolveCancellation(false, 'no ack'); }, 'failed'],
    [(m) => { m.transition('connecting', 'c'); m.fail('connection_refused', 'refused'); }, 'failed'],
  ];
  for (const [drive, expected] of cases) {
    const m = make();
    drive(m);
    assert.equal(m.state, expected);
    assert.equal(m.snapshot().state, expected, 'record and machine must agree');
    if (expected !== 'completed') assert.doesNotMatch(m.statusLine(), /^Completed/);
  }
});

// ── review findings (PR #139) ───────────────────────────────────────────────

test('review · a late terminal after cancellation still reaches a terminal state', () => {
  const m = make();
  toRunning(m);
  m.requestCancellation('user pressed stop');
  const accepted = m.observeTerminal(true, 'stale success arrived');
  assert.equal(accepted, false, 'the late response is still discarded');
  const r = m.snapshot();
  assert.notEqual(r.state, 'cancelling', 'the record must not be left mid-cancellation');
  assert.equal(r.state, 'failed');
  assert.equal(r.failureCategory, 'cancellation_unconfirmed');
  assert.ok(r.endedAt, 'a terminal record carries an end time');
});

test('review · precondition is recorded, not inferred from phase', () => {
  const none = make();
  none.requestPrecondition('none required', false);
  assert.equal(none.snapshot().preconditionRequired, false, 'no-precondition path must not claim one');

  const real = make();
  real.requestPrecondition('branch exists');
  real.confirmPrecondition(true, 'verified');
  const r = real.snapshot();
  assert.equal(r.preconditionRequired, true);
  assert.ok(r.preconditionConfirmedAt, 'confirmation time is recorded');
  assert.notEqual(r.preconditionConfirmedAt, r.startedAt, 'and it is not just the start time');
});
