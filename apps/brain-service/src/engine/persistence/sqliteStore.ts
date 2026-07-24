/**
 * MigraAI Engine — SQLite durable adapter (node:sqlite).
 *
 * The first real {@link DurableStore}: embedded, transactional, zero-dependency —
 * right for the local single-process engine. Vectors are stored as Float32 BLOBs;
 * a Postgres+pgvector adapter can implement the same interfaces for a hosted
 * deployment.
 *
 * Fail-closed: if the database cannot be opened or the schema version is ahead of
 * this build (incompatible), the store reports `unavailable`/mismatch and the
 * engine must NOT come up "ready" — it never silently serves empty durable state.
 */

import { DatabaseSync } from 'node:sqlite';
import type {
  ConversationPersistence, MemoryItemPersistence, RagIndexPersistence, EmbeddingCachePersistence,
  DurableStore, PersistenceHealth, PersistedChunk, PersistedIndexRecord,
  DurableAuditEvent, DurableUsageRecord, DurableIncident, DurableRecoveryEvent, DurableBudgetScope, DurableReservation, OperationalCounts,
  DurableAgentRun, DurableAgentRunEvent, AgentRunTransitionInput, DurableAgentRunState, AgentRunReconciliationClaim, DurableAgentRunTombstone, AgentRunFencedEventInput, AgentRunReproposalInput, AgentRunReproposalResult,
} from './types.js';
import type { Conversation, Message, Summary, MemoryItem } from '../memory/conversationStore.js';
import { validateRecoverySourceProvenance } from '../recoverySourceProvenance.js';

export const SCHEMA_VERSION = 5;

export type AgentRunReproposalFaultPhase =
  | 'recovery-status source read'
  | 'source event read'
  | 'provenance revalidation'
  | 'idempotency lookup'
  | 'successor run insert'
  | 'successor proposal/event insert'
  | 'source lineage update'
  | 'source recovery event insert'
  | 'successor lineage event insert'
  | 'transaction commit';

class AgentRunReproposalFault extends Error {
  constructor(readonly phase: AgentRunReproposalFaultPhase) {
    super(`injected agent reproposal sqlite fault: ${phase}`);
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, owner_scope TEXT, workspace_scope TEXT, title TEXT,
  memory_mode TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);
CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT, status TEXT,
  request_id TEXT, model_id TEXT, provider_id TEXT, created_at INTEGER, durable INTEGER,
  supersedes_id TEXT, seq INTEGER);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON conversation_messages(conversation_id, seq);
CREATE TABLE IF NOT EXISTS conversation_summaries (
  id TEXT PRIMARY KEY, conversation_id TEXT, source_from_message_id TEXT,
  source_to_message_id TEXT, summary_json TEXT, version INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY, owner_scope TEXT, workspace_scope TEXT, category TEXT,
  content TEXT, confidence REAL, source_type TEXT, source_id TEXT, expires_at INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS workspace_indexes (
  id TEXT PRIMARY KEY, workspace_id TEXT, owner_scope TEXT, source_type TEXT, root TEXT,
  state TEXT, version INTEGER, embedding_model TEXT, embedding_version TEXT, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS index_chunks (
  id TEXT PRIMARY KEY, index_id TEXT, workspace_id TEXT, file_path TEXT, language TEXT, symbol TEXT,
  start_line INTEGER, end_line INTEGER, content_hash TEXT, embedding_model TEXT, embedding_version TEXT,
  indexed_at INTEGER, text TEXT, vector BLOB);
CREATE INDEX IF NOT EXISTS idx_chunk_file ON index_chunks(index_id, file_path);
CREATE TABLE IF NOT EXISTS index_versions (index_id TEXT, version INTEGER, committed_at INTEGER, PRIMARY KEY(index_id, version));
CREATE TABLE IF NOT EXISTS embedding_cache (
  model TEXT, version TEXT, content_hash TEXT, dims INTEGER, vector BLOB, created_at INTEGER,
  PRIMARY KEY(model, version, content_hash));
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, owner_scope TEXT, workspace_scope TEXT, name TEXT, root TEXT,
  git_repo TEXT, git_branch TEXT, memory_mode TEXT, index_id TEXT, provider_preferences TEXT,
  permissions TEXT, last_sync_at INTEGER, created_at INTEGER, updated_at INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ws_scope ON workspaces(owner_scope, workspace_scope);

-- Operational Data Foundation (v2): durable METADATA only (never prompts,
-- completions, source, diffs, tokens, secrets, or raw paths).
CREATE TABLE IF NOT EXISTS op_audit_events (
  event_id TEXT PRIMARY KEY, correlation_id TEXT, causation_id TEXT, seq INTEGER,
  type TEXT, at INTEGER, duration_ms INTEGER, component TEXT, outcome TEXT, request_id TEXT, fields_json TEXT);
CREATE INDEX IF NOT EXISTS idx_op_audit_corr ON op_audit_events(correlation_id, seq);
CREATE INDEX IF NOT EXISTS idx_op_audit_at ON op_audit_events(at);
CREATE TABLE IF NOT EXISTS op_usage_records (
  usage_id TEXT PRIMARY KEY, correlation_id TEXT, provider_id TEXT, model_id TEXT,
  execution_mode TEXT, policy TEXT, local_or_cloud TEXT, at INTEGER, outcome TEXT,
  cost_usd REAL, cost_status TEXT, escalation_reason TEXT, fields_json TEXT);
CREATE INDEX IF NOT EXISTS idx_op_usage_at ON op_usage_records(at);
CREATE INDEX IF NOT EXISTS idx_op_usage_lc ON op_usage_records(local_or_cloud, at);
CREATE TABLE IF NOT EXISTS op_incidents (
  incident_id TEXT PRIMARY KEY, dedup_key TEXT, correlation_id TEXT, first_seen_at INTEGER,
  last_seen_at INTEGER, occurrence_count INTEGER, state TEXT, severity TEXT,
  affected_json TEXT, last_delivery_status TEXT, resolution_json TEXT);
CREATE INDEX IF NOT EXISTS idx_op_incident_seen ON op_incidents(last_seen_at);
CREATE TABLE IF NOT EXISTS op_recovery_events (
  id TEXT PRIMARY KEY, recovery_id TEXT, correlation_id TEXT, incident_id TEXT,
  type TEXT, at INTEGER, outcome TEXT, fields_json TEXT);
CREATE INDEX IF NOT EXISTS idx_op_recovery_at ON op_recovery_events(at);
CREATE TABLE IF NOT EXISTS op_budget_scopes (
  scope_id TEXT PRIMARY KEY, kind TEXT, scope_key TEXT, hard_limit_usd REAL,
  spent_usd REAL, reserved_usd REAL, period_start INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS op_reservations (
  reservation_id TEXT PRIMARY KEY, amount_usd REAL, scope_ids_json TEXT, correlation_id TEXT,
  provider_id TEXT, model_id TEXT, created_at INTEGER, expires_at INTEGER, status TEXT);

-- Agent Mode durable run journal (v3): sanitized authoritative state +
-- append-only lifecycle events. Never stores bootstrap secrets, activation
-- capabilities, raw approval tokens, raw stdout/stderr, process handles, DBus
-- handles, private keys, or production-review data.
CREATE TABLE IF NOT EXISTS agent_runs (
  run_id TEXT PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  external_request_ref TEXT,
  activation_ref TEXT NOT NULL,
  workspace_identity TEXT NOT NULL,
  workspace_ref TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  recipe_policy_version TEXT NOT NULL,
  proposal_fingerprint TEXT NOT NULL,
  proposal_hash TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  snapshot_manifest_digest TEXT NOT NULL,
  executable_digest TEXT NOT NULL,
  containment_unit TEXT,
  containment_binding TEXT,
  state TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  proposal_at INTEGER,
  approval_displayed_at INTEGER,
  approval_decision_at INTEGER,
  execution_started_at INTEGER,
  terminal_at INTEGER,
  expires_at INTEGER NOT NULL,
  timeout_ms INTEGER NOT NULL,
  output_limit_bytes INTEGER NOT NULL,
  mutation_classification TEXT NOT NULL,
  network_policy TEXT NOT NULL,
  expected_effects_json TEXT NOT NULL,
  preview_json TEXT,
  result_json TEXT,
  error_json TEXT,
  exit_code INTEGER,
  signal TEXT,
  failure_code TEXT,
  interruption_classification TEXT,
  approval_lifecycle_version INTEGER NOT NULL DEFAULT 1,
  approval_lifecycle TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
  approval_requested_at INTEGER,
  approval_expires_at INTEGER,
  approval_decision_type TEXT,
  approval_invalidation_reason TEXT,
  approval_actor_ref TEXT,
  recovery_class TEXT NOT NULL DEFAULT 'NONE',
  recovery_eligible INTEGER NOT NULL DEFAULT 0,
  recovery_reason TEXT,
  recovery_source_run_id TEXT,
  successor_run_id TEXT,
  reproposal_at INTEGER,
  recovery_attempt_count INTEGER NOT NULL DEFAULT 0,
  last_recovery_request_id TEXT,
  recovery_terminal_reason TEXT,
  audit_seq INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  reconciliation_owner TEXT,
  reconciliation_lease_until INTEGER,
  reconciliation_fence INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_state ON agent_runs(state, updated_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace ON agent_runs(workspace_identity, updated_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_terminal ON agent_runs(terminal_at, state);
CREATE INDEX IF NOT EXISTS idx_agent_runs_nonterminal ON agent_runs(state, reconciliation_lease_until, updated_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_reconciliation ON agent_runs(reconciliation_owner, reconciliation_fence, version, reconciliation_lease_until);
CREATE TABLE IF NOT EXISTS agent_run_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  at INTEGER NOT NULL,
  type TEXT NOT NULL,
  prior_state TEXT,
  next_state TEXT NOT NULL,
  reason TEXT,
  correlation_id TEXT NOT NULL,
  source TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  UNIQUE(run_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_agent_run_events_run ON agent_run_events(run_id, seq);
CREATE TABLE IF NOT EXISTS agent_run_tombstones (
  tombstone_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  workspace_identity TEXT NOT NULL,
  recipe_id TEXT NOT NULL,
  final_state TEXT NOT NULL,
  terminal_at INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL,
  deletion_reason TEXT NOT NULL,
  final_audit_seq INTEGER NOT NULL,
  event_count INTEGER NOT NULL,
  recovery_source_run_id TEXT,
  successor_run_id TEXT,
  schema_version INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_run_tombstones_deleted ON agent_run_tombstones(deleted_at);
`;

function toBlob(vec: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(vec).buffer);
}
function fromBlob(buf: Uint8Array): number[] {
  const f = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  return Array.from(f);
}

function clampLimit(n: number): number {
  return Math.max(1, Math.min(Math.floor(n) || 1, 5000));
}
// Row shapes + mappers for the operational tables (snake_case → typed record).
interface AuditRow { event_id: string; correlation_id: string; causation_id: string | null; seq: number; type: string; at: number; duration_ms: number | null; component: string; outcome: string | null; request_id: string | null; fields_json: string }
interface UsageRow { usage_id: string; correlation_id: string; provider_id: string; model_id: string; execution_mode: string; policy: string; local_or_cloud: string; at: number; outcome: string; cost_usd: number | null; cost_status: string; escalation_reason: string | null; fields_json: string }
interface IncidentRow { incident_id: string; dedup_key: string; correlation_id: string; first_seen_at: number; last_seen_at: number; occurrence_count: number; state: string; severity: string; affected_json: string; last_delivery_status: string; resolution_json: string | null }
interface BudgetScopeRow { scope_id: string; kind: string; scope_key: string; hard_limit_usd: number; spent_usd: number; reserved_usd: number; period_start: number; updated_at: number }
interface ReservationRow { reservation_id: string; amount_usd: number; scope_ids_json: string; correlation_id: string; provider_id: string; model_id: string; created_at: number; expires_at: number; status: string }
interface AgentRunRow {
  run_id: string; correlation_id: string; external_request_ref: string | null; activation_ref: string; workspace_identity: string; workspace_ref: string; recipe_id: string; recipe_policy_version: string; proposal_fingerprint: string; proposal_hash: string; snapshot_id: string; snapshot_manifest_digest: string; executable_digest: string; containment_unit: string | null; containment_binding: string | null; state: string; requested_at: number; proposal_at: number | null; approval_displayed_at: number | null; approval_decision_at: number | null; execution_started_at: number | null; terminal_at: number | null; expires_at: number; timeout_ms: number; output_limit_bytes: number; mutation_classification: string; network_policy: string; expected_effects_json: string; preview_json: string | null; result_json: string | null; error_json: string | null; exit_code: number | null; signal: string | null; failure_code: string | null; interruption_classification: string | null; approval_lifecycle_version: number; approval_lifecycle: string; approval_requested_at: number | null; approval_expires_at: number | null; approval_decision_type: string | null; approval_invalidation_reason: string | null; approval_actor_ref: string | null; recovery_class: string; recovery_eligible: number; recovery_reason: string | null; recovery_source_run_id: string | null; successor_run_id: string | null; reproposal_at: number | null; recovery_attempt_count: number; last_recovery_request_id: string | null; recovery_terminal_reason: string | null; audit_seq: number; schema_version: number; version: number; reconciliation_owner: string | null; reconciliation_lease_until: number | null; reconciliation_fence: number; updated_at: number;
}
interface AgentRunEventRow { event_id: string; run_id: string; seq: number; at: number; type: string; prior_state: string | null; next_state: string; reason: string | null; correlation_id: string; source: DurableAgentRunEvent['source']; schema_version: number }
interface AgentRunTombstoneRow { tombstone_id: string; run_id: string; workspace_identity: string; recipe_id: string; final_state: string; terminal_at: number; deleted_at: number; deletion_reason: string; final_audit_seq: number; event_count: number; recovery_source_run_id: string | null; successor_run_id: string | null; schema_version: number }
interface ExpectedColumn { type: string; notnull?: number; pk?: number; dflt?: string }
interface ExpectedIndex { name: string; table: string; columns: string[]; unique: boolean; partial?: string }
interface ExpectedForeignKey { table: string; foreignTable: string; columns: string[]; foreignColumns: string[]; onDelete: string }

const EXPECTED_SCHEMA_META_COLUMNS: Record<string, ExpectedColumn> = Object.freeze({
  key: { type: 'TEXT', pk: 1 },
  value: { type: 'TEXT' },
});

const EXPECTED_AGENT_TABLES: Record<string, Record<string, ExpectedColumn>> = Object.freeze({
  agent_runs: Object.freeze({
    run_id: { type: 'TEXT', pk: 1 },
    correlation_id: { type: 'TEXT', notnull: 1 },
    external_request_ref: { type: 'TEXT' },
    activation_ref: { type: 'TEXT', notnull: 1 },
    workspace_identity: { type: 'TEXT', notnull: 1 },
    workspace_ref: { type: 'TEXT', notnull: 1 },
    recipe_id: { type: 'TEXT', notnull: 1 },
    recipe_policy_version: { type: 'TEXT', notnull: 1 },
    proposal_fingerprint: { type: 'TEXT', notnull: 1 },
    proposal_hash: { type: 'TEXT', notnull: 1 },
    snapshot_id: { type: 'TEXT', notnull: 1 },
    snapshot_manifest_digest: { type: 'TEXT', notnull: 1 },
    executable_digest: { type: 'TEXT', notnull: 1 },
    containment_unit: { type: 'TEXT' },
    containment_binding: { type: 'TEXT' },
    state: { type: 'TEXT', notnull: 1 },
    requested_at: { type: 'INTEGER', notnull: 1 },
    proposal_at: { type: 'INTEGER' },
    approval_displayed_at: { type: 'INTEGER' },
    approval_decision_at: { type: 'INTEGER' },
    execution_started_at: { type: 'INTEGER' },
    terminal_at: { type: 'INTEGER' },
    expires_at: { type: 'INTEGER', notnull: 1 },
    timeout_ms: { type: 'INTEGER', notnull: 1 },
    output_limit_bytes: { type: 'INTEGER', notnull: 1 },
    mutation_classification: { type: 'TEXT', notnull: 1 },
    network_policy: { type: 'TEXT', notnull: 1 },
    expected_effects_json: { type: 'TEXT', notnull: 1 },
    preview_json: { type: 'TEXT' },
    result_json: { type: 'TEXT' },
    error_json: { type: 'TEXT' },
    exit_code: { type: 'INTEGER' },
    signal: { type: 'TEXT' },
    failure_code: { type: 'TEXT' },
    interruption_classification: { type: 'TEXT' },
    approval_lifecycle_version: { type: 'INTEGER', notnull: 1, dflt: '1' },
    approval_lifecycle: { type: 'TEXT', notnull: 1, dflt: "'NOT_REQUESTED'" },
    approval_requested_at: { type: 'INTEGER' },
    approval_expires_at: { type: 'INTEGER' },
    approval_decision_type: { type: 'TEXT' },
    approval_invalidation_reason: { type: 'TEXT' },
    approval_actor_ref: { type: 'TEXT' },
    recovery_class: { type: 'TEXT', notnull: 1, dflt: "'NONE'" },
    recovery_eligible: { type: 'INTEGER', notnull: 1, dflt: '0' },
    recovery_reason: { type: 'TEXT' },
    recovery_source_run_id: { type: 'TEXT' },
    successor_run_id: { type: 'TEXT' },
    reproposal_at: { type: 'INTEGER' },
    recovery_attempt_count: { type: 'INTEGER', notnull: 1, dflt: '0' },
    last_recovery_request_id: { type: 'TEXT' },
    recovery_terminal_reason: { type: 'TEXT' },
    audit_seq: { type: 'INTEGER', notnull: 1, dflt: '0' },
    schema_version: { type: 'INTEGER', notnull: 1 },
    version: { type: 'INTEGER', notnull: 1, dflt: '1' },
    reconciliation_owner: { type: 'TEXT' },
    reconciliation_lease_until: { type: 'INTEGER' },
    reconciliation_fence: { type: 'INTEGER', notnull: 1, dflt: '0' },
    updated_at: { type: 'INTEGER', notnull: 1 },
  }),
  agent_run_events: Object.freeze({
    event_id: { type: 'TEXT', pk: 1 },
    run_id: { type: 'TEXT', notnull: 1 },
    seq: { type: 'INTEGER', notnull: 1 },
    at: { type: 'INTEGER', notnull: 1 },
    type: { type: 'TEXT', notnull: 1 },
    prior_state: { type: 'TEXT' },
    next_state: { type: 'TEXT', notnull: 1 },
    reason: { type: 'TEXT' },
    correlation_id: { type: 'TEXT', notnull: 1 },
    source: { type: 'TEXT', notnull: 1 },
    schema_version: { type: 'INTEGER', notnull: 1 },
  }),
  agent_run_tombstones: Object.freeze({
    tombstone_id: { type: 'TEXT', pk: 1 },
    run_id: { type: 'TEXT', notnull: 1 },
    workspace_identity: { type: 'TEXT', notnull: 1 },
    recipe_id: { type: 'TEXT', notnull: 1 },
    final_state: { type: 'TEXT', notnull: 1 },
    terminal_at: { type: 'INTEGER', notnull: 1 },
    deleted_at: { type: 'INTEGER', notnull: 1 },
    deletion_reason: { type: 'TEXT', notnull: 1 },
    final_audit_seq: { type: 'INTEGER', notnull: 1 },
    event_count: { type: 'INTEGER', notnull: 1 },
    recovery_source_run_id: { type: 'TEXT' },
    successor_run_id: { type: 'TEXT' },
    schema_version: { type: 'INTEGER', notnull: 1 },
  }),
});

const EXPECTED_AGENT_INDEXES: readonly ExpectedIndex[] = Object.freeze([
  { table: 'agent_runs', name: 'idx_agent_runs_state', columns: ['state', 'updated_at'], unique: false },
  { table: 'agent_runs', name: 'idx_agent_runs_workspace', columns: ['workspace_identity', 'updated_at'], unique: false },
  { table: 'agent_runs', name: 'idx_agent_runs_terminal', columns: ['terminal_at', 'state'], unique: false },
  { table: 'agent_runs', name: 'idx_agent_runs_nonterminal', columns: ['state', 'reconciliation_lease_until', 'updated_at'], unique: false },
  { table: 'agent_runs', name: 'idx_agent_runs_reconciliation', columns: ['reconciliation_owner', 'reconciliation_fence', 'version', 'reconciliation_lease_until'], unique: false },
  { table: 'agent_runs', name: 'idx_agent_runs_recovery_source', columns: ['recovery_source_run_id', 'updated_at'], unique: false },
  { table: 'agent_runs', name: 'idx_agent_runs_active_successor', columns: ['recovery_source_run_id'], unique: true, partial: "recovery_source_run_id IS NOT NULL AND state NOT IN ('COMPLETED','REJECTED','EXPIRED','STALE','FAILED','CANCELLED')" },
  { table: 'agent_run_events', name: 'idx_agent_run_events_run', columns: ['run_id', 'seq'], unique: false },
  { table: 'agent_run_tombstones', name: 'idx_agent_run_tombstones_deleted', columns: ['deleted_at'], unique: false },
]);

const EXPECTED_AGENT_FOREIGN_KEYS: readonly ExpectedForeignKey[] = Object.freeze([
  { table: 'agent_run_events', foreignTable: 'agent_runs', columns: ['run_id'], foreignColumns: ['run_id'], onDelete: 'CASCADE' },
]);
function rowToAudit(r: AuditRow): DurableAuditEvent {
  return { eventId: r.event_id, correlationId: r.correlation_id, causationId: r.causation_id, seq: r.seq, type: r.type, at: r.at, durationMs: r.duration_ms ?? undefined, component: r.component, outcome: r.outcome ?? undefined, requestId: r.request_id ?? undefined, fieldsJson: r.fields_json };
}
function rowToUsage(r: UsageRow): DurableUsageRecord {
  return { usageId: r.usage_id, correlationId: r.correlation_id, providerId: r.provider_id, modelId: r.model_id, executionMode: r.execution_mode, policy: r.policy, localOrCloud: r.local_or_cloud, at: r.at, outcome: r.outcome, costUsd: r.cost_usd ?? undefined, costStatus: r.cost_status, escalationReason: r.escalation_reason ?? undefined, fieldsJson: r.fields_json };
}
function rowToIncident(r: IncidentRow): DurableIncident {
  return { incidentId: r.incident_id, deduplicationKey: r.dedup_key, correlationId: r.correlation_id, firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at, occurrenceCount: r.occurrence_count, state: r.state, severity: r.severity, affectedJson: r.affected_json, lastDeliveryStatus: r.last_delivery_status, resolutionJson: r.resolution_json ?? undefined };
}
function rowToBudgetScope(r: BudgetScopeRow): DurableBudgetScope {
  return { scopeId: r.scope_id, kind: r.kind, scopeKeyName: r.scope_key, hardLimitUsd: r.hard_limit_usd, spentUsd: r.spent_usd, reservedUsd: r.reserved_usd, periodStart: r.period_start, updatedAt: r.updated_at };
}
function rowToReservation(r: ReservationRow): DurableReservation {
  return { reservationId: r.reservation_id, amountUsd: r.amount_usd, scopeIdsJson: r.scope_ids_json, correlationId: r.correlation_id, providerId: r.provider_id, modelId: r.model_id, createdAt: r.created_at, expiresAt: r.expires_at, status: r.status };
}
function rowToAgentRun(r: AgentRunRow): DurableAgentRun {
  return {
    runId: r.run_id, correlationId: r.correlation_id, externalRequestRef: r.external_request_ref ?? undefined,
    activationRef: r.activation_ref, workspaceIdentity: r.workspace_identity, workspaceRef: r.workspace_ref,
    recipeId: r.recipe_id, recipePolicyVersion: r.recipe_policy_version, proposalFingerprint: r.proposal_fingerprint,
    proposalHash: r.proposal_hash, snapshotId: r.snapshot_id, snapshotManifestDigest: r.snapshot_manifest_digest,
    executableDigest: r.executable_digest, containmentUnit: r.containment_unit ?? undefined,
    containmentBinding: r.containment_binding ?? undefined, state: r.state as DurableAgentRunState,
    requestedAt: r.requested_at, proposalAt: r.proposal_at ?? undefined, approvalDisplayedAt: r.approval_displayed_at ?? undefined,
    approvalDecisionAt: r.approval_decision_at ?? undefined, executionStartedAt: r.execution_started_at ?? undefined,
    terminalAt: r.terminal_at ?? undefined, expiresAt: r.expires_at, timeoutMs: r.timeout_ms, outputLimitBytes: r.output_limit_bytes,
    mutationClassification: r.mutation_classification, networkPolicy: r.network_policy, expectedEffectsJson: r.expected_effects_json,
    previewJson: r.preview_json ?? undefined, resultJson: r.result_json ?? undefined, errorJson: r.error_json ?? undefined,
    exitCode: r.exit_code ?? undefined, signal: r.signal ?? undefined, failureCode: r.failure_code ?? undefined,
    interruptionClassification: r.interruption_classification ?? undefined,
    approvalLifecycleVersion: r.approval_lifecycle_version,
    approvalLifecycle: r.approval_lifecycle as DurableAgentRun['approvalLifecycle'],
    approvalRequestedAt: r.approval_requested_at ?? undefined,
    approvalExpiresAt: r.approval_expires_at ?? undefined,
    approvalDecisionType: (r.approval_decision_type as DurableAgentRun['approvalDecisionType']) ?? undefined,
    approvalInvalidationReason: r.approval_invalidation_reason ?? undefined,
    approvalActorRef: r.approval_actor_ref ?? undefined,
    recoveryClass: r.recovery_class as DurableAgentRun['recoveryClass'],
    recoveryEligible: r.recovery_eligible === 1,
    recoveryReason: r.recovery_reason ?? undefined,
    recoverySourceRunId: r.recovery_source_run_id ?? undefined,
    successorRunId: r.successor_run_id ?? undefined,
    reproposalAt: r.reproposal_at ?? undefined,
    recoveryAttemptCount: r.recovery_attempt_count,
    lastRecoveryRequestId: r.last_recovery_request_id ?? undefined,
    recoveryTerminalReason: r.recovery_terminal_reason ?? undefined,
    auditSeq: r.audit_seq, schemaVersion: r.schema_version,
    version: r.version, reconciliationOwner: r.reconciliation_owner ?? undefined, reconciliationLeaseUntil: r.reconciliation_lease_until ?? undefined,
    reconciliationFence: r.reconciliation_fence,
    updatedAt: r.updated_at,
  };
}
function rowToAgentRunTombstone(r: AgentRunTombstoneRow): DurableAgentRunTombstone {
  return {
    tombstoneId: r.tombstone_id, runId: r.run_id, workspaceIdentity: r.workspace_identity, recipeId: r.recipe_id,
    finalState: r.final_state as DurableAgentRunState, terminalAt: r.terminal_at, deletedAt: r.deleted_at,
    deletionReason: r.deletion_reason, finalAuditSeq: r.final_audit_seq, eventCount: r.event_count,
    recoverySourceRunId: r.recovery_source_run_id ?? undefined, successorRunId: r.successor_run_id ?? undefined,
    schemaVersion: r.schema_version,
  };
}
function rowToAgentRunEvent(r: AgentRunEventRow): DurableAgentRunEvent {
  return {
    eventId: r.event_id, runId: r.run_id, seq: r.seq, at: r.at, type: r.type,
    priorState: r.prior_state ? (r.prior_state as DurableAgentRunState) : undefined,
    nextState: r.next_state as DurableAgentRunState, reason: r.reason ?? undefined,
    correlationId: r.correlation_id, source: r.source, schemaVersion: r.schema_version,
  };
}
function isAgentTerminal(state: DurableAgentRunState): boolean {
  return state === 'COMPLETED' || state === 'REJECTED' || state === 'EXPIRED' || state === 'STALE' || state === 'FAILED' || state === 'CANCELLED';
}

class RecoveryEventInsertError extends Error {
  constructor(readonly code: Extract<AgentRunReproposalResult, { ok: false }>['code']) {
    super(code);
  }
}

function recoveryInsertFailure(error: unknown): AgentRunReproposalResult {
  if (error instanceof RecoveryEventInsertError) return { ok: false, code: error.code };
  return { ok: false, code: 'PARTIAL_FAILURE' };
}

function eventEquivalent(a: DurableAgentRunEvent, b: DurableAgentRunEvent): boolean {
  return a.eventId === b.eventId
    && a.runId === b.runId
    && a.seq === b.seq
    && a.at === b.at
    && a.type === b.type
    && (a.priorState ?? null) === (b.priorState ?? null)
    && a.nextState === b.nextState
    && (a.reason ?? null) === (b.reason ?? null)
    && a.correlationId === b.correlationId
    && a.source === b.source
    && a.schemaVersion === b.schemaVersion;
}

export class SqliteDurableStore implements DurableStore {
  private readonly db: DatabaseSync;
  private schemaVersion = 0;
  private migrationState = 'pending';
  private healthy: 'ready' | 'degraded' | 'unavailable' = 'unavailable';
  private detail?: string;
  private agentRunReproposalFaultPhase?: AgentRunReproposalFaultPhase;

  constructor(path: string) {
    // Open + migrate up front. A failure here throws — the engine treats that as a
    // fail-closed startup (degraded/unavailable), never a silent empty store.
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  injectAgentRunReproposalFaultForTest(phase?: AgentRunReproposalFaultPhase): void {
    this.agentRunReproposalFaultPhase = phase;
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT);');
    const row = this.db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('schema_version') as { value?: string } | undefined;
    const existing = row?.value ? Number(row.value) : 0;
    if (!row && this.hasDurableObjects()) {
      this.migrationState = 'mismatch';
      this.healthy = 'unavailable';
      this.detail = 'db schema metadata missing for non-empty database';
      throw new Error(this.detail);
    }
    if (!Number.isInteger(existing) || existing < 0) {
      this.migrationState = 'mismatch';
      this.healthy = 'unavailable';
      this.detail = `invalid db schema version ${row?.value ?? '<missing>'}`;
      throw new Error(this.detail);
    }
    if (existing > SCHEMA_VERSION) {
      // Schema is newer than this build — incompatible. Fail closed.
      this.migrationState = 'mismatch';
      this.healthy = 'unavailable';
      this.detail = `db schema v${existing} > engine v${SCHEMA_VERSION}`;
      throw new Error(this.detail);
    }
    this.tx(() => {
      if (existing < SCHEMA_VERSION) {
        this.db.exec(SCHEMA);
        const hasFence = this.tableColumns('agent_runs').some((column) => column.name === 'reconciliation_fence');
        if (!hasFence) this.db.exec('ALTER TABLE agent_runs ADD COLUMN reconciliation_fence INTEGER NOT NULL DEFAULT 0;');
        this.addColumnIfMissing('agent_runs', 'approval_lifecycle_version', "INTEGER NOT NULL DEFAULT 1");
        this.addColumnIfMissing('agent_runs', 'approval_lifecycle', "TEXT NOT NULL DEFAULT 'NOT_REQUESTED'");
        this.addColumnIfMissing('agent_runs', 'approval_requested_at', 'INTEGER');
        this.addColumnIfMissing('agent_runs', 'approval_expires_at', 'INTEGER');
        this.addColumnIfMissing('agent_runs', 'approval_decision_type', 'TEXT');
        this.addColumnIfMissing('agent_runs', 'approval_invalidation_reason', 'TEXT');
        this.addColumnIfMissing('agent_runs', 'approval_actor_ref', 'TEXT');
        this.addColumnIfMissing('agent_runs', 'recovery_class', "TEXT NOT NULL DEFAULT 'NONE'");
        this.addColumnIfMissing('agent_runs', 'recovery_eligible', 'INTEGER NOT NULL DEFAULT 0');
        this.addColumnIfMissing('agent_runs', 'recovery_reason', 'TEXT');
        this.addColumnIfMissing('agent_runs', 'recovery_source_run_id', 'TEXT');
        this.addColumnIfMissing('agent_runs', 'successor_run_id', 'TEXT');
        this.addColumnIfMissing('agent_runs', 'reproposal_at', 'INTEGER');
        this.addColumnIfMissing('agent_runs', 'recovery_attempt_count', 'INTEGER NOT NULL DEFAULT 0');
        this.addColumnIfMissing('agent_runs', 'last_recovery_request_id', 'TEXT');
        this.addColumnIfMissing('agent_runs', 'recovery_terminal_reason', 'TEXT');
        this.addColumnIfMissing('agent_run_tombstones', 'recovery_source_run_id', 'TEXT');
        this.addColumnIfMissing('agent_run_tombstones', 'successor_run_id', 'TEXT');
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_agent_runs_recovery_source ON agent_runs(recovery_source_run_id, updated_at);");
        this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_active_successor ON agent_runs(recovery_source_run_id) WHERE recovery_source_run_id IS NOT NULL AND state NOT IN ('COMPLETED','REJECTED','EXPIRED','STALE','FAILED','CANCELLED');");
        this.db.prepare('INSERT INTO schema_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('schema_version', String(SCHEMA_VERSION));
      }
    });
    this.assertSchemaMeta();
    this.assertAgentRunSchema();
    this.schemaVersion = SCHEMA_VERSION;
    this.migrationState = existing === SCHEMA_VERSION ? 'current' : 'applied';
    this.healthy = 'ready';
  }

  health(): PersistenceHealth {
    return { memoryStore: this.healthy, ragStore: this.healthy, schemaVersion: this.schemaVersion, migrationState: this.migrationState, detail: this.detail };
  }

  close(): void {
    try { this.db.close(); } catch { /* ignore */ }
  }

  // ── ConversationPersistence ──────────────────────────────────────────────
  saveConversation(c: Conversation): void {
    this.db.prepare(
      `INSERT INTO conversations(id,owner_scope,workspace_scope,title,memory_mode,created_at,updated_at,deleted_at)
       VALUES(?,?,?,?,?,?,?,NULL)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at`,
    ).run(c.id, c.ownerScope, c.workspaceScope, c.title, c.memoryMode, c.createdAt, c.updatedAt);
  }

  deleteConversation(id: string): void {
    this.tx(() => {
      this.db.prepare('DELETE FROM conversation_messages WHERE conversation_id = ?').run(id);
      this.db.prepare('DELETE FROM conversation_summaries WHERE conversation_id = ?').run(id);
      this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    });
  }

  saveMessage(m: Message): void {
    this.db.prepare(
      `INSERT OR IGNORE INTO conversation_messages(id,conversation_id,role,content,status,request_id,model_id,provider_id,created_at,durable,supersedes_id,seq)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(m.id, m.conversationId, m.role, m.content, m.status, m.requestId ?? null, m.modelId ?? null, m.providerId ?? null, m.createdAt, m.durable ? 1 : 0, m.supersedesId ?? null, m.createdAt);
  }

  saveSummary(s: Summary): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO conversation_summaries(id,conversation_id,source_from_message_id,source_to_message_id,summary_json,version,created_at)
       VALUES(?,?,?,?,?,?,?)`,
    ).run(s.id, s.conversationId, s.sourceFromMessageId, s.sourceToMessageId, JSON.stringify(s.summary), s.version, s.createdAt);
  }

  loadDurable(): { conversations: Conversation[]; messages: Message[]; summaries: Summary[] } {
    const conversations = (this.db.prepare('SELECT * FROM conversations WHERE deleted_at IS NULL').all() as Array<Record<string, unknown>>).map(rowToConversation);
    const messages = (this.db.prepare('SELECT * FROM conversation_messages ORDER BY conversation_id, seq, rowid').all() as Array<Record<string, unknown>>).map(rowToMessage);
    const summaries = (this.db.prepare('SELECT * FROM conversation_summaries ORDER BY conversation_id, version').all() as Array<Record<string, unknown>>).map(rowToSummary);
    return { conversations, messages, summaries };
  }

  // ── MemoryItemPersistence ────────────────────────────────────────────────
  saveMemoryItem(i: MemoryItem): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO memory_items(id,owner_scope,workspace_scope,category,content,confidence,source_type,source_id,expires_at,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    ).run(i.id, i.scope.owner ?? null, i.scope.workspace ?? null, i.category, i.content, i.confidence, i.sourceType, i.sourceId ?? null, i.expiresAt ?? null, i.createdAt);
  }

  loadMemoryItems(): MemoryItem[] {
    return (this.db.prepare('SELECT * FROM memory_items').all() as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string, scope: { owner: (r.owner_scope as string) ?? undefined, workspace: (r.workspace_scope as string) ?? undefined },
      category: r.category as MemoryItem['category'], content: r.content as string, confidence: r.confidence as number,
      sourceType: r.source_type as string, sourceId: (r.source_id as string) ?? undefined, expiresAt: (r.expires_at as number) ?? undefined, createdAt: r.created_at as number,
    }));
  }

  // ── RagIndexPersistence ──────────────────────────────────────────────────
  saveIndex(rec: PersistedIndexRecord): void {
    this.db.prepare(
      `INSERT INTO workspace_indexes(id,workspace_id,owner_scope,source_type,root,state,version,embedding_model,embedding_version,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET state=excluded.state, version=excluded.version, updated_at=excluded.updated_at`,
    ).run(rec.id, rec.workspaceId, rec.ownerScope, rec.sourceType, rec.root, rec.state, rec.version, rec.embeddingModel, rec.embeddingVersion, rec.createdAt, rec.updatedAt);
  }

  setIndexState(id: string, state: string, updatedAt: number): void {
    this.db.prepare('UPDATE workspace_indexes SET state=?, updated_at=? WHERE id=?').run(state, updatedAt, id);
  }

  deleteIndex(id: string): void {
    this.tx(() => {
      this.db.prepare('DELETE FROM index_chunks WHERE index_id=?').run(id);
      this.db.prepare('DELETE FROM index_versions WHERE index_id=?').run(id);
      this.db.prepare('DELETE FROM workspace_indexes WHERE id=?').run(id);
    });
  }

  commitSync(indexId: string, version: number, changed: PersistedChunk[], changedFiles: string[], deletedFiles: string[], updatedAt: number): void {
    // One transaction: rewrite changed files' chunks, drop deleted files, bump
    // version. A throw rolls the whole thing back → the previous version stands.
    this.tx(() => {
      for (const f of [...changedFiles, ...deletedFiles]) {
        this.db.prepare('DELETE FROM index_chunks WHERE index_id=? AND file_path=?').run(indexId, f);
      }
      const ins = this.db.prepare(
        `INSERT INTO index_chunks(id,index_id,workspace_id,file_path,language,symbol,start_line,end_line,content_hash,embedding_model,embedding_version,indexed_at,text,vector)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const c of changed) {
        ins.run(`${indexId}:${c.filePath}#${c.startLine}`, indexId, c.workspaceId, c.filePath, c.language, c.symbol ?? null, c.startLine, c.endLine, c.contentHash, c.embeddingModel, c.embeddingVersion, c.indexedAt, c.text, toBlob(c.vector));
      }
      this.db.prepare('INSERT OR REPLACE INTO index_versions(index_id,version,committed_at) VALUES(?,?,?)').run(indexId, version, updatedAt);
      this.db.prepare('UPDATE workspace_indexes SET version=?, updated_at=? WHERE id=?').run(version, updatedAt, indexId);
    });
  }

  loadIndexes(): PersistedIndexRecord[] {
    return (this.db.prepare('SELECT * FROM workspace_indexes').all() as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string, workspaceId: r.workspace_id as string, ownerScope: r.owner_scope as string, sourceType: r.source_type as string,
      root: r.root as string, state: r.state as string, version: r.version as number, embeddingModel: r.embedding_model as string,
      embeddingVersion: r.embedding_version as string, createdAt: r.created_at as number, updatedAt: r.updated_at as number,
    }));
  }

  loadChunks(indexId: string): PersistedChunk[] {
    return (this.db.prepare('SELECT * FROM index_chunks WHERE index_id=?').all(indexId) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string, indexId: r.index_id as string, workspaceId: r.workspace_id as string, filePath: r.file_path as string,
      language: r.language as string, symbol: (r.symbol as string) ?? undefined, startLine: r.start_line as number, endLine: r.end_line as number,
      contentHash: r.content_hash as string, embeddingModel: r.embedding_model as string, embeddingVersion: r.embedding_version as string,
      indexedAt: r.indexed_at as number, text: r.text as string, vector: fromBlob(r.vector as Uint8Array),
    }));
  }

  // ── EmbeddingCachePersistence ────────────────────────────────────────────
  getEmbedding(model: string, version: string, contentHash: string): number[] | undefined {
    const r = this.db.prepare('SELECT vector FROM embedding_cache WHERE model=? AND version=? AND content_hash=?').get(model, version, contentHash) as { vector?: Uint8Array } | undefined;
    return r?.vector ? fromBlob(r.vector) : undefined;
  }

  putEmbedding(model: string, version: string, contentHash: string, vector: number[]): void {
    this.db.prepare('INSERT OR REPLACE INTO embedding_cache(model,version,content_hash,dims,vector,created_at) VALUES(?,?,?,?,?,?)')
      .run(model, version, contentHash, vector.length, toBlob(vector), Date.now());
  }

  // ── WorkspacePersistence ─────────────────────────────────────────────────
  saveWorkspace(w: import('./types.js').PersistedWorkspace): void {
    this.db.prepare(
      `INSERT INTO workspaces(id,owner_scope,workspace_scope,name,root,git_repo,git_branch,memory_mode,index_id,provider_preferences,permissions,last_sync_at,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, root=excluded.root, git_repo=excluded.git_repo, git_branch=excluded.git_branch,
         memory_mode=excluded.memory_mode, index_id=excluded.index_id, provider_preferences=excluded.provider_preferences,
         permissions=excluded.permissions, last_sync_at=excluded.last_sync_at, updated_at=excluded.updated_at`,
    ).run(w.id, w.ownerScope, w.workspaceScope, w.name, w.root, w.gitRepo ?? null, w.gitBranch ?? null, w.memoryMode, w.indexId ?? null, w.providerPreferences ?? null, w.permissions ?? null, w.lastSyncAt ?? null, w.createdAt, w.updatedAt);
  }

  deleteWorkspace(id: string): void {
    this.db.prepare('DELETE FROM workspaces WHERE id=?').run(id);
  }

  loadWorkspaces(): import('./types.js').PersistedWorkspace[] {
    return (this.db.prepare('SELECT * FROM workspaces').all() as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string, ownerScope: r.owner_scope as string, workspaceScope: r.workspace_scope as string, name: r.name as string, root: r.root as string,
      gitRepo: (r.git_repo as string) ?? undefined, gitBranch: (r.git_branch as string) ?? undefined, memoryMode: r.memory_mode as string,
      indexId: (r.index_id as string) ?? undefined, providerPreferences: (r.provider_preferences as string) ?? undefined, permissions: (r.permissions as string) ?? undefined,
      lastSyncAt: (r.last_sync_at as number) ?? undefined, createdAt: r.created_at as number, updatedAt: r.updated_at as number,
    }));
  }

  pruneOlderThan(cutoffMs: number): number {
    const before = (this.db.prepare('SELECT count(*) c FROM embedding_cache').get() as { c: number }).c;
    this.db.prepare('DELETE FROM embedding_cache WHERE created_at < ?').run(cutoffMs);
    const after = (this.db.prepare('SELECT count(*) c FROM embedding_cache').get() as { c: number }).c;
    return before - after;
  }

  /** Remove index_versions rows with no matching active index (orphan cleanup). */
  cleanupOrphanVersions(): number {
    const res = this.db.prepare('DELETE FROM index_versions WHERE index_id NOT IN (SELECT id FROM workspace_indexes)').run();
    // Also drop orphan chunks (defensive — a delete already cascades).
    this.db.prepare('DELETE FROM index_chunks WHERE index_id NOT IN (SELECT id FROM workspace_indexes)').run();
    return Number(res.changes ?? 0);
  }

  /** SQLite integrity verification. Returns 'ok' or the first problem reported. */
  integrityCheck(): string {
    const rows = this.db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
    return rows[0]?.integrity_check ?? 'unknown';
  }

  /** Time a real (idempotent) write to gauge durable write latency. Uses a
   * dedicated schema_meta heartbeat key — never touches operational data. Timed
   * with a monotonic clock so it is independent of any injected wall clock. */
  probeWriteLatencyMs(): number {
    const t0 = process.hrtime.bigint();
    this.db.prepare('INSERT INTO schema_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('op_heartbeat', 'ping');
    return Number(process.hrtime.bigint() - t0) / 1e6;
  }

  /** Online backup to a file path (safe while the engine runs). */
  backupTo(destPath: string): void {
    // VACUUM INTO produces a consistent single-file snapshot.
    this.db.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
  }

  // ── OperationalPersistence (v2) ──────────────────────────────────────────────

  appendAuditEvent(e: DurableAuditEvent): void {
    // Idempotent by eventId — a replayed append is a no-op (never double-counts).
    this.db.prepare(
      `INSERT OR IGNORE INTO op_audit_events(event_id,correlation_id,causation_id,seq,type,at,duration_ms,component,outcome,request_id,fields_json)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(e.eventId, e.correlationId, e.causationId, e.seq, e.type, e.at, e.durationMs ?? null, e.component, e.outcome ?? null, e.requestId ?? null, e.fieldsJson);
  }
  recentAuditEvents(limit: number): DurableAuditEvent[] {
    return (this.db.prepare('SELECT * FROM op_audit_events ORDER BY at DESC, seq DESC LIMIT ?').all(clampLimit(limit)) as unknown as AuditRow[]).map(rowToAudit);
  }
  auditByCorrelation(correlationId: string, limit = 500): DurableAuditEvent[] {
    return (this.db.prepare('SELECT * FROM op_audit_events WHERE correlation_id = ? ORDER BY seq ASC LIMIT ?').all(correlationId, clampLimit(limit)) as unknown as AuditRow[]).map(rowToAudit);
  }

  appendUsageRecord(r: DurableUsageRecord): void {
    this.db.prepare(
      `INSERT OR IGNORE INTO op_usage_records(usage_id,correlation_id,provider_id,model_id,execution_mode,policy,local_or_cloud,at,outcome,cost_usd,cost_status,escalation_reason,fields_json)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(r.usageId, r.correlationId, r.providerId, r.modelId, r.executionMode, r.policy, r.localOrCloud, r.at, r.outcome, r.costUsd ?? null, r.costStatus, r.escalationReason ?? null, r.fieldsJson);
  }
  recentUsageRecords(limit: number): DurableUsageRecord[] {
    return (this.db.prepare('SELECT * FROM op_usage_records ORDER BY at DESC LIMIT ?').all(clampLimit(limit)) as unknown as UsageRow[]).map(rowToUsage);
  }

  upsertIncident(i: DurableIncident): void {
    this.db.prepare(
      `INSERT INTO op_incidents(incident_id,dedup_key,correlation_id,first_seen_at,last_seen_at,occurrence_count,state,severity,affected_json,last_delivery_status,resolution_json)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(incident_id) DO UPDATE SET last_seen_at=excluded.last_seen_at, occurrence_count=excluded.occurrence_count, state=excluded.state, last_delivery_status=excluded.last_delivery_status, resolution_json=excluded.resolution_json`,
    ).run(i.incidentId, i.deduplicationKey, i.correlationId, i.firstSeenAt, i.lastSeenAt, i.occurrenceCount, i.state, i.severity, i.affectedJson, i.lastDeliveryStatus, i.resolutionJson ?? null);
  }
  listIncidents(limit: number): DurableIncident[] {
    return (this.db.prepare('SELECT * FROM op_incidents ORDER BY last_seen_at DESC LIMIT ?').all(clampLimit(limit)) as unknown as IncidentRow[]).map(rowToIncident);
  }

  appendRecoveryEvent(e: DurableRecoveryEvent): void {
    this.db.prepare(
      `INSERT OR IGNORE INTO op_recovery_events(id,recovery_id,correlation_id,incident_id,type,at,outcome,fields_json) VALUES(?,?,?,?,?,?,?,?)`,
    ).run(e.id, e.recoveryId, e.correlationId, e.incidentId ?? null, e.type, e.at, e.outcome ?? null, e.fieldsJson);
  }

  saveBudgetScope(s: DurableBudgetScope): void {
    this.db.prepare(
      `INSERT INTO op_budget_scopes(scope_id,kind,scope_key,hard_limit_usd,spent_usd,reserved_usd,period_start,updated_at)
       VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(scope_id) DO UPDATE SET hard_limit_usd=excluded.hard_limit_usd, spent_usd=excluded.spent_usd, reserved_usd=excluded.reserved_usd, period_start=excluded.period_start, updated_at=excluded.updated_at`,
    ).run(s.scopeId, s.kind, s.scopeKeyName, s.hardLimitUsd, s.spentUsd, s.reservedUsd, s.periodStart, s.updatedAt);
  }
  loadBudgetScopes(): DurableBudgetScope[] {
    return (this.db.prepare('SELECT * FROM op_budget_scopes').all() as unknown as BudgetScopeRow[]).map(rowToBudgetScope);
  }
  saveReservation(r: DurableReservation): void {
    this.db.prepare(
      `INSERT INTO op_reservations(reservation_id,amount_usd,scope_ids_json,correlation_id,provider_id,model_id,created_at,expires_at,status)
       VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(reservation_id) DO UPDATE SET status=excluded.status`,
    ).run(r.reservationId, r.amountUsd, r.scopeIdsJson, r.correlationId, r.providerId, r.modelId, r.createdAt, r.expiresAt, r.status);
  }
  removeReservation(reservationId: string): void {
    this.db.prepare('DELETE FROM op_reservations WHERE reservation_id = ?').run(reservationId);
  }
  loadReservations(): DurableReservation[] {
    return (this.db.prepare('SELECT * FROM op_reservations').all() as unknown as ReservationRow[]).map(rowToReservation);
  }

  pruneOperational(cutoffs: { auditBefore: number; usageBefore: number; incidentsBefore: number; recoveryBefore: number }): { audit: number; usage: number; incidents: number; recovery: number } {
    const del = (sql: string, arg: number): number => Number(this.db.prepare(sql).run(arg).changes ?? 0);
    return {
      audit: del('DELETE FROM op_audit_events WHERE at < ?', cutoffs.auditBefore),
      usage: del('DELETE FROM op_usage_records WHERE at < ?', cutoffs.usageBefore),
      // Only resolved incidents past the cutoff are pruned — open incidents persist.
      incidents: del("DELETE FROM op_incidents WHERE last_seen_at < ? AND state = 'resolved'", cutoffs.incidentsBefore),
      recovery: del('DELETE FROM op_recovery_events WHERE at < ?', cutoffs.recoveryBefore),
    };
  }
  operationalCounts(): OperationalCounts {
    const c = (t: string): number => (this.db.prepare(`SELECT count(*) c FROM ${t}`).get() as { c: number }).c;
    return { auditEvents: c('op_audit_events'), usageRecords: c('op_usage_records'), incidents: c('op_incidents'), recoveryEvents: c('op_recovery_events'), reservations: c('op_reservations'), agentRuns: c('agent_runs'), agentRunEvents: c('agent_run_events'), agentRunTombstones: c('agent_run_tombstones') };
  }

  // ── Agent Mode durable run journal (v3) ─────────────────────────────────────

  insertAgentRun(run: DurableAgentRun, createdEvent: DurableAgentRunEvent): void {
    this.tx(() => {
      this.insertAgentRunInside(run);
      this.appendAgentRunEventInside({ ...createdEvent, seq: 1 });
      this.db.prepare('UPDATE agent_runs SET audit_seq = 1 WHERE run_id = ?').run(run.runId);
    });
  }

  appendAgentRunEvent(event: Omit<DurableAgentRunEvent, 'seq'>): void {
    this.tx(() => {
      const row = this.db.prepare('SELECT audit_seq FROM agent_runs WHERE run_id = ?').get(event.runId) as { audit_seq: number } | undefined;
      if (!row) throw new Error(`unknown Agent run ${event.runId}`);
      this.appendAgentRunEventInside({ ...event, seq: row.audit_seq + 1 });
      this.db.prepare('UPDATE agent_runs SET audit_seq = audit_seq + 1, updated_at = ? WHERE run_id = ?').run(event.at, event.runId);
    });
  }

  appendAgentRunEventUnderFence(input: AgentRunFencedEventInput): AgentRunReconciliationClaim | undefined {
    let claim: AgentRunReconciliationClaim | undefined;
    this.tx(() => {
      const row = this.db.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(input.runId) as AgentRunRow | undefined;
      if (!row) return;
      const state = row.state as DurableAgentRunState;
      if (isAgentTerminal(state)) return;
      if (input.expectedState && state !== input.expectedState) return;
      if (row.reconciliation_owner !== input.reconciliation.owner) return;
      if (row.reconciliation_fence !== input.reconciliation.fence) return;
      if ((row.reconciliation_lease_until ?? -1) < input.reconciliation.leaseValidAt) return;
      if (row.version !== input.reconciliation.expectedVersion) return;
      const eventId = input.eventId ?? `${input.runId}:${row.audit_seq + 1}:${input.eventType}`;
      const inserted = this.db.prepare(
        `INSERT OR IGNORE INTO agent_run_events(event_id,run_id,seq,at,type,prior_state,next_state,reason,correlation_id,source,schema_version)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(eventId, input.runId, row.audit_seq + 1, input.at, input.eventType, state, state, input.reason ?? null, row.correlation_id, input.source, 1);
      if (Number(inserted.changes ?? 0) !== 1) return;
      const updated = this.db.prepare(
        `UPDATE agent_runs SET audit_seq=audit_seq+1, version=version+1, updated_at=?
         WHERE run_id=? AND state=? AND reconciliation_owner=? AND reconciliation_fence=? AND reconciliation_lease_until>=? AND version=?`,
      ).run(input.at, input.runId, state, input.reconciliation.owner, input.reconciliation.fence, input.reconciliation.leaseValidAt, input.reconciliation.expectedVersion);
      if (Number(updated.changes ?? 0) !== 1) throw new Error('fenced Agent event append lost its CAS after insert');
      claim = this.loadReconciliationClaim(input.runId, input.reconciliation.owner);
    });
    return claim;
  }

  transitionAgentRun(input: AgentRunTransitionInput): boolean {
    let changed = false;
    this.tx(() => {
      const row = this.db.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(input.runId) as AgentRunRow | undefined;
      if (!row) return;
      const prior = row.state as DurableAgentRunState;
      if (isAgentTerminal(prior)) return;
      if (input.expectedState && prior !== input.expectedState) return;
      const nextTerminal = isAgentTerminal(input.nextState);
      if (input.reconciliation) {
        if (row.reconciliation_owner !== input.reconciliation.owner) return;
        if (row.reconciliation_fence !== input.reconciliation.fence) return;
        if ((row.reconciliation_lease_until ?? -1) < input.reconciliation.leaseValidAt) return;
        if (input.reconciliation.expectedVersion !== undefined && row.version !== input.reconciliation.expectedVersion) return;
      }
      const terminalAt = input.patch?.terminalAt ?? (nextTerminal ? input.at : row.terminal_at);
      const result = this.db.prepare(
        `UPDATE agent_runs SET
          state=?, approval_displayed_at=COALESCE(?, approval_displayed_at), approval_decision_at=COALESCE(?, approval_decision_at),
          execution_started_at=COALESCE(?, execution_started_at), terminal_at=COALESCE(?, terminal_at),
          result_json=COALESCE(?, result_json), error_json=COALESCE(?, error_json), exit_code=COALESCE(?, exit_code),
          signal=COALESCE(?, signal), failure_code=COALESCE(?, failure_code), interruption_classification=COALESCE(?, interruption_classification),
          containment_unit=COALESCE(?, containment_unit), containment_binding=COALESCE(?, containment_binding),
          approval_lifecycle=COALESCE(?, approval_lifecycle), approval_requested_at=COALESCE(?, approval_requested_at),
          approval_expires_at=COALESCE(?, approval_expires_at), approval_decision_type=COALESCE(?, approval_decision_type),
          approval_invalidation_reason=COALESCE(?, approval_invalidation_reason), approval_actor_ref=COALESCE(?, approval_actor_ref),
          recovery_class=COALESCE(?, recovery_class), recovery_eligible=COALESCE(?, recovery_eligible),
          recovery_reason=COALESCE(?, recovery_reason), successor_run_id=COALESCE(?, successor_run_id),
          reproposal_at=COALESCE(?, reproposal_at), recovery_attempt_count=COALESCE(?, recovery_attempt_count),
          last_recovery_request_id=COALESCE(?, last_recovery_request_id), recovery_terminal_reason=COALESCE(?, recovery_terminal_reason),
          reconciliation_owner=?, reconciliation_lease_until=?,
          audit_seq=audit_seq+1, version=version+1, updated_at=?
         WHERE run_id=? AND state=?${input.reconciliation ? ' AND reconciliation_owner=? AND reconciliation_fence=? AND reconciliation_lease_until>=?' : ''}${input.reconciliation?.expectedVersion !== undefined ? ' AND version=?' : ''}`,
      ).run(
        input.nextState, input.patch?.approvalDisplayedAt ?? null, input.patch?.approvalDecisionAt ?? null,
        input.patch?.executionStartedAt ?? null, terminalAt ?? null, input.patch?.resultJson ?? null, input.patch?.errorJson ?? null,
        input.patch && 'exitCode' in input.patch ? input.patch.exitCode ?? null : null, input.patch?.signal ?? null, input.patch?.failureCode ?? null,
        input.patch?.interruptionClassification ?? null, input.patch?.containmentUnit ?? null, input.patch?.containmentBinding ?? null,
        input.patch?.approvalLifecycle ?? null, input.patch?.approvalRequestedAt ?? null, input.patch?.approvalExpiresAt ?? null,
        input.patch?.approvalDecisionType ?? null, input.patch?.approvalInvalidationReason ?? null, input.patch?.approvalActorRef ?? null,
        input.patch?.recoveryClass ?? null, input.patch?.recoveryEligible === undefined ? null : input.patch.recoveryEligible ? 1 : 0,
        input.patch?.recoveryReason ?? null, input.patch?.successorRunId ?? null, input.patch?.reproposalAt ?? null,
        input.patch?.recoveryAttemptCount ?? null, input.patch?.lastRecoveryRequestId ?? null, input.patch?.recoveryTerminalReason ?? null,
        nextTerminal ? null : row.reconciliation_owner, nextTerminal ? null : row.reconciliation_lease_until,
        input.at, input.runId, prior,
        ...(input.reconciliation ? [input.reconciliation.owner, input.reconciliation.fence, input.reconciliation.leaseValidAt] : []),
        ...(input.reconciliation?.expectedVersion !== undefined ? [input.reconciliation.expectedVersion] : []),
      );
      if (Number(result.changes ?? 0) !== 1) return;
      this.appendAgentRunEventInside({
        eventId: input.eventId ?? `${input.runId}:${row.audit_seq + 1}:${input.eventType}`,
        runId: input.runId,
        seq: row.audit_seq + 1,
        at: input.at,
        type: input.eventType,
        priorState: prior,
        nextState: input.nextState,
        reason: input.reason,
        correlationId: row.correlation_id,
        source: input.source,
        schemaVersion: 1,
      });
      changed = true;
    });
    return changed;
  }

  reproposeAgentRun(input: AgentRunReproposalInput): AgentRunReproposalResult {
    let outcome: AgentRunReproposalResult = { ok: false, code: 'UNKNOWN_SOURCE' };
    try {
      this.tx(() => {
      this.failAgentRunReproposalPhase('recovery-status source read');
      const source = this.db.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(input.sourceRunId) as AgentRunRow | undefined;
      if (!source) { outcome = { ok: false, code: 'UNKNOWN_SOURCE' }; return; }
      this.failAgentRunReproposalPhase('idempotency lookup');
      if (source.last_recovery_request_id === input.requestId && source.successor_run_id) {
        const successor = this.loadAgentRun(source.successor_run_id);
        outcome = successor ? { ok: true, created: false, successor } : { ok: false, code: 'PARTIAL_FAILURE' };
        return;
      }
      const state = source.state as DurableAgentRunState;
      if (!isAgentTerminal(state)) { outcome = { ok: false, code: 'SOURCE_NOT_TERMINAL' }; return; }
      if (source.version !== input.sourceExpectedVersion) { outcome = { ok: false, code: 'SOURCE_VERSION_CHANGED' }; return; }
      if (source.reconciliation_owner && (source.reconciliation_lease_until ?? 0) >= input.at) { outcome = { ok: false, code: 'SOURCE_UNDER_RECONCILIATION' }; return; }
      if (source.successor_run_id) { outcome = { ok: false, code: 'ACTIVE_SUCCESSOR_EXISTS' }; return; }
      const active = this.db.prepare(
        `SELECT run_id FROM agent_runs WHERE recovery_source_run_id = ?
         AND state NOT IN ('COMPLETED','REJECTED','EXPIRED','STALE','FAILED','CANCELLED') LIMIT 1`,
      ).get(input.sourceRunId) as { run_id: string } | undefined;
      if (active) { outcome = { ok: false, code: 'ACTIVE_SUCCESSOR_EXISTS' }; return; }
      const sourceRun = rowToAgentRun(source);
      this.failAgentRunReproposalPhase('source event read');
      const sourceEvents = this.loadAgentRunEventsInside(input.sourceRunId);
      this.failAgentRunReproposalPhase('provenance revalidation');
      const provenance = validateRecoverySourceProvenance({
        run: sourceRun,
        events: sourceEvents,
        workspaceIdentity: input.provenance.workspaceIdentity,
        allowedRecipes: input.provenance.allowedRecipes,
        now: input.at,
      });
      if (!provenance.trusted || provenance.digest !== input.provenance.eventDigest || provenance.highestSeq !== input.provenance.highestSeq) {
        outcome = { ok: false, code: 'SOURCE_PROVENANCE_FAILED' };
        return;
      }

      this.failAgentRunReproposalPhase('successor run insert');
      this.insertAgentRunInside(input.successor);
      this.failAgentRunReproposalPhase('successor proposal/event insert');
      this.appendAgentRunEventInside({ ...input.createdEvent, seq: 1 }, 'strict');
      this.appendAgentRunEventInside({ ...input.proposalEvent, seq: 2 }, 'strict');
      this.db.prepare('UPDATE agent_runs SET audit_seq = 2 WHERE run_id = ?').run(input.successor.runId);

      this.failAgentRunReproposalPhase('source recovery event insert');
      this.appendAgentRunEventInside({
        eventId: `${input.sourceRunId}:reproposal:${input.requestId}:requested`,
        runId: input.sourceRunId,
        seq: source.audit_seq + 1,
        at: input.at,
        type: 'recovery.reproposal_requested',
        priorState: state,
        nextState: state,
        reason: input.requestId,
        correlationId: source.correlation_id,
        source: 'RECOVERY',
        schemaVersion: 1,
      }, 'strict');
      this.failAgentRunReproposalPhase('successor lineage event insert');
      this.appendAgentRunEventInside({
        eventId: `${input.sourceRunId}:reproposal:${input.requestId}:linked`,
        runId: input.sourceRunId,
        seq: source.audit_seq + 2,
        at: input.at,
        type: 'recovery.successor_linked',
        priorState: state,
        nextState: state,
        reason: input.successor.runId,
        correlationId: source.correlation_id,
        source: 'RECOVERY',
        schemaVersion: 1,
      }, 'strict');
      this.failAgentRunReproposalPhase('source lineage update');
      const linked = this.db.prepare(
        `UPDATE agent_runs SET successor_run_id=?, reproposal_at=?, recovery_attempt_count=recovery_attempt_count+1,
          last_recovery_request_id=?, recovery_terminal_reason=?, audit_seq=audit_seq+2, version=version+1, updated_at=?
         WHERE run_id=? AND version=? AND state IN ('COMPLETED','REJECTED','EXPIRED','STALE','FAILED','CANCELLED')
         AND successor_run_id IS NULL
         AND (reconciliation_owner IS NULL OR reconciliation_lease_until IS NULL OR reconciliation_lease_until < ?)`,
      ).run(input.successor.runId, input.at, input.requestId, 'SUCCESSOR_CREATED', input.at, input.sourceRunId, input.sourceExpectedVersion, input.at);
      if (Number(linked.changes ?? 0) !== 1) throw new Error('Agent reproposal source linkage lost its CAS');
      this.failAgentRunReproposalPhase('transaction commit');
      outcome = { ok: true, created: true, successor: input.successor };
      });
    } catch (error) {
      if (error instanceof AgentRunReproposalFault) this.agentRunReproposalFaultPhase = undefined;
      outcome = recoveryInsertFailure(error);
    }
    return outcome;
  }

  loadAgentRuns(limit = 5000): DurableAgentRun[] {
    return (this.db.prepare('SELECT * FROM agent_runs ORDER BY updated_at DESC LIMIT ?').all(clampLimit(limit)) as unknown as AgentRunRow[]).map(rowToAgentRun);
  }

  loadAgentRun(runId: string): DurableAgentRun | undefined {
    const row = this.db.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(runId) as AgentRunRow | undefined;
    return row ? rowToAgentRun(row) : undefined;
  }

  loadAgentRunEvents(runId: string, limit = 500): DurableAgentRunEvent[] {
    return (this.db.prepare('SELECT * FROM agent_run_events WHERE run_id = ? ORDER BY seq ASC LIMIT ?').all(runId, clampLimit(limit)) as unknown as AgentRunEventRow[]).map(rowToAgentRunEvent);
  }

  claimAgentRunReconciliation(runId: string, owner: string, leaseUntil: number, now: number): AgentRunReconciliationClaim | undefined {
    const result = this.db.prepare(
      `UPDATE agent_runs SET reconciliation_owner=?, reconciliation_lease_until=?, reconciliation_fence=reconciliation_fence+1, version=version+1, updated_at=?
       WHERE run_id=? AND state NOT IN ('COMPLETED','REJECTED','EXPIRED','STALE','FAILED','CANCELLED')
       AND (reconciliation_owner IS NULL OR reconciliation_lease_until IS NULL OR reconciliation_lease_until < ?)`,
    ).run(owner, leaseUntil, now, runId, now);
    if (Number(result.changes ?? 0) !== 1) return undefined;
    return this.loadReconciliationClaim(runId, owner);
  }

  renewAgentRunReconciliation(runId: string, owner: string, fence: number, leaseUntil: number, now: number): AgentRunReconciliationClaim | undefined {
    const result = this.db.prepare(
      `UPDATE agent_runs SET reconciliation_lease_until=?, version=version+1, updated_at=?
       WHERE run_id=? AND reconciliation_owner=? AND reconciliation_fence=? AND reconciliation_lease_until>=?
       AND state NOT IN ('COMPLETED','REJECTED','EXPIRED','STALE','FAILED','CANCELLED')`,
    ).run(leaseUntil, now, runId, owner, fence, now);
    if (Number(result.changes ?? 0) !== 1) return undefined;
    return this.loadReconciliationClaim(runId, owner);
  }

  pruneAgentRuns(cutoff: number, batchSize: number, now: number): { runs: number; events: number } {
    const limit = clampLimit(batchSize);
    let runs = 0;
    let events = 0;
    this.tx(() => {
      const candidates = (this.db.prepare(
        `SELECT run_id, version, audit_seq, state, workspace_identity, recipe_id, terminal_at, recovery_source_run_id, successor_run_id FROM agent_runs
         WHERE terminal_at IS NOT NULL AND terminal_at < ?
         AND state IN ('COMPLETED','REJECTED','EXPIRED','STALE','FAILED','CANCELLED')
         AND (reconciliation_owner IS NULL OR reconciliation_lease_until IS NULL OR reconciliation_lease_until < ?)
         AND (successor_run_id IS NULL OR NOT EXISTS (
           SELECT 1 FROM agent_runs child WHERE child.run_id = agent_runs.successor_run_id
           AND child.state NOT IN ('COMPLETED','REJECTED','EXPIRED','STALE','FAILED','CANCELLED')
         ))
         AND NOT EXISTS (
           SELECT 1 FROM agent_runs child WHERE child.recovery_source_run_id = agent_runs.run_id
           AND child.state NOT IN ('COMPLETED','REJECTED','EXPIRED','STALE','FAILED','CANCELLED')
         )
         ORDER BY terminal_at ASC LIMIT ?`,
      ).all(cutoff, now, limit) as Array<{ run_id: string; version: number; audit_seq: number; state: DurableAgentRunState; workspace_identity: string; recipe_id: string; terminal_at: number; recovery_source_run_id: string | null; successor_run_id: string | null }>);
      for (const candidate of candidates) {
        const runId = candidate.run_id;
        const eventCount = (this.db.prepare('SELECT count(*) c FROM agent_run_events WHERE run_id = ?').get(runId) as { c: number }).c;
        this.db.prepare(
          `INSERT INTO agent_run_tombstones(tombstone_id,run_id,workspace_identity,recipe_id,final_state,terminal_at,deleted_at,deletion_reason,final_audit_seq,event_count,recovery_source_run_id,successor_run_id,schema_version)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(`tombstone_${runId}_${now}`, runId, candidate.workspace_identity, candidate.recipe_id, candidate.state, candidate.terminal_at, now, 'RETENTION_EXPIRED', candidate.audit_seq, eventCount, candidate.recovery_source_run_id, candidate.successor_run_id, 1);
        const delEvents = this.db.prepare('DELETE FROM agent_run_events WHERE run_id = ?').run(runId);
        events += Number(delEvents.changes ?? 0);
        const delRun = this.db.prepare(
          `DELETE FROM agent_runs WHERE run_id = ? AND version = ?
           AND (reconciliation_owner IS NULL OR reconciliation_lease_until IS NULL OR reconciliation_lease_until < ?)`,
        ).run(runId, candidate.version, now);
        if (Number(delRun.changes ?? 0) !== 1) throw new Error(`Agent run ${runId} became retention-ineligible during cleanup`);
        runs += Number(delRun.changes ?? 0);
      }
    });
    return { runs, events };
  }

  loadAgentRunTombstones(limit = 500): DurableAgentRunTombstone[] {
    return (this.db.prepare('SELECT * FROM agent_run_tombstones ORDER BY deleted_at DESC LIMIT ?').all(clampLimit(limit)) as unknown as AgentRunTombstoneRow[]).map(rowToAgentRunTombstone);
  }

  private insertAgentRunInside(run: DurableAgentRun): void {
    const columns = [
      'run_id', 'correlation_id', 'external_request_ref', 'activation_ref', 'workspace_identity', 'workspace_ref',
      'recipe_id', 'recipe_policy_version', 'proposal_fingerprint', 'proposal_hash', 'snapshot_id', 'snapshot_manifest_digest',
      'executable_digest', 'containment_unit', 'containment_binding', 'state', 'requested_at', 'proposal_at',
      'approval_displayed_at', 'approval_decision_at', 'execution_started_at', 'terminal_at', 'expires_at',
      'timeout_ms', 'output_limit_bytes', 'mutation_classification', 'network_policy', 'expected_effects_json',
      'preview_json', 'result_json', 'error_json', 'exit_code', 'signal', 'failure_code', 'interruption_classification',
      'approval_lifecycle_version', 'approval_lifecycle', 'approval_requested_at', 'approval_expires_at',
      'approval_decision_type', 'approval_invalidation_reason', 'approval_actor_ref', 'recovery_class',
      'recovery_eligible', 'recovery_reason', 'recovery_source_run_id', 'successor_run_id', 'reproposal_at',
      'recovery_attempt_count', 'last_recovery_request_id', 'recovery_terminal_reason',
      'audit_seq', 'schema_version', 'version', 'reconciliation_owner', 'reconciliation_lease_until',
      'reconciliation_fence', 'updated_at',
    ];
    const values = [
      run.runId, run.correlationId, run.externalRequestRef ?? null, run.activationRef, run.workspaceIdentity, run.workspaceRef,
      run.recipeId, run.recipePolicyVersion, run.proposalFingerprint, run.proposalHash, run.snapshotId, run.snapshotManifestDigest,
      run.executableDigest, run.containmentUnit ?? null, run.containmentBinding ?? null, run.state, run.requestedAt, run.proposalAt ?? null,
      run.approvalDisplayedAt ?? null, run.approvalDecisionAt ?? null, run.executionStartedAt ?? null, run.terminalAt ?? null, run.expiresAt,
      run.timeoutMs, run.outputLimitBytes, run.mutationClassification, run.networkPolicy, run.expectedEffectsJson,
      run.previewJson ?? null, run.resultJson ?? null, run.errorJson ?? null, run.exitCode ?? null, run.signal ?? null, run.failureCode ?? null,
      run.interruptionClassification ?? null, run.approvalLifecycleVersion, run.approvalLifecycle, run.approvalRequestedAt ?? null,
      run.approvalExpiresAt ?? null, run.approvalDecisionType ?? null, run.approvalInvalidationReason ?? null, run.approvalActorRef ?? null,
      run.recoveryClass, run.recoveryEligible ? 1 : 0, run.recoveryReason ?? null, run.recoverySourceRunId ?? null,
      run.successorRunId ?? null, run.reproposalAt ?? null, run.recoveryAttemptCount, run.lastRecoveryRequestId ?? null,
      run.recoveryTerminalReason ?? null, run.auditSeq, run.schemaVersion, run.version, run.reconciliationOwner ?? null,
      run.reconciliationLeaseUntil ?? null, run.reconciliationFence ?? 0, run.updatedAt,
    ];
    this.db.prepare(`INSERT INTO agent_runs(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...values);
  }

  private appendAgentRunEventInside(e: DurableAgentRunEvent, mode: 'strict' | 'idempotent' = 'idempotent'): void {
    try {
      const inserted = this.db.prepare(
        `INSERT INTO agent_run_events(event_id,run_id,seq,at,type,prior_state,next_state,reason,correlation_id,source,schema_version)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(e.eventId, e.runId, e.seq, e.at, e.type, e.priorState ?? null, e.nextState, e.reason ?? null, e.correlationId, e.source, e.schemaVersion);
      if (Number(inserted.changes ?? 0) !== 1) throw new RecoveryEventInsertError('RECOVERY_EVENT_INSERT_FAILED');
      return;
    } catch (error) {
      const existing = this.db.prepare('SELECT * FROM agent_run_events WHERE event_id = ?').get(e.eventId) as AgentRunEventRow | undefined;
      if (!existing) {
        const sameSeq = this.db.prepare('SELECT * FROM agent_run_events WHERE run_id = ? AND seq = ?').get(e.runId, e.seq) as AgentRunEventRow | undefined;
        if (sameSeq) throw new RecoveryEventInsertError('RECOVERY_EVENT_SEQUENCE_CONFLICT');
        throw new RecoveryEventInsertError('RECOVERY_EVENT_INSERT_FAILED');
      }
      if (eventEquivalent(rowToAgentRunEvent(existing), e)) {
        if (mode === 'strict') throw new RecoveryEventInsertError('RECOVERY_EVENT_ID_COLLISION');
        return;
      }
      throw new RecoveryEventInsertError('RECOVERY_EVENT_CONTENT_MISMATCH');
    }
  }

  private loadAgentRunEventsInside(runId: string): DurableAgentRunEvent[] {
    return (this.db.prepare('SELECT * FROM agent_run_events WHERE run_id = ? ORDER BY seq ASC').all(runId) as unknown as AgentRunEventRow[]).map(rowToAgentRunEvent);
  }

  private failAgentRunReproposalPhase(phase: AgentRunReproposalFaultPhase): void {
    if (this.agentRunReproposalFaultPhase === phase) throw new AgentRunReproposalFault(phase);
  }

  private tx(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    }
  }

  private tableColumns(table: string): Array<{ name: string; type: string; notnull: number; pk: number; dflt_value: string | null }> {
    return this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; type: string; notnull: number; pk: number; dflt_value: string | null }>;
  }

  private addColumnIfMissing(table: string, column: string, definition: string): void {
    if (!this.tableColumns(table).some((entry) => entry.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }

  private hasDurableObjects(): boolean {
    const row = this.db.prepare(
      `SELECT name FROM sqlite_master
       WHERE type IN ('table','index','trigger','view')
       AND name NOT LIKE 'sqlite_%'
       AND name != 'schema_meta'
       LIMIT 1`,
    ).get() as { name: string } | undefined;
    return row !== undefined;
  }

  private assertAgentRunSchema(): void {
    for (const [table, columns] of Object.entries(EXPECTED_AGENT_TABLES)) this.assertColumns(table, columns, true);
    for (const index of EXPECTED_AGENT_INDEXES) this.assertIndex(index.table, index.name, index.columns, index.unique, index.partial);
    this.assertUniqueIndex('agent_run_events', ['run_id', 'seq']);
    for (const key of EXPECTED_AGENT_FOREIGN_KEYS) this.assertForeignKey(key.table, key.foreignTable, key.columns, key.foreignColumns, key.onDelete);
  }

  private assertSchemaMeta(): void {
    this.assertColumns('schema_meta', EXPECTED_SCHEMA_META_COLUMNS);
    const rows = this.db.prepare('SELECT value FROM schema_meta WHERE key = ?').all('schema_version') as Array<{ value: string }>;
    if (rows.length !== 1) throw new Error(`db schema v${SCHEMA_VERSION} schema_meta must contain exactly one schema_version row`);
    if (rows[0]?.value !== String(SCHEMA_VERSION)) throw new Error(`db schema v${SCHEMA_VERSION} schema_meta has incompatible schema_version`);
  }

  private assertColumns(table: string, expected: Record<string, ExpectedColumn>, exact = false): void {
    const columns = this.tableColumns(table);
    const actual = new Map(columns.map((column) => [column.name, column]));
    if (actual.size === 0) throw new Error(`db schema v${SCHEMA_VERSION} missing table ${table}`);
    for (const [name, requirement] of Object.entries(expected)) {
      const column = actual.get(name);
      if (!column) throw new Error(`db schema v${SCHEMA_VERSION} missing ${table}.${name}`);
      if (column.type.toUpperCase() !== requirement.type) throw new Error(`db schema v${SCHEMA_VERSION} has incompatible ${table}.${name} type`);
      if (requirement.notnull && column.notnull !== 1) throw new Error(`db schema v${SCHEMA_VERSION} has nullable ${table}.${name}`);
      if (requirement.pk !== undefined && column.pk !== requirement.pk) throw new Error(`db schema v${SCHEMA_VERSION} missing primary key on ${table}.${name}`);
      if (requirement.dflt !== undefined && column.dflt_value !== requirement.dflt) throw new Error(`db schema v${SCHEMA_VERSION} has incompatible default on ${table}.${name}`);
    }
    if (exact) {
      const expectedNames = new Set(Object.keys(expected));
      for (const column of columns) if (!expectedNames.has(column.name)) throw new Error(`db schema v${SCHEMA_VERSION} has unexpected ${table}.${column.name}`);
    }
  }

  private assertIndex(table: string, indexName: string, columns: string[], unique: boolean, partial?: string): void {
    const indexes = this.db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string; unique: number; partial: number }>;
    const found = indexes.find((index) => index.name === indexName);
    if (!found) throw new Error(`db schema v${SCHEMA_VERSION} missing index ${indexName}`);
    if (Boolean(found.unique) !== unique) throw new Error(`db schema v${SCHEMA_VERSION} has incompatible uniqueness for ${indexName}`);
    const actual = (this.db.prepare(`PRAGMA index_info(${indexName})`).all() as Array<{ name: string }>).map((row) => row.name);
    if (actual.join('\0') !== columns.join('\0')) throw new Error(`db schema v${SCHEMA_VERSION} has incompatible columns for ${indexName}`);
    if (partial !== undefined) {
      const row = this.db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(indexName) as { sql?: string } | undefined;
      if (!row?.sql?.includes(partial)) throw new Error(`db schema v${SCHEMA_VERSION} has incompatible partial predicate for ${indexName}`);
    } else if (found.partial !== 0) {
      throw new Error(`db schema v${SCHEMA_VERSION} has unexpected partial predicate for ${indexName}`);
    }
  }

  private assertUniqueIndex(table: string, columns: string[]): void {
    const indexes = this.db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string; unique: number }>;
    for (const index of indexes.filter((candidate) => candidate.unique === 1)) {
      const actual = (this.db.prepare(`PRAGMA index_info(${index.name})`).all() as Array<{ name: string }>).map((row) => row.name);
      if (actual.join('\0') === columns.join('\0')) return;
    }
    throw new Error(`db schema v${SCHEMA_VERSION} missing unique index on ${table}(${columns.join(',')})`);
  }

  private assertForeignKey(table: string, foreignTable: string, columns: string[], foreignColumns: string[], onDelete: string): void {
    const keys = this.db.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{ table: string; from: string; to: string; on_delete: string; id: number; seq: number }>;
    const grouped = new Map<number, Array<{ table: string; from: string; to: string; on_delete: string; seq: number }>>();
    for (const key of keys) grouped.set(key.id, [...(grouped.get(key.id) ?? []), key]);
    for (const group of grouped.values()) {
      const ordered = group.sort((a, b) => a.seq - b.seq);
      if (
        ordered[0]?.table === foreignTable &&
        ordered[0]?.on_delete.toUpperCase() === onDelete &&
        ordered.map((key) => key.from).join('\0') === columns.join('\0') &&
        ordered.map((key) => key.to).join('\0') === foreignColumns.join('\0')
      ) return;
    }
    throw new Error(`db schema v${SCHEMA_VERSION} missing foreign key ${table}(${columns.join(',')}) -> ${foreignTable}(${foreignColumns.join(',')})`);
  }

  private loadReconciliationClaim(runId: string, owner: string): AgentRunReconciliationClaim | undefined {
    const row = this.db.prepare('SELECT run_id,reconciliation_owner,reconciliation_fence,reconciliation_lease_until,version FROM agent_runs WHERE run_id=? AND reconciliation_owner=?').get(runId, owner) as { run_id: string; reconciliation_owner: string; reconciliation_fence: number; reconciliation_lease_until: number; version: number } | undefined;
    return row ? { runId: row.run_id, owner: row.reconciliation_owner, fence: row.reconciliation_fence, leaseUntil: row.reconciliation_lease_until, version: row.version } : undefined;
  }
}

function rowToConversation(r: Record<string, unknown>): Conversation {
  return { id: r.id as string, ownerScope: r.owner_scope as string, workspaceScope: r.workspace_scope as string, title: r.title as string, memoryMode: r.memory_mode as Conversation['memoryMode'], createdAt: r.created_at as number, updatedAt: r.updated_at as number };
}
function rowToMessage(r: Record<string, unknown>): Message {
  return { id: r.id as string, conversationId: r.conversation_id as string, role: r.role as Message['role'], content: r.content as string, status: r.status as Message['status'], requestId: (r.request_id as string) ?? undefined, modelId: (r.model_id as string) ?? undefined, providerId: (r.provider_id as string) ?? undefined, createdAt: r.created_at as number, durable: (r.durable as number) === 1, supersedesId: (r.supersedes_id as string) ?? undefined };
}
function rowToSummary(r: Record<string, unknown>): Summary {
  return { id: r.id as string, conversationId: r.conversation_id as string, sourceFromMessageId: r.source_from_message_id as string, sourceToMessageId: r.source_to_message_id as string, summary: JSON.parse(r.summary_json as string), version: r.version as number, createdAt: r.created_at as number };
}
