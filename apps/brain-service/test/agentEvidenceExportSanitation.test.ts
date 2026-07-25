import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { AgentModeCommandPreview } from '@migrapilot/protocol';
import { AgentModeCommandService, type AgentModeRequestContext } from '../src/engine/agentModeCommandService.js';
import { AgentRunHistoryService, REDACTED_AUTHORITY_BINDING } from '../src/engine/agentRunHistory.js';
import { AgentRunJournal, MemoryAgentRunJournalPersistence } from '../src/engine/agentRunJournal.js';
import { AGENT_RECIPE_OUTPUT_CAP_BYTES, AGENT_RECIPE_POLICY_VERSION } from '../src/engine/agentRecipe.js';
import { CapabilityRegistry } from '../src/engine/capabilityRegistry.js';
import { ToolApprovalStore } from '../src/engine/toolApprovalStore.js';
import { ToolAudit } from '../src/engine/toolAudit.js';

const ACTIVATION = '77777777-7777-4777-8777-777777777777';
const RUN_ID = 'agentcmd_evidence';
const WORKSPACE = '/home/operator/private-workspace';
const FINGERPRINT = 'c3f181aa6060821c';
const SNAPSHOT_ID = 'a34b286a04124cbab7f24ab4fc3b965366b6f169849b51f6b5728799eaacc481';
/** Not schema-bound: must stay redacted so the fix cannot be a blanket hex exemption. */
const UNRELATED_HEX = 'deadbeef'.repeat(8);
const CAPABILITY = 'agentcap_should_never_appear_in_evidence_0123456789';
const APPROVAL_ID = 'appr_private_should_never_appear';
const EXECUTABLE_DIGEST = 'f'.repeat(64);
const MANIFEST_DIGEST = 'e'.repeat(64);

function context(): AgentModeRequestContext {
  return { activationId: ACTIVATION, extensionProcessId: process.pid, serverInstanceId: 'brain-instance-123456789', workspaceRoot: WORKSPACE, workspaceIdentity: 'workspace-id', allowedRecipes: ['git.status', 'git.diff'] };
}

function preview(at: number): AgentModeCommandPreview {
  return {
    recipe: 'git.status', policyVersion: AGENT_RECIPE_POLICY_VERSION, executionIdentity: 'exec_identity_1',
    environmentPolicy: 'minimal-git-v2', workspaceMaterialFingerprint: 'material_fp_0001',
    snapshotId: SNAPSHOT_ID,
    sourceWorkspace: WORKSPACE,
    executable: '/tmp/migrapilot-agent-snapshot-AbCdEf/bin/git',
    arguments: ['-c', 'core.hooksPath=/dev/null', 'status', '--short'],
    cwd: '/tmp/migrapilot-agent-snapshot-AbCdEf/workspace',
    timeoutMs: 30_000, outputLimitBytes: AGENT_RECIPE_OUTPUT_CAP_BYTES,
    mutationClassification: 'read-only', networkPolicy: 'not-required',
    expectedEffects: ['Reads a private snapshot of the selected Git workspace.'],
    // Operator-supplied text carrying an unrelated high-entropy value.
    reason: `inspect status ${UNRELATED_HEX}`,
    requestId: `agentcorr_${RUN_ID}`,
    fingerprint: FINGERPRINT,
    expiresAt: at + 300_000,
    warnings: ['This is a fixed server-owned recipe.'],
    environment: [
      { key: 'HOME', value: '/tmp/migrapilot-agent-snapshot-AbCdEf/home', redacted: false },
      { key: 'PATH', value: '/tmp/migrapilot-agent-snapshot-AbCdEf/bin', redacted: false },
    ],
    canModifyFiles: false,
  };
}

function harness() {
  const at = 1_700_000_000_000;
  const persistence = new MemoryAgentRunJournalPersistence();
  const journal = new AgentRunJournal(persistence);
  let sequence = 0;
  const deps = { registry: new CapabilityRegistry(), approvals: new ToolApprovalStore(() => at, () => `appr_${++sequence}`, 100), audit: new ToolAudit() };
  const service = new AgentModeCommandService(deps, () => at, undefined, undefined, undefined, journal);
  const history = new AgentRunHistoryService(journal, (run, ctx) => {
    const result = service.getRunRecoveryStatus(run.runId, ctx);
    if (!result.ok) throw new Error('recovery status unavailable');
    return result.status;
  }, () => at);

  journal.create({
    runId: RUN_ID, correlationId: `agentcorr_${RUN_ID}`, activationId: ACTIVATION, workspaceRoot: WORKSPACE,
    workspaceIdentity: 'workspace-id', recipeId: 'git.status', recipePolicyVersion: AGENT_RECIPE_POLICY_VERSION,
    proposalFingerprint: FINGERPRINT, proposalHash: `${FINGERPRINT}${'0'.repeat(48)}`, snapshotId: SNAPSHOT_ID,
    snapshotManifestDigest: MANIFEST_DIGEST, executableDigest: EXECUTABLE_DIGEST, requestedAt: at, proposalAt: at,
    expiresAt: at + 300_000, timeoutMs: 30_000, outputLimitBytes: AGENT_RECIPE_OUTPUT_CAP_BYTES,
    mutationClassification: 'read-only', networkPolicy: 'not-required',
    expectedEffects: ['Reads a private snapshot of the selected Git workspace.'],
    preview: preview(at),
  });
  // approval.displayed carries the proposal fingerprint as its reason.
  journal.transition({ runId: RUN_ID, expectedState: 'AWAITING_APPROVAL', nextState: 'AWAITING_APPROVAL', at: at + 10, eventType: 'approval.displayed', source: 'API', reason: FINGERPRINT, approvalDisplayedAt: at + 10, approvalLifecycle: 'DISPLAYED' });
  journal.transition({ runId: RUN_ID, expectedState: 'AWAITING_APPROVAL', nextState: 'REJECTED', at: at + 20, eventType: 'approval.rejected', source: 'APPROVAL', reason: 'HUMAN_REJECTED', approvalDecisionAt: at + 20, terminalAt: at + 20, failureCode: 'REJECTED', approvalLifecycle: 'REJECTED', approvalDecisionType: 'REJECTED', recoveryClass: 'REPROPOSAL_ALLOWED', recoveryEligible: true, recoveryReason: 'REJECTED_FRESH_PROPOSAL_ALLOWED' });
  return { journal, service, history, persistence };
}

function exportEvidence(history: AgentRunHistoryService) {
  const result = history.export(RUN_ID, { includeTimeline: true, includePreview: true, includeResultSummary: true }, context());
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

/** Mirrors the service's canonicalJson: undefined entries dropped, keys by localeCompare. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined).sort(([l], [r]) => l.localeCompare(r));
    return `{${entries.map(([k, entry]) => `${JSON.stringify(k)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// 1 + 2. The canonical snapshot identifier is consistent and visible.
test('snapshotId is identical in summary and preview and remains visible', () => {
  const { history } = harness();
  const evidence = exportEvidence(history);
  assert.equal(evidence.body.summary.snapshotId, SNAPSHOT_ID);
  assert.equal(evidence.body.preview?.snapshotId, SNAPSHOT_ID);
  assert.equal(evidence.body.preview?.snapshotId, evidence.body.summary.snapshotId);
  assert.notEqual(evidence.body.preview?.snapshotId, '[REDACTED_SECRET]');
});

// 3. The exemption is schema-bound, not a blanket hex exemption.
test('an unrelated 64-hex value stays redacted', () => {
  const { history, persistence } = harness();
  // The write-time redactor must still have scrubbed the operator text.
  const stored = persistence.runs.get(RUN_ID)!.previewJson!;
  assert.equal(stored.includes(UNRELATED_HEX), false, 'write-time redaction must scrub unrelated high-entropy values');
  const evidence = exportEvidence(history);
  const body = canonicalJson(evidence.body);
  assert.equal(body.includes(UNRELATED_HEX), false);
  assert.ok(evidence.body.preview?.reason.includes('[REDACTED_SECRET]'));
});

// 4. Authority-binding material is replaced with a semantic marker.
test('proposal fingerprint is replaced with the authority-binding marker everywhere', () => {
  const { history, journal } = harness();
  const evidence = exportEvidence(history);
  const body = canonicalJson(evidence.body);
  assert.equal(body.includes(FINGERPRINT), false, 'no exported surface may carry the proposal fingerprint');
  assert.equal(evidence.body.preview?.fingerprint, REDACTED_AUTHORITY_BINDING);
  const displayed = evidence.body.timeline.find((event) => event.type === 'approval.displayed');
  assert.equal(displayed?.reason, REDACTED_AUTHORITY_BINDING);
  // Unrelated reasons stay legible.
  assert.equal(evidence.body.timeline.find((e) => e.type === 'approval.rejected')?.reason, 'HUMAN_REJECTED');
  assert.equal(evidence.body.timeline.find((e) => e.type === 'proposal.created')?.reason, 'git.status');
  // The durable record still retains it for internal binding.
  assert.equal(journal.loadRun(RUN_ID)?.proposalFingerprint, FINGERPRINT);
});

// 5. Credentials, digests, paths, and environment values stay out.
test('capability, approval id, bootstrap material, digests, paths and env values are absent', () => {
  const { history } = harness();
  const evidence = exportEvidence(history);
  const body = canonicalJson(evidence.body);
  for (const forbidden of [CAPABILITY, APPROVAL_ID, EXECUTABLE_DIGEST, MANIFEST_DIGEST, WORKSPACE, '/tmp/migrapilot-agent-snapshot-', 'bootstrap-secret']) {
    assert.equal(body.includes(forbidden), false, `${forbidden} must not appear in sanitized evidence`);
  }
  assert.equal(evidence.body.preview?.sourceWorkspace, '[REDACTED PATH]');
  assert.equal(evidence.body.preview?.executable, '[REDACTED PATH]');
  assert.equal(evidence.body.preview?.cwd, '[REDACTED PATH]');
  for (const entry of evidence.body.preview?.environment ?? []) {
    assert.equal(entry.value, '[SERVER CONTROLLED]');
    assert.equal(entry.redacted, true);
  }
});

// 6 + 7. Determinism and digest integrity survive the schema-preserving change.
test('repeat export is byte-identical and the manifest digest recomputes', () => {
  const { history } = harness();
  const first = exportEvidence(history);
  const second = exportEvidence(history);
  assert.equal(second.manifest.digest, first.manifest.digest);
  assert.equal(canonicalJson(second.body), canonicalJson(first.body));

  const canonical = canonicalJson(first.body);
  assert.equal(createHash('sha256').update(canonical).digest('hex'), first.manifest.digest);
  assert.equal(Buffer.byteLength(canonical), first.manifest.canonicalBytes);
  assert.equal(first.manifest.algorithm, 'sha256');
  assert.equal(first.mediaType, 'application/vnd.migrapilot.agent-run-evidence+json;v=1');
  assert.equal(first.manifest.redaction, 'sanitized-history-only');
});

// The digest must cover the sanitized bytes actually handed to the operator.
test('the manifest digest is computed over the sanitized body, not the raw record', () => {
  const { history } = harness();
  const evidence = exportEvidence(history);
  const rawish = canonicalJson({ ...evidence.body, preview: { ...evidence.body.preview, fingerprint: FINGERPRINT } });
  assert.notEqual(createHash('sha256').update(rawish).digest('hex'), evidence.manifest.digest);
});

// 8. The evidence surface still carries no execution authority.
test('history still exposes no execution authority after sanitation', async () => {
  const { history, service } = harness();
  for (const forbidden of ['decide', 'approve', 'execute', 'resume', 'start', 'cancel', 'repropose', 'propose']) {
    assert.equal(typeof (history as unknown as Record<string, unknown>)[forbidden], 'undefined');
  }
  const decided = await service.decide(RUN_ID, 'approve', FINGERPRINT, context());
  assert.equal(decided.ok, false);
  const cancelled = service.cancel(RUN_ID, context());
  assert.equal(cancelled.ok, false);
  // The marker itself must never be usable as a fingerprint.
  const withMarker = await service.decide(RUN_ID, 'approve', REDACTED_AUTHORITY_BINDING, context());
  assert.equal(withMarker.ok, false);
  await service.shutdown();
});
