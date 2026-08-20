// Acceptance for structured refusal reasons.
//
// Two things are under test and they pull in opposite directions: a caller must learn WHY
// an operation was refused, and must not learn anything the generic message existed to
// withhold. Every mapping case is asserted, and so is the non-leakage.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyToolFailure } from '../src/engine/toolFailureReason.js';
import { ChangesetError } from '../src/tools/changeset.js';

/** A path and a hash of the kind the engine really interpolates into its messages. */
const SECRET_PATH = '/home/someone/private-workspace/src/credentials.ts';
const SECRET_HASH = 'a'.repeat(64);

test('every engine code maps to its stable reason', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['STALE', 'STALE_CONTENT'],
    ['PARTIAL_WRITE', 'ROLLED_BACK'],
    ['READBACK_MISMATCH', 'ROLLED_BACK'],
    ['INCONSISTENT_STATE', 'INCONSISTENT_STATE'],
    ['CONFLICT', 'CONFLICTING_EDITS'],
    ['UNKNOWN_PROPOSAL', 'PROPOSAL_EXPIRED'],
    ['DELETE_NOT_ALLOWED', 'OPERATION_NOT_PERMITTED'],
    ['TOO_LARGE', 'TOO_LARGE'],
    ['ALREADY_EXISTS', 'TARGET_EXISTS'],
    ['NOT_FOUND', 'TARGET_MISSING'],
    ['INVALID_INPUT', 'INVALID_REQUEST'],
    ['INVALID_RANGE', 'INVALID_REQUEST'],
    ['PATH_ESCAPE', 'PATH_NOT_CONTAINED'],
    ['ABSOLUTE_PATH', 'PATH_NOT_CONTAINED'],
    ['UNSUPPORTED', 'OPERATION_NOT_PERMITTED'],
  ];
  for (const [code, reason] of cases) {
    const classified = classifyToolFailure(Object.assign(new Error('irrelevant'), { code }));
    assert.equal(classified.reason, reason, `${code} must classify as ${reason}`);
    assert.ok(classified.message.length > 0);
  }
});

test('a real ChangesetError classifies from its structured code', () => {
  const error = new ChangesetError('STALE', `source changed since proposal: ${SECRET_PATH}`);
  const classified = classifyToolFailure(error);
  assert.equal(classified.reason, 'STALE_CONTENT');
  assert.match(classified.message, /changed after the change was proposed/);
});

test('THE RAW MESSAGE NEVER LEAVES — paths and hashes are not forwarded', () => {
  for (const error of [
    new ChangesetError('STALE', `source changed since proposal: ${SECRET_PATH}`),
    new ChangesetError('UNKNOWN_PROPOSAL', `no live proposal for ${SECRET_HASH}`),
    Object.assign(new Error(`Path escapes the workspace root: ${SECRET_PATH}`), { code: 'PATH_ESCAPE' }),
  ]) {
    const classified = classifyToolFailure(error);
    const blob = JSON.stringify(classified);
    assert.ok(!blob.includes(SECRET_PATH), 'a filesystem path must never be forwarded');
    assert.ok(!blob.includes(SECRET_HASH), 'a proposal hash must never be forwarded');
    assert.ok(!blob.includes('private-workspace'), 'no fragment of the path may survive');
  }
});

test('a stack trace is never forwarded', () => {
  const error = new ChangesetError('PARTIAL_WRITE', 'apply failed and was rolled back cleanly: x');
  const classified = classifyToolFailure(error);
  const blob = JSON.stringify(classified);
  assert.ok(!blob.includes('at '), 'no stack frames');
  assert.ok(!blob.includes('.ts:'), 'no source locations');
  assert.ok(!('stack' in (classified as unknown as Record<string, unknown>)));
});

test('reverse material — prior file CONTENT — is never forwarded', () => {
  const error = new ChangesetError(
    'PARTIAL_WRITE',
    'rolled back',
    { appliedFileCount: 0, affectedPathCount: 2, rollbackFailureCount: 0, failureStage: 'write' },
    [{ path: SECRET_PATH, previousContent: 'API_KEY=super-secret-value' }],
  );
  const blob = JSON.stringify(classifyToolFailure(error));
  assert.ok(!blob.includes('super-secret-value'), 'reverse material must never cross the boundary');
  assert.ok(!blob.includes(SECRET_PATH));
});

test('a rollback forwards the documented-safe bounded counts', () => {
  const error = new ChangesetError(
    'PARTIAL_WRITE',
    'rolled back',
    { appliedFileCount: 0, affectedPathCount: 3, rollbackFailureCount: 0, failureStage: 'write' },
  );
  const classified = classifyToolFailure(error);
  assert.equal(classified.reason, 'ROLLED_BACK');
  assert.deepEqual(classified.details, {
    appliedFileCount: 0,
    affectedPathCount: 3,
    rollbackFailureCount: 0,
    failureStage: 'write',
  });
  assert.match(classified.message, /rolled back/i);
  assert.match(classified.message, /no file was partially written/i);
});

test('a failed rollback is NOT reported as a clean one', () => {
  const clean = classifyToolFailure(new ChangesetError('PARTIAL_WRITE', 'x'));
  const dirty = classifyToolFailure(new ChangesetError('INCONSISTENT_STATE', 'x'));
  assert.equal(clean.reason, 'ROLLED_BACK');
  assert.equal(dirty.reason, 'INCONSISTENT_STATE');
  assert.match(clean.message, /workspace is unchanged/i);
  assert.match(dirty.message, /rollback did not fully succeed/i);
});

test('details are only attached to rollback-shaped failures', () => {
  const stale = classifyToolFailure(
    new ChangesetError('STALE', 'x', {
      appliedFileCount: 1,
      affectedPathCount: 1,
      rollbackFailureCount: 0,
      failureStage: 'verify',
    }),
  );
  assert.equal(stale.reason, 'STALE_CONTENT');
  assert.equal(stale.details, undefined, 'counts belong to rollback reporting, not every refusal');
});

test('a malformed details object is dropped rather than forwarded', () => {
  const error = Object.assign(new Error('x'), {
    code: 'PARTIAL_WRITE',
    details: { appliedFileCount: 'lots', secret: SECRET_PATH },
  });
  const classified = classifyToolFailure(error);
  assert.equal(classified.details, undefined);
  assert.ok(!JSON.stringify(classified).includes(SECRET_PATH));
});

test('a timeout classifies as TIMEOUT', () => {
  const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
  assert.equal(classifyToolFailure(aborted).reason, 'TIMEOUT');
  assert.equal(classifyToolFailure(Object.assign(new Error('x'), { code: 'ETIMEDOUT' })).reason, 'TIMEOUT');
});

test('an unknown failure keeps the previous generic behaviour', () => {
  for (const error of [new Error('kaboom'), 'a string', undefined, { code: 'SOMETHING_NEW' }]) {
    const classified = classifyToolFailure(error);
    assert.equal(classified.reason, 'INTERNAL_ERROR');
    assert.equal(classified.message, 'The tool could not complete.');
  }
});
