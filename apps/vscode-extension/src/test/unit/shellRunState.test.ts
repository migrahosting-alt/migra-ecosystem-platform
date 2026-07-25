import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentModeCommandRunView, AgentModeRunHistorySummary, AgentModeState } from '@migrapilot/protocol';
import {
  HISTORY_SORTS,
  approvalBadge,
  historyControlAvailability,
  integrityBadge,
  isTerminalState,
  recoveryBadge,
  riskBadge,
  runControlAvailability,
  runStateBadge,
} from '../../panel/shell/runStateModel.js';
import { toRunHistoryList, toRunHistoryRow, toRunDetail, EVIDENCE_ONLY_NOTE } from '../../panel/shell/runHistoryModel.js';

const ALL_STATES: readonly AgentModeState[] = [
  'IDLE',
  'PLANNING',
  'AWAITING_APPROVAL',
  'APPROVED',
  'EXECUTING',
  'COMPLETED',
  'REJECTED',
  'EXPIRED',
  'STALE',
  'FAILED',
  'CANCELLED',
];

function preview(overrides: Record<string, unknown> = {}) {
  return {
    recipe: 'git.status' as const,
    policyVersion: 'policy-1',
    executionIdentity: 'engine',
    environmentPolicy: 'minimal',
    workspaceMaterialFingerprint: 'MATERIAL-SECRET-FINGERPRINT',
    snapshotId: 'SNAPSHOT-MANIFEST-DIGEST',
    sourceWorkspace: '/home/operator/private/repo',
    executable: '/usr/bin/git',
    arguments: ['status', '--porcelain'],
    cwd: '/home/operator/private/repo',
    timeoutMs: 5000,
    outputLimitBytes: 65536,
    mutationClassification: 'read-only' as const,
    networkPolicy: 'not-required' as const,
    expectedEffects: ['Reads the working tree state.'],
    reason: 'Inspect the repository state.',
    requestId: 'req-1234567890',
    fingerprint: 'FINGERPRINT-APPROVAL-AUTHORITY',
    expiresAt: 2_000_000,
    warnings: [],
    environment: [{ key: 'GIT_TERMINAL_PROMPT', value: '0', redacted: false }],
    canModifyFiles: false,
    ...overrides,
  };
}

function runView(state: AgentModeState, overrides: Partial<AgentModeCommandRunView> = {}): AgentModeCommandRunView {
  return {
    runId: 'agentcmd_8d704cc4-e182-456b-91bc-5ef1a0318d66',
    requestId: 'req-1234567890',
    state,
    preview: preview(),
    createdAt: 1_000_000,
    updatedAt: 1_000_500,
    ...overrides,
  } as AgentModeCommandRunView;
}

test('every canonical run state maps to a badge with the exact backend term', () => {
  for (const state of ALL_STATES) {
    const badge = runStateBadge(state);
    assert.equal(badge.text, state, 'security-relevant state text must be verbatim');
    assert.ok(badge.title && badge.title.length > 0, `${state} needs an accessible description`);
  }
});

test('run state tone mapping follows the palette contract', () => {
  assert.equal(runStateBadge('COMPLETED').tone, 'ok');
  assert.equal(runStateBadge('AWAITING_APPROVAL').tone, 'governed');
  assert.equal(runStateBadge('APPROVED').tone, 'governed');
  assert.equal(runStateBadge('EXECUTING').tone, 'info');
  assert.equal(runStateBadge('EXPIRED').tone, 'warn');
  assert.equal(runStateBadge('STALE').tone, 'warn');
  assert.equal(runStateBadge('REJECTED').tone, 'error');
  assert.equal(runStateBadge('FAILED').tone, 'error');
  assert.equal(runStateBadge('CANCELLED').tone, 'error');
  assert.equal(runStateBadge('IDLE').tone, 'muted');
});

test('integrity badges map TRUSTED/WARNING/UNTRUSTED and surface issues', () => {
  assert.deepEqual(
    { text: integrityBadge('TRUSTED').text, tone: integrityBadge('TRUSTED').tone },
    { text: 'TRUSTED', tone: 'ok' },
  );
  assert.equal(integrityBadge('WARNING').tone, 'warn');
  assert.equal(integrityBadge('UNTRUSTED').tone, 'error');
  // Unknown integrity is NEVER shown as green.
  assert.equal(integrityBadge(undefined).tone, 'muted');
  assert.equal(integrityBadge('SOMETHING_NEW').tone, 'muted');
  assert.match(integrityBadge('WARNING', ['audit gap at seq 4']).title ?? '', /audit gap at seq 4/);
});

test('approval lifecycle badges keep canonical terminology', () => {
  assert.equal(approvalBadge('LOST_ON_RESTART').text, 'LOST_ON_RESTART');
  assert.equal(approvalBadge('LOST_ON_RESTART').tone, 'warn');
  assert.equal(approvalBadge('APPROVED').tone, 'ok');
  assert.equal(approvalBadge('REJECTED').tone, 'error');
  assert.equal(approvalBadge(undefined).text, 'NOT_REQUESTED');
});

test('recovery badges keep canonical terminology and never imply resume', () => {
  const badge = recoveryBadge('REPROPOSAL_REQUIRED');
  assert.equal(badge.text, 'REPROPOSAL_REQUIRED');
  assert.equal(badge.tone, 'warn');
  assert.match(badge.title ?? '', /never resumes/i);
  assert.equal(recoveryBadge('AUTHORIZATION_LOST').tone, 'error');
  assert.equal(recoveryBadge(undefined).text, 'NONE');
});

test('risk badge derives from the engine mutation classification, not model text', () => {
  assert.equal(riskBadge('read-only', false).text, 'READ-ONLY');
  assert.equal(riskBadge('read-only', false).tone, 'ok');
  assert.equal(riskBadge('workspace-write-possible', true).tone, 'governed');
  // No classification reported → explicitly unknown, never "safe".
  assert.equal(riskBadge(undefined, undefined).text, 'RISK UNKNOWN');
  assert.equal(riskBadge(undefined, undefined).tone, 'muted');
});

test('approve and reject are offered ONLY for AWAITING_APPROVAL with a live preview', () => {
  for (const state of ALL_STATES) {
    const controls = runControlAvailability(runView(state));
    const expected = state === 'AWAITING_APPROVAL';
    assert.equal(controls.approve, expected, `approve must be ${expected} for ${state}`);
    assert.equal(controls.reject, expected, `reject must be ${expected} for ${state}`);
  }
});

test('approval is refused when the authoritative preview is missing', () => {
  const controls = runControlAvailability(runView('AWAITING_APPROVAL', { preview: undefined }));
  assert.equal(controls.approve, false, 'no preview means no fingerprint to bind — never offer approval');
  assert.equal(controls.reject, false);
  assert.equal(controls.reviewDiff, false);
});

test('cancel is offered only for live states and resume never exists', () => {
  const live: AgentModeState[] = ['PLANNING', 'AWAITING_APPROVAL', 'APPROVED', 'EXECUTING'];
  for (const state of ALL_STATES) {
    const controls = runControlAvailability(runView(state));
    assert.equal(controls.cancel, live.includes(state), `cancel for ${state}`);
    assert.equal(controls.resume, false, 'resume must never be available');
  }
});

test('fresh proposal requires SERVER eligibility, never client inference', () => {
  assert.equal(runControlAvailability(runView('EXPIRED')).freshProposal, false);
  assert.equal(
    runControlAvailability(runView('EXPIRED', { recovery: { classification: 'REPROPOSAL_REQUIRED', eligible: true } })).freshProposal,
    true,
  );
  assert.equal(
    runControlAvailability(runView('EXPIRED', { recovery: { classification: 'TERMINAL_NO_RECOVERY', eligible: false } })).freshProposal,
    false,
  );
});

test('interrupted runs carry an explicit "create a new proposal" note', () => {
  for (const state of ['STALE', 'FAILED', 'EXPIRED'] as AgentModeState[]) {
    assert.match(runControlAvailability(runView(state)).interruptedNote ?? '', /new proposal/i);
  }
  assert.equal(runControlAvailability(runView('COMPLETED')).interruptedNote, undefined);
});

test('an absent run yields no controls at all', () => {
  const controls = runControlAvailability(undefined);
  assert.deepEqual(
    { ...controls },
    {
      approve: false,
      reject: false,
      cancel: false,
      reconcile: false,
      resume: false,
      freshProposal: false,
      reviewDiff: false,
      inspectEvidence: false,
      exportEvidence: false,
    },
  );
});

test('history controls expose evidence reads ONLY — no execution authority', () => {
  const controls = historyControlAvailability();
  assert.equal(controls.approve, false);
  assert.equal(controls.reject, false);
  assert.equal(controls.cancel, false);
  assert.equal(controls.reconcile, false);
  assert.equal(controls.resume, false);
  assert.equal(controls.freshProposal, false);
  assert.equal(controls.inspectEvidence, true);
  assert.equal(controls.exportEvidence, true);
});

test('terminal state classification matches the protocol', () => {
  assert.equal(isTerminalState('COMPLETED'), true);
  assert.equal(isTerminalState('EXPIRED'), true);
  assert.equal(isTerminalState('STALE'), true);
  assert.equal(isTerminalState('AWAITING_APPROVAL'), false);
  assert.equal(isTerminalState('EXECUTING'), false);
});

test('history sorts match the protocol enum', () => {
  assert.deepEqual([...HISTORY_SORTS], ['updatedAt.desc', 'requestedAt.desc', 'terminalAt.desc']);
});

// ── History rendering ─────────────────────────────────────────────────────────

function historySummary(overrides: Partial<AgentModeRunHistorySummary> = {}): AgentModeRunHistorySummary {
  return {
    runId: 'agentcmd_history_1111-2222-3333',
    requestId: 'req-history-1',
    state: 'EXPIRED',
    recipe: 'git.status',
    requestedAt: 900_000,
    updatedAt: 950_000,
    terminalAt: 950_000,
    approvalLifecycle: 'LOST_ON_RESTART',
    recoveryClass: 'REPROPOSAL_REQUIRED',
    recoveryEligible: true,
    snapshotId: 'SNAPSHOT-MANIFEST-DIGEST',
    mutationClassification: 'read-only',
    networkPolicy: 'not-required',
    eventCount: 4,
    integrity: 'TRUSTED',
    integrityIssues: [],
    ...overrides,
  } as AgentModeRunHistorySummary;
}

test('every history row is evidence-only and never renders a snapshot digest', () => {
  const row = toRunHistoryRow(historySummary(), 1_000_000);
  assert.equal(row.controls.approve, false);
  assert.equal(row.controls.cancel, false);
  assert.equal(row.controls.freshProposal, false);
  const ids = row.actions.map((action) => action.id);
  assert.deepEqual(ids, ['inspectEvidence', 'exportEvidence']);
  const serialized = JSON.stringify(row);
  assert.doesNotMatch(serialized, /SNAPSHOT-MANIFEST-DIGEST/);
  assert.doesNotMatch(serialized, /FINGERPRINT/);
});

test('run history list reports activation-required rather than an empty list', () => {
  const model = toRunHistoryList(undefined, 1_000_000, { kind: 'activation', message: 'Activation required.' });
  assert.equal(model.state, 'activation-required');
  assert.equal(model.rows.length, 0);
  assert.match(model.message ?? '', /Activation required/);
});

test('run history list distinguishes loading, empty and transport failure', () => {
  assert.equal(toRunHistoryList(undefined, 1).state, 'loading');
  assert.equal(toRunHistoryList(undefined, 1, { kind: 'transport', message: 'nope' }).state, 'disconnected');
  const empty = toRunHistoryList(
    {
      runs: [],
      query: { sort: 'updatedAt.desc', limit: 25 },
      retention: { terminalRetentionMs: 604_800_000, retentionBatchSize: 50, tombstoneCount: 2, governance: 'READ_ONLY' },
    } as never,
    1_000_000,
  );
  assert.equal(empty.state, 'empty');
  assert.match(empty.retentionNote ?? '', /READ_ONLY/);
});

test('run detail is evidence-only, sanitized, and keeps canonical terms', () => {
  const detail = toRunDetail(
    {
      summary: historySummary(),
      preview: preview() as never,
      result: { recipe: 'git.status', exitCode: 0, timedOut: false, stdout: '', stderr: '', truncated: false, redacted: true, durationMs: 120 },
      timeline: [
        { eventId: 'e1', seq: 1, at: 900_000, type: 'PROPOSED', nextState: 'PLANNING', source: 'API' },
        { eventId: 'e2', seq: 2, at: 910_000, type: 'DISPLAYED', priorState: 'PLANNING', nextState: 'AWAITING_APPROVAL', source: 'APPROVAL' },
      ],
      lineage: {},
      retention: { eligibleForDeletion: false, reason: 'within retention window' },
    } as never,
    1_000_000,
  );

  assert.equal(detail.state, 'ready');
  assert.equal(detail.evidenceNote, EVIDENCE_ONLY_NOTE);
  assert.equal(detail.controls.approve, false);
  assert.equal(detail.controls.resume, false);
  assert.deepEqual(detail.actions.map((action) => action.id), ['inspectEvidence', 'exportEvidence']);

  const serialized = JSON.stringify(detail);
  assert.doesNotMatch(serialized, /FINGERPRINT-APPROVAL-AUTHORITY/, 'no approval fingerprint in evidence view');
  assert.doesNotMatch(serialized, /SNAPSHOT-MANIFEST-DIGEST/, 'no snapshot manifest digest in evidence view');
  assert.doesNotMatch(serialized, /MATERIAL-SECRET-FINGERPRINT/, 'no workspace material fingerprint');
  assert.doesNotMatch(serialized, /home\/operator\/private/, 'no raw filesystem path');
  // Canonical, security-relevant terms ARE shown verbatim.
  assert.match(serialized, /LOST_ON_RESTART/);
  assert.match(serialized, /REPROPOSAL_REQUIRED/);
  assert.match(serialized, /TRUSTED/);
});

test('empty run detail still reports the evidence-only rule', () => {
  const detail = toRunDetail(undefined, 1);
  assert.equal(detail.state, 'empty');
  assert.equal(detail.evidenceNote, EVIDENCE_ONLY_NOTE);
  assert.equal(detail.actions.length, 0);
  assert.equal(detail.controls.approve, false);
});
