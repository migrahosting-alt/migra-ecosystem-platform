import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { CapabilityRegistry } from '../src/engine/capabilityRegistry.js';
import { ToolApprovalStore, hashInput } from '../src/engine/toolApprovalStore.js';
import { ToolAudit } from '../src/engine/toolAudit.js';
import { AgentModeCommandService, type AgentModeRequestContext } from '../src/engine/agentModeCommandService.js';
import { AgentRunJournal, MemoryAgentRunJournalPersistence } from '../src/engine/agentRunJournal.js';
import { AGENT_RECIPE_OUTPUT_CAP_BYTES, AGENT_RECIPE_POLICY_VERSION, containmentIdentityForPlan, containmentIdentityForTrustedRun, type AgentContainmentIdentity, type AgentContainmentReconcileOutcome, type AgentRecipeExecutionOutcome, type AgentRecipePlan, type AgentRecipeProcessManagerLike, type AgentRecipeResolverLike } from '../src/engine/agentRecipe.js';

const ACTIVATION = '11111111-1111-4111-8111-111111111111';

function root(): string { return mkdtempSync(path.join(tmpdir(), 'migrapilot-agent-journal-')); }
function context(workspace: string, activationId = ACTIVATION): AgentModeRequestContext {
  return { activationId, extensionProcessId: process.pid, serverInstanceId: 'brain-instance-stage3a', workspaceRoot: workspace, workspaceIdentity: 'workspace-id', allowedRecipes: ['git.status', 'git.diff'], externalRequestId: 'external-secret-ref' };
}
function plan(workspace: string, runId = 'agentcmd_1'): AgentRecipePlan {
  const identity: AgentRecipePlan['identity'] = {
    recipe: 'git.status',
    policyVersion: AGENT_RECIPE_POLICY_VERSION,
    runId,
    activationId: ACTIVATION,
    sourceWorkspace: workspace,
    sourceWorkspaceIdentity: 'workspace-id',
    snapshotId: 'snapshot-id',
    snapshotRoot: workspace,
    canonicalCwd: workspace,
    executablePath: process.execPath,
    executableDigest: 'exec-digest',
    executableIdentity: 'exec-id',
    arguments: ['--version'],
    environmentPolicy: 'minimal-git-v2',
    environmentIdentity: hashInput({ PATH: '/safe' }),
    workspaceMaterialIdentity: 'manifest-digest',
    containmentPolicy: 'systemd-user-service-v2',
    timeoutMs: 5_000,
    outputLimitBytes: AGENT_RECIPE_OUTPUT_CAP_BYTES,
    shell: false,
    mutationClassification: 'read-only',
    canModifyFiles: false,
    networkPolicy: 'not-required',
    expectedEffects: ['reads only'],
  };
  return { identity, environment: { PATH: '/safe' }, privateRunRoot: workspace };
}

class Resolver implements AgentRecipeResolverLike {
  async prepare(_recipe: 'git.status' | 'git.diff', workspace: string, input: { runId: string }): Promise<AgentRecipePlan> { return plan(workspace, input.runId); }
  async verify(): Promise<boolean> { return true; }
  async release(): Promise<void> {}
  binding(value: AgentRecipePlan): string { return hashInput(value.identity); }
}

class Processes implements AgentRecipeProcessManagerLike {
  starts = 0;
  reconcileCalls = 0;
  delayMs = 10_000;
  outcome: AgentContainmentReconcileOutcome = { code: 'RESTART_NO_CONTAINMENT_FOUND', terminated: false, cgroupEmpty: true };
  onReconcile?: () => void | Promise<void>;
  activeCount(): number { return 0; }
  async availability() { return { ok: true, policy: 'fake' } as const; }
  async execute(runId: string, value: AgentRecipePlan, hooks: { onSpawned(identity: AgentContainmentIdentity): void }, signal?: AbortSignal): Promise<AgentRecipeExecutionOutcome> {
    this.starts += 1;
    hooks.onSpawned(containmentIdentityForPlan(runId, value));
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, this.delayMs);
      signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
    });
    return { disposition: signal?.aborted ? 'cancelled' : 'completed', result: { recipe: value.identity.recipe, exitCode: 0, timedOut: false, stdout: '', stderr: '', truncated: false, redacted: false, durationMs: 1 } };
  }
  async reconcileRun(): Promise<AgentContainmentReconcileOutcome> {
    this.reconcileCalls += 1;
    await this.onReconcile?.();
    return this.outcome;
  }
  async shutdown(): Promise<void> {}
}

function harness(persistence = new MemoryAgentRunJournalPersistence(), now = () => Date.now()) {
  let sequence = 0;
  const approvals = new ToolApprovalStore(now, () => `appr_private_${++sequence}`, 100);
  const deps = { registry: new CapabilityRegistry(), approvals, audit: new ToolAudit() };
  const resolver = new Resolver();
  const processes = new Processes();
  const journal = new AgentRunJournal(persistence, { terminalRetentionMs: 1_000, retentionBatchSize: 10, reconciliationLeaseMs: 30_000 }, () => `event_${++sequence}`);
  const service = new AgentModeCommandService(deps, now, () => `agentcmd_${++sequence}`, resolver, processes, journal, `svc_${++sequence}`);
  return { service, processes, persistence, deps };
}

async function propose(service: AgentModeCommandService, workspace: string) {
  const proposed = await service.propose({ rootPath: workspace, recipe: 'git.status', reason: 'contains ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA secret' }, context(workspace));
  assert.ok(proposed.ok);
  return proposed.view;
}

function durableContainmentIdentity(shared: MemoryAgentRunJournalPersistence, runId: string) {
  const run = shared.runs.get(runId)!;
  return containmentIdentityForTrustedRun({
    runId,
    workspaceIdentity: run.workspaceIdentity,
    recipeId: run.recipeId as 'git.status' | 'git.diff',
    proposalFingerprint: run.proposalFingerprint,
    snapshotManifestDigest: run.snapshotManifestDigest,
    executableDigest: run.executableDigest,
    recipePolicyVersion: run.recipePolicyVersion,
  });
}

test('AWAITING_APPROVAL restart loses approval credential, terminalizes, and old run cannot be approved', async () => {
  const workspace = root();
  const shared = new MemoryAgentRunJournalPersistence();
  const first = harness(shared);
  const run = await propose(first.service, workspace);
  const second = harness(shared);
  const summary = await second.service.reconcileOnStartup();
  assert.equal(summary.outcomes.RESTART_AUTHORIZATION_LOST, 1);
  const view = second.service.get(run.runId, context(workspace, '22222222-2222-4222-8222-222222222222'));
  assert.ok(view.ok);
  assert.equal(view.view.state, 'EXPIRED');
  const approval = await second.service.decide(run.runId, 'approve', run.preview!.fingerprint, context(workspace));
  assert.equal(approval.ok, false);
  assert.equal(second.processes.starts, 0);
});

test('APPROVED restart never executes and records RESTART_BEFORE_EXECUTION', async () => {
  const workspace = root();
  const shared = new MemoryAgentRunJournalPersistence();
  const first = harness(shared);
  const run = await propose(first.service, workspace);
  first.service.displayed(run.runId, run.preview!.fingerprint, context(workspace));
  assert.ok(shared.runs.get(run.runId));
  shared.transitionAgentRun({ runId: run.runId, expectedState: 'AWAITING_APPROVAL', nextState: 'APPROVED', at: Date.now(), source: 'APPROVAL', eventType: 'approval.approved', reason: 'test' });
  const second = harness(shared);
  await second.service.reconcileOnStartup();
  assert.equal(shared.runs.get(run.runId)?.state, 'STALE');
  assert.equal(shared.runs.get(run.runId)?.interruptionClassification, 'RESTART_BEFORE_EXECUTION');
  assert.equal(second.processes.starts, 0);
});

test('EXECUTING restart with no unit fails interrupted; valid unit is terminated and never replaced', async () => {
  const workspace = root();
  const shared = new MemoryAgentRunJournalPersistence();
  const first = harness(shared);
  const run = await propose(first.service, workspace);
  const durable = shared.runs.get(run.runId)!;
  shared.transitionAgentRun({ runId: run.runId, expectedState: 'AWAITING_APPROVAL', nextState: 'EXECUTING', at: Date.now(), source: 'EXECUTION', eventType: 'execution.spawned', reason: 'test' });
  let second = harness(shared);
  await second.service.reconcileOnStartup();
  assert.equal(shared.runs.get(run.runId)?.failureCode, 'INTERRUPTED_BY_RESTART');

  const another = await propose(first.service, workspace);
  const identity = durableContainmentIdentity(shared, another.runId);
  shared.transitionAgentRun({ runId: another.runId, expectedState: 'AWAITING_APPROVAL', nextState: 'EXECUTING', at: Date.now(), source: 'EXECUTION', eventType: 'execution.spawned', reason: 'test', patch: { containmentUnit: identity.unit, containmentBinding: identity.binding } });
  second = harness(shared);
  second.processes.outcome = { code: 'RESTART_CONTAINMENT_TERMINATED', terminated: true, cgroupEmpty: true };
  await second.service.reconcileOnStartup();
  assert.equal(shared.runs.get(another.runId)?.state, 'CANCELLED');
  assert.equal(shared.runs.get(another.runId)?.interruptionClassification, 'RESTART_CONTAINMENT_TERMINATED');
  assert.equal(second.processes.reconcileCalls, 1);
  assert.equal(second.processes.starts, 0);
  assert.ok(durable);
});

test('mismatched unit and termination failure become precise FAILED outcomes', async () => {
  const workspace = root();
  const shared = new MemoryAgentRunJournalPersistence();
  const seed = harness(shared);
  for (const code of ['RESTART_CONTAINMENT_IDENTITY_MISMATCH', 'RESTART_TERMINATION_FAILED'] as const) {
    const run = await propose(seed.service, workspace);
    const identity = durableContainmentIdentity(shared, run.runId);
    shared.transitionAgentRun({ runId: run.runId, expectedState: 'AWAITING_APPROVAL', nextState: 'EXECUTING', at: Date.now(), source: 'EXECUTION', eventType: 'execution.spawned', reason: 'test', patch: { containmentUnit: identity.unit, containmentBinding: identity.binding } });
    const second = harness(shared);
    second.processes.outcome = code === 'RESTART_CONTAINMENT_IDENTITY_MISMATCH' ? { code, terminated: false, cgroupEmpty: false } : { code, terminated: false, cgroupEmpty: false };
    await second.service.reconcileOnStartup();
    assert.equal(shared.runs.get(run.runId)?.state, 'FAILED');
    assert.equal(shared.runs.get(run.runId)?.failureCode, code);
  }
});

test('dual-instance reconciliation lease lets only one owner terminalize a run', async () => {
  const workspace = root();
  const shared = new MemoryAgentRunJournalPersistence();
  const seed = harness(shared);
  const run = await propose(seed.service, workspace);
  const a = harness(shared);
  const b = harness(shared);
  assert.equal((await a.service.reconcileOnStartup()).reconciled, 1);
  assert.equal((await b.service.reconcileOnStartup()).reconciled, 0);
  assert.equal(shared.events.get(run.runId)?.filter((event) => event.type === 'approval.lost_on_restart').length, 1);
});

test('spawned containment identity persistence failure fails closed instead of completing', async () => {
  const workspace = root();
  class FailingSpawnPersistence extends MemoryAgentRunJournalPersistence {
    override transitionAgentRun(input: Parameters<MemoryAgentRunJournalPersistence['transitionAgentRun']>[0]): boolean {
      if (input.eventType === 'execution.spawned') return false;
      return super.transitionAgentRun(input);
    }
  }
  const shared = new FailingSpawnPersistence();
  const h = harness(shared);
  const run = await propose(h.service, workspace);
  h.service.displayed(run.runId, run.preview!.fingerprint, context(workspace));
  assert.ok((await h.service.decide(run.runId, 'approve', run.preview!.fingerprint, context(workspace))).ok);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const durable = shared.runs.get(run.runId);
    if (durable?.state === 'FAILED') break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(shared.runs.get(run.runId)?.state, 'FAILED');
  assert.equal(shared.runs.get(run.runId)?.failureCode, 'SPAWNED_IDENTITY_PERSISTENCE_FAILED');
  assert.equal(shared.events.get(run.runId)?.some((event) => event.type === 'execution.completed'), false);
  assert.equal(h.processes.starts, 1);
});

test('long-running reconciliation cannot terminalize after its lease expires and a newer fence wins', async () => {
  let now = 1_000;
  const workspace = root();
  const shared = new MemoryAgentRunJournalPersistence();
  const seed = harness(shared, () => now);
  const run = await propose(seed.service, workspace);
  const identity = durableContainmentIdentity(shared, run.runId);
  shared.transitionAgentRun({ runId: run.runId, expectedState: 'AWAITING_APPROVAL', nextState: 'EXECUTING', at: now, source: 'EXECUTION', eventType: 'execution.spawned', reason: 'test', patch: { containmentUnit: identity.unit, containmentBinding: identity.binding } });
  const ownerA = harness(shared, () => now);
  ownerA.processes.outcome = { code: 'RESTART_CONTAINMENT_TERMINATED', terminated: true, cgroupEmpty: true };
  ownerA.processes.onReconcile = () => {
    now = 40_000;
    const ownerB = shared.claimAgentRunReconciliation(run.runId, 'owner-b', 70_000, now);
    assert.ok(ownerB);
  };
  const summary = await ownerA.service.reconcileOnStartup();
  assert.equal(summary.outcomes.RECONCILIATION_FENCE_LOST, 1);
  assert.equal(shared.runs.get(run.runId)?.state, 'EXECUTING');
  now = 80_000;
  const ownerB = harness(shared, () => now);
  ownerB.processes.outcome = { code: 'RESTART_CONTAINMENT_TERMINATED', terminated: true, cgroupEmpty: true };
  const second = await ownerB.service.reconcileOnStartup();
  assert.equal(second.outcomes.RESTART_CONTAINMENT_TERMINATED, 1);
  assert.equal(shared.runs.get(run.runId)?.state, 'CANCELLED');
});

test('long-running reconciliation renews the lease and terminalizes while still owned', async () => {
  let now = 1_000;
  const workspace = root();
  const shared = new MemoryAgentRunJournalPersistence();
  const seed = harness(shared, () => now);
  const run = await propose(seed.service, workspace);
  const identity = durableContainmentIdentity(shared, run.runId);
  shared.transitionAgentRun({ runId: run.runId, expectedState: 'AWAITING_APPROVAL', nextState: 'EXECUTING', at: now, source: 'EXECUTION', eventType: 'execution.spawned', reason: 'test', patch: { containmentUnit: identity.unit, containmentBinding: identity.binding } });
  const owner = harness(shared, () => now);
  owner.processes.outcome = { code: 'RESTART_CONTAINMENT_TERMINATED', terminated: true, cgroupEmpty: true };
  owner.processes.onReconcile = () => { now = 20_000; };
  const summary = await owner.service.reconcileOnStartup();
  assert.equal(summary.outcomes.RESTART_CONTAINMENT_TERMINATED, 1);
  assert.equal(shared.runs.get(run.runId)?.state, 'CANCELLED');
  assert.equal(shared.runs.get(run.runId)?.failureCode, 'RESTART_CONTAINMENT_TERMINATED');
  assert.equal(shared.events.get(run.runId)?.at(-1)?.type, 'containment.terminated');
});

test('journal redacts durable preview/result/error and never persists credentials', async () => {
  const workspace = root();
  const shared = new MemoryAgentRunJournalPersistence();
  const h = harness(shared);
  const run = await propose(h.service, workspace);
  h.service.displayed(run.runId, run.preview!.fingerprint, context(workspace));
  await h.service.decide(run.runId, 'reject', run.preview!.fingerprint, context(workspace));
  const durableJson = JSON.stringify({ runs: [...shared.runs.values()], events: [...shared.events.values()] });
  assert.doesNotMatch(durableJson, /appr_private|agentcap_|bootstrap-secret|ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA|PRIVATE KEY/);
});

test('retention preserves active runs and deletes old terminals in bounded batches with delete event', async () => {
  const workspace = root();
  const shared = new MemoryAgentRunJournalPersistence();
  const h = harness(shared, () => 10_000);
  const active = await propose(h.service, workspace);
  const terminal = await propose(h.service, workspace);
  h.service.displayed(terminal.runId, terminal.preview!.fingerprint, context(workspace));
  await h.service.decide(terminal.runId, 'reject', terminal.preview!.fingerprint, context(workspace));
  shared.runs.get(terminal.runId)!.terminalAt = 1;
  const pruned = new AgentRunJournal(shared, { terminalRetentionMs: 1_000, retentionBatchSize: 1, reconciliationLeaseMs: 30_000 }).prune(10_000);
  assert.equal(pruned.runs, 1);
  assert.ok(shared.runs.has(active.runId));
  assert.equal(shared.runs.has(terminal.runId), false);
});
