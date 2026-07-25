import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { AgentModeCommandPreview, AgentModeRecoveryClass } from '@migrapilot/protocol';
import { AgentModeCommandService, type AgentModeRequestContext } from '../src/engine/agentModeCommandService.js';
import { AgentRunHistoryService } from '../src/engine/agentRunHistory.js';
import { AgentRunJournal, MemoryAgentRunJournalPersistence } from '../src/engine/agentRunJournal.js';
import { AGENT_RECIPE_OUTPUT_CAP_BYTES, AGENT_RECIPE_POLICY_VERSION, containmentIdentityForPlan, type AgentContainmentIdentity, type AgentRecipeExecutionOutcome, type AgentRecipePlan, type AgentRecipeProcessManagerLike, type AgentRecipeResolverLike } from '../src/engine/agentRecipe.js';
import { CapabilityRegistry } from '../src/engine/capabilityRegistry.js';
import { validateRecoverySourceProvenance } from '../src/engine/recoverySourceProvenance.js';
import { ToolApprovalStore, hashInput } from '../src/engine/toolApprovalStore.js';
import { ToolAudit } from '../src/engine/toolAudit.js';

const ACTIVATION = '44444444-4444-4444-8444-444444444444';

function root(): string { return mkdtempSync(path.join(tmpdir(), 'migrapilot-recovery-')); }

function context(workspace: string): AgentModeRequestContext {
  return { activationId: ACTIVATION, extensionProcessId: process.pid, serverInstanceId: 'brain-instance-123456789', workspaceRoot: workspace, workspaceIdentity: 'workspace-id', allowedRecipes: ['git.status', 'git.diff'] };
}

function plan(workspace: string, runId: string): AgentRecipePlan {
  return {
    identity: {
      recipe: 'git.status', policyVersion: AGENT_RECIPE_POLICY_VERSION, runId, activationId: ACTIVATION,
      sourceWorkspace: workspace, sourceWorkspaceIdentity: 'workspace-id', snapshotId: 'snapshot-id',
      snapshotRoot: workspace, canonicalCwd: workspace, executablePath: process.execPath,
      executableDigest: 'digest', executableIdentity: 'exec-id', arguments: ['--version'],
      environmentPolicy: 'minimal-git-v2', environmentIdentity: hashInput({ PATH: '/safe' }),
      workspaceMaterialIdentity: 'material-id', containmentPolicy: 'systemd-user-service-v2',
      timeoutMs: 5_000, outputLimitBytes: AGENT_RECIPE_OUTPUT_CAP_BYTES, shell: false,
      mutationClassification: 'read-only', canModifyFiles: false, networkPolicy: 'not-required',
      expectedEffects: ['test'],
    },
    environment: { PATH: '/safe' },
    privateRunRoot: workspace,
  };
}

class FakeResolver implements AgentRecipeResolverLike {
  async prepare(_recipe: 'git.status' | 'git.diff', workspace: string, input: { runId: string }): Promise<AgentRecipePlan> { return plan(workspace, input.runId); }
  async verify(): Promise<boolean> { return true; }
  async release(): Promise<void> { /* nothing to release */ }
  binding(value: AgentRecipePlan): string { return hashInput(value.identity); }
}

class FakeProcesses implements AgentRecipeProcessManagerLike {
  async availability() { return { ok: true, policy: 'fake' } as const; }
  activeCount(): number { return 0; }
  async execute(runId: string, value: AgentRecipePlan, hooks: { onSpawned(identity: AgentContainmentIdentity): void }): Promise<AgentRecipeExecutionOutcome> {
    hooks.onSpawned(containmentIdentityForPlan(runId, value));
    return { disposition: 'completed', result: { recipe: value.identity.recipe, exitCode: 0, timedOut: false, stdout: '', stderr: '', truncated: false, redacted: false, durationMs: 1 } };
  }
  async shutdown(): Promise<void> { /* nothing running */ }
}

function harness(persistence = new MemoryAgentRunJournalPersistence()) {
  let sequence = 0;
  const approvals = new ToolApprovalStore(() => Date.now(), () => `appr_private_${++sequence}`, 100);
  const deps = { registry: new CapabilityRegistry(), approvals, audit: new ToolAudit() };
  const journal = new AgentRunJournal(persistence);
  const service = new AgentModeCommandService(deps, undefined, () => `agentcmd_${++sequence}`, new FakeResolver(), new FakeProcesses(), journal);
  const history = new AgentRunHistoryService(journal, (run, ctx) => {
    const result = service.getRunRecoveryStatus(run.runId, ctx);
    if (result.ok) return result.status;
    throw new Error('recovery status unavailable');
  });
  return { persistence, journal, service, history, deps };
}

function preview(runId: string, workspace: string, at: number): AgentModeCommandPreview {
  return {
    recipe: 'git.status', policyVersion: AGENT_RECIPE_POLICY_VERSION, executionIdentity: `exec_${runId}`.slice(0, 16),
    environmentPolicy: 'minimal-git-v2', workspaceMaterialFingerprint: 'material-id'.slice(0, 16), snapshotId: 'snapshot-id',
    sourceWorkspace: workspace, executable: process.execPath, arguments: ['--version'], cwd: workspace,
    timeoutMs: 5_000, outputLimitBytes: AGENT_RECIPE_OUTPUT_CAP_BYTES, mutationClassification: 'read-only',
    networkPolicy: 'not-required', expectedEffects: ['test'], reason: 'regression fixture',
    requestId: `agentcorr_${runId}`, fingerprint: `fp_${runId}`.slice(0, 16), expiresAt: at + 300_000,
    warnings: [], environment: [], canModifyFiles: false,
  };
}

/** Seeds an AWAITING_APPROVAL durable run exactly as propose() does. */
function seedPending(journal: AgentRunJournal, runId: string, workspace: string, at = Date.now()): void {
  journal.create({
    preview: preview(runId, workspace, at),
    runId, correlationId: `agentcorr_${runId}`, activationId: ACTIVATION, workspaceRoot: workspace,
    workspaceIdentity: 'workspace-id', recipeId: 'git.status', recipePolicyVersion: AGENT_RECIPE_POLICY_VERSION,
    proposalFingerprint: `fp_${runId}`.slice(0, 16), proposalHash: `hash_${runId}`, snapshotId: 'snapshot-id',
    snapshotManifestDigest: 'material-id', executableDigest: 'digest', requestedAt: at, proposalAt: at,
    expiresAt: at + 300_000, timeoutMs: 5_000, outputLimitBytes: AGENT_RECIPE_OUTPUT_CAP_BYTES,
    mutationClassification: 'read-only', networkPolicy: 'not-required', expectedEffects: ['test'],
  });
}

// Terminal writes copied from the production paths so fixtures cannot drift.
function rejectRun(journal: AgentRunJournal, runId: string, at = Date.now()): void {
  journal.transition({ runId, expectedState: 'AWAITING_APPROVAL', nextState: 'REJECTED', at, eventType: 'approval.rejected', source: 'APPROVAL', reason: 'HUMAN_REJECTED', approvalDecisionAt: at, terminalAt: at, failureCode: 'REJECTED', approvalLifecycle: 'REJECTED', approvalDecisionType: 'REJECTED', recoveryClass: 'REPROPOSAL_ALLOWED', recoveryEligible: true, recoveryReason: 'REJECTED_FRESH_PROPOSAL_ALLOWED' });
}
function cancelRun(journal: AgentRunJournal, runId: string, at = Date.now()): void {
  journal.transition({ runId, expectedState: 'AWAITING_APPROVAL', nextState: 'CANCELLED', at, eventType: 'cancellation.requested', source: 'API', reason: 'CANCELLED_BEFORE_SPAWN', terminalAt: at, failureCode: 'CANCELLED_BEFORE_SPAWN', approvalLifecycle: 'INVALIDATED', approvalInvalidationReason: 'CANCELLED_BEFORE_SPAWN', recoveryClass: 'REPROPOSAL_ALLOWED', recoveryEligible: true, recoveryReason: 'CANCELLED_FRESH_PROPOSAL_ALLOWED' });
}
function expireRun(journal: AgentRunJournal, runId: string, at = Date.now()): void {
  journal.transition({ runId, expectedState: 'AWAITING_APPROVAL', nextState: 'EXPIRED', at, eventType: 'approval.expired', source: 'CLEANUP', reason: 'APPROVAL_TTL_EXPIRED', terminalAt: at, failureCode: 'EXPIRED', approvalLifecycle: 'EXPIRED', approvalInvalidationReason: 'APPROVAL_TTL_EXPIRED', recoveryClass: 'REPROPOSAL_ALLOWED', recoveryEligible: true, recoveryReason: 'EXPIRED_FRESH_PROPOSAL_ALLOWED' });
}
function restartLoseApproval(journal: AgentRunJournal, runId: string, at = Date.now()): void {
  journal.transition({ runId, expectedState: 'AWAITING_APPROVAL', nextState: 'EXPIRED', at, eventType: 'approval.lost_on_restart', source: 'RECONCILIATION', reason: 'RESTART_AUTHORIZATION_LOST', terminalAt: at, failureCode: 'RESTART_AUTHORIZATION_LOST', approvalLifecycle: 'LOST_ON_RESTART', recoveryClass: 'REPROPOSAL_REQUIRED', recoveryEligible: true, recoveryReason: 'RESTART_AUTHORIZATION_LOST' });
}
function completeRun(journal: AgentRunJournal, persistence: MemoryAgentRunJournalPersistence, runId: string, at = Date.now()): void {
  journal.transition({ runId, expectedState: 'AWAITING_APPROVAL', nextState: 'APPROVED', at, eventType: 'approval.approved', source: 'APPROVAL', reason: 'HUMAN_APPROVED', approvalDecisionAt: at, approvalLifecycle: 'APPROVED', approvalDecisionType: 'APPROVED' });
  journal.transition({ runId, expectedState: 'APPROVED', nextState: 'EXECUTING', at: at + 1, eventType: 'execution.start_requested', source: 'EXECUTION', reason: 'APPROVED_EXECUTION_START', executionStartedAt: at + 1, approvalLifecycle: 'CONSUMED' });
  const identity = containmentIdentityForPlan(runId, plan('/workspace', runId));
  journal.transition({ runId, expectedState: 'EXECUTING', nextState: 'EXECUTING', at: at + 2, eventType: 'execution.spawned', source: 'EXECUTION', reason: 'CONTAINMENT_STARTED', containmentUnit: identity.unit, containmentBinding: identity.binding });
  journal.transition({ runId, expectedState: 'EXECUTING', nextState: 'COMPLETED', at: at + 3, eventType: 'execution.completed', source: 'EXECUTION', reason: 'PROCESS_EXITED', terminalAt: at + 3, exitCode: 0 });
  assert.equal(persistence.runs.get(runId)?.state, 'COMPLETED');
}

function provenanceOf(journal: AgentRunJournal, runId: string) {
  const run = journal.loadRun(runId)!;
  return validateRecoverySourceProvenance({ run, events: journal.events(runId), workspaceIdentity: 'workspace-id', allowedRecipes: ['git.status', 'git.diff'], now: Date.now() });
}

function summaryOf(history: AgentRunHistoryService, runId: string, workspace: string) {
  const detail = history.detail(runId, context(workspace));
  assert.equal(detail.ok, true);
  if (!detail.ok) throw new Error('unreachable');
  return detail.value.summary;
}

// ---------------------------------------------------------------------------
// Required policy matrix: coherent terminal outcomes are TRUSTED, and only the
// eligibility verdict varies.
// ---------------------------------------------------------------------------
const MATRIX: { name: string; seed: (h: ReturnType<typeof harness>, runId: string, workspace: string) => void; recoveryClass: AgentModeRecoveryClass; eligible: boolean }[] = [
  { name: 'rejected before spawn', seed: (h, id) => rejectRun(h.journal, id), recoveryClass: 'REPROPOSAL_ALLOWED', eligible: true },
  { name: 'cancelled before spawn', seed: (h, id) => cancelRun(h.journal, id), recoveryClass: 'REPROPOSAL_ALLOWED', eligible: true },
  { name: 'expired awaiting approval', seed: (h, id) => expireRun(h.journal, id), recoveryClass: 'REPROPOSAL_ALLOWED', eligible: true },
  { name: 'restart-lost approval', seed: (h, id) => restartLoseApproval(h.journal, id), recoveryClass: 'REPROPOSAL_REQUIRED', eligible: true },
  { name: 'completed', seed: (h, id) => completeRun(h.journal, h.persistence, id), recoveryClass: 'TERMINAL_NO_RECOVERY', eligible: false },
];

for (const entry of MATRIX) {
  test(`policy matrix: ${entry.name} is trusted with ${entry.recoveryClass} (eligible=${entry.eligible})`, () => {
    const workspace = root();
    const h = harness();
    const runId = 'agentcmd_matrix';
    seedPending(h.journal, runId, workspace);
    entry.seed(h, runId, workspace);

    const provenance = provenanceOf(h.journal, runId);
    assert.equal(provenance.trusted, true, `coherent history must stay trusted, got code ${provenance.code}`);
    assert.equal(provenance.eligible, entry.eligible);
    assert.equal(provenance.recoveryClass, entry.recoveryClass);
    // A policy refusal must never be reported with an integrity-failure code.
    assert.notEqual(provenance.code, 'SOURCE_INTEGRITY_FAILED');

    const summary = summaryOf(h.history, runId, workspace);
    assert.equal(summary.integrity, 'TRUSTED');
    assert.deepEqual(summary.integrityIssues, []);
    assert.equal(summary.recoveryClass, entry.recoveryClass);
    assert.equal(summary.recoveryEligible, entry.eligible);
  });
}

test('non-recoverable-by-policy reports a dedicated code, not an integrity failure', () => {
  const workspace = root();
  const h = harness();
  seedPending(h.journal, 'agentcmd_done', workspace);
  completeRun(h.journal, h.persistence, 'agentcmd_done');
  const provenance = provenanceOf(h.journal, 'agentcmd_done');
  assert.equal(provenance.code, 'SOURCE_TERMINAL_NO_RECOVERY');
  assert.equal(provenance.trusted, true);
  assert.equal(provenance.eligible, false);
});

test('rejected source before successor linkage is trusted and eligible', async () => {
  const workspace = root();
  const h = harness();
  seedPending(h.journal, 'agentcmd_src', workspace);
  rejectRun(h.journal, 'agentcmd_src');
  const provenance = provenanceOf(h.journal, 'agentcmd_src');
  assert.equal(provenance.trusted, true);
  assert.equal(provenance.eligible, true);
  assert.equal(provenance.recoveryClass, 'REPROPOSAL_ALLOWED');
  const status = h.service.getRunRecoveryStatus('agentcmd_src', context(workspace));
  assert.equal(status.ok, true);
  if (status.ok) assert.equal(status.status.eligible, true);
});

test('rejected source after successor linkage is trusted, ineligible, and records the successor', async () => {
  const workspace = root();
  const h = harness();
  seedPending(h.journal, 'agentcmd_src', workspace);
  rejectRun(h.journal, 'agentcmd_src');
  const reproposed = await h.service.reproposeFromRun('agentcmd_src', { requestId: '11111111-1111-4111-8111-111111111111' }, context(workspace));
  assert.equal(reproposed.ok, true);
  if (!reproposed.ok) return;

  const provenance = provenanceOf(h.journal, 'agentcmd_src');
  assert.equal(provenance.trusted, true, 'consumed recovery is lineage, never corruption');
  assert.equal(provenance.eligible, false);
  assert.equal(provenance.recoveryClass, 'SUCCESSOR_CREATED');
  assert.equal(provenance.code, 'SOURCE_HAS_ACTIVE_SUCCESSOR');

  const summary = summaryOf(h.history, 'agentcmd_src', workspace);
  assert.equal(summary.integrity, 'TRUSTED');
  assert.deepEqual(summary.integrityIssues, []);
  assert.equal(summary.recoveryClass, 'SUCCESSOR_CREATED');
  assert.equal(summary.recoveryEligible, false);
  assert.equal(summary.successorRunId, reproposed.view.runId);

  // Durable state must not keep asserting eligibility after it was consumed.
  const stored = h.journal.loadRun('agentcmd_src')!;
  assert.equal(stored.recoveryEligible, false);
  assert.equal(stored.recoveryClass, 'SUCCESSOR_CREATED');
  assert.equal(stored.recoveryTerminalReason, 'SUCCESSOR_CREATED');
  assert.equal(stored.successorRunId, reproposed.view.runId);
});

test('a second reproposal from a source with an active successor is refused without marking it corrupt', async () => {
  const workspace = root();
  const h = harness();
  seedPending(h.journal, 'agentcmd_src', workspace);
  rejectRun(h.journal, 'agentcmd_src');
  const first = await h.service.reproposeFromRun('agentcmd_src', { requestId: '11111111-1111-4111-8111-111111111111' }, context(workspace));
  assert.equal(first.ok, true);

  const second = await h.service.reproposeFromRun('agentcmd_src', { requestId: '22222222-2222-4222-8222-222222222222' }, context(workspace));
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.code, 'RECOVERY_CONFLICT');

  const summary = summaryOf(h.history, 'agentcmd_src', workspace);
  assert.equal(summary.integrity, 'TRUSTED', 'a refused duplicate recovery must not defame the source');
  assert.deepEqual(summary.integrityIssues, []);
});

test('a forged event chain is genuinely untrusted with an integrity code', () => {
  const workspace = root();
  const h = harness();
  seedPending(h.journal, 'agentcmd_forged', workspace);
  rejectRun(h.journal, 'agentcmd_forged');
  // Forge the chain: re-point an event at a foreign correlation id.
  const events = h.persistence.events.get('agentcmd_forged')!;
  events[events.length - 1] = { ...events[events.length - 1]!, correlationId: 'agentcorr_attacker' };

  const provenance = provenanceOf(h.journal, 'agentcmd_forged');
  assert.equal(provenance.trusted, false);
  assert.equal(provenance.code, 'SOURCE_INTEGRITY_FAILED');
  assert.equal(provenance.eligible, false);

  const summary = summaryOf(h.history, 'agentcmd_forged', workspace);
  assert.equal(summary.integrity, 'UNTRUSTED');
  assert.ok(summary.integrityIssues.some((issue) => issue.includes('SOURCE_INTEGRITY_FAILED')));
});

test('a duplicated event sequence is untrusted', () => {
  const workspace = root();
  const h = harness();
  seedPending(h.journal, 'agentcmd_gap', workspace);
  rejectRun(h.journal, 'agentcmd_gap');
  const events = h.persistence.events.get('agentcmd_gap')!;
  events.push({ ...events[events.length - 1]!, seq: events.length + 5 });

  const summary = summaryOf(h.history, 'agentcmd_gap', workspace);
  assert.equal(summary.integrity, 'UNTRUSTED');
});

test('legacy rows with stale recovery_eligible=1 plus successor linkage normalize to trusted and ineligible', async () => {
  const workspace = root();
  const h = harness();
  seedPending(h.journal, 'agentcmd_legacy', workspace);
  rejectRun(h.journal, 'agentcmd_legacy');
  const reproposed = await h.service.reproposeFromRun('agentcmd_legacy', { requestId: '33333333-3333-4333-8333-333333333333' }, context(workspace));
  assert.equal(reproposed.ok, true);

  // Recreate the pre-fix on-disk shape: eligibility left set, class left as
  // REPROPOSAL_ALLOWED, successor linked. No migration is applied.
  const stored = h.persistence.runs.get('agentcmd_legacy')!;
  Object.assign(stored, { recoveryEligible: true, recoveryClass: 'REPROPOSAL_ALLOWED' });

  const summary = summaryOf(h.history, 'agentcmd_legacy', workspace);
  assert.equal(summary.integrity, 'TRUSTED', 'a stale stored flag is a normalization concern, not corruption');
  assert.equal(summary.recoveryClass, 'SUCCESSOR_CREATED');
  assert.equal(summary.recoveryEligible, false);

  // And the stale flag must not re-open recovery.
  const again = await h.service.reproposeFromRun('agentcmd_legacy', { requestId: '44444444-4444-4444-8444-444444444444' }, context(workspace));
  assert.equal(again.ok, false);
});

test('legacy cancelled row stored as non-recoverable normalizes to trusted and eligible', () => {
  const workspace = root();
  const h = harness();
  seedPending(h.journal, 'agentcmd_legacy_cancel', workspace);
  cancelRun(h.journal, 'agentcmd_legacy_cancel');
  // Pre-fix stores would have carried the old non-recoverable classification.
  Object.assign(h.persistence.runs.get('agentcmd_legacy_cancel')!, { recoveryClass: 'TERMINAL_NO_RECOVERY', recoveryEligible: false });

  const summary = summaryOf(h.history, 'agentcmd_legacy_cancel', workspace);
  assert.equal(summary.integrity, 'TRUSTED');
  assert.equal(summary.recoveryClass, 'REPROPOSAL_ALLOWED');
  assert.equal(summary.recoveryEligible, true);
});

test('history list and detail report identical integrity and recovery classification', async () => {
  const workspace = root();
  const h = harness();
  const ctx = context(workspace);
  seedPending(h.journal, 'agentcmd_a', workspace); rejectRun(h.journal, 'agentcmd_a');
  seedPending(h.journal, 'agentcmd_b', workspace); cancelRun(h.journal, 'agentcmd_b');
  seedPending(h.journal, 'agentcmd_c', workspace); expireRun(h.journal, 'agentcmd_c');
  seedPending(h.journal, 'agentcmd_d', workspace); completeRun(h.journal, h.persistence, 'agentcmd_d');
  await h.service.reproposeFromRun('agentcmd_a', { requestId: '55555555-5555-4555-8555-555555555555' }, ctx);

  const list = h.history.list({ limit: 50, sort: 'requestedAt.desc' }, ctx);
  assert.equal(list.ok, true);
  if (!list.ok) return;
  assert.ok(list.value.runs.length >= 4);
  for (const row of list.value.runs) {
    const summary = summaryOf(h.history, row.runId, workspace);
    assert.equal(row.integrity, summary.integrity, `${row.runId} integrity must agree between list and detail`);
    assert.equal(row.recoveryClass, summary.recoveryClass, `${row.runId} class must agree between list and detail`);
    assert.equal(row.recoveryEligible, summary.recoveryEligible, `${row.runId} eligibility must agree between list and detail`);
    assert.equal(row.integrity, 'TRUSTED');
  }
});

test('no history surface can approve, resume, or execute a source or successor', async () => {
  const workspace = root();
  const h = harness();
  const ctx = context(workspace);
  seedPending(h.journal, 'agentcmd_src', workspace);
  rejectRun(h.journal, 'agentcmd_src');
  const reproposed = await h.service.reproposeFromRun('agentcmd_src', { requestId: '66666666-6666-4666-8666-666666666666' }, ctx);
  assert.equal(reproposed.ok, true);
  if (!reproposed.ok) return;
  const successorId = reproposed.view.runId;

  // The history service exposes evidence only: no decide/execute/approve surface.
  const surface = h.history as unknown as Record<string, unknown>;
  for (const forbidden of ['decide', 'approve', 'execute', 'resume', 'start', 'cancel']) {
    assert.equal(typeof surface[forbidden], 'undefined', `history must not expose ${forbidden}`);
  }
  // A terminal source cannot be approved even with its real fingerprint.
  const sourceFingerprint = h.journal.loadRun('agentcmd_src')!.proposalFingerprint;
  const decided = await h.service.decide('agentcmd_src', 'approve', sourceFingerprint, ctx);
  assert.equal(decided.ok, false);
  // The successor is a fresh proposal that still requires its own display+approval.
  const successorFingerprint = h.journal.loadRun(successorId)!.proposalFingerprint;
  const successorApproved = await h.service.decide(successorId, 'approve', `${successorFingerprint}-tampered`, ctx);
  assert.equal(successorApproved.ok, false);
});
