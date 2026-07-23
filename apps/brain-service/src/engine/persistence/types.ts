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
  /** e.g. 'applied', 'pending', 'mismatch', 'failed'. */
  migrationState: string;
  detail?: string;
}

// ── Conversation memory ──────────────────────────────────────────────────────
export interface ConversationPersistence {
  saveConversation(c: Conversation): void;
  /** Hard cascade delete: the conversation + its messages + summaries, so a
   * deleted conversation is inaccessible after restart. */
  deleteConversation(id: string): void;
  saveMessage(m: Message): void;
  saveSummary(s: Summary): void;
  /** Hydrate durable conversations + their messages (in order) + summaries. */
  loadDurable(): { conversations: Conversation[]; messages: Message[]; summaries: Summary[] };
}

// ── Memory items (workspace facts / user prefs) ──────────────────────────────
export interface MemoryItemPersistence {
  saveMemoryItem(item: MemoryItem): void;
  loadMemoryItems(): MemoryItem[];
}

// ── RAG indexes ──────────────────────────────────────────────────────────────
export interface PersistedIndexRecord {
  id: string;
  workspaceId: string;
  ownerScope: string;
  sourceType: string;
  root: string;
  state: string;
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
  saveIndex(rec: PersistedIndexRecord): void;
  deleteIndex(id: string): void;
  setIndexState(id: string, state: string, updatedAt: number): void;
  /**
   * Atomically replace the persisted chunk set for a set of files within one
   * index: `changed` files' chunks are rewritten, `deletedFiles` are removed, and
   * the index version is bumped — all in one transaction. A failure leaves the
   * previous persisted version intact (never a partial write).
   */
  commitSync(indexId: string, version: number, changed: PersistedChunk[], changedFiles: string[], deletedFiles: string[], updatedAt: number): void;
  loadIndexes(): PersistedIndexRecord[];
  loadChunks(indexId: string): PersistedChunk[];
}

// ── Embedding cache ──────────────────────────────────────────────────────────
export interface EmbeddingCachePersistence {
  /** Look up a cached vector keyed by (model, version, contentHash) — an
   * embedding from one model/version is NEVER returned for another. */
  getEmbedding(model: string, version: string, contentHash: string): number[] | undefined;
  putEmbedding(model: string, version: string, contentHash: string, vector: number[]): void;
  pruneOlderThan(cutoffMs: number): number;
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
  saveWorkspace(w: PersistedWorkspace): void;
  deleteWorkspace(id: string): void;
  loadWorkspaces(): PersistedWorkspace[];
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
  auditSeq: number;
  schemaVersion: number;
  version: number;
  reconciliationOwner?: string;
  reconciliationLeaseUntil?: number;
  reconciliationFence: number;
  updatedAt: number;
}

export interface AgentRunReconciliationClaim {
  runId: string;
  owner: string;
  fence: number;
  leaseUntil: number;
  version: number;
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
  source: 'API' | 'APPROVAL' | 'EXECUTION' | 'RECONCILIATION' | 'SHUTDOWN' | 'CLEANUP';
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
  patch?: Partial<Pick<DurableAgentRun, 'approvalDisplayedAt' | 'approvalDecisionAt' | 'executionStartedAt' | 'terminalAt' | 'resultJson' | 'errorJson' | 'exitCode' | 'signal' | 'failureCode' | 'interruptionClassification' | 'containmentUnit' | 'containmentBinding'>>;
  eventId?: string;
}

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

export interface AgentRunJournalPersistence {
  insertAgentRun(run: DurableAgentRun, createdEvent: DurableAgentRunEvent): void;
  appendAgentRunEvent(event: Omit<DurableAgentRunEvent, 'seq'>): void;
  appendAgentRunEventUnderFence(input: AgentRunFencedEventInput): AgentRunReconciliationClaim | undefined;
  transitionAgentRun(input: AgentRunTransitionInput): boolean;
  loadAgentRuns(limit?: number): DurableAgentRun[];
  loadAgentRun(runId: string): DurableAgentRun | undefined;
  loadAgentRunEvents(runId: string, limit?: number): DurableAgentRunEvent[];
  claimAgentRunReconciliation(runId: string, owner: string, leaseUntil: number, now: number): AgentRunReconciliationClaim | undefined;
  renewAgentRunReconciliation(runId: string, owner: string, fence: number, leaseUntil: number, now: number): AgentRunReconciliationClaim | undefined;
  pruneAgentRuns(cutoff: number, batchSize: number, now: number): { runs: number; events: number };
  loadAgentRunTombstones(limit?: number): DurableAgentRunTombstone[];
}

/** Durable persistence for operational metadata. Append-only where noted; incident
 * + budget rows are mutable-by-key. Retention prunes by age. */
export interface OperationalPersistence {
  appendAuditEvent(e: DurableAuditEvent): void; // idempotent by eventId
  recentAuditEvents(limit: number): DurableAuditEvent[];
  auditByCorrelation(correlationId: string, limit?: number): DurableAuditEvent[];

  appendUsageRecord(r: DurableUsageRecord): void;
  recentUsageRecords(limit: number): DurableUsageRecord[];

  upsertIncident(i: DurableIncident): void;
  listIncidents(limit: number): DurableIncident[];

  appendRecoveryEvent(e: DurableRecoveryEvent): void;

  saveBudgetScope(s: DurableBudgetScope): void;
  loadBudgetScopes(): DurableBudgetScope[];
  saveReservation(r: DurableReservation): void;
  removeReservation(reservationId: string): void;
  loadReservations(): DurableReservation[];

  /** Age-based retention per store; returns rows deleted per table. */
  pruneOperational(cutoffs: { auditBefore: number; usageBefore: number; incidentsBefore: number; recoveryBefore: number }): { audit: number; usage: number; incidents: number; recovery: number };
  operationalCounts(): OperationalCounts;
}

/** A composite durable store exposing every persistence facet + health. */
export interface DurableStore extends ConversationPersistence, MemoryItemPersistence, RagIndexPersistence, EmbeddingCachePersistence, WorkspacePersistence, OperationalPersistence, AgentRunJournalPersistence {
  health(): PersistenceHealth;
  integrityCheck(): string;
  close(): void;
}

/** Scope guard used by adapters to build scoped WHERE clauses. */
export function scopeKey(scope: Scope): { owner: string; workspace: string } {
  return { owner: scope.owner, workspace: scope.workspace };
}
