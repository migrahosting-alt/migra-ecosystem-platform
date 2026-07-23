import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentModeSessionGate, agentModeStatusText, renderPreviewLines } from '../../panel/agentModeModel.js';

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
