// The success gate, as a test. Every surface that renders an outcome depends on it.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  presentOutcome,
  qualifiesAsSuccess,
  stampOf,
  statusBarFor,
  notificationApiFor,
} from '../../services/brainOutcomePresentation.js';
import type { ExecutionRecord, ExecutionState, FailureCategory } from '../../services/executionState.js';

function rec(over: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    operationId: 'op-1',
    requestedAction: 'chat',
    brainEndpoint: 'http://localhost:3988',
    startedAt: '2026-01-01T00:00:00.000Z',
    state: 'completed' as ExecutionState,
    terminalObserved: true,
    transitions: [],
    transportAttempts: [],
    commands: [],
    filesChanged: [],
    testsRun: [],
    failures: [],
    remainingWork: [],
    invariantViolations: [],
    ...over,
  };
}

const present = (r: ExecutionRecord, durable: boolean, revision?: number) =>
  presentOutcome({
    record: r,
    statusLine: 'Completed — terminal response observed.',
    durable,
    ...(revision === undefined ? {} : { revision }),
  });

test('success requires completed + terminal observed + durable — all three', () => {
  assert.equal(qualifiesAsSuccess(rec(), true), true);
  assert.equal(qualifiesAsSuccess(rec(), false), false, 'not durable is not success');
  assert.equal(qualifiesAsSuccess(rec({ terminalObserved: false }), true), false, 'unobserved is not success');
  assert.equal(qualifiesAsSuccess(rec({ state: 'running' }), true), false, 'non-terminal is not success');
});

test('a completed-but-undurable operation renders as degraded, never as success', () => {
  const p = present(rec(), false, 4);
  assert.equal(p.severity, 'degraded_completion');
  assert.match(p.message, /not durably recorded/i);
  assert.equal(
    /^Completed — terminal response observed\.$/.test(p.message),
    false,
    'the raw optimistic line must not survive',
  );
  assert.equal(notificationApiFor(p), 'showWarningMessage');
  assert.equal(statusBarFor(p).warning, true);
});

test('an unconfirmed cancellation warns that work may still be running', () => {
  const p = presentOutcome({
    record: rec({
      state: 'failed',
      failureCategory: 'cancellation_unconfirmed' as FailureCategory,
      terminalObserved: false,
    }),
    statusLine: 'Cancellation requested but not confirmed',
    durable: true,
    revision: 7,
  });
  assert.equal(p.severity, 'unverified');
  assert.match(p.message, /may still be running/i);
  assert.notEqual(notificationApiFor(p), 'showInformationMessage');
});

test('every surface is stamped, and a missing revision says so rather than omitting it', () => {
  assert.equal(stampOf('op-9', 3), 'op op-9 · rev 3');
  assert.equal(stampOf('op-9', undefined), 'op op-9 · rev unrecorded');
  const p = present(rec(), true, 9);
  assert.match(p.text, /\[op op-1 · rev 9\]$/);
  assert.equal(statusBarFor(p).tooltip, p.text, 'the status bar carries the same stamped text');
});

test('only success is an information-level notification', () => {
  assert.equal(notificationApiFor(present(rec(), true, 1)), 'showInformationMessage');
  for (const r of [
    rec({ state: 'failed', failureCategory: 'connection_refused' as FailureCategory, terminalObserved: false }),
    rec({ state: 'cancelled', terminalObserved: false }),
    rec({ state: 'running', terminalObserved: false }),
  ]) {
    assert.notEqual(
      notificationApiFor(present(r, true, 1)),
      'showInformationMessage',
      `${r.state} must be qualified`,
    );
  }
});
