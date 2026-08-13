/**
 * MigraAI Engine — PostgreSQL agent run journal (Group 4).
 *
 * The state machine is NOT redesigned here. Every guard, every ordering rule and
 * every terminal-state meaning is the one in sqliteStore.ts. What changes is the
 * mechanism by which those guarantees are obtained, because the two engines get
 * them from completely different places.
 *
 * ─── The one thing a literal port gets wrong ────────────────────────────────
 *
 * SQLite serialises writers with a database-wide write lock, so this shape is
 * safe there:
 *
 *     const row = SELECT * FROM agent_runs WHERE run_id = ?   // read
 *     ...guards evaluated in JS against `row`...
 *     UPDATE agent_runs SET audit_seq = audit_seq + 1 WHERE run_id = ? AND state = ?
 *     INSERT INTO agent_run_events (seq) VALUES (row.audit_seq + 1)
 *
 * Under PostgreSQL READ COMMITTED it is not. Two concurrent transactions both
 * read audit_seq = 5. The UPDATE guard (`AND state = prior`) does still make the
 * *transition* exactly-once for a state-changing transition — the loser's
 * predicate fails on re-evaluation after it waits for the row lock. But two
 * cases break:
 *
 *   1. A self-transition (nextState === prior, which the state machine permits
 *      for repeated events on the same state) leaves `state` unchanged, so the
 *      loser's `AND state = prior` STILL MATCHES. Both transactions commit a
 *      transition.
 *
 *   2. Worse, both then insert an event at seq = 5 + 1 = 6, because each derived
 *      the sequence number from its own stale pre-read. That is a duplicate
 *      audit sequence — precisely the thing the journal exists to prevent. The
 *      UNIQUE (run_id, seq) constraint catches it, but as a thrown error, not as
 *      the `false` return the contract promises.
 *
 * So the read, the guards and the increment are collapsed into ONE statement,
 * with two independent protections:
 *
 *   • The CTE reads `FOR UPDATE`. Under READ COMMITTED a locking read follows
 *     the update chain and re-fetches the newest committed version of the row,
 *     so contenders queue on the lock and evaluate their guards against the
 *     winner's committed result rather than against a stale snapshot. This is
 *     the primary mechanism and it is what closes the check-then-act window.
 *
 *   • The event's sequence number is taken from the UPDATE's own
 *     `RETURNING audit_seq` (post-increment) rather than from anything read
 *     beforehand, so the sequence stays correct even if the row lock were ever
 *     weakened.
 *
 * Verified by mutation rather than assumed: reverting BOTH to the literal shape
 * fails three tests in postgresAgentRunConcurrency.test.ts (single-winner CAS,
 * self-transition parity, and gap-free sequencing). Reverting only the
 * RETURNING still passes — the row lock alone is sufficient — so the two are
 * genuinely redundant, and the belt-and-braces is deliberate, not accidental.
 *
 * This yields the identical observable contract: `true` for the single winner,
 * `false` for everyone else, and one event per successful transition.
 */

import type { PoolClient } from 'pg';
import { validateRecoverySourceProvenance } from '../../recoverySourceProvenance.js';
import type {
  AgentRunReproposalInput,
  AgentRunReproposalResult,
  AgentRunTransitionInput,
  AgentRunReconciliationClaim,
  DurableAgentRun,
  DurableAgentRunEvent,
  DurableAgentRunState,
  DurableAgentRunTombstone,
} from '../types.js';

/**
 * Terminal states, transcribed from sqliteStore.ts's `isAgentTerminal`.
 *
 * Kept as a SQL fragment because these guards must be evaluated by the database
 * inside the same statement as the update — evaluating them in JS would
 * reintroduce exactly the check-then-act window this module exists to close.
 */
const TERMINAL_SQL = `('COMPLETED','REJECTED','EXPIRED','STALE','FAILED','CANCELLED')`;

const AGENT_TERMINAL_STATES: ReadonlySet<string> = new Set([
  'COMPLETED', 'REJECTED', 'EXPIRED', 'STALE', 'FAILED', 'CANCELLED',
]);

export function isAgentTerminal(state: string): boolean {
  return AGENT_TERMINAL_STATES.has(state);
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const optNum = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v));
const optStr = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));

/** SQLite's limit clamp, reproduced so both engines truncate identically. */
const clampLimit = (n: number): number => Math.max(1, Math.min(Math.floor(n) || 1, 5000));

/**
 * Column order is the SQLite insert's, unchanged, so the two can be diffed
 * line-by-line. Scope columns are appended from the transaction-local setting
 * rather than taken from the caller — the run cannot be filed under a scope the
 * caller is not currently operating in, and RLS's WITH CHECK enforces that even
 * if this code were wrong.
 */
const RUN_COLUMNS = [
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
  'reconciliation_fence', 'updated_at', 'domain_kind', 'domain_schema_version', 'domain_payload_json',
] as const;

function runValues(run: DurableAgentRun): unknown[] {
  return [
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
    run.domainKind ?? null, run.domainSchemaVersion ?? null, run.domainPayloadJson ?? null,
  ];
}

export class RecoveryEventInsertError extends Error {
  constructor(readonly code: 'RECOVERY_EVENT_INSERT_FAILED' | 'RECOVERY_EVENT_SEQUENCE_CONFLICT'
    | 'RECOVERY_EVENT_ID_COLLISION' | 'RECOVERY_EVENT_CONTENT_MISMATCH') {
    super(code);
    this.name = 'RecoveryEventInsertError';
  }
}

function rowToAgentRunEvent(r: Record<string, unknown>): DurableAgentRunEvent {
  return {
    eventId: String(r.event_id), runId: String(r.run_id), seq: num(r.seq), at: num(r.at),
    type: String(r.type),
    priorState: r.prior_state ? (String(r.prior_state) as DurableAgentRunState) : undefined,
    nextState: String(r.next_state) as DurableAgentRunState,
    reason: r.reason === null || r.reason === undefined ? undefined : String(r.reason),
    correlationId: String(r.correlation_id),
    source: String(r.source) as DurableAgentRunEvent['source'],
    schemaVersion: num(r.schema_version),
  };
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

/**
 * Append an event, reproducing SQLite's idempotent/strict ladder.
 *
 * The mechanism has to differ. SQLite lets the INSERT throw and then runs
 * diagnostic SELECTs on the same connection; PostgreSQL aborts the entire
 * transaction on a constraint violation, so every subsequent statement would
 * fail with "current transaction is aborted". Rather than wrap each append in a
 * SAVEPOINT, the conflict is made non-throwing with ON CONFLICT DO NOTHING and
 * then classified — same outcomes, no aborted transaction, no savepoint cost.
 */
export async function appendAgentRunEvent(
  client: PoolClient,
  e: DurableAgentRunEvent,
  mode: 'strict' | 'idempotent' = 'idempotent',
): Promise<void> {
  const values = [
    e.eventId, e.runId, e.seq, e.at, e.type, e.priorState ?? null, e.nextState,
    e.reason ?? null, e.correlationId, e.source, e.schemaVersion,
  ];
  const inserted = await client.query(
    `INSERT INTO agent_run_events
       (event_id, run_id, seq, at, type, prior_state, next_state, reason,
        correlation_id, source, schema_version, owner_scope, workspace_scope)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
             current_setting('migrapilot.owner_scope'),
             current_setting('migrapilot.workspace_scope'))
     ON CONFLICT DO NOTHING`,
    values,
  );
  if (inserted.rowCount === 1) return;

  const byId = await client.query(
    `SELECT * FROM agent_run_events WHERE event_id = $1`, [e.eventId]);
  if (byId.rowCount !== 1) {
    // No row with this id, so the conflict was on (run_id, seq): something else
    // already occupies this position in the run's audit sequence.
    const bySeq = await client.query(
      `SELECT 1 FROM agent_run_events WHERE run_id = $1 AND seq = $2`, [e.runId, e.seq]);
    throw new RecoveryEventInsertError(
      bySeq.rowCount === 1 ? 'RECOVERY_EVENT_SEQUENCE_CONFLICT' : 'RECOVERY_EVENT_INSERT_FAILED');
  }
  if (eventEquivalent(rowToAgentRunEvent(byId.rows[0] as Record<string, unknown>), e)) {
    if (mode === 'strict') throw new RecoveryEventInsertError('RECOVERY_EVENT_ID_COLLISION');
    return;
  }
  throw new RecoveryEventInsertError('RECOVERY_EVENT_CONTENT_MISMATCH');
}

/**
 * Insert a run together with its creation event.
 *
 * Matches SQLite exactly, including the detail that the created event is forced
 * to seq 1 and `audit_seq` is then set to 1 — so a run's first transition event
 * is seq 2, not seq 1. Getting this wrong shifts every subsequent sequence
 * number by one and silently breaks audit parity between the two engines.
 *
 * A duplicate run_id is an error, not a merge, as in SQLite.
 */
export async function insertAgentRun(
  client: PoolClient,
  run: DurableAgentRun,
  createdEvent: DurableAgentRunEvent,
): Promise<void> {
  await insertAgentRunRow(client, run);
  await appendAgentRunEvent(client, { ...createdEvent, seq: 1 });
  await client.query(`UPDATE agent_runs SET audit_seq = 1 WHERE run_id = $1`, [run.runId]);
}

/**
 * The row insert alone, without the creation event. Reproposal needs this
 * because it writes the successor's first two events itself, at fixed
 * sequences — mirroring SQLite's private `insertAgentRunInside`.
 */
async function insertAgentRunRow(client: PoolClient, run: DurableAgentRun): Promise<void> {
  const values = runValues(run);
  const placeholders = values.map((_, i) => `$${i + 1}`).join(',');
  await client.query(
    `INSERT INTO agent_runs (${RUN_COLUMNS.join(',')}, owner_scope, workspace_scope)
     VALUES (${placeholders},
             current_setting('migrapilot.owner_scope'),
             current_setting('migrapilot.workspace_scope'))`,
    values,
  );
}

/**
 * CAS transition. Returns true only for the transaction that actually moved the
 * run, exactly as the SQLite implementation does.
 *
 * Caller must already be inside a transaction with the scope set (withScope) —
 * the row lock taken here must be held until that transaction commits, and the
 * event insert must be atomic with the state change.
 */
export async function transitionAgentRun(
  client: PoolClient,
  input: AgentRunTransitionInput,
): Promise<boolean> {
  const p = input.patch;
  const rec = input.reconciliation;
  const nextTerminal = isAgentTerminal(input.nextState);

  // Guards live in the CTE's WHERE, not in JS. `FOR UPDATE` serialises
  // contenders on this row and re-reads the latest committed version, so a
  // loser evaluates its guards against the winner's result and correctly
  // declines.
  const guards: string[] = [
    `cur.state NOT IN ${TERMINAL_SQL}`,
  ];
  const values: unknown[] = [input.runId];
  const ph = (v: unknown): string => `$${values.push(v)}`;

  if (input.expectedState !== undefined) {
    guards.push(`cur.state = ${ph(input.expectedState)}`);
  }
  if (rec) {
    guards.push(`cur.reconciliation_owner = ${ph(rec.owner)}`);
    guards.push(`cur.reconciliation_fence = ${ph(rec.fence)}`);
    // COALESCE mirrors SQLite's `(lease ?? -1) < leaseValidAt` rejection: a NULL
    // lease must fail the comparison, not evaluate to NULL and silently drop the
    // row from the update.
    guards.push(`COALESCE(cur.reconciliation_lease_until, -1) >= ${ph(rec.leaseValidAt)}`);
    if (rec.expectedVersion !== undefined) {
      guards.push(`cur.version = ${ph(rec.expectedVersion)}`);
    }
  }

  // terminalAt: explicit patch wins, else stamp `at` when entering a terminal
  // state, else leave whatever is there (COALESCE against the existing column).
  const terminalAt = p?.terminalAt ?? (nextTerminal ? input.at : null);

  const sql = `
    WITH cur AS (
      SELECT run_id, state, audit_seq, version, correlation_id,
             reconciliation_owner, reconciliation_lease_until, reconciliation_fence
      FROM agent_runs
      WHERE run_id = $1
      FOR UPDATE
    )
    UPDATE agent_runs r SET
      state = ${ph(input.nextState)},
      approval_displayed_at = COALESCE(${ph(p?.approvalDisplayedAt ?? null)}, r.approval_displayed_at),
      approval_decision_at = COALESCE(${ph(p?.approvalDecisionAt ?? null)}, r.approval_decision_at),
      execution_started_at = COALESCE(${ph(p?.executionStartedAt ?? null)}, r.execution_started_at),
      terminal_at = COALESCE(${ph(terminalAt)}, r.terminal_at),
      result_json = COALESCE(${ph(p?.resultJson ?? null)}, r.result_json),
      error_json = COALESCE(${ph(p?.errorJson ?? null)}, r.error_json),
      exit_code = COALESCE(${ph(p && 'exitCode' in p ? p.exitCode ?? null : null)}, r.exit_code),
      signal = COALESCE(${ph(p?.signal ?? null)}, r.signal),
      failure_code = COALESCE(${ph(p?.failureCode ?? null)}, r.failure_code),
      interruption_classification = COALESCE(${ph(p?.interruptionClassification ?? null)}, r.interruption_classification),
      containment_unit = COALESCE(${ph(p?.containmentUnit ?? null)}, r.containment_unit),
      containment_binding = COALESCE(${ph(p?.containmentBinding ?? null)}, r.containment_binding),
      approval_lifecycle = COALESCE(${ph(p?.approvalLifecycle ?? null)}, r.approval_lifecycle),
      approval_requested_at = COALESCE(${ph(p?.approvalRequestedAt ?? null)}, r.approval_requested_at),
      approval_expires_at = COALESCE(${ph(p?.approvalExpiresAt ?? null)}, r.approval_expires_at),
      approval_decision_type = COALESCE(${ph(p?.approvalDecisionType ?? null)}, r.approval_decision_type),
      approval_invalidation_reason = COALESCE(${ph(p?.approvalInvalidationReason ?? null)}, r.approval_invalidation_reason),
      approval_actor_ref = COALESCE(${ph(p?.approvalActorRef ?? null)}, r.approval_actor_ref),
      recovery_class = COALESCE(${ph(p?.recoveryClass ?? null)}, r.recovery_class),
      recovery_eligible = COALESCE(${ph(p?.recoveryEligible === undefined ? null : p.recoveryEligible ? 1 : 0)}, r.recovery_eligible),
      recovery_reason = COALESCE(${ph(p?.recoveryReason ?? null)}, r.recovery_reason),
      successor_run_id = COALESCE(${ph(p?.successorRunId ?? null)}, r.successor_run_id),
      reproposal_at = COALESCE(${ph(p?.reproposalAt ?? null)}, r.reproposal_at),
      recovery_attempt_count = COALESCE(${ph(p?.recoveryAttemptCount ?? null)}, r.recovery_attempt_count),
      last_recovery_request_id = COALESCE(${ph(p?.lastRecoveryRequestId ?? null)}, r.last_recovery_request_id),
      recovery_terminal_reason = COALESCE(${ph(p?.recoveryTerminalReason ?? null)}, r.recovery_terminal_reason),
      domain_kind = COALESCE(${ph(p?.domainKind ?? null)}, r.domain_kind),
      domain_schema_version = COALESCE(${ph(p?.domainSchemaVersion ?? null)}, r.domain_schema_version),
      domain_payload_json = COALESCE(${ph(p?.domainPayloadJson ?? null)}, r.domain_payload_json),
      -- A terminal state releases the reconciliation lease, matching SQLite.
      reconciliation_owner = ${nextTerminal ? 'NULL' : 'cur.reconciliation_owner'},
      reconciliation_lease_until = ${nextTerminal ? 'NULL' : 'cur.reconciliation_lease_until'},
      audit_seq = r.audit_seq + 1,
      version = r.version + 1,
      updated_at = ${ph(input.at)}
    FROM cur
    WHERE r.run_id = cur.run_id
      AND ${guards.join('\n      AND ')}
    RETURNING cur.state AS prior_state, r.audit_seq AS new_seq, r.correlation_id
  `;

  const res = await client.query(sql, values);
  if (res.rowCount !== 1) return false;

  const row = res.rows[0] as { prior_state: string; new_seq: string; correlation_id: string };
  const seq = num(row.new_seq);

  // Sequence comes from the UPDATE's own post-increment value, never from a
  // value read before the update. In the uncontended case this is identical to
  // SQLite's `row.audit_seq + 1`.
  await appendAgentRunEvent(client, {
    eventId: input.eventId ?? `${input.runId}:${seq}:${input.eventType}`,
    runId: input.runId,
    seq,
    at: input.at,
    type: input.eventType,
    priorState: row.prior_state as DurableAgentRunState,
    nextState: input.nextState,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    correlationId: row.correlation_id,
    source: input.source,
    schemaVersion: 1,
  });

  return true;
}

/**
 * Append a free-standing event, assigning the next audit sequence.
 *
 * `FOR UPDATE` again: the sequence must be allocated under the row lock, or two
 * concurrent appends allocate the same one.
 */
export async function appendAgentRunEventNext(
  client: PoolClient,
  event: Omit<DurableAgentRunEvent, 'seq'>,
): Promise<void> {
  const res = await client.query(
    `UPDATE agent_runs SET audit_seq = audit_seq + 1, updated_at = $2
     WHERE run_id = $1
     RETURNING audit_seq`,
    [event.runId, event.at],
  );
  if (res.rowCount !== 1) throw new Error(`unknown Agent run ${event.runId}`);
  await appendAgentRunEvent(client, { ...event, seq: num(res.rows[0].audit_seq) });
}

/**
 * Append an event under a reconciliation fence, returning the still-held claim.
 *
 * SQLite inserts the event first and then runs a guarded UPDATE, throwing if
 * that UPDATE unexpectedly matches nothing. Here the row is locked and the
 * guards evaluated FIRST, so the later UPDATE cannot lose — but the defensive
 * throw is kept, because if it ever fires it means the locking assumption
 * itself is broken, which must not pass silently.
 *
 * The insert stays ON CONFLICT DO NOTHING with an `undefined` return, matching
 * SQLite's `INSERT OR IGNORE`: replaying an already-recorded fenced event is a
 * no-op, not an error and not a second audit entry.
 */
export async function appendAgentRunEventUnderFence(
  client: PoolClient,
  input: {
    runId: string;
    expectedState?: DurableAgentRunState;
    at: number;
    source: 'RECONCILIATION';
    eventType: string;
    reason?: string;
    reconciliation: { owner: string; fence: number; leaseValidAt: number; expectedVersion: number };
    eventId?: string;
  },
): Promise<AgentRunReconciliationClaim | undefined> {
  const rec = input.reconciliation;
  const guards: string[] = [`state NOT IN ${TERMINAL_SQL}`];
  const values: unknown[] = [input.runId];
  const ph = (v: unknown): string => `$${values.push(v)}`;

  if (input.expectedState !== undefined) guards.push(`state = ${ph(input.expectedState)}`);
  guards.push(`reconciliation_owner = ${ph(rec.owner)}`);
  guards.push(`reconciliation_fence = ${ph(rec.fence)}`);
  guards.push(`COALESCE(reconciliation_lease_until, -1) >= ${ph(rec.leaseValidAt)}`);
  guards.push(`version = ${ph(rec.expectedVersion)}`);

  const locked = await client.query(
    `SELECT state, audit_seq, correlation_id FROM agent_runs
     WHERE run_id = $1 AND ${guards.join(' AND ')}
     FOR UPDATE`,
    values,
  );
  if (locked.rowCount !== 1) return undefined;

  const row = locked.rows[0] as { state: string; audit_seq: string; correlation_id: string };
  const state = row.state as DurableAgentRunState;
  const seq = num(row.audit_seq) + 1;

  const inserted = await client.query(
    `INSERT INTO agent_run_events
       (event_id, run_id, seq, at, type, prior_state, next_state, reason,
        correlation_id, source, schema_version, owner_scope, workspace_scope)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
             current_setting('migrapilot.owner_scope'),
             current_setting('migrapilot.workspace_scope'))
     ON CONFLICT DO NOTHING`,
    [
      input.eventId ?? `${input.runId}:${seq}:${input.eventType}`,
      input.runId, seq, input.at, input.eventType,
      state, state, input.reason ?? null, row.correlation_id, input.source, 1,
    ],
  );
  if (inserted.rowCount !== 1) return undefined;

  const updated = await client.query(
    `UPDATE agent_runs SET audit_seq = audit_seq + 1, version = version + 1, updated_at = $2
     WHERE run_id = $1
     RETURNING run_id, reconciliation_owner, reconciliation_fence,
               reconciliation_lease_until, version`,
    [input.runId, input.at],
  );
  if (updated.rowCount !== 1) throw new Error('fenced Agent event append lost its CAS after insert');

  const u = updated.rows[0] as Record<string, unknown>;
  return {
    runId: String(u.run_id),
    owner: String(u.reconciliation_owner),
    fence: num(u.reconciliation_fence),
    leaseUntil: num(u.reconciliation_lease_until),
    version: num(u.version),
  };
}

/**
 * Acquire a reconciliation lease, bumping the fence token.
 *
 * A single guarded UPDATE, as in SQLite. The fence increments on every
 * successful claim, so a claim taken after an expiry always outranks the stale
 * holder's — that is what lets `transitionAgentRun` reject writes from an owner
 * whose lease was stolen while it was paused.
 */
export async function claimAgentRunReconciliation(
  client: PoolClient,
  runId: string,
  owner: string,
  leaseUntil: number,
  now: number,
): Promise<AgentRunReconciliationClaim | undefined> {
  const res = await client.query(
    `UPDATE agent_runs SET
       reconciliation_owner = $2,
       reconciliation_lease_until = $3,
       reconciliation_fence = reconciliation_fence + 1,
       version = version + 1,
       updated_at = $4
     WHERE run_id = $1
       AND state NOT IN ${TERMINAL_SQL}
       AND (reconciliation_owner IS NULL
            OR reconciliation_lease_until IS NULL
            OR reconciliation_lease_until < $4)
     RETURNING run_id, reconciliation_owner, reconciliation_fence,
               reconciliation_lease_until, version`,
    [runId, owner, leaseUntil, now],
  );
  if (res.rowCount !== 1) return undefined;
  const r = res.rows[0] as Record<string, unknown>;
  return {
    runId: String(r.run_id),
    owner: String(r.reconciliation_owner),
    fence: num(r.reconciliation_fence),
    leaseUntil: num(r.reconciliation_lease_until),
    version: num(r.version),
  };
}

/**
 * Renew an existing lease. Requires the caller to still hold both the owner
 * identity AND the fence it was issued — a renewal cannot resurrect a lease that
 * someone else has already claimed, because the fence will have moved.
 */
export async function renewAgentRunReconciliation(
  client: PoolClient,
  runId: string,
  owner: string,
  fence: number,
  leaseUntil: number,
  now: number,
): Promise<AgentRunReconciliationClaim | undefined> {
  const res = await client.query(
    `UPDATE agent_runs SET
       reconciliation_lease_until = $4,
       version = version + 1,
       updated_at = $5
     WHERE run_id = $1
       AND reconciliation_owner = $2
       AND reconciliation_fence = $3
       AND reconciliation_lease_until >= $5
       AND state NOT IN ${TERMINAL_SQL}
     RETURNING run_id, reconciliation_owner, reconciliation_fence,
               reconciliation_lease_until, version`,
    [runId, owner, fence, leaseUntil, now],
  );
  if (res.rowCount !== 1) return undefined;
  const r = res.rows[0] as Record<string, unknown>;
  return {
    runId: String(r.run_id),
    owner: String(r.reconciliation_owner),
    fence: num(r.reconciliation_fence),
    leaseUntil: num(r.reconciliation_lease_until),
    version: num(r.version),
  };
}

/**
 * Create a successor run for a terminal source, consuming its recovery
 * opportunity.
 *
 * Every eligibility rule is SQLite's, in SQLite's order, because the order is
 * what distinguishes the failure codes callers branch on. Notably the
 * idempotency check comes FIRST: replaying a request id that already produced a
 * successor returns that successor with `created: false`, rather than reporting
 * a conflict.
 *
 * Provenance is revalidated here rather than trusted from the caller — both
 * `trusted` (the history is coherent) and `eligible` (policy permits recovery)
 * must hold. Checking only `trusted` would let deliberately non-recoverable
 * outcomes be reproposed.
 *
 * The source row is locked FOR UPDATE up front, so the linkage CAS at the end
 * cannot lose. Its defensive throw is kept anyway: if it ever fires, the
 * locking assumption is broken and that must not pass silently.
 *
 * ─── Why the SAVEPOINT is not optional ──────────────────────────────────────
 *
 * SQLite runs this whole body inside `this.tx()`, so a throw anywhere unwinds
 * every write. Here the method must RETURN a failure code rather than throw, and
 * the surrounding transaction belongs to the caller — so simply catching the
 * error and returning would COMMIT a half-built reproposal: a successor run
 * inserted, its lineage events missing, and the source never linked. That is
 * far worse than the failure being reported.
 *
 * A savepoint gives back exactly the all-or-nothing the SQLite version gets for
 * free, without seizing control of the caller's transaction.
 */
export async function reproposeAgentRun(
  client: PoolClient,
  input: AgentRunReproposalInput,
): Promise<AgentRunReproposalResult> {
  await client.query('SAVEPOINT repropose');
  const abort = async (result: AgentRunReproposalResult): Promise<AgentRunReproposalResult> => {
    await client.query('ROLLBACK TO SAVEPOINT repropose');
    return result;
  };
  try {
    const found = await client.query(
      `SELECT * FROM agent_runs WHERE run_id = $1 FOR UPDATE`, [input.sourceRunId]);
    if (found.rowCount !== 1) return abort({ ok: false, code: 'UNKNOWN_SOURCE' });
    const source = found.rows[0] as Record<string, unknown>;

    if (String(source.last_recovery_request_id ?? '') === input.requestId && source.successor_run_id) {
      const successor = await loadAgentRun(client, String(source.successor_run_id));
      await client.query('RELEASE SAVEPOINT repropose');
      return successor
        ? { ok: true, created: false, successor }
        : { ok: false, code: 'PARTIAL_FAILURE' };
    }

    const state = String(source.state) as DurableAgentRunState;
    if (!isAgentTerminal(state)) return abort({ ok: false, code: 'SOURCE_NOT_TERMINAL' });
    if (num(source.version) !== input.sourceExpectedVersion) {
      return abort({ ok: false, code: 'SOURCE_VERSION_CHANGED' });
    }
    if (source.reconciliation_owner && num(source.reconciliation_lease_until) >= input.at) {
      return abort({ ok: false, code: 'SOURCE_UNDER_RECONCILIATION' });
    }
    if (source.successor_run_id) return abort({ ok: false, code: 'ACTIVE_SUCCESSOR_EXISTS' });

    const active = await client.query(
      `SELECT run_id FROM agent_runs
       WHERE recovery_source_run_id = $1 AND state NOT IN ${TERMINAL_SQL} LIMIT 1`,
      [input.sourceRunId]);
    if (active.rowCount === 1) return abort({ ok: false, code: 'ACTIVE_SUCCESSOR_EXISTS' });

    const sourceRun = rowToAgentRun(source);
    const sourceEvents = await loadAgentRunEvents(client, input.sourceRunId, 5000);
    const provenance = validateRecoverySourceProvenance({
      run: sourceRun,
      events: sourceEvents,
      workspaceIdentity: input.provenance.workspaceIdentity,
      allowedRecipes: input.provenance.allowedRecipes,
      now: input.at,
    });
    if (!provenance.trusted
      || !provenance.eligible
      || provenance.digest !== input.provenance.eventDigest
      || provenance.highestSeq !== input.provenance.highestSeq) {
      return abort({ ok: false, code: 'SOURCE_PROVENANCE_FAILED' });
    }

    await insertAgentRunRow(client, input.successor);
    await appendAgentRunEvent(client, { ...input.createdEvent, seq: 1 }, 'strict');
    await appendAgentRunEvent(client, { ...input.proposalEvent, seq: 2 }, 'strict');
    await client.query(`UPDATE agent_runs SET audit_seq = 2 WHERE run_id = $1`, [input.successor.runId]);

    const sourceAudit = num(source.audit_seq);
    await appendAgentRunEvent(client, {
      eventId: `${input.sourceRunId}:reproposal:${input.requestId}:requested`,
      runId: input.sourceRunId, seq: sourceAudit + 1, at: input.at,
      type: 'recovery.reproposal_requested', priorState: state, nextState: state,
      reason: input.requestId, correlationId: String(source.correlation_id),
      source: 'RECOVERY', schemaVersion: 1,
    }, 'strict');
    await appendAgentRunEvent(client, {
      eventId: `${input.sourceRunId}:reproposal:${input.requestId}:linked`,
      runId: input.sourceRunId, seq: sourceAudit + 2, at: input.at,
      type: 'recovery.successor_linked', priorState: state, nextState: state,
      reason: input.successor.runId, correlationId: String(source.correlation_id),
      source: 'RECOVERY', schemaVersion: 1,
    }, 'strict');

    // The recovery opportunity is consumed here, so stored eligibility is
    // cleared in the same CAS that records the linkage. Without this the row
    // would keep asserting it is recoverable after it no longer is.
    const linked = await client.query(
      `UPDATE agent_runs SET
         successor_run_id = $1, reproposal_at = $2,
         recovery_attempt_count = recovery_attempt_count + 1,
         last_recovery_request_id = $3, recovery_terminal_reason = $4,
         recovery_eligible = 0, recovery_class = 'SUCCESSOR_CREATED',
         audit_seq = audit_seq + 2, version = version + 1, updated_at = $5
       WHERE run_id = $6 AND version = $7 AND state IN ${TERMINAL_SQL}
         AND successor_run_id IS NULL
         AND (reconciliation_owner IS NULL OR reconciliation_lease_until IS NULL
              OR reconciliation_lease_until < $8)`,
      [
        input.successor.runId, input.at, input.requestId, 'SUCCESSOR_CREATED',
        input.at, input.sourceRunId, input.sourceExpectedVersion, input.at,
      ]);
    if (linked.rowCount !== 1) throw new Error('Agent reproposal source linkage lost its CAS');

    await client.query('RELEASE SAVEPOINT repropose');
    return { ok: true, created: true, successor: input.successor };
  } catch (error) {
    // Undo every partial write before reporting. Without this the caller would
    // commit a successor run with no lineage and an unlinked source.
    await client.query('ROLLBACK TO SAVEPOINT repropose').catch(() => undefined);
    if (error instanceof RecoveryEventInsertError) return { ok: false, code: error.code };
    return { ok: false, code: 'PARTIAL_FAILURE' };
  }
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/**
 * `pg` returns BIGINT as a string to avoid silent precision loss, so EVERY
 * numeric column is converted explicitly. A column left unconverted here would
 * surface as a string flowing into arithmetic somewhere far away from this file.
 */
export function rowToAgentRun(r: Record<string, unknown>): DurableAgentRun {
  return {
    runId: String(r.run_id), correlationId: String(r.correlation_id),
    externalRequestRef: optStr(r.external_request_ref),
    activationRef: String(r.activation_ref), workspaceIdentity: String(r.workspace_identity),
    workspaceRef: String(r.workspace_ref), recipeId: String(r.recipe_id),
    recipePolicyVersion: String(r.recipe_policy_version),
    proposalFingerprint: String(r.proposal_fingerprint), proposalHash: String(r.proposal_hash),
    snapshotId: String(r.snapshot_id), snapshotManifestDigest: String(r.snapshot_manifest_digest),
    executableDigest: String(r.executable_digest),
    containmentUnit: optStr(r.containment_unit), containmentBinding: optStr(r.containment_binding),
    state: String(r.state) as DurableAgentRunState,
    requestedAt: num(r.requested_at), proposalAt: optNum(r.proposal_at),
    approvalDisplayedAt: optNum(r.approval_displayed_at),
    approvalDecisionAt: optNum(r.approval_decision_at),
    executionStartedAt: optNum(r.execution_started_at),
    terminalAt: optNum(r.terminal_at), expiresAt: num(r.expires_at),
    timeoutMs: num(r.timeout_ms), outputLimitBytes: num(r.output_limit_bytes),
    mutationClassification: String(r.mutation_classification),
    networkPolicy: String(r.network_policy),
    expectedEffectsJson: String(r.expected_effects_json),
    previewJson: optStr(r.preview_json), resultJson: optStr(r.result_json),
    errorJson: optStr(r.error_json), exitCode: optNum(r.exit_code),
    signal: optStr(r.signal), failureCode: optStr(r.failure_code),
    interruptionClassification: optStr(r.interruption_classification),
    approvalLifecycleVersion: num(r.approval_lifecycle_version),
    approvalLifecycle: String(r.approval_lifecycle) as DurableAgentRun['approvalLifecycle'],
    approvalRequestedAt: optNum(r.approval_requested_at),
    approvalExpiresAt: optNum(r.approval_expires_at),
    approvalDecisionType: optStr(r.approval_decision_type) as DurableAgentRun['approvalDecisionType'],
    approvalInvalidationReason: optStr(r.approval_invalidation_reason),
    approvalActorRef: optStr(r.approval_actor_ref),
    recoveryClass: String(r.recovery_class) as DurableAgentRun['recoveryClass'],
    // Stored as BIGINT 0/1 to preserve the SQLite value domain exactly.
    recoveryEligible: num(r.recovery_eligible) === 1,
    recoveryReason: optStr(r.recovery_reason),
    recoverySourceRunId: optStr(r.recovery_source_run_id),
    successorRunId: optStr(r.successor_run_id),
    reproposalAt: optNum(r.reproposal_at),
    recoveryAttemptCount: num(r.recovery_attempt_count),
    lastRecoveryRequestId: optStr(r.last_recovery_request_id),
    recoveryTerminalReason: optStr(r.recovery_terminal_reason),
    auditSeq: num(r.audit_seq), schemaVersion: num(r.schema_version), version: num(r.version),
    reconciliationOwner: optStr(r.reconciliation_owner),
    reconciliationLeaseUntil: optNum(r.reconciliation_lease_until),
    reconciliationFence: num(r.reconciliation_fence),
    updatedAt: num(r.updated_at),
    domainKind: optStr(r.domain_kind),
    domainSchemaVersion: optNum(r.domain_schema_version),
    domainPayloadJson: optStr(r.domain_payload_json),
  } as DurableAgentRun;
}

function rowToAgentRunTombstone(r: Record<string, unknown>): DurableAgentRunTombstone {
  return {
    tombstoneId: String(r.tombstone_id), runId: String(r.run_id),
    workspaceIdentity: String(r.workspace_identity), recipeId: String(r.recipe_id),
    finalState: String(r.final_state) as DurableAgentRunState,
    terminalAt: num(r.terminal_at), deletedAt: num(r.deleted_at),
    deletionReason: String(r.deletion_reason), finalAuditSeq: num(r.final_audit_seq),
    eventCount: num(r.event_count),
    recoverySourceRunId: optStr(r.recovery_source_run_id),
    successorRunId: optStr(r.successor_run_id),
    schemaVersion: num(r.schema_version),
  } as DurableAgentRunTombstone;
}

export async function loadAgentRun(client: PoolClient, runId: string): Promise<DurableAgentRun | undefined> {
  const r = await client.query(`SELECT * FROM agent_runs WHERE run_id = $1`, [runId]);
  return r.rowCount === 1 ? rowToAgentRun(r.rows[0] as Record<string, unknown>) : undefined;
}

export async function loadAgentRuns(client: PoolClient, limit = 5000): Promise<DurableAgentRun[]> {
  // ins_seq breaks ties deterministically where SQLite fell back to rowid order.
  const r = await client.query(
    `SELECT * FROM agent_runs ORDER BY updated_at DESC, ins_seq DESC LIMIT $1`, [clampLimit(limit)]);
  return r.rows.map((x: Record<string, unknown>) => rowToAgentRun(x));
}

export async function loadAgentRunEvents(
  client: PoolClient, runId: string, limit = 500,
): Promise<DurableAgentRunEvent[]> {
  const r = await client.query(
    `SELECT * FROM agent_run_events WHERE run_id = $1 ORDER BY seq ASC, ins_seq ASC LIMIT $2`,
    [runId, clampLimit(limit)]);
  return r.rows.map((x: Record<string, unknown>) => rowToAgentRunEvent(x));
}

export async function loadAgentRunTombstones(
  client: PoolClient, limit = 500,
): Promise<DurableAgentRunTombstone[]> {
  const r = await client.query(
    `SELECT * FROM agent_run_tombstones ORDER BY deleted_at DESC, ins_seq DESC LIMIT $1`,
    [clampLimit(limit)]);
  return r.rows.map((x: Record<string, unknown>) => rowToAgentRunTombstone(x));
}

/**
 * Retention prune. Writes a tombstone for every run it removes, so the fact of
 * the deletion outlives the data.
 *
 * The eligibility predicate is SQLite's, unchanged: terminal, past the cutoff,
 * not under a live reconciliation lease, and with no live successor or live
 * recovery child still depending on it.
 *
 * `FOR UPDATE SKIP LOCKED` on the candidate scan is the one addition. Two
 * concurrent pruners would otherwise select overlapping candidates, and the
 * loser would trip the "became retention-ineligible" guard — correct, but noisy
 * and wasteful. Skipping locked rows lets pruners partition the work instead.
 */
export async function pruneAgentRuns(
  client: PoolClient,
  cutoff: number,
  batchSize: number,
  now: number,
): Promise<{ runs: number; events: number }> {
  const candidates = await client.query(
    `SELECT run_id, version, audit_seq, state, workspace_identity, recipe_id,
            terminal_at, recovery_source_run_id, successor_run_id
     FROM agent_runs
     WHERE terminal_at IS NOT NULL AND terminal_at < $1
       AND state IN ${TERMINAL_SQL}
       AND (reconciliation_owner IS NULL OR reconciliation_lease_until IS NULL
            OR reconciliation_lease_until < $2)
       AND (successor_run_id IS NULL OR NOT EXISTS (
             SELECT 1 FROM agent_runs c WHERE c.run_id = agent_runs.successor_run_id
             AND c.state NOT IN ${TERMINAL_SQL}))
       AND NOT EXISTS (
             SELECT 1 FROM agent_runs c WHERE c.recovery_source_run_id = agent_runs.run_id
             AND c.state NOT IN ${TERMINAL_SQL})
     ORDER BY terminal_at ASC
     LIMIT $3
     FOR UPDATE SKIP LOCKED`,
    [cutoff, now, clampLimit(batchSize)],
  );

  let runs = 0;
  let events = 0;

  for (const c of candidates.rows as Array<Record<string, unknown>>) {
    const runId = String(c.run_id);
    const counted = await client.query(
      `SELECT count(*) AS c FROM agent_run_events WHERE run_id = $1`, [runId]);
    const eventCount = num((counted.rows[0] as { c: string }).c);

    await client.query(
      `INSERT INTO agent_run_tombstones
         (tombstone_id, run_id, workspace_identity, recipe_id, final_state, terminal_at,
          deleted_at, deletion_reason, final_audit_seq, event_count,
          recovery_source_run_id, successor_run_id, schema_version,
          owner_scope, workspace_scope)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
               current_setting('migrapilot.owner_scope'),
               current_setting('migrapilot.workspace_scope'))`,
      [
        `tombstone_${runId}_${now}`, runId, c.workspace_identity, c.recipe_id, c.state,
        c.terminal_at, now, 'RETENTION_EXPIRED', c.audit_seq, eventCount,
        c.recovery_source_run_id, c.successor_run_id, 1,
      ],
    );

    const delEvents = await client.query(
      `DELETE FROM agent_run_events WHERE run_id = $1`, [runId]);
    events += delEvents.rowCount ?? 0;

    const delRun = await client.query(
      `DELETE FROM agent_runs WHERE run_id = $1 AND version = $2
       AND (reconciliation_owner IS NULL OR reconciliation_lease_until IS NULL
            OR reconciliation_lease_until < $3)`,
      [runId, c.version, now]);
    if (delRun.rowCount !== 1) {
      throw new Error(`Agent run ${runId} became retention-ineligible during cleanup`);
    }
    runs += delRun.rowCount;
  }

  return { runs, events };
}
