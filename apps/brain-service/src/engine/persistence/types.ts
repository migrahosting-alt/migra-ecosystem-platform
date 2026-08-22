/**
 * MigraAI Engine — durable persistence abstraction.
 *
 * The engine is the ONLY writer of these records; clients never touch the store.
 * Adapters keep the engine independent of any one database: an embedded SQLite
 * adapter backs the local engine today; a Postgres+pgvector adapter can back a
 * hosted/multi-tenant deployment later without changing the engine.
 *
 * Every row carries owner + workspace scope so isolation is enforced in QUERIES,
 * not only in application code. Callers pass already-redacted content — no
 * secrets, approval tokens, chain-of-thought, or unsanitized tool payloads ever
 * reach an adapter (redaction happens at the store boundary above these).
 */

import type { Conversation, Message, Summary, MemoryItem, Scope } from '../memory/conversationStore.js';

export type StoreHealth = 'ready' | 'degraded' | 'unavailable';

export interface PersistenceHealth {
  memoryStore: StoreHealth;
  ragStore: StoreHealth;
  schemaVersion: number;
  /** e.g. 'current', 'applied', 'pending', 'mismatch', 'failed'. */
  migrationState: string;
  detail?: string;
}

// ── Conversation memory ──────────────────────────────────────────────────────
/** The tenant/workspace pair every scoped statement declares. */
export interface PersistenceScope {
  owner: string;
  workspace: string;
}

export interface ConversationPersistence {
  saveConversation(c: Conversation): Promise<void>;
  /** Hard cascade delete: the conversation + its messages + summaries, so a
   * deleted conversation is inaccessible after restart. */
  deleteConversation(id: string): Promise<void>;
  /**
   * Scope is supplied by the caller because it cannot be recovered.
   *
   * Under FORCE ROW LEVEL SECURITY a connection that has not declared its scope
   * sees no rows at all, so the parent conversation cannot be read to learn it.
   * The database re-checks the row against the declared scope (`WITH CHECK`),
   * so a wrong scope is a hard write failure rather than a cross-tenant write.
   */
  saveMessage(m: Message, scope: PersistenceScope): Promise<void>;
  saveSummary(s: Summary, scope: PersistenceScope): Promise<void>;
  /** Hydrate durable conversations + their messages (in order) + summaries. */
  loadDurable(): Promise<{ conversations: Conversation[]; messages: Message[]; summaries: Summary[] }>;
}

// ── Memory items (workspace facts / user prefs) ──────────────────────────────
export interface MemoryItemPersistence {
  saveMemoryItem(item: MemoryItem): Promise<void>;
  loadMemoryItems(): Promise<MemoryItem[]>;
}

// ── RAG indexes ──────────────────────────────────────────────────────────────
export interface PersistedIndexRecord {
  id: string;
  workspaceId: string;
  ownerScope: string;
  sourceType: string;
  root: string;
  /** Lifecycle of the LATEST candidate — not what production retrieval serves. */
  state: string;
  /** Version authorised for production retrieval; undefined when none is. */
  approvedVersion?: number;
  version: number;
  embeddingModel: string;
  embeddingVersion: string;
  createdAt: number;
  updatedAt: number;
}

export interface PersistedChunk {
  id: string;
  indexId: string;
  workspaceId: string;
  filePath: string;
  language: string;
  symbol?: string;
  startLine: number;
  endLine: number;
  contentHash: string;
  embeddingModel: string;
  embeddingVersion: string;
  indexedAt: number;
  text: string;
  vector: number[];
}

export interface RagIndexPersistence {
  saveIndex(rec: PersistedIndexRecord): Promise<void>;
  deleteIndex(id: string): Promise<void>;
  setIndexState(id: string, state: string, updatedAt: number): Promise<void>;
  /**
   * Atomically replace the persisted chunk set for a set of files within one
   * index: `changed` files' chunks are rewritten, `deletedFiles` are removed, and
   * the index version is bumped — all in one transaction. A failure leaves the
   * previous persisted version intact (never a partial write).
   */
  /**
   * Scope is carried for the same reason `saveMessage` carries it: `index_chunks`
   * is row-level-security protected, and an `indexId` cannot be resolved to a
   * scope by reading first — an undeclared connection sees no rows at all.
   */
  commitSync(indexId: string, version: number, changed: PersistedChunk[], changedFiles: string[], deletedFiles: string[], updatedAt: number, scope: PersistenceScope): Promise<void>;
  /**
   * Promote (or clear, with `null`) the version authorised for production
   * retrieval. Independent of `state`: advancing a candidate must never move this
   * pointer, and demoting a candidate's lifecycle must never revoke it.
   */
  setApprovedVersion(id: string, approvedVersion: number | null, updatedAt: number): Promise<void>;
  loadIndexes(): Promise<PersistedIndexRecord[]>;
  /** Chunks for ONE version. Never load an index_id across versions. */
  loadChunks(indexId: string, indexVersion: number): Promise<PersistedChunk[]>;
}

// ── Embedding cache ──────────────────────────────────────────────────────────
export interface EmbeddingCachePersistence {
  /** Look up a cached vector keyed by (model, version, contentHash) — an
   * embedding from one model/version is NEVER returned for another. */
  getEmbedding(model: string, version: string, contentHash: string): Promise<number[] | undefined>;
  putEmbedding(model: string, version: string, contentHash: string, vector: number[]): Promise<void>;
  pruneOlderThan(cutoffMs: number): Promise<number>;
}

// ── Workspaces ───────────────────────────────────────────────────────────────
export interface PersistedWorkspace {
  id: string;
  ownerScope: string;
  workspaceScope: string;
  name: string;
  root: string;
  gitRepo?: string;
  gitBranch?: string;
  memoryMode: string;
  indexId?: string;
  providerPreferences?: string;
  permissions?: string;
  lastSyncAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspacePersistence {
  saveWorkspace(w: PersistedWorkspace): Promise<void>;
  deleteWorkspace(id: string): Promise<void>;
  loadWorkspaces(): Promise<PersistedWorkspace[]>;
}

// ── Operational data foundation (durable metadata only — NEVER prompts,
//    completions, source, diffs, tokens, secrets, credentials, or raw paths) ────

export interface DurableAuditEvent {
  eventId: string;
  correlationId: string;
  causationId: string | null;
  seq: number;
  type: string;
  at: number;
  durationMs?: number;
  component: string;
  outcome?: string;
  requestId?: string;
  /** Bounded, already-redacted metadata (JSON). */
  fieldsJson: string;
}

export interface DurableUsageRecord {
  usageId: string;
  correlationId: string;
  providerId: string;
  modelId: string;
  executionMode: string;
  policy: string;
  localOrCloud: string;
  at: number;
  outcome: string;
  costUsd?: number;
  costStatus: string;
  escalationReason?: string;
  /** Remaining already-redacted metadata (JSON). */
  fieldsJson: string;
}

export interface DurableIncident {
  incidentId: string;
  deduplicationKey: string;
  correlationId: string;
  firstSeenAt: number;
  lastSeenAt: number;
  occurrenceCount: number;
  state: string;
  severity: string;
  affectedJson: string;
  lastDeliveryStatus: string;
  resolutionJson?: string;
}

export interface DurableRecoveryEvent {
  id: string;
  recoveryId: string;
  correlationId: string;
  incidentId?: string;
  type: string;
  at: number;
  outcome?: string;
  fieldsJson: string;
}

export interface DurableBudgetScope {
  scopeId: string;
  kind: string;
  scopeKeyName: string;
  hardLimitUsd: number;
  spentUsd: number;
  reservedUsd: number;
  periodStart: number;
  updatedAt: number;
}

export interface DurableReservation {
  reservationId: string;
  amountUsd: number;
  scopeIdsJson: string;
  correlationId: string;
  providerId: string;
  modelId: string;
  createdAt: number;
  expiresAt: number;
  status: string;
}

export interface OperationalCounts {
  auditEvents: number;
  usageRecords: number;
  incidents: number;
  recoveryEvents: number;
  reservations: number;
  agentRuns?: number;
  agentRunEvents?: number;
  agentRunTombstones?: number;
  agentRunChildren?: number;
}

export type DurableAgentRunState =
  | 'IDLE'
  | 'PLANNING'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'STALE'
  | 'FAILED'
  | 'CANCELLED';

export type DurableAgentApprovalLifecycle =
  | 'NOT_REQUESTED'
  | 'PENDING_DISPLAY'
  | 'DISPLAYED'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'INVALIDATED'
  | 'LOST_ON_RESTART'
  | 'CONSUMED';

export type DurableAgentRecoveryClass =
  | 'NONE'
  | 'REPROPOSAL_ALLOWED'
  | 'REPROPOSAL_REQUIRED'
  | 'TERMINAL_NO_RECOVERY'
  // Recovery opportunity consumed by a linked successor; history stays trusted.
  | 'SUCCESSOR_CREATED'
  | 'WORKSPACE_MISMATCH'
  | 'POLICY_CHANGED'
  | 'SNAPSHOT_CHANGED'
  | 'RECIPE_DISABLED'
  | 'AUTHORIZATION_LOST'
  | 'INTERRUPTED_EXECUTION'
  | 'RETENTION_REMOVED'
  | 'SCHEMA_INCOMPATIBLE';

export interface DurableAgentRun {
  runId: string;
  correlationId: string;
  externalRequestRef?: string;
  activationRef: string;
  workspaceIdentity: string;
  workspaceRef: string;
  recipeId: string;
  recipePolicyVersion: string;
  proposalFingerprint: string;
  proposalHash: string;
  snapshotId: string;
  snapshotManifestDigest: string;
  executableDigest: string;
  containmentUnit?: string;
  containmentBinding?: string;
  state: DurableAgentRunState;
  requestedAt: number;
  proposalAt?: number;
  approvalDisplayedAt?: number;
  approvalDecisionAt?: number;
  executionStartedAt?: number;
  terminalAt?: number;
  expiresAt: number;
  timeoutMs: number;
  outputLimitBytes: number;
  mutationClassification: string;
  networkPolicy: string;
  expectedEffectsJson: string;
  previewJson?: string;
  resultJson?: string;
  errorJson?: string;
  exitCode?: number | null;
  signal?: string;
  failureCode?: string;
  interruptionClassification?: string;
  approvalLifecycleVersion: number;
  approvalLifecycle: DurableAgentApprovalLifecycle;
  approvalRequestedAt?: number;
  approvalExpiresAt?: number;
  approvalDecisionType?: 'APPROVED' | 'REJECTED';
  approvalInvalidationReason?: string;
  approvalActorRef?: string;
  recoveryClass: DurableAgentRecoveryClass;
  recoveryEligible: boolean;
  recoveryReason?: string;
  recoverySourceRunId?: string;
  successorRunId?: string;
  reproposalAt?: number;
  recoveryAttemptCount: number;
  lastRecoveryRequestId?: string;
  recoveryTerminalReason?: string;
  auditSeq: number;
  schemaVersion: number;
  version: number;
  reconciliationOwner?: string;
  reconciliationLeaseUntil?: number;
  reconciliationFence: number;
  updatedAt: number;
  // ── Opaque versioned domain payload ────────────────────────────────────────
  // The core journal validates SHAPE (kind present ⇒ version present, valid JSON,
  // within size limit, redacted) and nothing else. It never interprets these —
  // that is the boundary that keeps coding concerns out of every agent run.
  domainKind?: string;
  domainSchemaVersion?: number;
  domainPayloadJson?: string;
}

export interface AgentRunReconciliationClaim {
  runId: string;
  owner: string;
  fence: number;
  leaseUntil: number;
  version: number;
}

// ── Child operations ─────────────────────────────────────────────────────────
//
// A parent run's `agent_run_events` log records what happened TO THE PARENT. It
// cannot represent an operation that has its own lifecycle, its own terminal
// evidence, and its own ability to be cancelled or interrupted independently —
// which is exactly what each consequential step of a governed coding run is.
//
// Children are therefore rows, not events. The parent may not reach a terminal
// success while a REQUIRED child is still non-terminal; that rule is the whole
// reason the table exists.

export type DurableChildState =
  /** Written before dispatch. Proves no work was sent. Nothing transitions INTO it. */
  | 'created'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  /** Process died while this child was live. Deliberately NOT `failed`: the outcome
   * is unknown rather than known-bad, and a new child — never a rewrite of this one
   * — is how work resumes. */
  | 'interrupted';

export const DURABLE_CHILD_TERMINAL_STATES: ReadonlySet<DurableChildState> = new Set([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

/**
 * Legal child transitions. Fail closed: anything absent is refused.
 *
 * `created → running` is the ONLY way work begins, and `created` has no path to any
 * success state — a child that was never dispatched cannot have succeeded. Terminal
 * states have no outgoing edges at all: resuming interrupted work means a NEW child,
 * never the rewriting of one whose outcome was never observed.
 */
const LEGAL_CHILD: Record<DurableChildState, readonly DurableChildState[]> = {
  created: ['running', 'failed', 'interrupted'],
  running: ['cancelling', 'completed', 'failed', 'interrupted'],
  cancelling: ['cancelled', 'failed', 'interrupted'],
  completed: [],
  failed: [],
  cancelled: [],
  interrupted: [],
};

export function isLegalChildTransition(from: DurableChildState, to: DurableChildState): boolean {
  return (LEGAL_CHILD[from] ?? []).includes(to);
}

/** Why a child became terminal. Replaces a generic `success` boolean: terminal truth
 * is state + evidence, and a boolean would let those two disagree. */
export type DurableChildTerminalCategory =
  | 'observed_success'
  | 'observed_failure'
  | 'cancellation_confirmed'
  | 'orphaned_before_dispatch'
  | 'interrupted_by_restart'
  | 'outcome_unverified';

export interface DurableAgentRunChild {
  childId: string;
  runId: string;
  /** Explicit operation kind. Never collapsed into a generic step. */
  kind: string;
  /** Distinguishes repeated occurrences of one kind (repair attempt 1, 2, …) and
   * backs the (run_id, kind, attempt) uniqueness constraint. */
  attempt: number;
  state: DurableChildState;
  /** A required child blocks parent completion until terminal AND acceptable. */
  required: boolean;
  revision: number;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  terminalCategory?: DurableChildTerminalCategory;
  terminalEvidenceJson?: string;
  cancellationRequestedAt?: number;
  cancellationConfirmedAt?: number;
  errorJson?: string;
  metadataJson?: string;
  schemaVersion: number;
  updatedAt: number;
}

export type AgentRunChildWriteFailure =
  | 'UNKNOWN_PARENT'
  | 'PARENT_TERMINAL'
  | 'DUPLICATE_CHILD'
  | 'UNKNOWN_CHILD'
  | 'STALE_REVISION'
  | 'ILLEGAL_TRANSITION'
  | 'TERMINAL_CHILD_IMMUTABLE'
  | 'PAYLOAD_TOO_LARGE';

export type AgentRunChildWriteResult =
  | { ok: true; child: DurableAgentRunChild }
  | { ok: false; code: AgentRunChildWriteFailure; current?: DurableAgentRunChild };

export interface AgentRunChildTransitionInput {
  childId: string;
  /** Optimistic concurrency. The caller states what it believes it is updating. */
  expectedRevision: number;
  nextState: DurableChildState;
  at: number;
  startedAt?: number;
  endedAt?: number;
  terminalCategory?: DurableChildTerminalCategory;
  terminalEvidenceJson?: string;
  cancellationRequestedAt?: number;
  cancellationConfirmedAt?: number;
  errorJson?: string;
  metadataJson?: string;
}

export interface AgentRunChildPersistence {
  insertAgentRunChild(child: DurableAgentRunChild): Promise<AgentRunChildWriteResult>;
  transitionAgentRunChild(input: AgentRunChildTransitionInput): Promise<AgentRunChildWriteResult>;
  loadAgentRunChildren(runId: string): Promise<DurableAgentRunChild[]>;
  loadAgentRunChild(childId: string): Promise<DurableAgentRunChild | undefined>;
}

export interface DurableAgentRunTombstone {
  tombstoneId: string;
  runId: string;
  workspaceIdentity: string;
  recipeId: string;
  finalState: DurableAgentRunState;
  terminalAt: number;
  deletedAt: number;
  deletionReason: string;
  finalAuditSeq: number;
  eventCount: number;
  recoverySourceRunId?: string;
  successorRunId?: string;
  schemaVersion: number;
}

export interface DurableAgentRunEvent {
  eventId: string;
  runId: string;
  seq: number;
  at: number;
  type: string;
  priorState?: DurableAgentRunState;
  nextState: DurableAgentRunState;
  reason?: string;
  correlationId: string;
  source: 'API' | 'APPROVAL' | 'EXECUTION' | 'RECONCILIATION' | 'SHUTDOWN' | 'CLEANUP' | 'RECOVERY';
  schemaVersion: number;
}

export interface AgentRunTransitionInput {
  runId: string;
  expectedState?: DurableAgentRunState;
  nextState: DurableAgentRunState;
  at: number;
  source: DurableAgentRunEvent['source'];
  eventType: string;
  reason?: string;
  reconciliation?: {
    owner: string;
    fence: number;
    leaseValidAt: number;
    expectedVersion?: number;
  };
  patch?: Partial<Pick<DurableAgentRun, 'approvalDisplayedAt' | 'approvalDecisionAt' | 'executionStartedAt' | 'terminalAt' | 'resultJson' | 'errorJson' | 'exitCode' | 'signal' | 'failureCode' | 'interruptionClassification' | 'containmentUnit' | 'containmentBinding' | 'approvalLifecycle' | 'approvalRequestedAt' | 'approvalExpiresAt' | 'approvalDecisionType' | 'approvalInvalidationReason' | 'approvalActorRef' | 'recoveryClass' | 'recoveryEligible' | 'recoveryReason' | 'successorRunId' | 'reproposalAt' | 'recoveryAttemptCount' | 'lastRecoveryRequestId' | 'recoveryTerminalReason' | 'domainKind' | 'domainSchemaVersion' | 'domainPayloadJson'>>;
  eventId?: string;
}

export interface AgentRunReproposalInput {
  sourceRunId: string;
  sourceExpectedVersion: number;
  requestId: string;
  at: number;
  provenance: {
    workspaceIdentity: string;
    allowedRecipes: readonly string[];
    eventDigest: string;
    highestSeq: number;
  };
  successor: DurableAgentRun;
  createdEvent: DurableAgentRunEvent;
  proposalEvent: DurableAgentRunEvent;
}

export type AgentRunReproposalResult =
  | { ok: true; created: true; successor: DurableAgentRun }
  | { ok: true; created: false; successor: DurableAgentRun }
  | { ok: false; code: 'UNKNOWN_SOURCE' | 'SOURCE_NOT_TERMINAL' | 'SOURCE_UNDER_RECONCILIATION' | 'ACTIVE_SUCCESSOR_EXISTS' | 'SOURCE_VERSION_CHANGED' | 'SOURCE_PROVENANCE_FAILED' | 'RECOVERY_EVENT_ID_COLLISION' | 'RECOVERY_EVENT_CONTENT_MISMATCH' | 'RECOVERY_EVENT_SEQUENCE_CONFLICT' | 'RECOVERY_EVENT_INSERT_FAILED' | 'PARTIAL_FAILURE' };

export interface AgentRunFencedEventInput {
  runId: string;
  expectedState?: DurableAgentRunState;
  at: number;
  source: 'RECONCILIATION';
  eventType: string;
  reason?: string;
  reconciliation: {
    owner: string;
    fence: number;
    leaseValidAt: number;
    expectedVersion: number;
  };
  eventId?: string;
}

export interface AgentRunJournalPersistence extends AgentRunChildPersistence {
  insertAgentRun(run: DurableAgentRun, createdEvent: DurableAgentRunEvent): Promise<void>;
  appendAgentRunEvent(event: Omit<DurableAgentRunEvent, 'seq'>): Promise<void>;
  appendAgentRunEventUnderFence(input: AgentRunFencedEventInput): Promise<AgentRunReconciliationClaim | undefined>;
  transitionAgentRun(input: AgentRunTransitionInput): Promise<boolean>;
  reproposeAgentRun(input: AgentRunReproposalInput): Promise<AgentRunReproposalResult>;
  loadAgentRuns(limit?: number): Promise<DurableAgentRun[]>;
  loadAgentRun(runId: string): Promise<DurableAgentRun | undefined>;
  loadAgentRunEvents(runId: string, limit?: number): Promise<DurableAgentRunEvent[]>;
  claimAgentRunReconciliation(runId: string, owner: string, leaseUntil: number, now: number): Promise<AgentRunReconciliationClaim | undefined>;
  renewAgentRunReconciliation(runId: string, owner: string, fence: number, leaseUntil: number, now: number): Promise<AgentRunReconciliationClaim | undefined>;
  pruneAgentRuns(cutoff: number, batchSize: number, now: number): Promise<{ runs: number; events: number }>;
  loadAgentRunTombstones(limit?: number): Promise<DurableAgentRunTombstone[]>;
}

/** Durable persistence for operational metadata. Append-only where noted; incident
 * + budget rows are mutable-by-key. Retention prunes by age. */
export interface OperationalPersistence {
  appendAuditEvent(e: DurableAuditEvent): Promise<void>; // idempotent by eventId
  recentAuditEvents(limit: number): Promise<DurableAuditEvent[]>;
  auditByCorrelation(correlationId: string, limit?: number): Promise<DurableAuditEvent[]>;

  appendUsageRecord(r: DurableUsageRecord): Promise<void>;
  recentUsageRecords(limit: number): Promise<DurableUsageRecord[]>;

  upsertIncident(i: DurableIncident): Promise<void>;
  listIncidents(limit: number): Promise<DurableIncident[]>;

  appendRecoveryEvent(e: DurableRecoveryEvent): Promise<void>;

  saveBudgetScope(s: DurableBudgetScope): Promise<void>;
  loadBudgetScopes(): Promise<DurableBudgetScope[]>;
  saveReservation(r: DurableReservation): Promise<void>;
  removeReservation(reservationId: string): Promise<void>;
  loadReservations(): Promise<DurableReservation[]>;

  /** Age-based retention per store; returns rows deleted per table. */
  pruneOperational(cutoffs: { auditBefore: number; usageBefore: number; incidentsBefore: number; recoveryBefore: number }): Promise<{ audit: number; usage: number; incidents: number; recovery: number }>;
  operationalCounts(): Promise<OperationalCounts>;
}

/** A composite durable store exposing every persistence facet + health. */
export interface DurableStore extends ConversationPersistence, MemoryItemPersistence, RagIndexPersistence, EmbeddingCachePersistence, WorkspacePersistence, OperationalPersistence, AgentRunJournalPersistence {
  health(): Promise<PersistenceHealth>;
  integrityCheck(): Promise<string>;
  close(): Promise<void>;
}

/** Scope guard used by adapters to build scoped WHERE clauses. */
export function scopeKey(scope: Scope): { owner: string; workspace: string } {
  return { owner: scope.owner, workspace: scope.workspace };
}
