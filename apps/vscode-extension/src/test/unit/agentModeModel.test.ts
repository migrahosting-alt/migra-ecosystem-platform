import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentModeCommandRunView, AgentModeRunHistoryDetail, AgentModeRunHistorySummary, AgentModeRunRecoveryStatus } from '@migrapilot/protocol';
import { AgentModeSessionGate, agentModeControlState, agentModeHistoryDetailLines, agentModeHistorySummaryLines, agentModeRecoveryControlState, agentModeRecoveryStatusText, agentModeStatusText, renderPreviewLines } from '../../panel/agentModeModel.js';

test('Agent Mode session gate resets OFF on view recreation/disposal', () => {
  const gate = new AgentModeSessionGate();
  assert.equal(gate.enabled, false);
  gate.enter();
  assert.equal(gate.enabled, true);
  gate.reset();
  assert.equal(gate.enabled, false);
});

test('Agent Mode is explicit and every security state remains visually distinct', () => {
  assert.equal(agentModeStatusText(false, 'IDLE'), '$(shield) Agent Mode: OFF');
  for (const state of ['IDLE', 'PLANNING', 'AWAITING_APPROVAL', 'APPROVED', 'EXECUTING', 'COMPLETED', 'REJECTED', 'EXPIRED', 'STALE', 'FAILED', 'CANCELLED'] as const) {
    assert.match(agentModeStatusText(true, state), new RegExp(state));
  }
});

test('preview renderer displays exact authoritative argv and redacted environment without reconstructing shell text', () => {
  const lines = renderPreviewLines({
    recipe: 'git.diff',
    policyVersion: 'agent-recipes-v2',
    executionIdentity: 'exec123',
    environmentPolicy: 'minimal-git-v2',
    workspaceMaterialFingerprint: 'material123',
    snapshotId: 'snapshot123',
    sourceWorkspace: '/workspace/live',
    executable: '/private/snapshot/bin/git',
    arguments: ['--no-pager', 'diff', '--no-textconv', '--'],
    cwd: '/private/snapshot/workspace',
    timeoutMs: 30000,
    outputLimitBytes: 24576,
    mutationClassification: 'read-only',
    networkPolicy: 'not-required',
    expectedEffects: ['Reads a private snapshot.'],
    reason: 'Run unit tests',
    requestId: 'req-1',
    fingerprint: 'abcdef123456',
    expiresAt: 1_800_000_000_000,
    warnings: ['single use'],
    environment: [{ key: 'API_TOKEN', value: '[REDACTED]', redacted: true }],
    canModifyFiles: false,
  });
  assert.ok(lines.includes('Recipe: git.diff'));
  assert.ok(lines.includes('Snapshot: snapshot123'));
  assert.ok(lines.includes('Executable: /private/snapshot/bin/git'));
  assert.ok(lines.includes('Arg 1: --no-pager'));
  assert.ok(lines.includes('Environment API_TOKEN: [REDACTED]'));
  assert.doesNotMatch(lines.join('\n'), /npm test --if-present/);
});

test('restart-restored Agent runs are view/reconcile only: no hidden resume or approval controls', () => {
  for (const state of ['STALE', 'FAILED', 'EXPIRED', 'CANCELLED', 'COMPLETED'] as const) {
    const controls = agentModeControlState(state);
    assert.equal(controls.resume, false);
    assert.equal(controls.approve, false);
    assert.equal(controls.reject, false);
    assert.equal(controls.reconcile, true);
  }
  assert.match(agentModeControlState('FAILED').restartLabel ?? '', /new proposal/);
  assert.equal(agentModeControlState('AWAITING_APPROVAL').approve, true);
});

test('recovery controls offer fresh proposals only and never resume', () => {
  const view: AgentModeCommandRunView = {
    runId: 'agentcmd_1',
    requestId: 'agentcorr_1',
    state: 'EXPIRED',
    recovery: { classification: 'REPROPOSAL_REQUIRED', eligible: true, reason: 'restart lost authorization' },
    createdAt: 1,
    updatedAt: 2,
  };
  const status: AgentModeRunRecoveryStatus = {
    runId: view.runId,
    sourceState: 'EXPIRED',
    approvalLifecycle: 'LOST_ON_RESTART',
    recoveryClass: 'REPROPOSAL_REQUIRED',
    eligible: true,
    explanation: 'Approval could not survive restart.',
    currentRecipeAvailable: true,
    workspaceMatches: true,
    recommendedAction: 'Create a fresh proposal.',
    lineage: {},
  };
  const controls = agentModeRecoveryControlState(view, status);
  assert.equal(controls.freshProposal, true);
  assert.equal(controls.resume, false);
  assert.match(agentModeRecoveryStatusText(status), /Fresh proposal required/);
});

test('history renderers present evidence and governance without resume authority', () => {
  const summary: AgentModeRunHistorySummary = {
    runId: 'agentcmd_history',
    requestId: 'agentcorr_history',
    state: 'FAILED',
    recipe: 'git.status',
    requestedAt: 1_800_000_000_000,
    updatedAt: 1_800_000_001_000,
    terminalAt: 1_800_000_001_000,
    approvalLifecycle: 'INVALIDATED',
    recoveryClass: 'REPROPOSAL_ALLOWED',
    recoveryEligible: true,
    recoveryReason: 'INTERRUPTED_BY_RESTART',
    snapshotId: 'snapshot-history',
    mutationClassification: 'read-only',
    networkPolicy: 'not-required',
    eventCount: 6,
    integrity: 'TRUSTED',
    integrityIssues: [],
  };
  const detail: AgentModeRunHistoryDetail = {
    summary,
    timeline: [{ eventId: 'event-1', seq: 1, at: summary.requestedAt, type: 'run.created', nextState: 'AWAITING_APPROVAL', source: 'API' }],
    lineage: {},
    recovery: {
      runId: summary.runId,
      sourceState: 'FAILED',
      approvalLifecycle: 'INVALIDATED',
      recoveryClass: 'REPROPOSAL_ALLOWED',
      eligible: true,
      explanation: 'A fresh proposal may be created.',
      currentRecipeAvailable: true,
      workspaceMatches: true,
      recommendedAction: 'Create a fresh proposal.',
      lineage: {},
    },
    retention: { eligibleForDeletion: false, reason: 'Terminal run is inside the configured retention window.' },
  };
  const rendered = [...agentModeHistorySummaryLines(summary), ...agentModeHistoryDetailLines(detail)].join('\n');
  assert.match(rendered, /agentcmd_history/);
  assert.match(rendered, /Integrity: TRUSTED/);
  assert.match(rendered, /Create a fresh proposal/);
  assert.doesNotMatch(rendered, /\bresume\b|reuse approval|continue execution/i);
});
