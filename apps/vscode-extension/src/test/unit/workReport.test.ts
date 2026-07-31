// The machine-authored work report must be consistent and truthful about what
// happened after every build task (applied vs proposed vs cancelled). © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWorkReport } from '../../chat/workReport.js';

test('applied build reports the files and an Applied status', () => {
  const r = buildWorkReport({
    task: 'build me an app named Bonex that plays music',
    root: '/home/me/bonex',
    proposedFiles: [{ path: 'index.html', kind: 'add' }, { path: 'app.js', kind: 'add' }],
    applied: true,
    cancelled: false,
  });
  assert.match(r, /### 📋 Summary/);
  assert.match(r, /\*\*Task:\*\* build me an app named Bonex/);
  assert.match(r, /\*\*Folder:\*\* `\/home\/me\/bonex`/);
  assert.match(r, /\*\*Files:\*\* 2 — `index\.html`.*`app\.js`/);
  assert.match(r, /Applied to the workspace/);
});

test('proposed-but-not-applied reports how to apply', () => {
  const r = buildWorkReport({ task: 't', root: '/w', proposedFiles: [{ path: 'a.js' }], applied: false, cancelled: false });
  assert.match(r, /not applied yet/i);
  assert.match(r, /click \*\*Apply\*\*|autoApplyChangeset/);
});

test('auto-apply that did not complete is reported honestly (not a false success)', () => {
  const r = buildWorkReport({ task: 't', root: '/w', proposedFiles: [{ path: 'a.js' }], applied: false, cancelled: false, autoApply: true });
  assert.match(r, /NOT applied/);
  assert.doesNotMatch(r, /Applied to the workspace/);
});

test('a run with no file changes states the fact and claims no success', () => {
  // Regression: this used to report "✅ Done". A green tick under "none proposed"
  // reads as success, and the owner saw exactly that after a build order that
  // produced nothing at all. Neutral wording is right for both cases — a task
  // like "run the tests" legitimately writes no files.
  const r = buildWorkReport({ task: 'run the tests', root: '/w', proposedFiles: [], applied: false, cancelled: false });
  assert.match(r, /none proposed/);
  assert.match(r, /No files were created or changed/);
  assert.doesNotMatch(r, /✅/, 'never a success tick when nothing was produced');
});

test('a cancelled run reports Stopped and no changes', () => {
  const r = buildWorkReport({ task: 't', root: '/w', proposedFiles: [{ path: 'a.js' }], applied: false, cancelled: true });
  assert.match(r, /Stopped/);
  assert.match(r, /no changes were applied/);
  assert.doesNotMatch(r, /Files:/);
});

test('a long file list is truncated with a "+N more" tail', () => {
  const files = Array.from({ length: 20 }, (_, i) => ({ path: `src/f${i}.ts`, kind: 'add' }));
  const r = buildWorkReport({ task: 't', root: '/w', proposedFiles: files, applied: true, cancelled: false });
  assert.match(r, /\*\*Files:\*\* 20 —/);
  assert.match(r, /\+8 more/);
});

// ── convergence: the execution snapshot is the only authority ────────────────

import { SCHEMA_VERSION, type PersistedBrainOperation } from '../../services/brainPersistence.js';

const rec = (over: Partial<PersistedBrainOperation> = {}): PersistedBrainOperation => ({
  schemaVersion: SCHEMA_VERSION,
  revision: 3,
  operationId: 'op-42',
  requestedAction: 'chat',
  operationKind: 'consequential',
  currentState: 'completed',
  startedAt: 'T0',
  updatedAt: 'T1',
  endedAt: 'T1',
  transitions: [],
  invariantViolations: [],
  precondition: { required: false },
  transportAttempts: [],
  commands: [],
  changedFiles: [],
  tests: [],
  failures: [],
  remainingWork: [],
  terminalEvidence: { observedAt: 'T1', outcome: 'success', evidenceType: 'parsed-body' },
  ...over,
});

const base = { task: 't', root: '/w', proposedFiles: [{ path: 'a.js' }], applied: true };

test('the persisted record overrides a stale manual cancelled=false', () => {
  const r = buildWorkReport({
    ...base,
    cancelled: false, // deprecated input, deliberately wrong
    execution: { record: rec({ currentState: 'cancelled', terminalEvidence: undefined }), currentRevision: 3 },
  });
  assert.match(r, /Stopped/, 'the record says cancelled, so the report must say cancelled');
});

test('the persisted record overrides a stale manual cancelled=true', () => {
  const r = buildWorkReport({
    ...base,
    cancelled: true, // deprecated input, deliberately wrong
    execution: { record: rec(), currentRevision: 3 },
  });
  assert.doesNotMatch(r, /Stopped/, 'the record says completed, so the report must not claim cancelled');
});

test('every report carries its operation id and revision', () => {
  const r = buildWorkReport({ ...base, cancelled: false, execution: { record: rec(), currentRevision: 3 } });
  assert.match(r, /operation `op-42`/);
  assert.match(r, /revision 3/);
});

test('a report rendered from a stale revision is visibly marked', () => {
  const r = buildWorkReport({
    ...base,
    cancelled: false,
    execution: { record: rec({ revision: 2 }), currentRevision: 5 },
  });
  assert.match(r, /STALE REPORT/);
  assert.match(r, /revision 5 is authoritative/);
});

test('completed WITHOUT terminal evidence is not reported as success', () => {
  const r = buildWorkReport({
    ...base,
    cancelled: false,
    execution: { record: rec({ terminalEvidence: undefined }), currentRevision: 3 },
  });
  assert.match(r, /without\*\* durable terminal evidence/);
});

test('an interrupted record is surfaced, never rendered as a clean run', () => {
  const r = buildWorkReport({
    ...base,
    cancelled: false,
    execution: {
      record: rec({ currentState: 'failed', recovery: { evidence: 'operation_interrupted', recoveredAt: 'T2' } }),
      currentRevision: 3,
    },
  });
  assert.match(r, /Interrupted \(operation_interrupted\)/);
});

test('cancellation requested but unconfirmed says exactly that', () => {
  const r = buildWorkReport({
    ...base,
    cancelled: false,
    execution: {
      record: rec({ currentState: 'failed', cancellation: { requestedAt: 'T', confirmed: false } }),
      currentRevision: 3,
    },
  });
  assert.match(r, /Cancellation requested but not confirmed/);
});
