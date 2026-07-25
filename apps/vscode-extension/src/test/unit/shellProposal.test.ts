import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentModeCommandRunView, AgentModeRunHistoryEvent, AgentModeState } from '@migrapilot/protocol';
import {
  PROPOSAL_DENY_LIST,
  approvalConsentDetail,
  executableLabel,
  pathLabel,
  toProgressStages,
  toProposalCard,
} from '../../panel/shell/proposalCardModel.js';

const NOW = 1_700_000_000_000;

/** Deliberately seeds EVERY field the UI must never display. */
function preview(overrides: Record<string, unknown> = {}) {
  return {
    recipe: 'git.diff' as const,
    policyVersion: 'agent-policy-v3',
    executionIdentity: 'engine-service-account',
    environmentPolicy: 'minimal-allowlist',
    workspaceMaterialFingerprint: 'WSMATERIAL_deadbeefcafe',
    snapshotId: 'SNAPSHOTID_manifest_digest_0099',
    sourceWorkspace: '/home/bonex/workspace/active/MigraTeck-Ecosystem/dev',
    executable: '/usr/lib/git-core/git',
    arguments: ['diff', '--stat'],
    cwd: '/home/bonex/workspace/active/MigraTeck-Ecosystem/dev',
    timeoutMs: 15000,
    outputLimitBytes: 131072,
    mutationClassification: 'read-only' as const,
    networkPolicy: 'not-required' as const,
    expectedEffects: ['Reads tracked file differences.', 'Writes nothing.'],
    reason: 'Add a health endpoint message to the Brain service.',
    requestId: 'req_aaaaaaaabbbbbbbbcccccccc',
    fingerprint: 'FPRINT_do_not_display_1234567890',
    expiresAt: NOW + 120_000,
    warnings: ['The working tree is dirty.'],
    environment: [
      { key: 'GIT_TERMINAL_PROMPT', value: '0', redacted: false },
      { key: 'GIT_ASKPASS', value: 'SUPER_SECRET_VALUE', redacted: true },
    ],
    canModifyFiles: false,
    ...overrides,
  };
}

function runView(state: AgentModeState = 'AWAITING_APPROVAL', overrides: Partial<AgentModeCommandRunView> = {}): AgentModeCommandRunView {
  return {
    runId: 'agentcmd_8d704cc4-e182-456b-91bc-5ef1a0318d66',
    requestId: 'req_aaaaaaaabbbbbbbbcccccccc',
    state,
    preview: preview(),
    approval: { lifecycle: 'DISPLAYED', requestedAt: NOW - 5_000, displayedAt: NOW - 4_000, expiresAt: NOW + 120_000 },
    createdAt: NOW - 10_000,
    updatedAt: NOW - 1_000,
    ...overrides,
  } as AgentModeCommandRunView;
}

test('path and executable labels reduce absolute paths to a single segment', () => {
  assert.equal(pathLabel('/home/bonex/workspace/active/dev'), 'dev');
  assert.equal(pathLabel('C:\\Users\\bonex\\repo\\'), 'repo');
  assert.equal(pathLabel(undefined), undefined);
  assert.equal(executableLabel('/usr/lib/git-core/git'), 'git');
  assert.equal(executableLabel('C:\\Program Files\\Git\\cmd\\git.exe'), 'git.exe');
});

test('the proposal card NEVER carries approval or snapshot authority material', () => {
  const card = toProposalCard(runView(), NOW);
  const serialized = JSON.stringify(card);

  assert.doesNotMatch(serialized, /FPRINT_do_not_display/, 'proposal fingerprint must never reach the webview');
  assert.doesNotMatch(serialized, /SNAPSHOTID_manifest_digest/, 'snapshot manifest digest must never be displayed');
  assert.doesNotMatch(serialized, /WSMATERIAL_deadbeefcafe/, 'workspace material fingerprint must never be displayed');
  assert.doesNotMatch(serialized, /SUPER_SECRET_VALUE/, 'environment VALUES must never be displayed');
  assert.doesNotMatch(serialized, /home\/bonex/, 'raw filesystem paths must never be displayed');
  assert.doesNotMatch(serialized, /usr\/lib\/git-core/, 'raw executable paths must never be displayed');

  for (const denied of PROPOSAL_DENY_LIST) {
    assert.ok(!Object.prototype.hasOwnProperty.call(card, denied), `card must not have a "${denied}" field`);
  }
});

test('the proposal card shows environment KEYS with a redaction flag only', () => {
  const card = toProposalCard(runView(), NOW);
  assert.equal(card.environmentKeys.length, 2);
  assert.deepEqual(
    card.environmentKeys.map((row) => [row.label, row.value]),
    [
      ['GIT_TERMINAL_PROMPT', 'set by policy'],
      ['GIT_ASKPASS', 'redacted by policy'],
    ],
  );
});

test('the proposal card surfaces sanitized policy facts and the approval requirement', () => {
  const card = toProposalCard(runView(), NOW);
  const byLabel = new Map(card.policy.map((row) => [row.label, row.value]));
  assert.equal(byLabel.get('Recipe'), 'git.diff');
  assert.equal(byLabel.get('Policy version'), 'agent-policy-v3');
  assert.equal(byLabel.get('Executable'), 'git');
  assert.equal(byLabel.get('Working directory'), 'dev');
  assert.equal(byLabel.get('Workspace'), 'dev');
  assert.equal(byLabel.get('Mutation'), 'read-only');
  assert.equal(byLabel.get('Can modify files'), 'no');
  assert.equal(byLabel.get('Approval requirement'), 'Explicit one-time approval');
});

test('validation is reported as "Not run yet" and never claimed to pass', () => {
  const card = toProposalCard(runView(), NOW);
  assert.equal(card.validation.state, 'not-run');
  assert.equal(card.validation.checks.length, 0);
  assert.match(card.validation.note, /Not run yet/);
  assert.doesNotMatch(JSON.stringify(card.validation), /passed/i);
});

test('changes report the engine classification instead of a fabricated zero count', () => {
  const card = toProposalCard(runView(), NOW);
  assert.equal(card.changes.fileCount, undefined, 'no invented "0 files changed"');
  assert.equal(card.changes.additions, undefined);
  assert.equal(card.changes.deletions, undefined);
  assert.deepEqual(card.changes.expectedEffects, ['Reads tracked file differences.', 'Writes nothing.']);
  assert.match(card.changes.note, /read-only/);

  const writable = toProposalCard(
    runView('AWAITING_APPROVAL', { preview: preview({ mutationClassification: 'workspace-write-possible', canModifyFiles: true }) as never }),
    NOW,
  );
  assert.match(writable.changes.note, /may write/);
  assert.equal(writable.risk.tone, 'governed');
});

test('card actions are Review Diff / Reject / Approve & Run with governed accent', () => {
  const card = toProposalCard(runView(), NOW);
  assert.deepEqual(card.actions.map((action) => action.label), ['Review Diff', 'Reject', 'Approve & Run']);
  assert.deepEqual(card.actions.map((action) => action.kind), ['primary', 'danger', 'governed']);
  assert.equal(card.actions.every((action) => action.disabled !== true), true, 'all enabled while awaiting approval');
});

test('card actions are disabled with a reason once the run is terminal', () => {
  const card = toProposalCard(runView('EXPIRED'), NOW);
  const approve = card.actions.find((action) => action.id === 'approve');
  assert.equal(approve?.disabled, true);
  assert.match(approve?.disabledReason ?? '', /awaiting approval/i);
  assert.equal(card.heading, 'PROPOSAL EXPIRED');
});

test('the expiry countdown is derived from authoritative timestamps', () => {
  assert.match(toProposalCard(runView(), NOW).expiresInLabel ?? '', /Expires in 2m/);
  assert.equal(toProposalCard(runView(), NOW + 200_000).expiresInLabel, 'Approval window closed');
});

test('headings cover every canonical state', () => {
  const states: AgentModeState[] = ['IDLE', 'PLANNING', 'AWAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'COMPLETED', 'REJECTED', 'EXPIRED', 'STALE', 'FAILED', 'CANCELLED'];
  for (const state of states) {
    const heading = toProposalCard(runView(state), NOW).heading;
    assert.ok(heading.length > 0, `${state} needs a heading`);
  }
});

// ── Agent progress ────────────────────────────────────────────────────────────

test('progress stages are complete only when the backend advanced past them', () => {
  const planning = toProgressStages(runView('PLANNING'));
  assert.deepEqual(
    planning.map((stage) => [stage.id, stage.status]),
    [['queued', 'complete'], ['planning', 'active'], ['approval', 'pending'], ['executing', 'pending'], ['validating', 'pending']],
  );

  const awaiting = toProgressStages(runView('AWAITING_APPROVAL'));
  assert.equal(awaiting.find((stage) => stage.id === 'planning')?.status, 'complete');
  assert.equal(awaiting.find((stage) => stage.id === 'approval')?.status, 'active');
  assert.equal(awaiting.find((stage) => stage.id === 'executing')?.status, 'pending');

  const completed = toProgressStages(runView('COMPLETED'));
  assert.equal(completed.every((stage) => stage.status === 'complete'), true);
});

test('a failed run marks the active stage failed and never completes later stages', () => {
  const failed = toProgressStages(runView('EXECUTING', { state: 'EXECUTING' }));
  assert.equal(failed.find((stage) => stage.id === 'executing')?.status, 'active');

  const expired = toProgressStages(runView('EXPIRED'));
  assert.equal(expired.find((stage) => stage.id === 'validating')?.status, 'skipped');
  assert.equal(expired.some((stage) => stage.id !== 'queued' && stage.status === 'complete' && stage.id === 'executing'), false);
});

test('progress details come from canonical timeline events, never model text', () => {
  const timeline: AgentModeRunHistoryEvent[] = [
    { eventId: 'e1', seq: 1, at: NOW - 9_000, type: 'PROPOSED', nextState: 'PLANNING', reason: 'Repository indexed', source: 'API' },
    { eventId: 'e2', seq: 2, at: NOW - 8_000, type: 'DISPLAYED', priorState: 'PLANNING', nextState: 'AWAITING_APPROVAL', reason: 'Change plan prepared', source: 'APPROVAL' },
  ];
  const stages = toProgressStages(runView('AWAITING_APPROVAL'), timeline);
  assert.equal(stages.find((stage) => stage.id === 'queued')?.detail, 'Repository indexed');
  assert.equal(stages.find((stage) => stage.id === 'planning')?.detail, 'Change plan prepared');
  // Nothing was reported for later stages, so nothing is claimed.
  assert.equal(stages.find((stage) => stage.id === 'executing')?.detail, undefined);
});

test('no run means no progress list at all', () => {
  assert.deepEqual(toProgressStages(undefined), []);
});

// ── Approval consent modal ────────────────────────────────────────────────────

test('the approval consent detail is built from the sanitized card only', () => {
  const card = toProposalCard(runView(), NOW);
  const detail = approvalConsentDetail(card.task, card.policy, card.changes.note, card.warnings);

  assert.match(detail, /Add a health endpoint message/);
  assert.match(detail, /Executable: git/);
  assert.match(detail, /Warning: The working tree is dirty\./);
  assert.match(detail, /approves ONE execution/);
  assert.doesNotMatch(detail, /FPRINT_do_not_display/);
  assert.doesNotMatch(detail, /SNAPSHOTID_manifest_digest/);
  assert.doesNotMatch(detail, /WSMATERIAL_deadbeefcafe/);
  assert.doesNotMatch(detail, /SUPER_SECRET_VALUE/);
  assert.doesNotMatch(detail, /home\/bonex/);
});
