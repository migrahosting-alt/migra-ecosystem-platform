import { randomUUID } from 'node:crypto';
import {
  AgentModeCommandProposalRequestSchema,
  AgentModeReproposalRequestSchema,
  type AgentModeRunRecoveryStatus,
  type AgentModeCommandResult,
  type AgentModeCommandRunView,
  type AgentModeRecoveryClass,
  type AgentModeRecipeId,
  type AgentModeState,
} from '@migrapilot/protocol';
import { auditStore, auditHash } from './auditLog.js';
import { redactCommandOutput } from './redaction.js';
import type { ToolExecDeps } from './toolExecutor.js';
import { ApprovalCapacityError, hashInput } from './toolApprovalStore.js';
import {
  AgentRecipePolicyError,
  AgentRecipeProcessManager,
  AgentRecipeResolver,
  containmentIdentityForTrustedRun,
  type AgentRecipePlan,
  type AgentContainmentIdentity,
  type AgentContainmentReconciliationIdentity,
  type AgentRecipeProcessManagerLike,
  type AgentRecipeResolverLike,
} from './agentRecipe.js';
import { AgentRunJournal, AGENT_TERMINAL_STATES, buildAgentRunJournalConfig, durableRunToView } from './agentRunJournal.js';
import type { AgentRunJournalPersistence, AgentRunReconciliationClaim, DurableAgentRun } from './persistence/types.js';
import { recoveryProductionReasonContracts, validateRecoverySourceProvenance } from './recoverySourceProvenance.js';

const TERMINAL = new Set<AgentModeState>(['COMPLETED', 'REJECTED', 'EXPIRED', 'STALE', 'FAILED', 'CANCELLED']);
const MAX_RUNS = 200;
const MAX_PENDING = 50;
const MAX_PENDING_PER_SESSION = 10;
const TERMINAL_RETENTION_MS = 60 * 60 * 1000;

interface ReconciliationFence {
  owner: string;
  fence: number;
  leaseValidAt: number;
  expectedVersion?: number;
}

export interface AgentModeRecoveryMetadata {
  approvalLifecycle?: DurableAgentRun['approvalLifecycle'];
  approvalInvalidationReason?: string;
  recoveryClass: AgentModeRecoveryClass;
  recoveryEligible: boolean;
  recoveryReason: string;
}

export interface AgentModeReconciliationTerminalEmitter {
  readonly branch: string;
  readonly sourceState: AgentModeState;
  readonly nextState: AgentModeState;
  readonly eventType: string;
  readonly reason: string;
}

export const AGENT_MODE_RECONCILIATION_TERMINAL_EMITTERS: readonly AgentModeReconciliationTerminalEmitter[] = Object.freeze([
  { branch: 'pending approval loses restart-local authority', sourceState: 'AWAITING_APPROVAL', nextState: 'EXPIRED', eventType: 'approval.lost_on_restart', reason: 'RESTART_AUTHORIZATION_LOST' },
  { branch: 'approved before execution loses restart-local authority', sourceState: 'APPROVED', nextState: 'STALE', eventType: 'restart.authorization_lost', reason: 'RESTART_BEFORE_EXECUTION' },
  { branch: 'executing without durable containment identity', sourceState: 'EXECUTING', nextState: 'FAILED', eventType: 'restart.interrupted_execution', reason: 'INTERRUPTED_BY_RESTART' },
  { branch: 'executing containment not found', sourceState: 'EXECUTING', nextState: 'FAILED', eventType: 'restart.interrupted_execution', reason: 'RESTART_NO_CONTAINMENT_FOUND' },
  { branch: 'executing containment already exited', sourceState: 'EXECUTING', nextState: 'FAILED', eventType: 'restart.interrupted_execution', reason: 'RESTART_CONTAINMENT_ALREADY_EXITED' },
  { branch: 'executing containment termination failed', sourceState: 'EXECUTING', nextState: 'FAILED', eventType: 'containment.termination_failed', reason: 'RESTART_TERMINATION_FAILED' },
  { branch: 'executing containment identity mismatch', sourceState: 'EXECUTING', nextState: 'FAILED', eventType: 'restart.interrupted_execution', reason: 'RESTART_CONTAINMENT_IDENTITY_MISMATCH' },
  { branch: 'executing containment terminated', sourceState: 'EXECUTING', nextState: 'CANCELLED', eventType: 'containment.terminated', reason: 'RESTART_CONTAINMENT_TERMINATED' },
]);

export interface AgentModeRequestContext {
  activationId: string;
  extensionProcessId: number;
  serverInstanceId: string;
  workspaceRoot: string;
  workspaceIdentity: string;
  allowedRecipes: readonly AgentRecipePlan['identity']['recipe'][];
  externalRequestId?: string;
}

interface CommandRunRecord {
  runId: string;
  requestId: string;
  externalRequestRef?: string;
  activationId: string;
  workspaceRoot: string;
  state: AgentModeState;
  plan: AgentRecipePlan;
  proposalHash: string;
  fingerprint: string;
  approvalId: string;
  displayed: boolean;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  preview: NonNullable<AgentModeCommandRunView['preview']>;
  result?: AgentModeCommandResult;
  error?: { code: string; message: string };
  controller?: AbortController;
  cancelRequested?: boolean;
  containment?: AgentContainmentIdentity;
}

export type AgentModeActionResult =
  | { ok: true; view: AgentModeCommandRunView }
  | { ok: false; code: 'UNKNOWN_RUN' | 'INVALID_STATE' | 'INVALID_CONTEXT' | 'EXPIRED' | 'STALE' | 'PROPOSAL_FAILED' | 'OVERLOADED' | 'UNSUPPORTED_PLATFORM' | 'CONTAINMENT_UNAVAILABLE' | 'RECOVERY_INELIGIBLE' | 'RECOVERY_CONFLICT'; message: string };

type AgentModeActionErrorCode = Extract<AgentModeActionResult, { ok: false }>['code'];

export type AgentModeRecoveryResult =
  | { ok: true; status: AgentModeRunRecoveryStatus }
  | { ok: false; code: AgentModeActionErrorCode; message: string };

export class AgentModeCommandService {
  private readonly runs = new Map<string, CommandRunRecord>();
  private readonly executing = new Set<Promise<void>>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(
    private readonly toolDeps: ToolExecDeps,
    private readonly now: () => number = () => Date.now(),
    private readonly newRunId: () => string = () => `agentcmd_${randomUUID()}`,
    private readonly resolver: AgentRecipeResolverLike = new AgentRecipeResolver(),
    private readonly processes: AgentRecipeProcessManagerLike = new AgentRecipeProcessManager(),
    private readonly journal = new AgentRunJournal(undefined),
    private readonly serviceInstanceId = `agentreconcile_${randomUUID()}`,
  ) {
    this.cleanupTimer = setInterval(() => this.cleanup(), 5_000);
    this.cleanupTimer.unref();
  }

  agentRunJournal(): AgentRunJournal {
    return this.journal;
  }

  async propose(raw: unknown, context: AgentModeRequestContext): Promise<AgentModeActionResult> {
    const parsed = AgentModeCommandProposalRequestSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, code: 'PROPOSAL_FAILED', message: 'Recipe proposal input failed validation.' };
    if (!validContext(context) || parsed.data.rootPath !== context.workspaceRoot || !context.allowedRecipes.includes(parsed.data.recipe)) {
      return { ok: false, code: 'INVALID_CONTEXT', message: 'The Agent Mode session or workspace context is invalid.' };
    }
    this.cleanup();
    const pending = [...this.runs.values()].filter((run) => !TERMINAL.has(run.state));
    if (this.runs.size >= MAX_RUNS || pending.length >= MAX_PENDING || pending.filter((run) => run.activationId === context.activationId).length >= MAX_PENDING_PER_SESSION) {
      return { ok: false, code: 'OVERLOADED', message: 'The Agent Mode run limit is currently reached.' };
    }

    const containment = await this.processes.availability();
    if (!containment.ok) return { ok: false, code: containment.code, message: containment.message };
    const runId = this.newRunId();
    let plan: AgentRecipePlan;
    try {
      plan = await this.resolver.prepare(parsed.data.recipe, parsed.data.rootPath, { runId, activationId: context.activationId, workspaceIdentity: context.workspaceIdentity });
    } catch (error) {
      if (error instanceof AgentRecipePolicyError && (error.code === 'UNSUPPORTED_PLATFORM' || error.code === 'CONTAINMENT_UNAVAILABLE')) return { ok: false, code: error.code, message: error.message };
      return { ok: false, code: 'PROPOSAL_FAILED', message: 'The server could not prepare the selected recipe.' };
    }
    const requestId = `agentcorr_${randomUUID()}`;
    const safeReason = redactCommandOutput(parsed.data.reason).value;
    const proposalHash = this.binding(plan, safeReason);
    const fingerprint = proposalHash.slice(0, 16);
    let approval;
    try {
      approval = this.toolDeps.approvals.mint({ tool: 'agent.recipe', inputHash: proposalHash, requestId: runId, correlationId: requestId });
    } catch (error) {
      await this.resolver.release(plan).catch(() => {});
      if (error instanceof ApprovalCapacityError) return { ok: false, code: 'OVERLOADED', message: 'The Agent Mode approval limit is currently reached.' };
      return { ok: false, code: 'PROPOSAL_FAILED', message: 'The server could not prepare an approval.' };
    }
    const createdAt = this.now();
    const run: CommandRunRecord = {
      runId,
      requestId,
      externalRequestRef: context.externalRequestId ? auditHash(context.externalRequestId) : undefined,
      activationId: context.activationId,
      workspaceRoot: plan.identity.sourceWorkspace,
      state: 'AWAITING_APPROVAL',
      plan,
      proposalHash,
      fingerprint,
      approvalId: approval.id,
      displayed: false,
      createdAt,
      updatedAt: createdAt,
      expiresAt: approval.expiresAt,
      preview: {
        recipe: plan.identity.recipe,
        policyVersion: plan.identity.policyVersion,
        executionIdentity: hashInput(plan.identity).slice(0, 16),
        environmentPolicy: plan.identity.environmentPolicy,
        workspaceMaterialFingerprint: plan.identity.workspaceMaterialIdentity.slice(0, 16),
        snapshotId: plan.identity.snapshotId,
        sourceWorkspace: plan.identity.sourceWorkspace,
        executable: plan.identity.executablePath,
        arguments: [...plan.identity.arguments],
        cwd: plan.identity.canonicalCwd,
        timeoutMs: plan.identity.timeoutMs,
        outputLimitBytes: plan.identity.outputLimitBytes,
        mutationClassification: plan.identity.mutationClassification,
        networkPolicy: plan.identity.networkPolicy,
        expectedEffects: [...plan.identity.expectedEffects],
        reason: safeReason,
        requestId,
        fingerprint,
        expiresAt: approval.expiresAt,
        warnings: [
          'This is a fixed server-owned recipe; executable and arguments cannot be supplied by the client.',
          plan.identity.canModifyFiles ? 'This recipe may modify workspace artifacts or caches.' : 'This recipe is declared read-only.',
          'Approval is single-use and bound to this activation, run, immutable snapshot, executable digest, and recipe policy.',
        ],
        environment: Object.keys(plan.environment).sort().map((key) => ({ key, value: '[SERVER CONTROLLED]', redacted: true })),
        canModifyFiles: plan.identity.canModifyFiles,
      },
    };
    this.runs.set(runId, run);
    try {
      this.journal.create({
        runId,
        correlationId: requestId,
        externalRequestRef: run.externalRequestRef,
        activationId: context.activationId,
        workspaceRoot: run.workspaceRoot,
        workspaceIdentity: context.workspaceIdentity,
        recipeId: plan.identity.recipe,
        recipePolicyVersion: plan.identity.policyVersion,
        proposalFingerprint: fingerprint,
        proposalHash,
        snapshotId: plan.identity.snapshotId,
        snapshotManifestDigest: plan.identity.workspaceMaterialIdentity,
        executableDigest: plan.identity.executableDigest,
        requestedAt: createdAt,
        proposalAt: createdAt,
        expiresAt: approval.expiresAt,
        timeoutMs: plan.identity.timeoutMs,
        outputLimitBytes: plan.identity.outputLimitBytes,
        mutationClassification: plan.identity.mutationClassification,
        networkPolicy: plan.identity.networkPolicy,
        expectedEffects: plan.identity.expectedEffects,
        preview: run.preview,
      });
    } catch {
      this.revokeApproval(run);
      this.runs.delete(runId);
      await this.resolver.release(plan).catch(() => {});
      return { ok: false, code: 'PROPOSAL_FAILED', message: 'The server could not durably record the Agent run.' };
    }
    this.audit(run, 'proposal.created', 'AWAITING_APPROVAL', { recipe: plan.identity.recipe, fingerprint, expiresAt: approval.expiresAt });
    return { ok: true, view: toView(run) };
  }

  displayed(runId: string, fingerprint: string, context: AgentModeRequestContext): AgentModeActionResult {
    const found = this.owned(runId, context);
    if (!found.ok) return found;
    const run = found.run;
    this.expire(run);
    if (run.state !== 'AWAITING_APPROVAL' || fingerprint !== run.fingerprint) {
      return { ok: false, code: 'INVALID_STATE', message: 'The authoritative proposal cannot be marked displayed.' };
    }
    if (!run.displayed) {
      this.journal.transition({ runId: run.runId, expectedState: 'AWAITING_APPROVAL', nextState: 'AWAITING_APPROVAL', at: this.now(), eventType: 'approval.displayed', source: 'API', reason: run.fingerprint, approvalDisplayedAt: this.now(), approvalLifecycle: 'DISPLAYED' });
      run.displayed = true;
      this.audit(run, 'approval.displayed', 'AWAITING_APPROVAL', { recipe: run.plan.identity.recipe, fingerprint });
    }
    return { ok: true, view: toView(run) };
  }

  get(runId: string, context: AgentModeRequestContext, _reconcile = true): AgentModeActionResult {
    const found = this.owned(runId, context);
    if (!found.ok) {
      const durable = this.journal.loadRun(runId);
      if (durable && durable.workspaceIdentity === context.workspaceIdentity && AGENT_TERMINAL_STATES.has(durable.state as AgentModeState)) {
        return { ok: true, view: durableRunToView(durable) };
      }
      return found;
    }
    return { ok: true, view: toView(found.run) };
  }

  getRunRecoveryStatus(runId: string, context: AgentModeRequestContext): AgentModeRecoveryResult {
    if (!validContext(context)) return { ok: false, code: 'INVALID_CONTEXT', message: 'The Agent Mode session or workspace context is invalid.' };
    const run = this.journal.loadRun(runId);
    if (!run || run.workspaceIdentity !== context.workspaceIdentity) return { ok: false, code: 'UNKNOWN_RUN', message: 'Unknown Agent Mode recipe run.' };
    return { ok: true, status: this.recoveryStatus(run, context) };
  }

  async reproposeFromRun(runId: string, raw: unknown, context: AgentModeRequestContext): Promise<AgentModeActionResult> {
    const parsed = AgentModeReproposalRequestSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, code: 'PROPOSAL_FAILED', message: 'A valid recovery request id is required.' };
    if (!validContext(context)) return { ok: false, code: 'INVALID_CONTEXT', message: 'The Agent Mode session or workspace context is invalid.' };
    this.cleanup();
    const source = this.journal.loadRun(runId);
    if (!source || source.workspaceIdentity !== context.workspaceIdentity) return { ok: false, code: 'UNKNOWN_RUN', message: 'Unknown Agent Mode recipe run.' };
    if (source.successorRunId) {
      const successor = this.journal.loadRun(source.successorRunId);
      if (source.lastRecoveryRequestId === parsed.data.requestId && successor) return { ok: true, view: durableRunToView(successor) };
      return { ok: false, code: 'RECOVERY_CONFLICT', message: 'This run already has an active recovery successor.' };
    }
    const sourceEvents = this.journal.events(source.runId);
    const provenance = validateRecoverySourceProvenance({ run: source, events: sourceEvents, workspaceIdentity: context.workspaceIdentity, allowedRecipes: context.allowedRecipes, now: this.now() });
    const status = this.recoveryStatus(source, context, sourceEvents);
    if (!status.eligible) return { ok: false, code: 'RECOVERY_INELIGIBLE', message: status.explanation };
    if (source.reconciliationOwner && (source.reconciliationLeaseUntil ?? 0) >= this.now()) return { ok: false, code: 'RECOVERY_CONFLICT', message: 'The source run is currently under restart reconciliation.' };
    const recipe = source.recipeId as AgentModeRecipeId;
    if (!context.allowedRecipes.includes(recipe)) return { ok: false, code: 'INVALID_CONTEXT', message: 'The selected recipe is no longer allowed.' };
    const containment = await this.processes.availability();
    if (!containment.ok) return { ok: false, code: containment.code, message: containment.message };
    const newRunId = this.newRunId();
    let plan: AgentRecipePlan;
    try {
      plan = await this.resolver.prepare(recipe, context.workspaceRoot, { runId: newRunId, activationId: context.activationId, workspaceIdentity: context.workspaceIdentity });
    } catch (error) {
      if (error instanceof AgentRecipePolicyError && (error.code === 'UNSUPPORTED_PLATFORM' || error.code === 'CONTAINMENT_UNAVAILABLE')) return { ok: false, code: error.code, message: error.message };
      return { ok: false, code: 'PROPOSAL_FAILED', message: 'The server could not prepare a fresh recovery proposal.' };
    }
    const requestId = `agentcorr_${randomUUID()}`;
    const safeReason = redactCommandOutput(parsed.data.reason ?? recoveryReproposalReason(source)).value;
    const proposalHash = this.binding(plan, safeReason);
    const fingerprint = proposalHash.slice(0, 16);
    let approval;
    try {
      approval = this.toolDeps.approvals.mint({ tool: 'agent.recipe', inputHash: proposalHash, requestId: newRunId, correlationId: requestId });
    } catch (error) {
      await this.resolver.release(plan).catch(() => {});
      if (error instanceof ApprovalCapacityError) return { ok: false, code: 'OVERLOADED', message: 'The Agent Mode approval limit is currently reached.' };
      return { ok: false, code: 'PROPOSAL_FAILED', message: 'The server could not prepare a fresh approval.' };
    }
    const createdAt = this.now();
    const preview = this.previewFor(plan, safeReason, requestId, fingerprint, approval.expiresAt);
    const journalResult = this.journal.createSuccessor({
      source,
      provenance: {
        workspaceIdentity: context.workspaceIdentity,
        allowedRecipes: context.allowedRecipes,
        eventDigest: provenance.digest,
        highestSeq: provenance.highestSeq,
      },
      requestId: parsed.data.requestId,
      run: {
        runId: newRunId,
        correlationId: requestId,
        externalRequestRef: context.externalRequestId ? auditHash(context.externalRequestId) : undefined,
        activationId: context.activationId,
        workspaceRoot: plan.identity.sourceWorkspace,
        workspaceIdentity: context.workspaceIdentity,
        recipeId: plan.identity.recipe,
        recipePolicyVersion: plan.identity.policyVersion,
        proposalFingerprint: fingerprint,
        proposalHash,
        snapshotId: plan.identity.snapshotId,
        snapshotManifestDigest: plan.identity.workspaceMaterialIdentity,
        executableDigest: plan.identity.executableDigest,
        requestedAt: createdAt,
        proposalAt: createdAt,
        expiresAt: approval.expiresAt,
        timeoutMs: plan.identity.timeoutMs,
        outputLimitBytes: plan.identity.outputLimitBytes,
        mutationClassification: plan.identity.mutationClassification,
        networkPolicy: plan.identity.networkPolicy,
        expectedEffects: plan.identity.expectedEffects,
        preview,
        recoverySourceRunId: source.runId,
      },
    });
    if (!journalResult.ok) {
      this.toolDeps.approvals.reject(approval.id, { tool: 'agent.recipe', inputHash: proposalHash, correlationId: requestId });
      await this.resolver.release(plan).catch(() => {});
      if (journalResult.code === 'ACTIVE_SUCCESSOR_EXISTS' || journalResult.code === 'SOURCE_VERSION_CHANGED' || journalResult.code === 'SOURCE_UNDER_RECONCILIATION') return { ok: false, code: 'RECOVERY_CONFLICT', message: 'The recovery request conflicted with newer durable state.' };
      return { ok: false, code: 'PROPOSAL_FAILED', message: 'The server could not durably link the recovery proposal.' };
    }
    if (!journalResult.created) {
      this.toolDeps.approvals.reject(approval.id, { tool: 'agent.recipe', inputHash: proposalHash, correlationId: requestId });
      await this.resolver.release(plan).catch(() => {});
      return { ok: true, view: durableRunToView(journalResult.successor) };
    }
    const run: CommandRunRecord = {
      runId: newRunId,
      requestId,
      externalRequestRef: context.externalRequestId ? auditHash(context.externalRequestId) : undefined,
      activationId: context.activationId,
      workspaceRoot: plan.identity.sourceWorkspace,
      state: 'AWAITING_APPROVAL',
      plan,
      proposalHash,
      fingerprint,
      approvalId: approval.id,
      displayed: false,
      createdAt,
      updatedAt: createdAt,
      expiresAt: approval.expiresAt,
      preview,
    };
    this.runs.set(newRunId, run);
    this.audit(run, 'recovery.successor_created', 'AWAITING_APPROVAL', { recipe: plan.identity.recipe, source: auditHash(source.runId), fingerprint });
    return { ok: true, view: toView(run) };
  }

  async reconcileOnStartup(): Promise<{ scanned: number; reconciled: number; outcomes: Record<string, number> }> {
    const runs = this.journal.loadRuns().filter((run) => !AGENT_TERMINAL_STATES.has(run.state as AgentModeState));
    const outcomes: Record<string, number> = {};
    let reconciled = 0;
    for (const run of runs) {
      const claim = this.journal.claimReconciliation(run.runId, this.serviceInstanceId, this.now());
      if (!claim) continue;
      reconciled += 1;
      const started = this.journal.reconciliationEvent({ runId: run.runId, expectedState: run.state as AgentModeState, at: this.now(), type: 'restart.reconciliation_started', reason: run.state, reconciliation: { owner: claim.owner, fence: claim.fence, leaseValidAt: this.now(), expectedVersion: claim.version } });
      if (!started) {
        outcomes.RECONCILIATION_FENCE_LOST = (outcomes.RECONCILIATION_FENCE_LOST ?? 0) + 1;
        continue;
      }
      const outcome = await this.reconcileRun(run, started);
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }
    return { scanned: runs.length, reconciled, outcomes };
  }

  async decide(runId: string, decision: 'approve' | 'reject', fingerprint: string, context: AgentModeRequestContext): Promise<AgentModeActionResult> {
    const found = this.owned(runId, context);
    if (!found.ok) return found;
    const run = found.run;
    this.expire(run);
    if (TERMINAL.has(run.state)) return this.terminalDecision(run);
    if (run.state !== 'AWAITING_APPROVAL') return this.duplicateDecision(run);
    if (decision === 'reject') {
      this.revokeApproval(run);
      this.journal.transition({ runId, expectedState: 'AWAITING_APPROVAL', nextState: 'REJECTED', at: this.now(), eventType: 'approval.rejected', source: 'APPROVAL', reason: 'HUMAN_REJECTED', approvalDecisionAt: this.now(), terminalAt: this.now(), failureCode: 'REJECTED', approvalLifecycle: 'REJECTED', approvalDecisionType: 'REJECTED', approvalActorRef: auditHash(context.activationId), recoveryClass: 'REPROPOSAL_ALLOWED', recoveryEligible: true, recoveryReason: 'REJECTED_FRESH_PROPOSAL_ALLOWED' });
      this.transition(run, 'REJECTED');
      this.audit(run, 'approval.rejected', 'REJECTED', { recipe: run.plan.identity.recipe });
      void this.resolver.release(run.plan);
      return { ok: true, view: toView(run) };
    }
    if (!run.displayed) return { ok: false, code: 'INVALID_STATE', message: 'Approval requires the authoritative preview to be displayed first.' };
    const currentValid = await this.resolver.verify(run.plan);
    if (run.state !== 'AWAITING_APPROVAL') return TERMINAL.has(run.state) ? this.terminalDecision(run) : this.duplicateDecision(run);
    const currentHash = this.binding(run.plan, run.preview.reason);
    if (!currentValid || fingerprint !== run.fingerprint || currentHash !== run.proposalHash || currentHash.slice(0, 16) !== run.fingerprint) return this.stale(run);
    if (!this.journal.transition({ runId, expectedState: 'AWAITING_APPROVAL', nextState: 'APPROVED', at: this.now(), eventType: 'approval.approved', source: 'APPROVAL', reason: 'HUMAN_APPROVED', approvalDecisionAt: this.now(), approvalLifecycle: 'APPROVED', approvalDecisionType: 'APPROVED', approvalActorRef: auditHash(context.activationId) })) {
      return { ok: false, code: 'STALE', message: 'The durable Agent run could not be approved safely.' };
    }
    // This critical audit write must succeed before the private approval is consumed.
    this.audit(run, 'approval.approved', 'APPROVED', { recipe: run.plan.identity.recipe, fingerprint: run.fingerprint });
    const consumed = this.toolDeps.approvals.consume(run.approvalId, { tool: 'agent.recipe', inputHash: run.proposalHash, correlationId: run.requestId });
    if (!consumed.ok) return this.stale(run);
    // Consumption is itself a critical, durable boundary. If this append fails,
    // the private token is already revoked and execution remains fail-closed.
    this.audit(run, 'approval.consumed', 'CONSUMED', { recipe: run.plan.identity.recipe, fingerprint: run.fingerprint });
    this.journal.transition({ runId, expectedState: 'APPROVED', nextState: 'APPROVED', at: this.now(), eventType: 'approval.consumed', source: 'APPROVAL', reason: 'ONE_TIME_AUTHORITY_CONSUMED', approvalLifecycle: 'CONSUMED' });
    this.transition(run, 'APPROVED');
    run.controller = new AbortController();
    queueMicrotask(() => {
      if (run.state !== 'APPROVED') return;
      if (!this.journal.transition({ runId: run.runId, expectedState: 'APPROVED', nextState: 'EXECUTING', at: this.now(), eventType: 'execution.start_requested', source: 'EXECUTION', reason: 'APPROVED_EXECUTION_START', executionStartedAt: this.now() })) {
        this.transition(run, 'FAILED');
        run.error = { code: 'DURABLE_WRITE_FAILED', message: 'The approved recipe did not start because durable execution state could not be recorded.' };
        this.audit(run, 'execution.failed', 'DURABLE_WRITE_FAILED', { recipe: run.plan.identity.recipe });
        void this.resolver.release(run.plan);
        return;
      }
      this.transition(run, 'EXECUTING');
      const execution = this.execute(run).finally(() => this.executing.delete(execution));
      this.executing.add(execution);
    });
    return { ok: true, view: toView(run) };
  }

  cancel(runId: string, context: AgentModeRequestContext): AgentModeActionResult {
    const found = this.owned(runId, context);
    if (!found.ok) return found;
    const run = found.run;
    this.expire(run);
    if (run.state === 'CANCELLED') return { ok: true, view: toView(run) };
    if (TERMINAL.has(run.state)) return { ok: false, code: 'INVALID_STATE', message: `The recipe run is already terminal in ${run.state}.` };
    if (run.state === 'AWAITING_APPROVAL' || run.state === 'APPROVED') {
      if (run.state === 'AWAITING_APPROVAL') this.revokeApproval(run);
      this.journal.transition({ runId, expectedState: run.state, nextState: 'CANCELLED', at: this.now(), eventType: 'cancellation.requested', source: 'API', reason: 'CANCELLED_BEFORE_SPAWN', terminalAt: this.now(), failureCode: 'CANCELLED_BEFORE_SPAWN', approvalLifecycle: run.state === 'AWAITING_APPROVAL' ? 'INVALIDATED' : undefined, approvalInvalidationReason: 'CANCELLED_BEFORE_SPAWN', recoveryClass: 'REPROPOSAL_ALLOWED', recoveryEligible: true, recoveryReason: 'CANCELLED_FRESH_PROPOSAL_ALLOWED' });
      this.transition(run, 'CANCELLED');
      run.controller?.abort();
      this.audit(run, 'cancellation.requested', 'CANCELLED_BEFORE_SPAWN', { recipe: run.plan.identity.recipe });
      void this.resolver.release(run.plan);
      return { ok: true, view: toView(run) };
    }
    run.cancelRequested = true;
    run.controller?.abort();
    this.journal.event({ runId, at: this.now(), type: 'cancellation.requested', state: 'EXECUTING', correlationId: run.requestId, source: 'API', reason: 'USER_CANCELLED' });
    this.audit(run, 'cancellation.requested', 'EXECUTING', { recipe: run.plan.identity.recipe });
    return { ok: true, view: toView(run) };
  }

  async shutdown(): Promise<void> {
    clearInterval(this.cleanupTimer);
    for (const run of this.runs.values()) if (run.state === 'EXECUTING') this.audit(run, 'shutdown.termination_requested', 'EXECUTING', { recipe: run.plan.identity.recipe });
    await this.processes.shutdown();
    await Promise.allSettled([...this.executing]);
    for (const run of this.runs.values()) await this.resolver.release(run.plan).catch(() => {});
  }

  private async execute(run: CommandRunRecord): Promise<void> {
    if (!(await this.resolver.verify(run.plan)) || this.binding(run.plan, run.preview.reason) !== run.proposalHash) {
      this.transition(run, 'STALE');
      run.error = { code: 'STALE', message: 'The recipe execution identity changed before process start.' };
      this.audit(run, 'proposal.stale', 'STALE', { recipe: run.plan.identity.recipe, reason: 'identity_changed' });
      await this.resolver.release(run.plan).catch(() => {});
      return;
    }
    try {
      const outcome = await this.processes.execute(run.runId, run.plan, { onSpawned: (identity) => {
        const trustedIdentity = this.containmentIdentity(run, identity.unit);
        run.containment = trustedIdentity;
        const persisted = this.journal.transition({ runId: run.runId, expectedState: 'EXECUTING', nextState: 'EXECUTING', at: this.now(), eventType: 'execution.spawned', source: 'EXECUTION', reason: trustedIdentity.unit, containmentUnit: trustedIdentity.unit, containmentBinding: trustedIdentity.binding });
        if (!persisted) {
          throw new AgentRecipePolicyError('SPAWNED_IDENTITY_PERSISTENCE_FAILED', 'The contained recipe was stopped because its spawned identity could not be recorded durably.');
        }
        this.audit(run, 'execution.spawned', 'EXECUTING', { recipe: run.plan.identity.recipe, snapshot: run.plan.identity.snapshotId.slice(0, 16) });
      } }, run.controller?.signal);
      const result = sanitizeAgentModeCommandResult(outcome.result);
      run.result = result;
      if (outcome.disposition === 'cancelled') {
        if (!this.persistTransition({ runId: run.runId, expectedState: 'EXECUTING', nextState: 'CANCELLED', at: this.now(), eventType: 'containment.terminated', source: 'EXECUTION', reason: 'USER_CANCELLED', terminalAt: this.now(), result, exitCode: result.exitCode, failureCode: 'CANCELLED' })) {
          this.failLocalAfterDurableTerminalLoss(run);
          return;
        }
        this.transition(run, 'CANCELLED');
        this.audit(run, 'containment.terminated', 'CANCELLED', { recipe: run.plan.identity.recipe });
      } else if (outcome.disposition === 'timed_out') {
        if (!this.persistTransition({ runId: run.runId, expectedState: 'EXECUTING', nextState: 'FAILED', at: this.now(), eventType: 'execution.failed', source: 'EXECUTION', reason: 'TIMED_OUT', terminalAt: this.now(), result, exitCode: result.exitCode, failureCode: 'TIMED_OUT' })) {
          this.failLocalAfterDurableTerminalLoss(run);
          return;
        }
        this.transition(run, 'FAILED');
        run.error = { code: 'TIMED_OUT', message: 'The recipe exceeded its server-owned timeout and its process tree was stopped.' };
        this.audit(run, 'execution.timed_out', 'TIMED_OUT', { recipe: run.plan.identity.recipe });
      } else if (outcome.disposition === 'shutdown') {
        if (!this.persistTransition({ runId: run.runId, expectedState: 'EXECUTING', nextState: 'CANCELLED', at: this.now(), eventType: 'containment.terminated', source: 'SHUTDOWN', reason: 'SHUTDOWN_TERMINATED', terminalAt: this.now(), result, exitCode: result.exitCode, failureCode: 'SHUTDOWN_TERMINATED' })) {
          this.failLocalAfterDurableTerminalLoss(run);
          return;
        }
        this.transition(run, 'CANCELLED');
        this.audit(run, 'shutdown.terminated', 'CANCELLED', { recipe: run.plan.identity.recipe });
      } else {
        if (!this.persistTransition({ runId: run.runId, expectedState: 'EXECUTING', nextState: 'COMPLETED', at: this.now(), eventType: 'execution.completed', source: 'EXECUTION', reason: 'PROCESS_EXITED', terminalAt: this.now(), result, exitCode: result.exitCode })) {
          this.failLocalAfterDurableTerminalLoss(run);
          return;
        }
        this.transition(run, 'COMPLETED');
        this.audit(run, 'execution.completed', 'COMPLETED', { recipe: run.plan.identity.recipe, exitCode: result.exitCode, redacted: result.redacted });
      }
    } catch (error) {
      const code = error instanceof AgentRecipePolicyError ? error.code : 'EXECUTION_FAILED';
      this.persistTerminalFailure(run, code, 'EXECUTION');
      this.transition(run, 'FAILED');
      run.error = { code, message: code === 'TERMINATION_FAILED' ? 'The recipe process tree could not be confirmed stopped.' : code === 'SPAWNED_IDENTITY_PERSISTENCE_FAILED' ? 'The recipe process tree was stopped because durable containment identity recording failed.' : 'The approved recipe did not complete.' };
      this.audit(run, code === 'TERMINATION_FAILED' ? 'execution.termination_failed' : 'execution.failed', code, { recipe: run.plan.identity.recipe });
    } finally {
      await this.resolver.release(run.plan).catch(() => {});
    }
  }

  private binding(plan: AgentRecipePlan, reason: string): string {
    return hashInput({ identity: plan.identity, reason });
  }

  private owned(runId: string, context: AgentModeRequestContext): { ok: true; run: CommandRunRecord } | Extract<AgentModeActionResult, { ok: false }> {
    const run = this.runs.get(runId);
    if (!run || !validContext(context) || run.activationId !== context.activationId || context.workspaceRoot !== run.workspaceRoot) {
      return { ok: false, code: 'UNKNOWN_RUN', message: 'Unknown Agent Mode recipe run.' };
    }
    return { ok: true, run };
  }

  private stale(run: CommandRunRecord): AgentModeActionResult {
    this.revokeApproval(run);
    this.journal.transition({ runId: run.runId, nextState: 'STALE', at: this.now(), eventType: 'proposal.stale', source: 'APPROVAL', reason: 'STALE_PROPOSAL', terminalAt: this.now(), failureCode: 'STALE', approvalLifecycle: 'INVALIDATED', approvalInvalidationReason: 'SNAPSHOT_CHANGED', recoveryClass: 'SNAPSHOT_CHANGED', recoveryEligible: true, recoveryReason: 'STALE_REQUIRES_FRESH_PROPOSAL' });
    this.transition(run, 'STALE');
    this.audit(run, 'proposal.stale', 'STALE', { recipe: run.plan.identity.recipe });
    void this.resolver.release(run.plan);
    return { ok: false, code: 'STALE', message: 'The preview fingerprint or recipe execution identity is stale.' };
  }

  private expire(run: CommandRunRecord): void {
    if (run.state !== 'AWAITING_APPROVAL' || run.expiresAt > this.now()) return;
    this.revokeApproval(run);
    this.journal.transition({ runId: run.runId, expectedState: 'AWAITING_APPROVAL', nextState: 'EXPIRED', at: this.now(), eventType: 'approval.expired', source: 'CLEANUP', reason: 'APPROVAL_TTL_EXPIRED', terminalAt: this.now(), failureCode: 'EXPIRED', approvalLifecycle: 'EXPIRED', approvalInvalidationReason: 'APPROVAL_TTL_EXPIRED', recoveryClass: 'REPROPOSAL_ALLOWED', recoveryEligible: true, recoveryReason: 'EXPIRED_FRESH_PROPOSAL_ALLOWED' });
    this.transition(run, 'EXPIRED');
    this.audit(run, 'approval.expired', 'EXPIRED', { recipe: run.plan.identity.recipe });
    void this.resolver.release(run.plan);
  }

  private terminalDecision(run: CommandRunRecord): AgentModeActionResult {
    return { ok: false, code: 'INVALID_STATE', message: `The recipe run is already terminal in ${run.state}.` };
  }

  private duplicateDecision(run: CommandRunRecord): AgentModeActionResult {
    if (run.state === 'APPROVED' || run.state === 'EXECUTING') return { ok: true, view: toView(run) };
    return { ok: false, code: 'INVALID_STATE', message: `The recipe run cannot be approved from ${run.state}.` };
  }

  private revokeApproval(run: CommandRunRecord): void {
    this.toolDeps.approvals.reject(run.approvalId, { tool: 'agent.recipe', inputHash: run.proposalHash, correlationId: run.requestId });
  }

  private transition(run: CommandRunRecord, state: AgentModeState): void {
    if (TERMINAL.has(run.state)) return;
    run.state = state;
    run.updatedAt = this.now();
  }

  private cleanup(): void {
    for (const run of this.runs.values()) this.expire(run);
    const cutoff = this.now() - TERMINAL_RETENTION_MS;
    for (const [runId, run] of this.runs) if (TERMINAL.has(run.state) && run.updatedAt < cutoff) this.runs.delete(runId);
    this.journal.prune(this.now());
  }

  private audit(run: CommandRunRecord, type: Parameters<typeof auditStore.append>[0]['type'], outcome: string, fields: Record<string, unknown>): void {
    auditStore.append({ correlationId: run.requestId, requestId: run.requestId, type, component: 'agent-mode-recipe', outcome, fields: { ...fields, run: auditHash(run.runId), activation: auditHash(run.activationId), workspace: auditHash(run.workspaceRoot), ...(run.externalRequestRef ? { externalRequest: run.externalRequestRef } : {}) } });
  }

  private previewFor(plan: AgentRecipePlan, safeReason: string, requestId: string, fingerprint: string, expiresAt: number): NonNullable<AgentModeCommandRunView['preview']> {
    return {
      recipe: plan.identity.recipe,
      policyVersion: plan.identity.policyVersion,
      executionIdentity: hashInput(plan.identity).slice(0, 16),
      environmentPolicy: plan.identity.environmentPolicy,
      workspaceMaterialFingerprint: plan.identity.workspaceMaterialIdentity.slice(0, 16),
      snapshotId: plan.identity.snapshotId,
      sourceWorkspace: plan.identity.sourceWorkspace,
      executable: plan.identity.executablePath,
      arguments: [...plan.identity.arguments],
      cwd: plan.identity.canonicalCwd,
      timeoutMs: plan.identity.timeoutMs,
      outputLimitBytes: plan.identity.outputLimitBytes,
      mutationClassification: plan.identity.mutationClassification,
      networkPolicy: plan.identity.networkPolicy,
      expectedEffects: [...plan.identity.expectedEffects],
      reason: safeReason,
      requestId,
      fingerprint,
      expiresAt,
      warnings: [
        'This is a fixed server-owned recipe; executable and arguments cannot be supplied by the client.',
        plan.identity.canModifyFiles ? 'This recipe may modify workspace artifacts or caches.' : 'This recipe is declared read-only.',
        'Approval is single-use and bound to this activation, run, immutable snapshot, executable digest, and recipe policy.',
      ],
      environment: Object.keys(plan.environment).sort().map((key) => ({ key, value: '[SERVER CONTROLLED]', redacted: true })),
      canModifyFiles: plan.identity.canModifyFiles,
    };
  }

  private recoveryStatus(run: DurableAgentRun, context: AgentModeRequestContext, events = this.journal.events(run.runId)): AgentModeRunRecoveryStatus {
    const workspaceMatches = run.workspaceIdentity === context.workspaceIdentity;
    const currentRecipeAvailable = context.allowedRecipes.includes(run.recipeId as AgentModeRecipeId);
    const provenance = validateRecoverySourceProvenance({ run, events, workspaceIdentity: context.workspaceIdentity, allowedRecipes: context.allowedRecipes, now: this.now() });
    const classification = provenance.recoveryClass;
    const eligible = provenance.trusted;
    return {
      runId: run.runId,
      sourceState: run.state as AgentModeState,
      approvalLifecycle: run.approvalLifecycle,
      terminalReason: run.failureCode ?? run.interruptionClassification ?? run.recoveryReason,
      recoveryClass: classification,
      eligible,
      explanation: provenance.explanation,
      currentRecipeAvailable,
      workspaceMatches,
      activeSuccessorRunId: run.successorRunId,
      recommendedAction: eligible ? 'Create a fresh proposal.' : recoveryRecommendation(classification, run, provenance.code),
      lineage: { sourceRunId: run.recoverySourceRunId, successorRunId: run.successorRunId },
    };
  }

  private async reconcileRun(run: DurableAgentRun, claim: AgentRunReconciliationClaim): Promise<string> {
    const reconciliation = { owner: claim.owner, fence: claim.fence, leaseValidAt: this.now(), expectedVersion: claim.version };
    if (run.state === 'AWAITING_APPROVAL') {
      return this.reconciliationTransition(run, reconciliation, 'AWAITING_APPROVAL', 'EXPIRED', 'approval.lost_on_restart', 'RESTART_AUTHORIZATION_LOST');
    }
    if (run.state === 'APPROVED') {
      return this.reconciliationTransition(run, reconciliation, 'APPROVED', 'STALE', 'restart.authorization_lost', 'RESTART_BEFORE_EXECUTION');
    }
    if (run.state === 'EXECUTING') {
      if (!run.containmentUnit || !run.containmentBinding || !this.processes.reconcileRun) {
        return this.reconciliationTransition(run, reconciliation, 'EXECUTING', 'FAILED', 'restart.interrupted_execution', 'INTERRUPTED_BY_RESTART');
      }
      const expected = this.containmentIdentityForDurableRun(run, run.containmentUnit);
      if (run.containmentBinding !== expected.binding) {
        return this.reconciliationTransition(run, reconciliation, 'EXECUTING', 'FAILED', 'restart.interrupted_execution', 'RESTART_CONTAINMENT_IDENTITY_MISMATCH');
      }
      const renewed = this.journal.renewReconciliation(run.runId, claim.owner, claim.fence, this.now());
      if (!renewed) return 'RECONCILIATION_FENCE_LOST';
      const outcome = await this.processes.reconcileRun(run.runId, { ...expected, binding: run.containmentBinding });
      const finalClaim = this.journal.renewReconciliation(run.runId, renewed.owner, renewed.fence, this.now());
      if (!finalClaim) return 'RECONCILIATION_FENCE_LOST';
      const finalReconciliation = { owner: finalClaim.owner, fence: finalClaim.fence, leaseValidAt: this.now(), expectedVersion: finalClaim.version };
      const nextState = outcome.code === 'RESTART_CONTAINMENT_TERMINATED' ? 'CANCELLED' : 'FAILED';
      const eventType = outcome.code === 'RESTART_CONTAINMENT_TERMINATED' ? 'containment.terminated' : outcome.code === 'RESTART_TERMINATION_FAILED' ? 'containment.termination_failed' : 'restart.interrupted_execution';
      const transitioned = this.reconciliationTransition(run, finalReconciliation, 'EXECUTING', nextState, eventType, outcome.code);
      return transitioned === outcome.code ? outcome.code : transitioned;
    }
    return 'RECONCILIATION_UNSUPPORTED_STATE';
  }

  private reconciliationTransition(
    run: DurableAgentRun,
    reconciliation: ReconciliationFence,
    expectedState: AgentModeState,
    nextState: AgentModeState,
    eventType: string,
    reason: string,
  ): string {
    const recovery = agentModeRecoveryMetadataFor(reason, nextState);
    const ok = this.journal.transition({
      runId: run.runId,
      expectedState,
      nextState,
      at: this.now(),
      eventType,
      source: 'RECONCILIATION',
      reason,
      reconciliation,
      terminalAt: this.now(),
      failureCode: reason,
      interruptionClassification: reason,
      approvalLifecycle: recovery.approvalLifecycle,
      approvalInvalidationReason: recovery.approvalInvalidationReason,
      recoveryClass: recovery.recoveryClass,
      recoveryEligible: recovery.recoveryEligible,
      recoveryReason: recovery.recoveryReason,
    });
    return ok ? reason : 'RECONCILIATION_FENCE_LOST';
  }

  private persistTerminalFailure(run: CommandRunRecord, code: string, source: 'EXECUTION' | 'SHUTDOWN'): void {
    if (this.persistTransition({ runId: run.runId, expectedState: 'EXECUTING', nextState: 'FAILED', at: this.now(), eventType: code === 'TERMINATION_FAILED' ? 'containment.termination_failed' : 'execution.failed', source, reason: code, terminalAt: this.now(), error: { code, message: code === 'TERMINATION_FAILED' ? 'The recipe process tree could not be confirmed stopped.' : 'The approved recipe did not complete.' }, failureCode: code })) return;
    auditStore.append({ correlationId: run.requestId, requestId: run.requestId, type: 'execution.failed', component: 'agent-mode-recipe', outcome: 'DURABLE_TERMINAL_WRITE_FAILED', fields: { run: auditHash(run.runId), code } });
  }

  private persistTransition(input: Parameters<AgentRunJournal['transition']>[0]): boolean {
    for (let attempt = 0; attempt < 3; attempt += 1) if (this.journal.transition(input)) return true;
    return false;
  }

  private failLocalAfterDurableTerminalLoss(run: CommandRunRecord): void {
    this.transition(run, 'FAILED');
    run.error = { code: 'DURABLE_TERMINAL_WRITE_FAILED', message: 'The recipe process ended, but durable terminal state could not be recorded.' };
    this.audit(run, 'execution.failed', 'DURABLE_TERMINAL_WRITE_FAILED', { recipe: run.plan.identity.recipe });
  }

  private containmentIdentity(run: CommandRunRecord, unit?: string): AgentContainmentIdentity {
    return containmentIdentityForTrustedRun({
      runId: run.runId,
      unit,
      workspaceIdentity: run.plan.identity.sourceWorkspaceIdentity,
      recipeId: run.plan.identity.recipe,
      proposalFingerprint: run.fingerprint,
      snapshotManifestDigest: run.plan.identity.workspaceMaterialIdentity,
      executableDigest: run.plan.identity.executableDigest,
      recipePolicyVersion: run.plan.identity.policyVersion,
    });
  }

  private containmentIdentityForDurableRun(run: DurableAgentRun, unit?: string): AgentContainmentReconciliationIdentity {
    const input = {
      runId: run.runId,
      unit,
      workspaceIdentity: run.workspaceIdentity,
      recipeId: run.recipeId as AgentRecipePlan['identity']['recipe'],
      proposalFingerprint: run.proposalFingerprint,
      snapshotManifestDigest: run.snapshotManifestDigest,
      executableDigest: run.executableDigest,
      recipePolicyVersion: run.recipePolicyVersion,
    };
    return { ...input, ...containmentIdentityForTrustedRun(input) };
  }
}

export function buildAgentModeCommandService(toolDeps: ToolExecDeps, journalPersistence?: AgentRunJournalPersistence): AgentModeCommandService {
  return new AgentModeCommandService(toolDeps, undefined, undefined, undefined, undefined, new AgentRunJournal(journalPersistence, buildAgentRunJournalConfig()));
}

function validContext(context: AgentModeRequestContext): boolean {
  return typeof context.activationId === 'string' && context.activationId.length >= 16 && Number.isSafeInteger(context.extensionProcessId) && context.extensionProcessId > 0 && typeof context.serverInstanceId === 'string' && context.serverInstanceId.length >= 16 && typeof context.workspaceRoot === 'string' && context.workspaceRoot.length > 0 && context.workspaceRoot.length <= 4096;
}

const AGENT_MODE_RECOVERY_REASON_POLICY = new Map<string, AgentModeRecoveryMetadata>([
  ['RESTART_AUTHORIZATION_LOST', { approvalLifecycle: 'LOST_ON_RESTART', approvalInvalidationReason: 'RESTART_AUTHORIZATION_LOST', recoveryClass: 'REPROPOSAL_REQUIRED', recoveryEligible: true, recoveryReason: 'RESTART_AUTHORIZATION_LOST' }],
  ['RESTART_BEFORE_EXECUTION', { approvalLifecycle: 'INVALIDATED', approvalInvalidationReason: 'RESTART_BEFORE_EXECUTION', recoveryClass: 'REPROPOSAL_REQUIRED', recoveryEligible: true, recoveryReason: 'RESTART_BEFORE_EXECUTION' }],
  ['INTERRUPTED_BY_RESTART', { approvalLifecycle: 'INVALIDATED', approvalInvalidationReason: 'INTERRUPTED_BY_RESTART', recoveryClass: 'REPROPOSAL_ALLOWED', recoveryEligible: true, recoveryReason: 'INTERRUPTED_BY_RESTART' }],
  ['RESTART_NO_CONTAINMENT_FOUND', { approvalLifecycle: 'INVALIDATED', approvalInvalidationReason: 'RESTART_NO_CONTAINMENT_FOUND', recoveryClass: 'REPROPOSAL_ALLOWED', recoveryEligible: true, recoveryReason: 'RESTART_NO_CONTAINMENT_FOUND' }],
  ['RESTART_CONTAINMENT_ALREADY_EXITED', { approvalLifecycle: 'INVALIDATED', approvalInvalidationReason: 'RESTART_CONTAINMENT_ALREADY_EXITED', recoveryClass: 'REPROPOSAL_ALLOWED', recoveryEligible: true, recoveryReason: 'RESTART_CONTAINMENT_ALREADY_EXITED' }],
  ['RESTART_CONTAINMENT_TERMINATED', { approvalLifecycle: 'INVALIDATED', approvalInvalidationReason: 'RESTART_CONTAINMENT_TERMINATED', recoveryClass: 'REPROPOSAL_ALLOWED', recoveryEligible: true, recoveryReason: 'RESTART_CONTAINMENT_TERMINATED' }],
  ['RESTART_TERMINATION_FAILED', { approvalLifecycle: 'INVALIDATED', approvalInvalidationReason: 'RESTART_TERMINATION_FAILED', recoveryClass: 'TERMINAL_NO_RECOVERY', recoveryEligible: false, recoveryReason: 'RESTART_TERMINATION_FAILED' }],
  ['RESTART_CONTAINMENT_IDENTITY_MISMATCH', { approvalLifecycle: 'INVALIDATED', approvalInvalidationReason: 'RESTART_CONTAINMENT_IDENTITY_MISMATCH', recoveryClass: 'POLICY_CHANGED', recoveryEligible: false, recoveryReason: 'RESTART_CONTAINMENT_IDENTITY_MISMATCH' }],
]);

export function agentModeRecoveryMetadataFor(reason: string, _state: AgentModeState): AgentModeRecoveryMetadata {
  return AGENT_MODE_RECOVERY_REASON_POLICY.get(reason) ?? { recoveryClass: 'TERMINAL_NO_RECOVERY', recoveryEligible: false, recoveryReason: reason };
}

export function agentModeRecoveryReasonPolicy(): readonly AgentModeRecoveryMetadata[] {
  return [...AGENT_MODE_RECOVERY_REASON_POLICY.values()].map((entry) => ({ ...entry }));
}

export function agentModeReconciliationEmitterContractParity(): readonly { emitter: AgentModeReconciliationTerminalEmitter; contractMatches: number; metadata: AgentModeRecoveryMetadata; contractRecoverable?: boolean; contractRecoveryClass?: AgentModeRecoveryClass }[] {
  const contracts = recoveryProductionReasonContracts();
  return AGENT_MODE_RECONCILIATION_TERMINAL_EMITTERS.map((emitter) => {
    const matches = contracts.filter((contract) => contract.state === emitter.nextState && contract.reason === emitter.reason && contract.terminalEvents.includes(emitter.eventType));
    return {
      emitter,
      contractMatches: matches.length,
      metadata: agentModeRecoveryMetadataFor(emitter.reason, emitter.nextState),
      contractRecoverable: matches[0]?.recoverable,
      contractRecoveryClass: matches[0]?.recoveryClass,
    };
  });
}

function recoveryRecommendation(classification: AgentModeRecoveryClass, run: DurableAgentRun, code?: string): string {
  if (code === 'MISSING_REQUIRED_EVENT' || code === 'EVENT_SEQUENCE_GAP') return 'Investigate the incomplete durable run history before creating another proposal.';
  if (code === 'ILLEGAL_STATE_TRANSITION' || code === 'TERMINAL_STATE_MISMATCH' || code === 'AUDIT_SEQUENCE_MISMATCH' || code === 'APPROVAL_LIFECYCLE_MISMATCH' || code === 'SOURCE_INTEGRITY_FAILED') return 'Investigate the inconsistent durable run history before creating another proposal.';
  if (run.successorRunId) return 'Review the active successor proposal.';
  if (classification === 'TERMINAL_NO_RECOVERY') return 'No recovery action is available for this run.';
  if (classification === 'NONE') return 'Wait for the active run to reach a terminal state.';
  return 'Resolve the ineligible recovery condition before creating a fresh proposal.';
}

function recoveryReproposalReason(run: DurableAgentRun): string {
  return `Fresh proposal after ${run.failureCode ?? run.state}`;
}

function sanitizeAgentModeCommandResult(result: AgentModeCommandResult): AgentModeCommandResult {
  const stdout = redactCommandOutput(result.stdout);
  const stderr = redactCommandOutput(result.stderr);
  return {
    ...result,
    stdout: stdout.value,
    stderr: stderr.value,
    redacted: result.redacted || stdout.redacted || stderr.redacted,
  };
}

function toView(run: CommandRunRecord): AgentModeCommandRunView {
  const liveRecoveryClass = run.state === 'COMPLETED' ? 'TERMINAL_NO_RECOVERY' : TERMINAL.has(run.state) ? 'REPROPOSAL_ALLOWED' : 'NONE';
  return {
    runId: run.runId,
    requestId: run.requestId,
    state: run.state,
    preview: run.preview,
    result: run.result,
    error: run.error,
    approval: {
      lifecycle: run.state === 'AWAITING_APPROVAL' ? (run.displayed ? 'DISPLAYED' : 'PENDING_DISPLAY') : run.state === 'APPROVED' || run.state === 'EXECUTING' ? 'CONSUMED' : run.state === 'REJECTED' ? 'REJECTED' : run.state === 'EXPIRED' ? 'EXPIRED' : 'INVALIDATED',
      requestedAt: run.createdAt,
      displayedAt: run.displayed ? run.updatedAt : undefined,
      expiresAt: run.expiresAt,
    },
    recovery: { classification: liveRecoveryClass, eligible: liveRecoveryClass === 'REPROPOSAL_ALLOWED' },
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}
