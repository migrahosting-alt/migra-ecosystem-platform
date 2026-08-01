/**
 * Acceptance for the governed coding SURFACE.
 *
 * The question behind every case is the same: can the display ever tell the user
 * something the durable record does not say? A local timer that decides a run
 * finished, a panel that keeps its last phase after the connection drops, a Cancel
 * button that writes "Cancelled" on click — each is closed here.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CodingRunSnapshot } from '../../services/codingRunClient.js';
import {
  approvalDocument,
  childViews,
  decideReload,
  finalReportDocument,
  panelClosureCancelsRun,
  phaseView,
} from '../../services/codingSurfaceModel.js';

function snapshot(over: Partial<CodingRunSnapshot> = {}): CodingRunSnapshot {
  return {
    runId: 'run_1', revision: 7, state: 'EXECUTING', phase: 'validating',
    children: [], blockers: [], statusUrl: '/api/ai/coding/runs/run_1', ...over,
  };
}

const APPROVAL = {
  runId: 'run_1',
  revision: 7,
  pathSetHash: 'hash_abc123',
  expiresAt: '2026-08-01T00:05:00.000Z',
  issueSummary: 'Cancelled lines are still counted in the order total.',
  files: [
    { path: 'src/services/orderTotalsService.js', rationale: 'computes the total', evidence: [{ startLine: 1, endLine: 12, excerptHash: 'e1' }] },
    { path: 'src/contracts/orderTotals.js', rationale: 'declares the response shape', evidence: [{ startLine: 1, endLine: 4, excerptHash: 'e2' }] },
    { path: 'src/routes/orderTotalsRoute.js', rationale: 'projects the response', evidence: [{ startLine: 1, endLine: 8, excerptHash: 'e3' }] },
  ],
  excluded: [{ path: 'src/services/orderTotalsFormatter.js', reason: 'display only; performs no arithmetic' }],
};

// ── 4–5. approval presentation ───────────────────────────────────────────────

test('4 + 5 — the approval panel shows the exact scope, rationale, evidence, hash and expiry', () => {
  const doc = approvalDocument(APPROVAL);

  for (const file of APPROVAL.files) {
    assert.ok(doc.markdown.includes(file.path), `${file.path} must be shown`);
    assert.ok(doc.markdown.includes(file.rationale), 'each file states why it is in scope');
    assert.ok(doc.modalDetail.includes(file.path), 'the modal repeats the exact paths — a decision is not made from a title');
  }
  assert.ok(doc.markdown.includes('lines 1–12'), 'evidence locations render as line ranges');
  assert.ok(doc.markdown.includes('hash_abc123'), 'the scope hash the decision binds to');
  assert.ok(doc.markdown.includes('2026-08-01T00:05:00.000Z'), 'the approval expiry');
  assert.ok(doc.markdown.includes('exactly these 3 file(s)'), 'the boundary is stated as a count');
  assert.ok(doc.markdown.includes('orderTotalsFormatter.js'), 'the excluded candidate and its reason are visible');
  assert.match(doc.markdown, /changes.*asked again|asked again/i, 'the panel warns that a changed scope needs a new decision');
});

test('8 — a superseded proposal is marked prominently in both the document and the modal', () => {
  const doc = approvalDocument({ ...APPROVAL, supersededPreviousProposal: true });
  assert.match(doc.markdown, /REPLACED the one you were shown earlier/);
  assert.match(doc.modalDetail, /REPLACED AN EARLIER ONE/);
  assert.equal(approvalDocument(APPROVAL).modalDetail.includes('REPLACED'), false, 'a first proposal is not falsely marked');
});

test('a file with no evidence spans is flagged rather than shown as justified', () => {
  const doc = approvalDocument({ ...APPROVAL, files: [{ path: 'src/x.ts', rationale: 'because', evidence: [] }] });
  assert.match(doc.markdown, /No evidence spans recorded/);
});

// ── 10 + phase rendering ─────────────────────────────────────────────────────

test('10 — a requested cancellation is never displayed as cancelled', () => {
  const requested = snapshot({ cancellation: { requestedAt: 't1', status: 'cancelling' } });
  assert.equal(phaseView(requested).label, 'Cancellation requested');
  assert.notEqual(phaseView(requested).label, 'Cancelled');

  const confirmed = snapshot({ phase: 'terminal', state: 'CANCELLED', cancellation: { requestedAt: 't1', confirmedAt: 't2', status: 'cancelled' } });
  assert.equal(phaseView(confirmed).label, 'Cancelled');
  assert.equal(phaseView(confirmed).busy, false);

  // Requested, but the run ended some other way.
  const unconfirmed = snapshot({ phase: 'terminal', state: 'FAILED', cancellation: { requestedAt: 't1', status: 'cancelling' } });
  assert.equal(phaseView(unconfirmed).label, 'Cancellation could not be confirmed');
});

test('a pending cancellation outranks the phase, so a stop request never looks ignored', () => {
  const view = phaseView(snapshot({ phase: 'repairing', cancellation: { requestedAt: 't1', status: 'cancelling' } }));
  assert.equal(view.label, 'Cancellation requested');
  assert.notEqual(view.label, 'Repairing');
});

test('every durable phase has a human label and busy is derived from the record', () => {
  const cases: Array<[string, string, boolean]> = [
    ['planning', 'Planning', true],
    ['awaiting_scope_approval', 'Awaiting approval', true],
    ['executing_initial_changeset', 'Applying changes', true],
    ['validating', 'Validating', true],
    ['repairing', 'Repairing', true],
    ['reconciling', 'Reconciling', true],
  ];
  for (const [phase, label, busy] of cases) {
    const view = phaseView(snapshot({ phase }));
    assert.equal(view.label, label);
    assert.equal(view.busy, busy);
  }
  for (const [state, label] of [['COMPLETED', 'Completed'], ['FAILED', 'Failed'], ['REJECTED', 'Rejected']] as const) {
    assert.equal(phaseView(snapshot({ phase: 'terminal', state })).label, label);
    assert.equal(phaseView(snapshot({ phase: 'terminal', state })).busy, false);
  }
});

test('child outcomes render in plain language, never raw internals', () => {
  const views = childViews(snapshot({
    children: [
      { childId: 'c1', kind: 'repository_planning', attempt: 1, state: 'completed', required: true, terminalCategory: 'observed_success' },
      { childId: 'c2', kind: 'validation', attempt: 1, state: 'failed', required: false, terminalCategory: 'observed_failure' },
      { childId: 'c3', kind: 'repair_apply', attempt: 1, state: 'running', required: false },
      { childId: 'c4', kind: 'final_validation', attempt: 1, state: 'created', required: true },
    ],
  }));
  assert.deepEqual(views.map((v) => `${v.label}:${v.outcome}`), [
    'Read the repository:succeeded',
    'Ran validation:failed',
    'Applied the repair:running',
    'Final validation:pending',
  ]);
  assert.equal(JSON.stringify(views).includes('childId'), false, 'internal ids are not surfaced');
});

// ── 17. final report ─────────────────────────────────────────────────────────

test('17 — the final report is rendered from Brain evidence, not local assumptions', () => {
  const report = finalReportDocument(snapshot({
    phase: 'terminal', state: 'COMPLETED', revision: 21,
    children: [
      { childId: 'c1', kind: 'validation', attempt: 1, state: 'failed', required: false, terminalCategory: 'observed_failure' },
      { childId: 'c2', kind: 'repair_model_proposal', attempt: 1, state: 'completed', required: false, terminalCategory: 'observed_success' },
      { childId: 'c3', kind: 'final_validation', attempt: 1, state: 'completed', required: true, terminalCategory: 'observed_success' },
    ],
    latestValidation: { commandRunId: 'cmd_9', command: ['node', '--test'], exitCode: 0, timedOut: false, passed: true, outputHead: 'ok' },
    finalReport: {
      stopReason: 'validated', complete: true,
      changedFiles: ['src/a.ts', 'src/b.ts'],
      approvedPaths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      refusedPaths: ['src/evil.ts'],
      unusedScope: ['src/c.ts'],
      unresolvedRisks: ['a rollback was not verified'],
    },
  }));

  assert.match(report, /Completed/);
  assert.match(report, /\*\*Complete:\*\* yes/);
  assert.match(report, /stopReason|Stop reason/);
  assert.match(report, /src\/a\.ts/);
  assert.match(report, /Refused \(outside authority\).*src\/evil\.ts/);
  assert.match(report, /Approved but never written.*src\/c\.ts/);
  assert.match(report, /Ran validation \(attempt 1\): \*\*failed\*\*/, 'the initial failure stays visible');
  assert.match(report, /Final validation \(attempt 1\): \*\*passed\*\*/);
  assert.match(report, /node --test/);
  assert.match(report, /a rollback was not verified/);
});

test('a terminal run with no Brain report says so rather than inventing one', () => {
  const report = finalReportDocument(snapshot({ phase: 'terminal', state: 'FAILED', blockers: ['required_child_not_successful: c1'] }));
  assert.match(report, /recorded no final report/);
  assert.match(report, /required_child_not_successful/);
  assert.equal(report.includes('**Complete:** yes'), false, 'absence of a report is never rendered as success');
});

// ── 14–16. reload recovery ───────────────────────────────────────────────────

test('14 — reload restores an active run by asking the Brain', () => {
  const active = decideReload({ storedRunId: 'run_1', lookup: { kind: 'ok', value: snapshot({ phase: 'repairing' }) } });
  assert.equal(active.kind, 'restore_progress');

  const awaiting = decideReload({ storedRunId: 'run_1', lookup: { kind: 'ok', value: snapshot({ phase: 'awaiting_scope_approval' }) } });
  assert.equal(awaiting.kind, 'restore_approval');

  const done = decideReload({ storedRunId: 'run_1', lookup: { kind: 'ok', value: snapshot({ phase: 'terminal', state: 'COMPLETED' }) } });
  assert.equal(done.kind, 'show_final');
});

test('15 — a missing run and an unavailable capability stay distinct', () => {
  assert.equal(decideReload({ storedRunId: 'run_1', lookup: { kind: 'not_found' } }).kind, 'run_missing');

  const offByConfig = decideReload({
    storedRunId: 'run_1',
    capability: { available: false, unavailableReason: 'disabled by configuration' },
    lookup: { kind: 'not_found' },
  });
  assert.equal(offByConfig.kind, 'capability_unavailable', 'a disabled capability is not a vanished run');
  assert.equal(offByConfig.kind === 'capability_unavailable' && offByConfig.detail, 'disabled by configuration');

  assert.equal(decideReload({ storedRunId: 'run_1', lookup: { kind: 'capability_unavailable', detail: 'not mounted' } }).kind, 'capability_unavailable');
});

test('16 — a corrupt durable record is surfaced explicitly, never as "not found"', () => {
  const decision = decideReload({ storedRunId: 'run_1', lookup: { kind: 'corrupt', detail: 'payload failed validation' } });
  assert.equal(decision.kind, 'unreadable');
  assert.notEqual(decision.kind, 'run_missing');
  assert.equal(decision.kind === 'unreadable' && decision.detail, 'payload failed validation');
});

test('reload never infers a terminal state from the extension having restarted', () => {
  // No stored run: nothing is claimed either way.
  assert.equal(decideReload({ lookup: { kind: 'not_found' } }).kind, 'nothing_to_restore');
  // A run that was mid-flight stays mid-flight until the Brain says otherwise.
  const decision = decideReload({ storedRunId: 'run_1', lookup: { kind: 'ok', value: snapshot({ phase: 'executing_initial_changeset', state: 'EXECUTING' }) } });
  assert.equal(decision.kind, 'restore_progress');
  assert.equal(decision.kind === 'restore_progress' && decision.snapshot.phase, 'executing_initial_changeset');
  // A transport problem is not a verdict about the run.
  assert.equal(decideReload({ storedRunId: 'run_1', lookup: { kind: 'other', detail: 'ECONNREFUSED' } }).kind, 'unknown');
});

// ── 18. panel closure ────────────────────────────────────────────────────────

test('18 — closing the UI never manufactures a cancellation', () => {
  assert.equal(panelClosureCancelsRun(), false);
  // A snapshot with no cancellation renders no cancellation label, regardless of
  // what the surface did locally.
  assert.equal(phaseView(snapshot({ phase: 'validating' })).label, 'Validating');
  assert.equal(finalReportDocument(snapshot({ phase: 'terminal', state: 'COMPLETED' })).includes('Cancelled'), false);
});
