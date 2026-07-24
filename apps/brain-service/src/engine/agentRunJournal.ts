import { createHash, randomUUID } from 'node:crypto';
import type { AgentModeCommandPreview, AgentModeCommandResult, AgentModeCommandRunView, AgentModeState } from '@migrapilot/protocol';
import { auditHash } from './auditLog.js';
import { redactValue } from './redaction.js';
import { validateRecoverySourceProvenance } from './recoverySourceProvenance.js';
import type {
  AgentRunJournalPersistence,
  AgentRunFencedEventInput,
  AgentRunReproposalResult,
  AgentRunReconciliationClaim,
  AgentRunTransitionInput,
  DurableAgentApprovalLifecycle,
  DurableAgentRun,
  DurableAgentRunEvent,
  DurableAgentRecoveryClass,
  DurableAgentRunState,
  DurableAgentRunTombstone,
} from './persistence/types.js';

export const AGENT_RUN_SCHEMA_VERSION = 1;
export const AGENT_TERMINAL_STATES = new Set<AgentModeState>(['COMPLETED', 'REJECTED', 'EXPIRED', 'STALE', 'FAILED', 'CANCELLED']);

export type AgentRunEventSource = DurableAgentRunEvent['source'];

export interface AgentRunCreateInput {
  runId: string;
  correlationId: string;
  externalRequestRef?: string;
  activationId: string;
  workspaceRoot: string;
  workspaceIdentity: string;
  recipeId: string;
  recipePolicyVersion: string;
  proposalFingerprint: string;
  proposalHash: string;
  snapshotId: string;
  snapshotManifestDigest: string;
  executableDigest: string;
  requestedAt: number;
  proposalAt: number;
  expiresAt: number;
  timeoutMs: number;
  outputLimitBytes: number;
  mutationClassification: string;
  networkPolicy: string;
  expectedEffects: readonly string[];
  preview: AgentModeCommandPreview;
  recoverySourceRunId?: string;
}

export interface AgentRunTransition {
  runId: string;
  expectedState?: AgentModeState;
  nextState: AgentModeState;
  at: number;
  eventType: string;
  source: AgentRunEventSource;
  reason?: string;
  approvalDisplayedAt?: number;
  approvalDecisionAt?: number;
  executionStartedAt?: number;
  terminalAt?: number;
  result?: AgentModeCommandResult;
  error?: { code: string; message: string };
  exitCode?: number | null;
  signal?: string;
  failureCode?: string;
  interruptionClassification?: string;
  containmentUnit?: string;
  containmentBinding?: string;
  approvalLifecycle?: DurableAgentApprovalLifecycle;
  approvalRequestedAt?: number;
  approvalExpiresAt?: number;
  approvalDecisionType?: 'APPROVED' | 'REJECTED';
  approvalInvalidationReason?: string;
  approvalActorRef?: string;
  recoveryClass?: DurableAgentRecoveryClass;
  recoveryEligible?: boolean;
  recoveryReason?: string;
  successorRunId?: string;
  reproposalAt?: number;
  recoveryAttemptCount?: number;
  lastRecoveryRequestId?: string;
  recoveryTerminalReason?: string;
  reconciliation?: {
    owner: string;
    fence: number;
    leaseValidAt: number;
    expectedVersion?: number;
  };
}

export interface AgentRunJournalConfig {
  terminalRetentionMs: number;
  retentionBatchSize: number;
  reconciliationLeaseMs: number;
}

export const DEFAULT_AGENT_RUN_JOURNAL_CONFIG: AgentRunJournalConfig = Object.freeze({
  terminalRetentionMs: 14 * 24 * 60 * 60 * 1000,
  retentionBatchSize: 100,
  reconciliationLeaseMs: 30_000,
});

export function buildAgentRunJournalConfig(env: NodeJS.ProcessEnv = process.env): AgentRunJournalConfig {
  return {
    terminalRetentionMs: boundedDays(env.MIGRAPILOT_AGENT_RUN_RETENTION_DAYS, 14, 1, 90) * 24 * 60 * 60 * 1000,
    retentionBatchSize: boundedInt(env.MIGRAPILOT_AGENT_RUN_RETENTION_BATCH, 100, 1, 500),
    reconciliationLeaseMs: boundedInt(env.MIGRAPILOT_AGENT_RUN_RECONCILE_LEASE_MS, 30_000, 5_000, 120_000),
  };
}

export class AgentRunJournal {
  constructor(
    private readonly persistence: AgentRunJournalPersistence | undefined,
    readonly config: AgentRunJournalConfig = DEFAULT_AGENT_RUN_JOURNAL_CONFIG,
    private readonly mkId: () => string = randomUUID,
  ) {}

  get durable(): boolean { return this.persistence !== undefined; }

  create(input: AgentRunCreateInput): void {
    if (!this.persistence) return;
    const run = this.buildRun(input);
    this.persistence.insertAgentRun(run, {
      eventId: this.mkId(),
      runId: input.runId,
      seq: 1,
      at: input.proposalAt,
      type: 'run.created',
      nextState: 'AWAITING_APPROVAL',
      reason: 'PROPOSAL_CREATED',
      correlationId: input.correlationId,
      source: 'API',
      schemaVersion: AGENT_RUN_SCHEMA_VERSION,
    });
    this.event({ runId: input.runId, at: input.proposalAt, type: 'proposal.created', state: 'AWAITING_APPROVAL', correlationId: input.correlationId, source: 'API', reason: input.recipeId });
    this.event({ runId: input.runId, at: input.proposalAt, type: 'approval.requested', state: 'AWAITING_APPROVAL', correlationId: input.correlationId, source: 'APPROVAL', reason: 'PENDING_DISPLAY' });
  }

  createSuccessor(input: {
    source: DurableAgentRun;
    provenance: Parameters<AgentRunJournalPersistence['reproposeAgentRun']>[0]['provenance'];
    requestId: string;
    run: AgentRunCreateInput;
  }): AgentRunReproposalResult {
    if (!this.persistence) return { ok: false, code: 'UNKNOWN_SOURCE' };
    const successor = this.buildRun(input.run);
    return this.persistence.reproposeAgentRun({
      sourceRunId: input.source.runId,
      sourceExpectedVersion: input.source.version,
      requestId: input.requestId,
      at: input.run.proposalAt,
      provenance: input.provenance,
      successor,
      createdEvent: {
        eventId: this.mkId(),
        runId: input.run.runId,
        seq: 1,
        at: input.run.proposalAt,
        type: 'run.created',
        nextState: 'AWAITING_APPROVAL',
        reason: 'RECOVERY_REPROPOSAL_CREATED',
        correlationId: input.run.correlationId,
        source: 'RECOVERY',
        schemaVersion: AGENT_RUN_SCHEMA_VERSION,
      },
      proposalEvent: {
        eventId: this.mkId(),
        runId: input.run.runId,
        seq: 2,
        at: input.run.proposalAt,
        type: 'proposal.created',
        priorState: 'AWAITING_APPROVAL',
        nextState: 'AWAITING_APPROVAL',
        reason: input.run.recipeId,
        correlationId: input.run.correlationId,
        source: 'RECOVERY',
        schemaVersion: AGENT_RUN_SCHEMA_VERSION,
      },
    });
  }

  private buildRun(input: AgentRunCreateInput): DurableAgentRun {
    return {
      runId: input.runId,
      correlationId: input.correlationId,
      externalRequestRef: input.externalRequestRef,
      activationRef: auditHash(input.activationId),
      workspaceIdentity: input.workspaceIdentity,
      workspaceRef: auditHash(input.workspaceRoot),
      recipeId: input.recipeId,
      recipePolicyVersion: input.recipePolicyVersion,
      proposalFingerprint: input.proposalFingerprint,
      proposalHash: input.proposalHash,
      snapshotId: input.snapshotId,
      snapshotManifestDigest: input.snapshotManifestDigest,
      executableDigest: input.executableDigest,
      recoverySourceRunId: input.recoverySourceRunId,
      state: 'AWAITING_APPROVAL',
      requestedAt: input.requestedAt,
      proposalAt: input.proposalAt,
      expiresAt: input.expiresAt,
      timeoutMs: input.timeoutMs,
      outputLimitBytes: input.outputLimitBytes,
      mutationClassification: input.mutationClassification,
      networkPolicy: input.networkPolicy,
      expectedEffectsJson: stableJson(input.expectedEffects),
      previewJson: stableJson(redactValue(input.preview)),
      approvalLifecycleVersion: 1,
      approvalLifecycle: 'PENDING_DISPLAY',
      approvalRequestedAt: input.proposalAt,
      approvalExpiresAt: input.expiresAt,
      recoveryClass: 'NONE',
      recoveryEligible: false,
      recoveryAttemptCount: 0,
      auditSeq: 0,
      schemaVersion: AGENT_RUN_SCHEMA_VERSION,
      version: 1,
      reconciliationFence: 0,
      updatedAt: input.proposalAt,
    };
  }

  event(input: { runId: string; at: number; type: string; state: AgentModeState; correlationId: string; source: AgentRunEventSource; reason?: string }): void {
    if (!this.persistence) return;
    this.persistence.appendAgentRunEvent({
      eventId: this.mkId(),
      runId: input.runId,
      at: input.at,
      type: input.type,
      nextState: input.state,
      reason: input.reason,
      correlationId: input.correlationId,
      source: input.source,
      schemaVersion: AGENT_RUN_SCHEMA_VERSION,
    });
  }

  reconciliationEvent(input: {
    runId: string;
    expectedState?: AgentModeState;
    at: number;
    type: string;
    reason?: string;
    reconciliation: AgentRunFencedEventInput['reconciliation'];
  }): AgentRunReconciliationClaim | undefined {
    if (!this.persistence) return undefined;
    return this.persistence.appendAgentRunEventUnderFence({
      runId: input.runId,
      expectedState: input.expectedState as DurableAgentRunState | undefined,
      at: input.at,
      source: 'RECONCILIATION',
      eventType: input.type,
      reason: input.reason,
      reconciliation: input.reconciliation,
      eventId: this.mkId(),
    });
  }

  transition(input: AgentRunTransition): boolean {
    if (!this.persistence) return true;
    const patch: AgentRunTransitionInput['patch'] = {
      approvalDisplayedAt: input.approvalDisplayedAt,
      approvalDecisionAt: input.approvalDecisionAt,
      executionStartedAt: input.executionStartedAt,
      terminalAt: input.terminalAt,
      resultJson: input.result ? stableJson(redactValue(input.result)) : undefined,
      errorJson: input.error ? stableJson(redactValue(input.error)) : undefined,
      exitCode: input.exitCode,
      signal: input.signal,
      failureCode: input.failureCode,
      interruptionClassification: input.interruptionClassification,
      containmentUnit: input.containmentUnit,
      containmentBinding: input.containmentBinding,
      approvalLifecycle: input.approvalLifecycle,
      approvalRequestedAt: input.approvalRequestedAt,
      approvalExpiresAt: input.approvalExpiresAt,
      approvalDecisionType: input.approvalDecisionType,
      approvalInvalidationReason: input.approvalInvalidationReason,
      approvalActorRef: input.approvalActorRef,
      recoveryClass: input.recoveryClass,
      recoveryEligible: input.recoveryEligible,
      recoveryReason: input.recoveryReason,
      successorRunId: input.successorRunId,
      reproposalAt: input.reproposalAt,
      recoveryAttemptCount: input.recoveryAttemptCount,
      lastRecoveryRequestId: input.lastRecoveryRequestId,
      recoveryTerminalReason: input.recoveryTerminalReason,
    };
    return this.persistence.transitionAgentRun({
      runId: input.runId,
      expectedState: input.expectedState as DurableAgentRunState | undefined,
      nextState: input.nextState as DurableAgentRunState,
      at: input.at,
      source: input.source,
      eventType: input.eventType,
      reason: input.reason,
      reconciliation: input.reconciliation,
      patch,
      eventId: this.mkId(),
    });
  }

  loadRuns(): DurableAgentRun[] {
    return this.persistence?.loadAgentRuns() ?? [];
  }

  loadRun(runId: string): DurableAgentRun | undefined {
    return this.persistence?.loadAgentRun(runId);
  }

  events(runId: string): DurableAgentRunEvent[] {
    return this.persistence?.loadAgentRunEvents(runId) ?? [];
  }

  claimReconciliation(runId: string, owner: string, now: number): AgentRunReconciliationClaim | undefined {
    return this.persistence?.claimAgentRunReconciliation(runId, owner, now + this.config.reconciliationLeaseMs, now);
  }

  renewReconciliation(runId: string, owner: string, fence: number, now: number): AgentRunReconciliationClaim | undefined {
    return this.persistence?.renewAgentRunReconciliation(runId, owner, fence, now + this.config.reconciliationLeaseMs, now);
  }

  prune(now: number): { runs: number; events: number } {
    if (!this.persistence) return { runs: 0, events: 0 };
    return this.persistence.pruneAgentRuns(now - this.config.terminalRetentionMs, this.config.retentionBatchSize, now);
  }

  tombstones(limit = 500): DurableAgentRunTombstone[] {
    return this.persistence?.loadAgentRunTombstones(limit) ?? [];
  }
}

export function durableRunToView(run: DurableAgentRun): AgentModeCommandRunView {
  return {
    runId: run.runId,
    requestId: run.correlationId,
    state: run.state as AgentModeState,
    preview: parseJson<AgentModeCommandPreview>(run.previewJson),
    result: parseJson<AgentModeCommandResult>(run.resultJson),
    error: parseJson<{ code: string; message: string }>(run.errorJson),
    approval: {
      lifecycle: run.approvalLifecycle,
      requestedAt: run.approvalRequestedAt,
      displayedAt: run.approvalDisplayedAt,
      decisionAt: run.approvalDecisionAt,
      decision: run.approvalDecisionType,
      expiresAt: run.approvalExpiresAt,
      invalidationReason: run.approvalInvalidationReason,
      actorRef: run.approvalActorRef,
    },
    recovery: {
      classification: run.recoveryClass,
      eligible: run.recoveryEligible,
      reason: run.recoveryReason,
      sourceRunId: run.recoverySourceRunId,
      successorRunId: run.successorRunId,
      attemptCount: run.recoveryAttemptCount,
      lastRequestId: run.lastRecoveryRequestId,
      terminalReason: run.recoveryTerminalReason,
    },
    createdAt: run.requestedAt,
    updatedAt: run.updatedAt,
  };
}

export function containmentBinding(input: { runId: string; snapshotId: string; executableDigest: string; recipePolicyVersion: string; containmentUnit?: string }): string {
  return createHash('sha256')
    .update(JSON.stringify({ runId: input.runId, snapshotId: input.snapshotId, executableDigest: input.executableDigest, recipePolicyVersion: input.recipePolicyVersion, containmentUnit: input.containmentUnit ?? '' }))
    .digest('hex');
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(json: string | undefined): T | undefined {
  if (!json) return undefined;
  try { return JSON.parse(json) as T; } catch { return undefined; }
}

function boundedDays(raw: string | undefined, fallback: number, min: number, max: number): number {
  return boundedInt(raw, fallback, min, max);
}

function boundedInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export class MemoryAgentRunJournalPersistence implements AgentRunJournalPersistence {
  readonly runs = new Map<string, DurableAgentRun>();
  readonly events = new Map<string, DurableAgentRunEvent[]>();
  readonly tombstones: DurableAgentRunTombstone[] = [];

  insertAgentRun(run: DurableAgentRun, createdEvent: DurableAgentRunEvent): void {
    if (this.runs.has(run.runId)) throw new Error(`duplicate Agent run ${run.runId}`);
    this.runs.set(run.runId, { ...run });
    this.events.set(run.runId, [{ ...createdEvent }]);
    this.runs.get(run.runId)!.auditSeq = createdEvent.seq;
  }

  appendAgentRunEvent(event: Omit<DurableAgentRunEvent, 'seq'>): void {
    const run = this.runs.get(event.runId);
    if (!run) throw new Error(`unknown Agent run ${event.runId}`);
    const next = { ...event, seq: run.auditSeq + 1 };
    this.events.set(event.runId, [...(this.events.get(event.runId) ?? []), next]);
    run.auditSeq = next.seq;
    run.updatedAt = event.at;
  }
  appendAgentRunEventUnderFence(input: AgentRunFencedEventInput): AgentRunReconciliationClaim | undefined {
    const run = this.runs.get(input.runId);
    if (!run || AGENT_TERMINAL_STATES.has(run.state as AgentModeState)) return undefined;
    if (input.expectedState && run.state !== input.expectedState) return undefined;
    if (run.reconciliationOwner !== input.reconciliation.owner) return undefined;
    if (run.reconciliationFence !== input.reconciliation.fence) return undefined;
    if ((run.reconciliationLeaseUntil ?? -1) < input.reconciliation.leaseValidAt) return undefined;
    if (run.version !== input.reconciliation.expectedVersion) return undefined;
    const next = {
      eventId: input.eventId ?? randomUUID(),
      runId: input.runId,
      seq: run.auditSeq + 1,
      at: input.at,
      type: input.eventType,
      priorState: run.state,
      nextState: run.state,
      reason: input.reason,
      correlationId: run.correlationId,
      source: input.source,
      schemaVersion: AGENT_RUN_SCHEMA_VERSION,
    };
    this.events.set(input.runId, [...(this.events.get(input.runId) ?? []), next]);
    run.auditSeq = next.seq;
    run.version += 1;
    run.updatedAt = input.at;
    return { runId: input.runId, owner: run.reconciliationOwner, fence: run.reconciliationFence, leaseUntil: run.reconciliationLeaseUntil!, version: run.version };
  }

  transitionAgentRun(input: AgentRunTransitionInput): boolean {
    const run = this.runs.get(input.runId);
    if (!run || AGENT_TERMINAL_STATES.has(run.state as AgentModeState)) return false;
    if (input.expectedState && run.state !== input.expectedState) return false;
    if (input.reconciliation) {
      if (run.reconciliationOwner !== input.reconciliation.owner) return false;
      if (run.reconciliationFence !== input.reconciliation.fence) return false;
      if ((run.reconciliationLeaseUntil ?? -1) < input.reconciliation.leaseValidAt) return false;
      if (input.reconciliation.expectedVersion !== undefined && run.version !== input.reconciliation.expectedVersion) return false;
    }
    const prior = run.state;
    Object.assign(run, compact({
      state: input.nextState,
      approvalDisplayedAt: input.patch?.approvalDisplayedAt,
      approvalDecisionAt: input.patch?.approvalDecisionAt,
      executionStartedAt: input.patch?.executionStartedAt,
      terminalAt: input.patch?.terminalAt ?? (AGENT_TERMINAL_STATES.has(input.nextState as AgentModeState) ? input.at : undefined),
      resultJson: input.patch?.resultJson,
      errorJson: input.patch?.errorJson,
      exitCode: input.patch && 'exitCode' in input.patch ? input.patch.exitCode : undefined,
      signal: input.patch?.signal,
      failureCode: input.patch?.failureCode,
      interruptionClassification: input.patch?.interruptionClassification,
      containmentUnit: input.patch?.containmentUnit,
      containmentBinding: input.patch?.containmentBinding,
      approvalLifecycle: input.patch?.approvalLifecycle,
      approvalRequestedAt: input.patch?.approvalRequestedAt,
      approvalExpiresAt: input.patch?.approvalExpiresAt,
      approvalDecisionType: input.patch?.approvalDecisionType,
      approvalInvalidationReason: input.patch?.approvalInvalidationReason,
      approvalActorRef: input.patch?.approvalActorRef,
      recoveryClass: input.patch?.recoveryClass,
      recoveryEligible: input.patch?.recoveryEligible,
      recoveryReason: input.patch?.recoveryReason,
      successorRunId: input.patch?.successorRunId,
      reproposalAt: input.patch?.reproposalAt,
      recoveryAttemptCount: input.patch?.recoveryAttemptCount,
      lastRecoveryRequestId: input.patch?.lastRecoveryRequestId,
      recoveryTerminalReason: input.patch?.recoveryTerminalReason,
      updatedAt: input.at,
      version: run.version + 1,
    }));
    if (AGENT_TERMINAL_STATES.has(input.nextState as AgentModeState)) {
      run.reconciliationOwner = undefined;
      run.reconciliationLeaseUntil = undefined;
    }
    this.appendAgentRunEvent({
      eventId: input.eventId ?? this.events.size.toString(),
      runId: input.runId,
      at: input.at,
      type: input.eventType,
      priorState: prior,
      nextState: input.nextState,
      reason: input.reason,
      correlationId: run.correlationId,
      source: input.source,
      schemaVersion: AGENT_RUN_SCHEMA_VERSION,
    });
    return true;
  }

  reproposeAgentRun(input: Parameters<AgentRunJournalPersistence['reproposeAgentRun']>[0]): AgentRunReproposalResult {
    const source = this.runs.get(input.sourceRunId);
    if (!source) return { ok: false, code: 'UNKNOWN_SOURCE' };
    if (source.lastRecoveryRequestId === input.requestId && source.successorRunId) {
      const successor = this.runs.get(source.successorRunId);
      if (successor) return { ok: true, created: false, successor: { ...successor } };
    }
    if (!AGENT_TERMINAL_STATES.has(source.state as AgentModeState)) return { ok: false, code: 'SOURCE_NOT_TERMINAL' };
    if (source.version !== input.sourceExpectedVersion) return { ok: false, code: 'SOURCE_VERSION_CHANGED' };
    if (source.reconciliationOwner && (source.reconciliationLeaseUntil ?? 0) >= input.at) return { ok: false, code: 'SOURCE_UNDER_RECONCILIATION' };
    if (source.successorRunId) return { ok: false, code: 'ACTIVE_SUCCESSOR_EXISTS' };
    const activeSuccessor = [...this.runs.values()].find((run) => run.recoverySourceRunId === source.runId && !AGENT_TERMINAL_STATES.has(run.state as AgentModeState));
    if (activeSuccessor) return { ok: false, code: 'ACTIVE_SUCCESSOR_EXISTS' };
    const sourceEvents = this.events.get(source.runId) ?? [];
    const provenance = validateRecoverySourceProvenance({
      run: source,
      events: sourceEvents,
      workspaceIdentity: input.provenance.workspaceIdentity,
      allowedRecipes: input.provenance.allowedRecipes,
      now: input.at,
    });
    if (!provenance.trusted || provenance.digest !== input.provenance.eventDigest || provenance.highestSeq !== input.provenance.highestSeq) return { ok: false, code: 'SOURCE_PROVENANCE_FAILED' };
    if (this.runs.has(input.successor.runId)) return { ok: false, code: 'PARTIAL_FAILURE' };
    const sourceEvent1: DurableAgentRunEvent = {
      eventId: `${source.runId}:reproposal:${input.requestId}:requested`,
      runId: source.runId,
      seq: source.auditSeq + 1,
      at: input.at,
      type: 'recovery.reproposal_requested',
      priorState: source.state,
      nextState: source.state,
      reason: input.requestId,
      correlationId: source.correlationId,
      source: 'RECOVERY',
      schemaVersion: AGENT_RUN_SCHEMA_VERSION,
    };
    const sourceEvent2: DurableAgentRunEvent = {
      eventId: `${source.runId}:reproposal:${input.requestId}:linked`,
      runId: source.runId,
      seq: source.auditSeq + 2,
      at: input.at,
      type: 'recovery.successor_linked',
      priorState: source.state,
      nextState: source.state,
      reason: input.successor.runId,
      correlationId: source.correlationId,
      source: 'RECOVERY',
      schemaVersion: AGENT_RUN_SCHEMA_VERSION,
    };
    this.runs.set(input.successor.runId, { ...input.successor });
    this.events.set(input.successor.runId, [{ ...input.createdEvent }, { ...input.proposalEvent }]);
    this.runs.get(input.successor.runId)!.auditSeq = 2;
    this.events.set(source.runId, [...(this.events.get(source.runId) ?? []), sourceEvent1, sourceEvent2]);
    Object.assign(source, {
      successorRunId: input.successor.runId,
      reproposalAt: input.at,
      recoveryAttemptCount: source.recoveryAttemptCount + 1,
      lastRecoveryRequestId: input.requestId,
      recoveryTerminalReason: 'SUCCESSOR_CREATED',
      auditSeq: source.auditSeq + 2,
      version: source.version + 1,
      updatedAt: input.at,
    });
    return { ok: true, created: true, successor: { ...input.successor } };
  }

  loadAgentRuns(limit = 5000): DurableAgentRun[] { return [...this.runs.values()].slice(0, limit).map((r) => ({ ...r })); }
  loadAgentRun(runId: string): DurableAgentRun | undefined { const r = this.runs.get(runId); return r ? { ...r } : undefined; }
  loadAgentRunEvents(runId: string, limit = 500): DurableAgentRunEvent[] { return (this.events.get(runId) ?? []).slice(0, limit).map((e) => ({ ...e })); }
  claimAgentRunReconciliation(runId: string, owner: string, leaseUntil: number, now: number): AgentRunReconciliationClaim | undefined {
    const run = this.runs.get(runId);
    if (!run || AGENT_TERMINAL_STATES.has(run.state as AgentModeState)) return undefined;
    if (run.reconciliationOwner && (run.reconciliationLeaseUntil ?? 0) >= now) return undefined;
    run.reconciliationOwner = owner;
    run.reconciliationLeaseUntil = leaseUntil;
    run.reconciliationFence = (run.reconciliationFence ?? 0) + 1;
    run.version += 1;
    run.updatedAt = now;
    return { runId, owner, fence: run.reconciliationFence, leaseUntil, version: run.version };
  }
  renewAgentRunReconciliation(runId: string, owner: string, fence: number, leaseUntil: number, now: number): AgentRunReconciliationClaim | undefined {
    const run = this.runs.get(runId);
    if (!run || AGENT_TERMINAL_STATES.has(run.state as AgentModeState)) return undefined;
    if (run.reconciliationOwner !== owner || run.reconciliationFence !== fence) return undefined;
    if ((run.reconciliationLeaseUntil ?? -1) < now) return undefined;
    run.reconciliationLeaseUntil = leaseUntil;
    run.version += 1;
    run.updatedAt = now;
    return { runId, owner, fence, leaseUntil, version: run.version };
  }
  pruneAgentRuns(cutoff: number, batchSize: number, now: number): { runs: number; events: number } {
    let runs = 0;
    let events = 0;
    const candidates = [...this.runs.values()].filter((r) => r.terminalAt !== undefined && r.terminalAt < cutoff && AGENT_TERMINAL_STATES.has(r.state as AgentModeState) && (!r.reconciliationOwner || (r.reconciliationLeaseUntil ?? 0) < now) && !activeLineage(this.runs, r)).slice(0, batchSize).map((run) => ({ run, version: run.version }));
    for (const { run, version } of candidates) {
      const current = this.runs.get(run.runId);
      if (!current || current.version !== version || (current.reconciliationOwner && (current.reconciliationLeaseUntil ?? 0) >= now)) continue;
      const eventCount = this.events.get(run.runId)?.length ?? 0;
      this.tombstones.push({ tombstoneId: `tombstone_${run.runId}_${now}`, runId: run.runId, workspaceIdentity: run.workspaceIdentity, recipeId: run.recipeId, finalState: run.state, terminalAt: run.terminalAt!, deletedAt: now, deletionReason: 'RETENTION_EXPIRED', finalAuditSeq: run.auditSeq, eventCount, recoverySourceRunId: run.recoverySourceRunId, successorRunId: run.successorRunId, schemaVersion: AGENT_RUN_SCHEMA_VERSION });
      events += eventCount;
      this.events.delete(run.runId);
      this.runs.delete(run.runId);
      runs += 1;
    }
    return { runs, events };
  }
  loadAgentRunTombstones(limit = 500): DurableAgentRunTombstone[] { return this.tombstones.slice(0, limit).map((t) => ({ ...t })); }
}

function activeLineage(runs: Map<string, DurableAgentRun>, run: DurableAgentRun): boolean {
  if (run.successorRunId) {
    const successor = runs.get(run.successorRunId);
    if (successor && !AGENT_TERMINAL_STATES.has(successor.state as AgentModeState)) return true;
  }
  return [...runs.values()].some((candidate) => candidate.recoverySourceRunId === run.runId && !AGENT_TERMINAL_STATES.has(candidate.state as AgentModeState));
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
