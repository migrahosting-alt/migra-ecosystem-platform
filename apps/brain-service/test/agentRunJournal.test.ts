import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { CapabilityRegistry } from '../src/engine/capabilityRegistry.js';
import { ToolApprovalStore, hashInput } from '../src/engine/toolApprovalStore.js';
import { ToolAudit } from '../src/engine/toolAudit.js';
import { AGENT_MODE_RECONCILIATION_TERMINAL_EMITTERS, agentModeReconciliationEmitterContractParity, agentModeRecoveryMetadataFor, type AgentModeRequestContext, AgentModeCommandService } from '../src/engine/agentModeCommandService.js';
import { AgentRunJournal, MemoryAgentRunJournalPersistence } from '../src/engine/agentRunJournal.js';
import { AGENT_RECIPE_OUTPUT_CAP_BYTES, AGENT_RECIPE_POLICY_VERSION, AgentRecipePolicyError, containmentIdentityForPlan, containmentIdentityForTrustedRun, type AgentContainmentIdentity, type AgentContainmentReconcileOutcome, type AgentRecipeExecutionOutcome, type AgentRecipePlan, type AgentRecipeProcessManagerLike, type AgentRecipeResolverLike } from '../src/engine/agentRecipe.js';
import type { DurableAgentRun, DurableAgentRunEvent, DurableAgentRunState } from '../src/engine/persistence/types.js';
import { recoveryClassCanCreateFreshProposal, recoveryProductionReasonContracts } from '../src/engine/recoverySourceProvenance.js';

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
  prepares = 0;
  workspaceVersion = 0;
  failPrepare = false;
  async prepare(_recipe: 'git.status' | 'git.diff', workspace: string, input: { runId: string }): Promise<AgentRecipePlan> {
    this.prepares += 1;
    if (this.failPrepare) throw new AgentRecipePolicyError('CONTAINMENT_UNAVAILABLE', 'snapshot unavailable');
    const prepared = plan(workspace, input.runId);
    prepared.identity.snapshotId = `snapshot-${input.runId}-${this.prepares}-${this.workspaceVersion}`;
    prepared.identity.workspaceMaterialIdentity = `manifest-${input.runId}-${this.prepares}-${this.workspaceVersion}`;
    return prepared;
  }
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
  return { service, processes, persistence, deps, resolver };
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

type DurableTerminalSpec = {
  name: string;
  state: DurableAgentRunState;
  failureCode: string;
  approvalLifecycle: DurableAgentRun['approvalLifecycle'];
  recoveryClass: DurableAgentRun['recoveryClass'];
  events: Array<{
    type: string;
    priorState?: DurableAgentRunState;
    nextState: DurableAgentRunState;
    reason?: string;
    source?: DurableAgentRunEvent['source'];
  }>;
  approvalDecisionType?: DurableAgentRun['approvalDecisionType'];
  executionStarted?: boolean;
  containment?: boolean;
  recoverable: boolean;
};

function sourceEvent(durable: DurableAgentRun, index: number, spec: DurableTerminalSpec['events'][number]): DurableAgentRunEvent {
  return {
    eventId: `${durable.runId}:${index}:${spec.type}`,
    runId: durable.runId,
    seq: index,
    at: (durable.proposalAt ?? durable.requestedAt) + index,
    type: spec.type,
    priorState: spec.priorState,
    nextState: spec.nextState,
    reason: spec.reason,
    correlationId: durable.correlationId,
    source: spec.source ?? (spec.type.startsWith('approval.') ? 'APPROVAL' : spec.type.startsWith('execution.') || spec.type.startsWith('containment.') ? 'EXECUTION' : spec.type.startsWith('restart.') ? 'RECONCILIATION' : 'API'),
    schemaVersion: durable.schemaVersion,
  };
}

function installTerminalHistory(shared: MemoryAgentRunJournalPersistence, runId: string, spec: DurableTerminalSpec) {
  const durable = shared.runs.get(runId)!;
  const identity = spec.containment ? durableContainmentIdentity(shared, runId) : undefined;
  const events = spec.events.map((event, index) => sourceEvent(durable, index + 1, event));
  Object.assign(durable, {
    state: spec.state,
    failureCode: spec.failureCode,
    interruptionClassification: spec.failureCode,
    recoveryClass: spec.recoveryClass,
    recoveryEligible: spec.recoverable,
    recoveryReason: spec.failureCode,
    approvalLifecycle: spec.approvalLifecycle,
    approvalDecisionType: spec.approvalDecisionType,
    terminalAt: events.at(-1)!.at,
    updatedAt: events.at(-1)!.at,
    auditSeq: events.length,
    executionStartedAt: spec.executionStarted ? events.find((event) => event.type === 'execution.start_requested')?.at ?? durable.proposalAt : undefined,
    containmentUnit: identity?.unit,
    containmentBinding: identity?.binding,
    successorRunId: undefined,
    lastRecoveryRequestId: undefined,
  });
  shared.events.set(runId, events);
}

function approveDurableRun(shared: MemoryAgentRunJournalPersistence, runId: string, at: number) {
  assert.equal(shared.transitionAgentRun({
    runId,
    expectedState: 'AWAITING_APPROVAL',
    nextState: 'APPROVED',
    at,
    source: 'APPROVAL',
    eventType: 'approval.approved',
    reason: 'HUMAN_APPROVED',
    patch: { approvalLifecycle: 'APPROVED', approvalDecisionType: 'APPROVED', approvalDecisionAt: at },
  }), true);
}

function startDurableRun(shared: MemoryAgentRunJournalPersistence, runId: string, at: number, withContainment: boolean) {
  assert.equal(shared.transitionAgentRun({
    runId,
    expectedState: 'APPROVED',
    nextState: 'APPROVED',
    at,
    source: 'APPROVAL',
    eventType: 'approval.consumed',
    reason: 'ONE_TIME_AUTHORITY_CONSUMED',
    patch: { approvalLifecycle: 'CONSUMED' },
  }), true);
  assert.equal(shared.transitionAgentRun({
    runId,
    expectedState: 'APPROVED',
    nextState: 'EXECUTING',
    at: at + 1,
    source: 'EXECUTION',
    eventType: 'execution.start_requested',
    reason: 'APPROVED_EXECUTION_START',
    patch: { executionStartedAt: at + 1 },
  }), true);
  if (withContainment) {
    const identity = durableContainmentIdentity(shared, runId);
    assert.equal(shared.transitionAgentRun({
      runId,
      expectedState: 'EXECUTING',
      nextState: 'EXECUTING',
      at: at + 2,
      source: 'EXECUTION',
      eventType: 'execution.spawned',
      reason: 'CONTAINMENT_STARTED',
      patch: { containmentUnit: identity.unit, containmentBinding: identity.binding },
    }), true);
  }
}

function terminalSpecs(): DurableTerminalSpec[] {
  const pending = [
    { type: 'run.created', nextState: 'AWAITING_APPROVAL' as const, reason: 'PROPOSAL_CREATED' },
    { type: 'proposal.created', nextState: 'AWAITING_APPROVAL' as const, reason: 'git.status' },
    { type: 'approval.requested', nextState: 'AWAITING_APPROVAL' as const, reason: 'PENDING_DISPLAY' },
  ];
  const approved = [
    ...pending,
    { type: 'approval.approved', priorState: 'AWAITING_APPROVAL' as const, nextState: 'APPROVED' as const, reason: 'HUMAN_APPROVED' },
  ];
  const started = [
    ...approved,
    { type: 'execution.start_requested', priorState: 'APPROVED' as const, nextState: 'EXECUTING' as const, reason: 'APPROVAL_CONSUMED', source: 'EXECUTION' as const },
  ];
  const spawned = [
    ...started,
    { type: 'execution.spawned', priorState: 'EXECUTING' as const, nextState: 'EXECUTING' as const, reason: 'CONTAINMENT_STARTED', source: 'EXECUTION' as const },
  ];
  return [
    { name: 'REJECTED / REJECTED', state: 'REJECTED', failureCode: 'REJECTED', approvalLifecycle: 'REJECTED', approvalDecisionType: 'REJECTED', recoveryClass: 'REPROPOSAL_ALLOWED', recoverable: true, events: [...pending, { type: 'approval.rejected', priorState: 'AWAITING_APPROVAL', nextState: 'REJECTED', reason: 'HUMAN_REJECTED', source: 'APPROVAL' }] },
    { name: 'EXPIRED / EXPIRED', state: 'EXPIRED', failureCode: 'EXPIRED', approvalLifecycle: 'EXPIRED', recoveryClass: 'REPROPOSAL_ALLOWED', recoverable: true, events: [...pending, { type: 'approval.expired', priorState: 'AWAITING_APPROVAL', nextState: 'EXPIRED', reason: 'APPROVAL_TTL_EXPIRED', source: 'APPROVAL' }] },
    { name: 'EXPIRED / RESTART_AUTHORIZATION_LOST', state: 'EXPIRED', failureCode: 'RESTART_AUTHORIZATION_LOST', approvalLifecycle: 'LOST_ON_RESTART', recoveryClass: 'REPROPOSAL_REQUIRED', recoverable: true, events: [...pending, { type: 'approval.lost_on_restart', priorState: 'AWAITING_APPROVAL', nextState: 'EXPIRED', reason: 'RESTART_AUTHORIZATION_LOST', source: 'RECONCILIATION' }] },
    { name: 'STALE / STALE', state: 'STALE', failureCode: 'STALE', approvalLifecycle: 'INVALIDATED', recoveryClass: 'SNAPSHOT_CHANGED', recoverable: true, events: [...pending, { type: 'proposal.stale', priorState: 'AWAITING_APPROVAL', nextState: 'STALE', reason: 'STALE_PROPOSAL', source: 'API' }] },
    { name: 'STALE / RESTART_BEFORE_EXECUTION', state: 'STALE', failureCode: 'RESTART_BEFORE_EXECUTION', approvalLifecycle: 'INVALIDATED', recoveryClass: 'REPROPOSAL_REQUIRED', recoverable: true, events: [...approved, { type: 'restart.authorization_lost', priorState: 'APPROVED', nextState: 'STALE', reason: 'RESTART_BEFORE_EXECUTION', source: 'RECONCILIATION' }] },
    { name: 'FAILED / INTERRUPTED_BY_RESTART', state: 'FAILED', failureCode: 'INTERRUPTED_BY_RESTART', approvalLifecycle: 'INVALIDATED', recoveryClass: 'REPROPOSAL_ALLOWED', recoverable: true, executionStarted: true, events: [...started, { type: 'restart.interrupted_execution', priorState: 'EXECUTING', nextState: 'FAILED', reason: 'INTERRUPTED_BY_RESTART', source: 'RECONCILIATION' }] },
    { name: 'FAILED / RESTART_NO_CONTAINMENT_FOUND', state: 'FAILED', failureCode: 'RESTART_NO_CONTAINMENT_FOUND', approvalLifecycle: 'INVALIDATED', recoveryClass: 'REPROPOSAL_ALLOWED', recoverable: true, executionStarted: true, events: [...started, { type: 'restart.interrupted_execution', priorState: 'EXECUTING', nextState: 'FAILED', reason: 'RESTART_NO_CONTAINMENT_FOUND', source: 'RECONCILIATION' }] },
    { name: 'FAILED / RESTART_CONTAINMENT_ALREADY_EXITED', state: 'FAILED', failureCode: 'RESTART_CONTAINMENT_ALREADY_EXITED', approvalLifecycle: 'INVALIDATED', recoveryClass: 'REPROPOSAL_ALLOWED', recoverable: true, executionStarted: true, events: [...started, { type: 'restart.interrupted_execution', priorState: 'EXECUTING', nextState: 'FAILED', reason: 'RESTART_CONTAINMENT_ALREADY_EXITED', source: 'RECONCILIATION' }] },
    { name: 'CANCELLED / RESTART_CONTAINMENT_TERMINATED', state: 'CANCELLED', failureCode: 'RESTART_CONTAINMENT_TERMINATED', approvalLifecycle: 'INVALIDATED', recoveryClass: 'REPROPOSAL_ALLOWED', recoverable: true, executionStarted: true, containment: true, events: [...spawned, { type: 'containment.terminated', priorState: 'EXECUTING', nextState: 'CANCELLED', reason: 'RESTART_CONTAINMENT_TERMINATED', source: 'RECONCILIATION' }] },
  ];
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

test('startup reconciliation enumerates every production terminal branch with contract-matched metadata', async () => {
  const cases: Array<{
    name: string;
    setup(shared: MemoryAgentRunJournalPersistence, runId: string): void;
    outcome?: AgentContainmentReconcileOutcome;
    expectedState: DurableAgentRunState;
    expectedReason: string;
    expectedEvent: string;
    expectProcessReconcileCalls: number;
  }> = [
    {
      name: 'pending approval loses authority',
      setup: () => {},
      expectedState: 'EXPIRED',
      expectedReason: 'RESTART_AUTHORIZATION_LOST',
      expectedEvent: 'approval.lost_on_restart',
      expectProcessReconcileCalls: 0,
    },
    {
      name: 'approved before execution becomes stale pre-execution only',
      setup: (shared, runId) => approveDurableRun(shared, runId, 2_000),
      expectedState: 'STALE',
      expectedReason: 'RESTART_BEFORE_EXECUTION',
      expectedEvent: 'restart.authorization_lost',
      expectProcessReconcileCalls: 0,
    },
    {
      name: 'executing without containment identity becomes interrupted failure',
      setup: (shared, runId) => { approveDurableRun(shared, runId, 2_000); startDurableRun(shared, runId, 2_010, false); },
      expectedState: 'FAILED',
      expectedReason: 'INTERRUPTED_BY_RESTART',
      expectedEvent: 'restart.interrupted_execution',
      expectProcessReconcileCalls: 0,
    },
    {
      name: 'executing with mismatched containment identity becomes integrity-sensitive failure',
      setup: (shared, runId) => {
        approveDurableRun(shared, runId, 2_000);
        startDurableRun(shared, runId, 2_010, true);
        shared.runs.get(runId)!.containmentBinding = 'forged-binding';
      },
      expectedState: 'FAILED',
      expectedReason: 'RESTART_CONTAINMENT_IDENTITY_MISMATCH',
      expectedEvent: 'restart.interrupted_execution',
      expectProcessReconcileCalls: 0,
    },
    {
      name: 'valid containment not found',
      setup: (shared, runId) => { approveDurableRun(shared, runId, 2_000); startDurableRun(shared, runId, 2_010, true); },
      outcome: { code: 'RESTART_NO_CONTAINMENT_FOUND', terminated: false, cgroupEmpty: true },
      expectedState: 'FAILED',
      expectedReason: 'RESTART_NO_CONTAINMENT_FOUND',
      expectedEvent: 'restart.interrupted_execution',
      expectProcessReconcileCalls: 1,
    },
    {
      name: 'valid containment already exited',
      setup: (shared, runId) => { approveDurableRun(shared, runId, 2_000); startDurableRun(shared, runId, 2_010, true); },
      outcome: { code: 'RESTART_CONTAINMENT_ALREADY_EXITED', terminated: false, cgroupEmpty: true },
      expectedState: 'FAILED',
      expectedReason: 'RESTART_CONTAINMENT_ALREADY_EXITED',
      expectedEvent: 'restart.interrupted_execution',
      expectProcessReconcileCalls: 1,
    },
    {
      name: 'valid containment termination failed',
      setup: (shared, runId) => { approveDurableRun(shared, runId, 2_000); startDurableRun(shared, runId, 2_010, true); },
      outcome: { code: 'RESTART_TERMINATION_FAILED', terminated: false, cgroupEmpty: false },
      expectedState: 'FAILED',
      expectedReason: 'RESTART_TERMINATION_FAILED',
      expectedEvent: 'containment.termination_failed',
      expectProcessReconcileCalls: 1,
    },
    {
      name: 'valid containment terminated',
      setup: (shared, runId) => { approveDurableRun(shared, runId, 2_000); startDurableRun(shared, runId, 2_010, true); },
      outcome: { code: 'RESTART_CONTAINMENT_TERMINATED', terminated: true, cgroupEmpty: true },
      expectedState: 'CANCELLED',
      expectedReason: 'RESTART_CONTAINMENT_TERMINATED',
      expectedEvent: 'containment.terminated',
      expectProcessReconcileCalls: 1,
    },
  ];

  for (const entry of cases) {
    const workspace = root();
    const shared = new MemoryAgentRunJournalPersistence();
    const seed = harness(shared);
    const run = await propose(seed.service, workspace);
    entry.setup(shared, run.runId);
    const service = harness(shared);
    if (entry.outcome) service.processes.outcome = entry.outcome;

    const summary = await service.service.reconcileOnStartup();
    assert.equal(summary.outcomes[entry.expectedReason], 1, entry.name);
    assert.equal(service.processes.reconcileCalls, entry.expectProcessReconcileCalls, entry.name);
    const durable = shared.runs.get(run.runId)!;
    const metadata = agentModeRecoveryMetadataFor(entry.expectedReason, entry.expectedState);
    assert.equal(durable.state, entry.expectedState, entry.name);
    assert.equal(durable.failureCode, entry.expectedReason, entry.name);
    assert.equal(durable.interruptionClassification, entry.expectedReason, entry.name);
    assert.equal(durable.approvalInvalidationReason, metadata.approvalInvalidationReason, entry.name);
    assert.equal(durable.recoveryClass, metadata.recoveryClass, entry.name);
    assert.equal(durable.recoveryEligible, metadata.recoveryEligible, entry.name);
    assert.equal(durable.recoveryReason, metadata.recoveryReason, entry.name);
    const terminal = shared.events.get(run.runId)!.at(-1)!;
    assert.equal(terminal.type, entry.expectedEvent, entry.name);
    assert.equal(terminal.nextState, entry.expectedState, entry.name);
    assert.equal(terminal.reason, entry.expectedReason, entry.name);
    assert.equal(terminal.source, 'RECONCILIATION', entry.name);
    assert.equal(entry.expectedState === 'STALE' && entry.expectedReason === 'INTERRUPTED_BY_RESTART', false, entry.name);
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

test('approval lifecycle is durable from proposal through display, rejection, and recovery eligibility', async () => {
  const workspace = root();
  const shared = new MemoryAgentRunJournalPersistence();
  const h = harness(shared);
  const run = await propose(h.service, workspace);
  assert.equal(shared.runs.get(run.runId)?.approvalLifecycle, 'PENDING_DISPLAY');
  assert.equal(shared.runs.get(run.runId)?.recoveryEligible, false);

  const displayed = h.service.displayed(run.runId, run.preview!.fingerprint, context(workspace));
  assert.equal(displayed.ok, true);
  assert.equal(shared.runs.get(run.runId)?.approvalLifecycle, 'DISPLAYED');

  const rejected = await h.service.decide(run.runId, 'reject', run.preview!.fingerprint, context(workspace));
  assert.equal(rejected.ok, true);
  const durable = shared.runs.get(run.runId)!;
  assert.equal(durable.state, 'REJECTED');
  assert.equal(durable.approvalLifecycle, 'REJECTED');
  assert.equal(durable.approvalDecisionType, 'REJECTED');
  assert.equal(durable.recoveryClass, 'REPROPOSAL_ALLOWED');
  assert.equal(durable.recoveryEligible, true);
});

test('restart reconciliation records lost approval and permits fresh proposal without execution resume', async () => {
  const workspace = root();
  const shared = new MemoryAgentRunJournalPersistence();
  const first = harness(shared);
  const run = await propose(first.service, workspace);

  const second = harness(shared);
  await second.service.reconcileOnStartup();
  const status = second.service.getRunRecoveryStatus(run.runId, context(workspace));
  assert.equal(status.ok, true);
  assert.equal(status.status.recoveryClass, 'REPROPOSAL_REQUIRED');
  assert.equal(status.status.eligible, true);
  assert.equal(shared.runs.get(run.runId)?.approvalLifecycle, 'LOST_ON_RESTART');

  const successor = await second.service.reproposeFromRun(run.runId, { requestId: 'stage3b-reproposal-1' }, context(workspace));
  assert.equal(successor.ok, true);
  assert.equal(successor.view.state, 'AWAITING_APPROVAL');
  assert.notEqual(successor.view.runId, run.runId);
  assert.equal(successor.view.approval?.lifecycle, 'PENDING_DISPLAY');
  assert.equal(second.processes.starts, 0);
  assert.equal(shared.runs.get(run.runId)?.successorRunId, successor.view.runId);
  assert.equal(shared.runs.get(successor.view.runId)?.recoverySourceRunId, run.runId);

  const replay = await second.service.reproposeFromRun(run.runId, { requestId: 'stage3b-reproposal-1' }, context(workspace));
  assert.equal(replay.ok, true);
  assert.equal(replay.view.runId, successor.view.runId);

  const conflicting = await second.service.reproposeFromRun(run.runId, { requestId: 'stage3b-reproposal-2' }, context(workspace));
  assert.equal(conflicting.ok, false);
  assert.equal(conflicting.code, 'RECOVERY_CONFLICT');
});

test('fresh reproposal requires current workspace and recipe policy', async () => {
  const workspace = root();
  const shared = new MemoryAgentRunJournalPersistence();
  const h = harness(shared);
  const run = await propose(h.service, workspace);
  h.service.displayed(run.runId, run.preview!.fingerprint, context(workspace));
  await h.service.decide(run.runId, 'reject', run.preview!.fingerprint, context(workspace));

  const wrongWorkspace = await h.service.reproposeFromRun(run.runId, { requestId: 'stage3b-reproposal-workspace' }, { ...context(workspace), workspaceIdentity: 'other-workspace' });
  assert.equal(wrongWorkspace.ok, false);
  assert.equal(wrongWorkspace.code, 'UNKNOWN_RUN');

  const disabledRecipe = await h.service.reproposeFromRun(run.runId, { requestId: 'stage3b-reproposal-policy' }, { ...context(workspace), allowedRecipes: ['git.diff'] });
  assert.equal(disabledRecipe.ok, false);
  assert.equal(disabledRecipe.code, 'RECOVERY_INELIGIBLE');
  assert.equal(h.processes.starts, 0);
});

test('forged terminal durable row without coherent events cannot be recovered', async () => {
  const workspace = root();
  const shared = new MemoryAgentRunJournalPersistence();
  const h = harness(shared);
  const run = await propose(h.service, workspace);
  h.service.displayed(run.runId, run.preview!.fingerprint, context(workspace));
  await h.service.decide(run.runId, 'reject', run.preview!.fingerprint, context(workspace));

  const durable = shared.runs.get(run.runId)!;
  durable.recoveryEligible = true;
  durable.recoveryClass = 'REPROPOSAL_ALLOWED';
  shared.events.set(run.runId, []);

  const status = h.service.getRunRecoveryStatus(run.runId, context(workspace));
  assert.equal(status.ok, true);
  assert.equal(status.status.eligible, false);
  assert.match(status.status.explanation, /durable history is incomplete/i);
  assert.notEqual(status.status.recommendedAction, 'Create a fresh proposal.');

  const denied = await h.service.reproposeFromRun(run.runId, { requestId: 'stage3b-forged-no-events' }, context(workspace));
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'RECOVERY_INELIGIBLE');
  assert.equal(h.processes.starts, 0);
  assert.equal(shared.runs.get(run.runId)?.successorRunId, undefined);
  assert.equal((shared.events.get(run.runId) ?? []).filter((event) => event.type.startsWith('recovery.')).length, 0);
});

test('corrupt source event chains are ineligible and cannot create successors', async () => {
  const corruptions: Array<{ name: string; mutate(events: DurableAgentRunEvent[]): DurableAgentRunEvent[]; run?: (run: DurableAgentRun) => void }> = [
    { name: 'missing run.created', mutate: (events) => events.filter((event) => event.type !== 'run.created') },
    { name: 'missing proposal.created', mutate: (events) => events.filter((event) => event.type !== 'proposal.created') },
    { name: 'missing terminal event', mutate: (events) => events.filter((event) => event.type !== 'approval.rejected') },
    { name: 'sequence gap', mutate: (events) => events.map((event) => event.type === 'proposal.created' ? { ...event, seq: event.seq + 2 } : event) },
    { name: 'duplicate sequence', mutate: (events) => events.map((event) => event.type === 'approval.rejected' ? { ...event, seq: 2 } : event) },
    { name: 'out-of-order transition', mutate: (events) => events.map((event) => event.type === 'approval.rejected' ? { ...event, priorState: 'APPROVED' } : event) },
    { name: 'terminal mismatch', mutate: (events) => events, run: (durable) => { durable.state = 'EXPIRED'; } },
    { name: 'audit mismatch', mutate: (events) => events, run: (durable) => { durable.auditSeq += 1; } },
    { name: 'correlation mismatch', mutate: (events) => events.map((event) => event.type === 'proposal.created' ? { ...event, correlationId: 'forged-correlation' } : event) },
    { name: 'approval lifecycle mismatch', mutate: (events) => events, run: (durable) => { durable.approvalLifecycle = 'APPROVED'; } },
    { name: 'metadata incomplete', mutate: (events) => events, run: (durable) => { durable.snapshotId = ''; } },
  ];

  for (const corruption of corruptions) {
    const workspace = root();
    const shared = new MemoryAgentRunJournalPersistence();
    const h = harness(shared);
    const view = await propose(h.service, workspace);
    h.service.displayed(view.runId, view.preview!.fingerprint, context(workspace));
    await h.service.decide(view.runId, 'reject', view.preview!.fingerprint, context(workspace));
    const durable = shared.runs.get(view.runId)!;
    corruption.run?.(durable);
    shared.events.set(view.runId, corruption.mutate(shared.events.get(view.runId) ?? []));

    const status = h.service.getRunRecoveryStatus(view.runId, context(workspace));
    assert.equal(status.ok, true, corruption.name);
    assert.equal(status.status.eligible, false, corruption.name);
    assert.notEqual(status.status.recommendedAction, 'Create a fresh proposal.', corruption.name);
    const denied = await h.service.reproposeFromRun(view.runId, { requestId: `stage3b-corrupt-${corruption.name.replaceAll(' ', '-')}` }, context(workspace));
    assert.equal(denied.ok, false, corruption.name);
    assert.equal(denied.code, 'RECOVERY_INELIGIBLE', corruption.name);
    assert.equal(h.processes.starts, 0, corruption.name);
    assert.equal(shared.runs.get(view.runId)?.successorRunId, undefined, corruption.name);
  }
});

test('forged terminal reason and terminal event contracts are rejected', async () => {
  const cases: Array<{
    name: string;
    state: DurableAgentRun['state'];
    failureCode: string;
    approvalLifecycle: DurableAgentRun['approvalLifecycle'];
    finalType: string;
    finalReason: string;
    finalPrior?: DurableAgentRun['state'];
    extra?: DurableAgentRunEvent[];
    run?: (run: DurableAgentRun) => void;
  }> = [
    { name: 'EXPIRED forged reason', state: 'EXPIRED', failureCode: 'FORGED_REASON', approvalLifecycle: 'EXPIRED', finalType: 'approval.expired', finalReason: 'APPROVAL_TTL_EXPIRED', finalPrior: 'AWAITING_APPROVAL' },
    { name: 'EXPIRED wrong terminal event', state: 'EXPIRED', failureCode: 'RESTART_AUTHORIZATION_LOST', approvalLifecycle: 'LOST_ON_RESTART', finalType: 'restart.authorization_lost', finalReason: 'RESTART_AUTHORIZATION_LOST', finalPrior: 'AWAITING_APPROVAL' },
    { name: 'EXPIRED unknown event type', state: 'EXPIRED', failureCode: 'EXPIRED', approvalLifecycle: 'EXPIRED', finalType: 'forged.terminal', finalReason: 'APPROVAL_TTL_EXPIRED', finalPrior: 'AWAITING_APPROVAL' },
    { name: 'EXPIRED execution spawned', state: 'EXPIRED', failureCode: 'EXPIRED', approvalLifecycle: 'EXPIRED', finalType: 'approval.expired', finalReason: 'APPROVAL_TTL_EXPIRED', finalPrior: 'EXECUTING', extra: [{ eventId: 'extra_spawned', runId: 'placeholder', seq: 4, at: 1, type: 'execution.spawned', priorState: 'EXECUTING', nextState: 'EXECUTING', correlationId: 'placeholder', source: 'EXECUTION', schemaVersion: 1 }], run: (durable) => { durable.executionStartedAt = 1; } },
    { name: 'STALE forged reason', state: 'STALE', failureCode: 'FORGED_REASON', approvalLifecycle: 'INVALIDATED', finalType: 'proposal.stale', finalReason: 'STALE_PROPOSAL', finalPrior: 'AWAITING_APPROVAL' },
    { name: 'STALE wrong restart event', state: 'STALE', failureCode: 'RESTART_BEFORE_EXECUTION', approvalLifecycle: 'INVALIDATED', finalType: 'approval.lost_on_restart', finalReason: 'RESTART_AUTHORIZATION_LOST', finalPrior: 'APPROVED' },
    { name: 'STALE execution started', state: 'STALE', failureCode: 'RESTART_BEFORE_EXECUTION', approvalLifecycle: 'INVALIDATED', finalType: 'restart.authorization_lost', finalReason: 'RESTART_BEFORE_EXECUTION', finalPrior: 'EXECUTING', extra: [{ eventId: 'extra_start', runId: 'placeholder', seq: 4, at: 1, type: 'execution.start_requested', priorState: 'APPROVED', nextState: 'EXECUTING', correlationId: 'placeholder', source: 'EXECUTION', schemaVersion: 1 }], run: (durable) => { durable.executionStartedAt = 1; } },
    { name: 'FAILED synthetic reason', state: 'FAILED', failureCode: 'SYNTHETIC_FAILURE', approvalLifecycle: 'INVALIDATED', finalType: 'restart.interrupted_execution', finalReason: 'SYNTHETIC_FAILURE', finalPrior: 'EXECUTING', run: (durable) => { durable.executionStartedAt = 1; } },
    { name: 'FAILED unknown terminal event', state: 'FAILED', failureCode: 'INTERRUPTED_BY_RESTART', approvalLifecycle: 'INVALIDATED', finalType: 'forged.failed', finalReason: 'INTERRUPTED_BY_RESTART', finalPrior: 'EXECUTING', run: (durable) => { durable.executionStartedAt = 1; } },
    { name: 'FAILED completed present', state: 'FAILED', failureCode: 'INTERRUPTED_BY_RESTART', approvalLifecycle: 'INVALIDATED', finalType: 'restart.interrupted_execution', finalReason: 'INTERRUPTED_BY_RESTART', finalPrior: 'EXECUTING', extra: [{ eventId: 'extra_completed', runId: 'placeholder', seq: 5, at: 1, type: 'execution.completed', priorState: 'EXECUTING', nextState: 'COMPLETED', reason: 'PROCESS_EXITED', correlationId: 'placeholder', source: 'EXECUTION', schemaVersion: 1 }], run: (durable) => { durable.executionStartedAt = 1; } },
    { name: 'FAILED termination failed with terminated event', state: 'FAILED', failureCode: 'RESTART_TERMINATION_FAILED', approvalLifecycle: 'INVALIDATED', finalType: 'containment.terminated', finalReason: 'RESTART_CONTAINMENT_TERMINATED', finalPrior: 'EXECUTING', run: (durable) => { durable.executionStartedAt = 1; durable.containmentUnit = 'unit'; durable.containmentBinding = 'binding'; } },
    { name: 'CANCELLED termination failed reason', state: 'CANCELLED', failureCode: 'RESTART_TERMINATION_FAILED', approvalLifecycle: 'INVALIDATED', finalType: 'containment.termination_failed', finalReason: 'RESTART_TERMINATION_FAILED', finalPrior: 'EXECUTING', run: (durable) => { durable.executionStartedAt = 1; durable.containmentUnit = 'unit'; durable.containmentBinding = 'binding'; } },
    { name: 'CANCELLED without containment terminated', state: 'CANCELLED', failureCode: 'RESTART_CONTAINMENT_TERMINATED', approvalLifecycle: 'INVALIDATED', finalType: 'restart.interrupted_execution', finalReason: 'RESTART_CONTAINMENT_TERMINATED', finalPrior: 'EXECUTING', run: (durable) => { durable.executionStartedAt = 1; durable.containmentUnit = 'unit'; durable.containmentBinding = 'binding'; } },
    { name: 'REJECTED without approval rejected', state: 'REJECTED', failureCode: 'REJECTED', approvalLifecycle: 'REJECTED', finalType: 'approval.expired', finalReason: 'APPROVAL_TTL_EXPIRED', finalPrior: 'AWAITING_APPROVAL' },
    { name: 'REJECTED with execution start', state: 'REJECTED', failureCode: 'REJECTED', approvalLifecycle: 'REJECTED', finalType: 'approval.rejected', finalReason: 'HUMAN_REJECTED', finalPrior: 'EXECUTING', extra: [{ eventId: 'extra_rejected_start', runId: 'placeholder', seq: 4, at: 1, type: 'execution.start_requested', priorState: 'APPROVED', nextState: 'EXECUTING', correlationId: 'placeholder', source: 'EXECUTION', schemaVersion: 1 }], run: (durable) => { durable.executionStartedAt = 1; } },
    { name: 'valid reason forbidden event', state: 'FAILED', failureCode: 'RESTART_TERMINATION_FAILED', approvalLifecycle: 'INVALIDATED', finalType: 'containment.termination_failed', finalReason: 'RESTART_TERMINATION_FAILED', finalPrior: 'EXECUTING', extra: [{ eventId: 'extra_forbidden_terminated', runId: 'placeholder', seq: 5, at: 1, type: 'containment.terminated', priorState: 'EXECUTING', nextState: 'CANCELLED', reason: 'RESTART_CONTAINMENT_TERMINATED', correlationId: 'placeholder', source: 'RECONCILIATION', schemaVersion: 1 }], run: (durable) => { durable.executionStartedAt = 1; durable.containmentUnit = 'unit'; durable.containmentBinding = 'binding'; } },
    { name: 'incorrect final prior state', state: 'EXPIRED', failureCode: 'RESTART_AUTHORIZATION_LOST', approvalLifecycle: 'LOST_ON_RESTART', finalType: 'approval.lost_on_restart', finalReason: 'RESTART_AUTHORIZATION_LOST', finalPrior: 'APPROVED' },
  ];

  for (const entry of cases) {
    const workspace = root();
    const shared = new MemoryAgentRunJournalPersistence();
    const h = harness(shared);
    const view = await propose(h.service, workspace);
    const durable = shared.runs.get(view.runId)!;
    Object.assign(durable, {
      state: entry.state,
      failureCode: entry.failureCode,
      interruptionClassification: entry.failureCode,
      recoveryClass: 'REPROPOSAL_ALLOWED',
      recoveryEligible: true,
      recoveryReason: entry.failureCode,
      approvalLifecycle: entry.approvalLifecycle,
      approvalDecisionType: entry.state === 'REJECTED' ? 'REJECTED' : undefined,
      terminalAt: durable.proposalAt! + 1,
      updatedAt: durable.proposalAt! + 1,
    });
    entry.run?.(durable);
    const base: DurableAgentRunEvent[] = [
      { eventId: `${entry.name}:created`, runId: view.runId, seq: 1, at: durable.proposalAt!, type: 'run.created', nextState: 'AWAITING_APPROVAL', reason: 'PROPOSAL_CREATED', correlationId: durable.correlationId, source: 'API', schemaVersion: 1 },
      { eventId: `${entry.name}:proposal`, runId: view.runId, seq: 2, at: durable.proposalAt!, type: 'proposal.created', nextState: 'AWAITING_APPROVAL', reason: durable.recipeId, correlationId: durable.correlationId, source: 'API', schemaVersion: 1 },
      { eventId: `${entry.name}:approval`, runId: view.runId, seq: 3, at: durable.proposalAt!, type: 'approval.requested', nextState: 'AWAITING_APPROVAL', reason: 'PENDING_DISPLAY', correlationId: durable.correlationId, source: 'APPROVAL', schemaVersion: 1 },
      ...(entry.extra ?? []).map((event, index) => ({ ...event, eventId: `${entry.name}:${event.eventId}`, runId: view.runId, seq: 4 + index, correlationId: durable.correlationId })),
    ];
    const finalSeq = base.length + 1;
    const events = [
      ...base,
      { eventId: `${entry.name}:terminal`, runId: view.runId, seq: finalSeq, at: durable.proposalAt! + 1, type: entry.finalType, priorState: entry.finalPrior, nextState: entry.state, reason: entry.finalReason, correlationId: durable.correlationId, source: 'RECONCILIATION' as const, schemaVersion: 1 },
    ];
    durable.auditSeq = events.length;
    shared.events.set(view.runId, events);
    const status = h.service.getRunRecoveryStatus(view.runId, context(workspace));
    assert.equal(status.ok, true, entry.name);
    assert.equal(status.status.eligible, false, entry.name);
    assert.notEqual(status.status.recommendedAction, 'Create a fresh proposal.', entry.name);
    const denied = await h.service.reproposeFromRun(view.runId, { requestId: `stage3b-contract-${entry.name.replaceAll(/[^a-z0-9]+/gi, '-')}` }, context(workspace));
    assert.equal(denied.ok, false, entry.name);
    assert.equal(denied.code, 'RECOVERY_INELIGIBLE', entry.name);
    assert.equal(shared.runs.get(view.runId)?.successorRunId, undefined, entry.name);
    assert.equal((shared.events.get(view.runId) ?? []).some((event) => event.type.startsWith('recovery.')), false, entry.name);
  }
});

test('valid recoverable terminal histories create only fresh idempotent reproposals', async () => {
  for (const spec of terminalSpecs()) {
    const workspace = root();
    const shared = new MemoryAgentRunJournalPersistence();
    const h = harness(shared);
    const source = await propose(h.service, workspace);
    installTerminalHistory(shared, source.runId, spec);
    const durableSource = shared.runs.get(source.runId)!;
    const sourceFingerprint = durableSource.proposalFingerprint;
    const sourceSnapshotId = durableSource.snapshotId;
    const sourceManifestDigest = durableSource.snapshotManifestDigest;
    const sourceApprovalDecision = durableSource.approvalDecisionType;
    h.resolver.workspaceVersion += 1;

    const status = h.service.getRunRecoveryStatus(source.runId, context(workspace));
    assert.equal(status.ok, true, spec.name);
    assert.equal(status.status.eligible, true, spec.name);
    assert.equal(status.status.recoveryClass, spec.recoveryClass, spec.name);
    assert.equal(status.status.recommendedAction, 'Create a fresh proposal.', spec.name);

    const first = await h.service.reproposeFromRun(source.runId, { requestId: `stage3b-valid-${spec.name}` }, context(workspace));
    assert.equal(first.ok, true, spec.name);
    assert.equal(first.view.state, 'AWAITING_APPROVAL', spec.name);
    assert.notEqual(first.view.runId, source.runId, spec.name);
    assert.equal(first.view.approval?.lifecycle, 'PENDING_DISPLAY', spec.name);
    assert.equal(h.processes.starts, 0, spec.name);

    const refreshedSource = shared.runs.get(source.runId)!;
    const durableSuccessor = shared.runs.get(first.view.runId)!;
    assert.equal(refreshedSource.state, spec.state, spec.name);
    assert.equal(refreshedSource.successorRunId, first.view.runId, spec.name);
    assert.equal(durableSuccessor.recoverySourceRunId, source.runId, spec.name);
    assert.equal(durableSuccessor.state, 'AWAITING_APPROVAL', spec.name);
    assert.notEqual(durableSuccessor.runId, source.runId, spec.name);
    assert.notEqual(durableSuccessor.proposalFingerprint, sourceFingerprint, spec.name);
    assert.notEqual(durableSuccessor.snapshotId, sourceSnapshotId, spec.name);
    assert.notEqual(durableSuccessor.snapshotManifestDigest, sourceManifestDigest, spec.name);
    assert.match(durableSuccessor.snapshotId, new RegExp(durableSuccessor.runId), spec.name);
    assert.match(durableSuccessor.snapshotManifestDigest, new RegExp(durableSuccessor.runId), spec.name);
    assert.equal(durableSuccessor.approvalDecisionType, undefined, spec.name);
    assert.equal(durableSuccessor.executionStartedAt, undefined, spec.name);
    assert.equal(durableSuccessor.containmentUnit, undefined, spec.name);
    assert.equal(durableSuccessor.containmentBinding, undefined, spec.name);
    assert.equal(sourceApprovalDecision, spec.approvalDecisionType, spec.name);

    const preparesAfterCommit = h.resolver.prepares;
    h.resolver.workspaceVersion += 1;
    const replay = await h.service.reproposeFromRun(source.runId, { requestId: `stage3b-valid-${spec.name}` }, context(workspace));
    assert.equal(replay.ok, true, spec.name);
    assert.equal(replay.view.runId, first.view.runId, spec.name);
    assert.equal(h.resolver.prepares, preparesAfterCommit, spec.name);

    const conflict = await h.service.reproposeFromRun(source.runId, { requestId: `stage3b-conflict-${spec.name}` }, context(workspace));
    assert.equal(conflict.ok, false, spec.name);
    assert.equal(conflict.code, 'RECOVERY_CONFLICT', spec.name);
  }
});

test('fresh interrupted reproposal aborts before lineage when snapshot capture fails', async () => {
  for (const spec of terminalSpecs().filter((entry) => entry.executionStarted)) {
    const workspace = root();
    const shared = new MemoryAgentRunJournalPersistence();
    const h = harness(shared);
    const source = await propose(h.service, workspace);
    installTerminalHistory(shared, source.runId, spec);
    const sourceVersion = shared.runs.get(source.runId)!.version;
    const sourceAuditSeq = shared.runs.get(source.runId)!.auditSeq;
    h.resolver.failPrepare = true;

    const denied = await h.service.reproposeFromRun(source.runId, { requestId: `stage3b-snapshot-fail-${spec.name}` }, context(workspace));
    assert.equal(denied.ok, false, spec.name);
    assert.equal(denied.code, 'CONTAINMENT_UNAVAILABLE', spec.name);
    assert.equal(shared.runs.get(source.runId)?.successorRunId, undefined, spec.name);
    assert.equal(shared.runs.get(source.runId)?.lastRecoveryRequestId, undefined, spec.name);
    assert.equal(shared.runs.get(source.runId)?.version, sourceVersion, spec.name);
    assert.equal(shared.runs.get(source.runId)?.auditSeq, sourceAuditSeq, spec.name);
    assert.equal([...shared.runs.values()].filter((run) => run.recoverySourceRunId === source.runId).length, 0, spec.name);
    assert.equal((shared.events.get(source.runId) ?? []).some((event) => event.type.startsWith('recovery.')), false, spec.name);
    assert.equal(h.processes.starts, 0, spec.name);
  }
});

test('nonrecoverable and non-production terminal histories fail closed without successors', async () => {
  const specs: DurableTerminalSpec[] = [
    {
      name: 'FAILED / RESTART_TERMINATION_FAILED',
      state: 'FAILED',
      failureCode: 'RESTART_TERMINATION_FAILED',
      approvalLifecycle: 'INVALIDATED',
      recoveryClass: 'TERMINAL_NO_RECOVERY',
      recoverable: false,
      executionStarted: true,
      containment: true,
      events: [
        { type: 'run.created', nextState: 'AWAITING_APPROVAL', reason: 'PROPOSAL_CREATED' },
        { type: 'proposal.created', nextState: 'AWAITING_APPROVAL', reason: 'git.status' },
        { type: 'approval.requested', nextState: 'AWAITING_APPROVAL', reason: 'PENDING_DISPLAY' },
        { type: 'approval.approved', priorState: 'AWAITING_APPROVAL', nextState: 'APPROVED', reason: 'HUMAN_APPROVED', source: 'APPROVAL' },
        { type: 'execution.start_requested', priorState: 'APPROVED', nextState: 'EXECUTING', reason: 'APPROVAL_CONSUMED', source: 'EXECUTION' },
        { type: 'execution.spawned', priorState: 'EXECUTING', nextState: 'EXECUTING', reason: 'CONTAINMENT_STARTED', source: 'EXECUTION' },
        { type: 'containment.termination_failed', priorState: 'EXECUTING', nextState: 'FAILED', reason: 'RESTART_TERMINATION_FAILED', source: 'RECONCILIATION' },
      ],
    },
    {
      name: 'STALE / INTERRUPTED_BY_RESTART',
      state: 'STALE',
      failureCode: 'INTERRUPTED_BY_RESTART',
      approvalLifecycle: 'INVALIDATED',
      recoveryClass: 'REPROPOSAL_ALLOWED',
      recoverable: false,
      events: [
        { type: 'run.created', nextState: 'AWAITING_APPROVAL', reason: 'PROPOSAL_CREATED' },
        { type: 'proposal.created', nextState: 'AWAITING_APPROVAL', reason: 'git.status' },
        { type: 'approval.requested', nextState: 'AWAITING_APPROVAL', reason: 'PENDING_DISPLAY' },
        { type: 'restart.interrupted_execution', priorState: 'AWAITING_APPROVAL', nextState: 'STALE', reason: 'INTERRUPTED_BY_RESTART', source: 'RECONCILIATION' },
      ],
    },
  ];

  for (const spec of specs) {
    const workspace = root();
    const shared = new MemoryAgentRunJournalPersistence();
    const h = harness(shared);
    const source = await propose(h.service, workspace);
    installTerminalHistory(shared, source.runId, spec);

    const status = h.service.getRunRecoveryStatus(source.runId, context(workspace));
    assert.equal(status.ok, true, spec.name);
    assert.equal(status.status.eligible, false, spec.name);
    assert.notEqual(status.status.recommendedAction, 'Create a fresh proposal.', spec.name);

    const denied = await h.service.reproposeFromRun(source.runId, { requestId: `stage3b-nonrecoverable-${spec.name}` }, context(workspace));
    assert.equal(denied.ok, false, spec.name);
    assert.equal(denied.code, 'RECOVERY_INELIGIBLE', spec.name);
    assert.equal(shared.runs.get(source.runId)?.successorRunId, undefined, spec.name);
    assert.equal(h.processes.starts, 0, spec.name);
  }
});

test('production recovery provenance contracts enumerate exact terminal states, reasons, and final events', () => {
  const contracts = recoveryProductionReasonContracts();
  const keys = new Set(contracts.map((entry) => `${entry.state}:${entry.reason}:${entry.terminalEvents.join('|')}:${entry.recoveryClass}:${entry.recoverable}`));
  for (const expected of [
    'REJECTED:REJECTED:approval.rejected:REPROPOSAL_ALLOWED:true',
    'EXPIRED:EXPIRED:approval.expired:REPROPOSAL_ALLOWED:true',
    'EXPIRED:RESTART_AUTHORIZATION_LOST:approval.lost_on_restart:REPROPOSAL_REQUIRED:true',
    'STALE:STALE:proposal.stale:SNAPSHOT_CHANGED:true',
    'STALE:RESTART_BEFORE_EXECUTION:restart.authorization_lost:REPROPOSAL_REQUIRED:true',
    'FAILED:INTERRUPTED_BY_RESTART:restart.interrupted_execution:REPROPOSAL_ALLOWED:true',
    'FAILED:RESTART_NO_CONTAINMENT_FOUND:restart.interrupted_execution:REPROPOSAL_ALLOWED:true',
    'FAILED:RESTART_CONTAINMENT_ALREADY_EXITED:restart.interrupted_execution:REPROPOSAL_ALLOWED:true',
    'FAILED:RESTART_TERMINATION_FAILED:containment.termination_failed:TERMINAL_NO_RECOVERY:false',
    'FAILED:RESTART_CONTAINMENT_IDENTITY_MISMATCH:restart.interrupted_execution:POLICY_CHANGED:false',
    'CANCELLED:RESTART_CONTAINMENT_TERMINATED:containment.terminated:REPROPOSAL_ALLOWED:true',
    'COMPLETED:COMPLETED:execution.completed:TERMINAL_NO_RECOVERY:false',
  ]) assert.ok(keys.has(expected), expected);
  assert.equal(contracts.some((entry) => entry.state === 'STALE' && entry.reason === 'INTERRUPTED_BY_RESTART'), false);
  for (const entry of contracts) assert.equal(entry.recoverable, recoveryClassCanCreateFreshProposal(entry.recoveryClass), `${entry.state}:${entry.reason}`);
  assert.equal([...keys].some((key) => key.includes('FORGED_REASON')), false);
  assert.equal([...keys].some((key) => key.includes('forged.terminal')), false);
});

test('reconciliation emitters, provenance contracts, metadata, and classifications stay in parity', () => {
  const emitterKeys = new Set(AGENT_MODE_RECONCILIATION_TERMINAL_EMITTERS.map((entry) => `${entry.nextState}:${entry.reason}:${entry.eventType}`));
  assert.equal(emitterKeys.has('STALE:INTERRUPTED_BY_RESTART:restart.interrupted_execution'), false);

  const parity = agentModeReconciliationEmitterContractParity();
  for (const entry of parity) {
    assert.equal(entry.contractMatches, 1, entry.emitter.branch);
    assert.equal(entry.metadata.recoveryEligible, entry.contractRecoverable, entry.emitter.branch);
    assert.equal(entry.metadata.recoveryClass, entry.contractRecoveryClass, entry.emitter.branch);
    if (entry.emitter.sourceState === 'EXECUTING') assert.notEqual(entry.emitter.nextState, 'STALE', entry.emitter.branch);
  }

  const contracts = recoveryProductionReasonContracts();
  const contractKeys = new Set(contracts.map((entry) => `${entry.state}:${entry.reason}:${entry.terminalEvents.join('|')}`));
  assert.equal(contractKeys.size, contracts.length, 'two provenance contracts overlap');
  const restartContractKeys = new Set(contracts
    .filter((entry) => entry.reason.startsWith('RESTART_') || entry.reason === 'INTERRUPTED_BY_RESTART')
    .map((entry) => `${entry.state}:${entry.reason}:${entry.terminalEvents.join('|')}`));
  for (const contractKey of restartContractKeys) assert.ok(emitterKeys.has(contractKey), `restart contract lacks production emitter: ${contractKey}`);

  for (const reason of ['INTERRUPTED_BY_RESTART', 'RESTART_NO_CONTAINMENT_FOUND', 'RESTART_CONTAINMENT_ALREADY_EXITED']) {
    const metadata = agentModeRecoveryMetadataFor(reason, 'FAILED');
    assert.equal(metadata.recoveryEligible, true, reason);
    assert.equal(metadata.recoveryClass, 'REPROPOSAL_ALLOWED', reason);
  }
  for (const reason of ['RESTART_TERMINATION_FAILED', 'RESTART_CONTAINMENT_IDENTITY_MISMATCH', 'RESTART_UNEXPECTED_NEW_REASON']) {
    const metadata = agentModeRecoveryMetadataFor(reason, 'FAILED');
    assert.equal(metadata.recoveryEligible, false, reason);
    assert.notEqual(metadata.recoveryClass, 'REPROPOSAL_ALLOWED', reason);
  }
});

test('retention preserves terminal source while its recovery successor is active', async () => {
  const workspace = root();
  const shared = new MemoryAgentRunJournalPersistence();
  const h = harness(shared, () => 10_000);
  const source = await propose(h.service, workspace);
  h.service.displayed(source.runId, source.preview!.fingerprint, context(workspace));
  await h.service.decide(source.runId, 'reject', source.preview!.fingerprint, context(workspace));

  const successor = await h.service.reproposeFromRun(source.runId, { requestId: 'stage3b-retention-successor' }, context(workspace));
  assert.equal(successor.ok, true);
  shared.runs.get(source.runId)!.terminalAt = 1;

  const pruned = new AgentRunJournal(shared, { terminalRetentionMs: 1_000, retentionBatchSize: 10, reconciliationLeaseMs: 30_000 }).prune(10_000);
  assert.equal(pruned.runs, 0);
  assert.ok(shared.runs.has(source.runId));
  assert.ok(shared.runs.has(successor.view.runId));
});
