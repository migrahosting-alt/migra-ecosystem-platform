/**
 * MigraAI Engine — PostgreSQL operational persistence (Group 5).
 *
 * Audit, usage, incidents, recovery, budget scopes and reservations. Normalised
 * to the same contract SQLite exposes:
 *
 *   INSERT OR IGNORE  -> ON CONFLICT (pk) DO NOTHING
 *   upsert-by-pk      -> ON CONFLICT (pk) DO UPDATE SET <the same subset>
 *   epoch-ms integers -> BIGINT, converted explicitly on read
 *   REAL money        -> DOUBLE PRECISION, value domain unchanged
 *
 * ─── Why scope columns are omitted from every DO UPDATE ─────────────────────
 *
 * The upserts conflict on the PRIMARY KEY (incident_id, scope_id), which is
 * global rather than per-tenant. If a conflict update were allowed to write
 * owner_scope/workspace_scope, an upsert could re-home an existing row into the
 * caller's tenant — a silent takeover of another tenant's record.
 *
 * Omitting the scope columns from the SET list means a conflicting upsert can
 * only ever modify a row the caller already owns, and RLS's USING clause makes
 * a cross-tenant conflict fail outright rather than mutate. Same discipline as
 * the memory-workspace upserts in Group 2, for the same reason.
 *
 * `pg` returns BIGINT as a string to avoid precision loss, so every numeric
 * column is converted explicitly rather than trusted to arrive as a number.
 */

import type { PoolClient } from 'pg';
import type {
  DurableAuditEvent,
  DurableBudgetScope,
  DurableIncident,
  DurableRecoveryEvent,
  DurableReservation,
  DurableUsageRecord,
  OperationalCounts,
} from '../types.js';

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const optNum = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v));
const optStr = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));
const clampLimit = (n: number): number => Math.max(1, Math.min(Math.floor(n) || 1, 5000));

const SCOPE_VALUES = `current_setting('migrapilot.owner_scope'), current_setting('migrapilot.workspace_scope')`;

// ─── Audit ──────────────────────────────────────────────────────────────────

function rowToAudit(r: Record<string, unknown>): DurableAuditEvent {
  return {
    eventId: String(r.event_id), correlationId: String(r.correlation_id),
    causationId: String(r.causation_id), seq: num(r.seq), type: String(r.type),
    at: num(r.at), durationMs: optNum(r.duration_ms), component: String(r.component),
    outcome: optStr(r.outcome), requestId: optStr(r.request_id),
    fieldsJson: String(r.fields_json),
  } as DurableAuditEvent;
}

/** Idempotent by eventId — a replayed append is a no-op, never a double count. */
export async function appendAuditEvent(client: PoolClient, e: DurableAuditEvent): Promise<void> {
  await client.query(
    `INSERT INTO op_audit_events
       (event_id, correlation_id, causation_id, seq, type, at, duration_ms,
        component, outcome, request_id, fields_json, owner_scope, workspace_scope)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, ${SCOPE_VALUES})
     ON CONFLICT (event_id) DO NOTHING`,
    [
      e.eventId, e.correlationId, e.causationId, e.seq, e.type, e.at,
      e.durationMs ?? null, e.component, e.outcome ?? null, e.requestId ?? null, e.fieldsJson,
    ],
  );
}

export async function recentAuditEvents(client: PoolClient, limit: number): Promise<DurableAuditEvent[]> {
  const r = await client.query(
    `SELECT * FROM op_audit_events ORDER BY at DESC, seq DESC, ins_seq DESC LIMIT $1`,
    [clampLimit(limit)]);
  return r.rows.map((x: Record<string, unknown>) => rowToAudit(x));
}

export async function auditByCorrelation(
  client: PoolClient, correlationId: string, limit = 500,
): Promise<DurableAuditEvent[]> {
  const r = await client.query(
    `SELECT * FROM op_audit_events WHERE correlation_id = $1
     ORDER BY seq ASC, ins_seq ASC LIMIT $2`,
    [correlationId, clampLimit(limit)]);
  return r.rows.map((x: Record<string, unknown>) => rowToAudit(x));
}

// ─── Usage ──────────────────────────────────────────────────────────────────

function rowToUsage(r: Record<string, unknown>): DurableUsageRecord {
  return {
    usageId: String(r.usage_id), correlationId: String(r.correlation_id),
    providerId: String(r.provider_id), modelId: String(r.model_id),
    executionMode: String(r.execution_mode), policy: String(r.policy),
    localOrCloud: String(r.local_or_cloud), at: num(r.at), outcome: String(r.outcome),
    costUsd: optNum(r.cost_usd), costStatus: String(r.cost_status),
    escalationReason: optStr(r.escalation_reason), fieldsJson: String(r.fields_json),
  } as DurableUsageRecord;
}

export async function appendUsageRecord(client: PoolClient, r: DurableUsageRecord): Promise<void> {
  await client.query(
    `INSERT INTO op_usage_records
       (usage_id, correlation_id, provider_id, model_id, execution_mode, policy,
        local_or_cloud, at, outcome, cost_usd, cost_status, escalation_reason,
        fields_json, owner_scope, workspace_scope)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, ${SCOPE_VALUES})
     ON CONFLICT (usage_id) DO NOTHING`,
    [
      r.usageId, r.correlationId, r.providerId, r.modelId, r.executionMode, r.policy,
      r.localOrCloud, r.at, r.outcome, r.costUsd ?? null, r.costStatus,
      r.escalationReason ?? null, r.fieldsJson,
    ],
  );
}

export async function recentUsageRecords(client: PoolClient, limit: number): Promise<DurableUsageRecord[]> {
  const r = await client.query(
    `SELECT * FROM op_usage_records ORDER BY at DESC, ins_seq DESC LIMIT $1`, [clampLimit(limit)]);
  return r.rows.map((x: Record<string, unknown>) => rowToUsage(x));
}

// ─── Incidents ──────────────────────────────────────────────────────────────

function rowToIncident(r: Record<string, unknown>): DurableIncident {
  return {
    incidentId: String(r.incident_id), deduplicationKey: String(r.dedup_key),
    correlationId: String(r.correlation_id), firstSeenAt: num(r.first_seen_at),
    lastSeenAt: num(r.last_seen_at), occurrenceCount: num(r.occurrence_count),
    state: String(r.state), severity: String(r.severity),
    affectedJson: String(r.affected_json), lastDeliveryStatus: String(r.last_delivery_status),
    resolutionJson: optStr(r.resolution_json),
  } as DurableIncident;
}

/**
 * Upsert by incident id. The DO UPDATE list is SQLite's exactly — first_seen_at,
 * dedup_key, correlation_id and severity are deliberately NOT refreshed, so an
 * incident keeps the identity it was opened with. Scope columns are omitted for
 * the reason given at the top of this file.
 */
export async function upsertIncident(client: PoolClient, i: DurableIncident): Promise<void> {
  await client.query(
    `INSERT INTO op_incidents
       (incident_id, dedup_key, correlation_id, first_seen_at, last_seen_at,
        occurrence_count, state, severity, affected_json, last_delivery_status,
        resolution_json, owner_scope, workspace_scope)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, ${SCOPE_VALUES})
     ON CONFLICT (incident_id) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       occurrence_count = excluded.occurrence_count,
       state = excluded.state,
       last_delivery_status = excluded.last_delivery_status,
       resolution_json = excluded.resolution_json`,
    [
      i.incidentId, i.deduplicationKey, i.correlationId, i.firstSeenAt, i.lastSeenAt,
      i.occurrenceCount, i.state, i.severity, i.affectedJson, i.lastDeliveryStatus,
      i.resolutionJson ?? null,
    ],
  );
}

export async function listIncidents(client: PoolClient, limit: number): Promise<DurableIncident[]> {
  const r = await client.query(
    `SELECT * FROM op_incidents ORDER BY last_seen_at DESC, ins_seq DESC LIMIT $1`,
    [clampLimit(limit)]);
  return r.rows.map((x: Record<string, unknown>) => rowToIncident(x));
}

// ─── Recovery ───────────────────────────────────────────────────────────────

export async function appendRecoveryEvent(client: PoolClient, e: DurableRecoveryEvent): Promise<void> {
  await client.query(
    `INSERT INTO op_recovery_events
       (id, recovery_id, correlation_id, incident_id, type, at, outcome,
        fields_json, owner_scope, workspace_scope)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, ${SCOPE_VALUES})
     ON CONFLICT (id) DO NOTHING`,
    [e.id, e.recoveryId, e.correlationId, e.incidentId ?? null, e.type, e.at, e.outcome ?? null, e.fieldsJson],
  );
}

// ─── Budget ─────────────────────────────────────────────────────────────────

function rowToBudgetScope(r: Record<string, unknown>): DurableBudgetScope {
  return {
    scopeId: String(r.scope_id), kind: String(r.kind), scopeKeyName: String(r.scope_key),
    hardLimitUsd: num(r.hard_limit_usd), spentUsd: num(r.spent_usd),
    reservedUsd: num(r.reserved_usd), periodStart: num(r.period_start),
    updatedAt: num(r.updated_at),
  } as DurableBudgetScope;
}

export async function saveBudgetScope(client: PoolClient, s: DurableBudgetScope): Promise<void> {
  await client.query(
    `INSERT INTO op_budget_scopes
       (scope_id, kind, scope_key, hard_limit_usd, spent_usd, reserved_usd,
        period_start, updated_at, owner_scope, workspace_scope)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, ${SCOPE_VALUES})
     ON CONFLICT (scope_id) DO UPDATE SET
       hard_limit_usd = excluded.hard_limit_usd,
       spent_usd = excluded.spent_usd,
       reserved_usd = excluded.reserved_usd,
       period_start = excluded.period_start,
       updated_at = excluded.updated_at`,
    [s.scopeId, s.kind, s.scopeKeyName, s.hardLimitUsd, s.spentUsd, s.reservedUsd, s.periodStart, s.updatedAt],
  );
}

export async function loadBudgetScopes(client: PoolClient): Promise<DurableBudgetScope[]> {
  // SQLite returns these in rowid order; ins_seq reproduces that deterministically.
  const r = await client.query(`SELECT * FROM op_budget_scopes ORDER BY ins_seq ASC`);
  return r.rows.map((x: Record<string, unknown>) => rowToBudgetScope(x));
}

// ─── Reservations ───────────────────────────────────────────────────────────

function rowToReservation(r: Record<string, unknown>): DurableReservation {
  return {
    reservationId: String(r.reservation_id), amountUsd: num(r.amount_usd),
    scopeIdsJson: String(r.scope_ids_json), correlationId: String(r.correlation_id),
    providerId: String(r.provider_id), modelId: String(r.model_id),
    createdAt: num(r.created_at), expiresAt: num(r.expires_at), status: String(r.status),
  } as DurableReservation;
}

export async function saveReservation(client: PoolClient, r: DurableReservation): Promise<void> {
  await client.query(
    `INSERT INTO op_reservations
       (reservation_id, amount_usd, scope_ids_json, correlation_id, provider_id,
        model_id, created_at, expires_at, status, owner_scope, workspace_scope)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, ${SCOPE_VALUES})
     ON CONFLICT (reservation_id) DO UPDATE SET status = excluded.status`,
    [
      r.reservationId, r.amountUsd, r.scopeIdsJson, r.correlationId, r.providerId,
      r.modelId, r.createdAt, r.expiresAt, r.status,
    ],
  );
}

export async function removeReservation(client: PoolClient, reservationId: string): Promise<void> {
  await client.query(`DELETE FROM op_reservations WHERE reservation_id = $1`, [reservationId]);
}

export async function loadReservations(client: PoolClient): Promise<DurableReservation[]> {
  const r = await client.query(`SELECT * FROM op_reservations ORDER BY ins_seq ASC`);
  return r.rows.map((x: Record<string, unknown>) => rowToReservation(x));
}

// ─── Retention and counts ───────────────────────────────────────────────────

/**
 * Age-based retention. Incidents are pruned ONLY when resolved, matching
 * SQLite — an open incident outlives its cutoff on purpose.
 *
 * Recovery events referencing a pruned incident are not deleted; the foreign
 * key nulls their incident_id instead (see operationalSchema.ts). That keeps
 * the returned counts identical to SQLite's, where the reference would simply
 * have dangled.
 */
export async function pruneOperational(
  client: PoolClient,
  cutoffs: { auditBefore: number; usageBefore: number; incidentsBefore: number; recoveryBefore: number },
): Promise<{ audit: number; usage: number; incidents: number; recovery: number }> {
  const del = async (sql: string, arg: number): Promise<number> => {
    const r = await client.query(sql, [arg]);
    return r.rowCount ?? 0;
  };
  return {
    audit: await del(`DELETE FROM op_audit_events WHERE at < $1`, cutoffs.auditBefore),
    usage: await del(`DELETE FROM op_usage_records WHERE at < $1`, cutoffs.usageBefore),
    incidents: await del(
      `DELETE FROM op_incidents WHERE last_seen_at < $1 AND state = 'resolved'`,
      cutoffs.incidentsBefore),
    recovery: await del(`DELETE FROM op_recovery_events WHERE at < $1`, cutoffs.recoveryBefore),
  };
}

/**
 * Row counts across every operational and journal table.
 *
 * Counts are RLS-scoped, so this reports what the CALLING TENANT has, not what
 * the database holds. That is the correct reading for a per-tenant operational
 * surface, and it differs from SQLite only because SQLite has no tenants.
 */
export async function operationalCounts(client: PoolClient): Promise<OperationalCounts> {
  const r = await client.query(
    `SELECT
       (SELECT count(*) FROM op_audit_events)        AS audit_events,
       (SELECT count(*) FROM op_usage_records)       AS usage_records,
       (SELECT count(*) FROM op_incidents)           AS incidents,
       (SELECT count(*) FROM op_recovery_events)     AS recovery_events,
       (SELECT count(*) FROM op_reservations)        AS reservations,
       (SELECT count(*) FROM agent_runs)             AS agent_runs,
       (SELECT count(*) FROM agent_run_events)       AS agent_run_events,
       (SELECT count(*) FROM agent_run_tombstones)   AS agent_run_tombstones,
       (SELECT count(*) FROM agent_run_children)     AS agent_run_children`);
  const x = r.rows[0] as Record<string, unknown>;
  return {
    auditEvents: num(x.audit_events),
    usageRecords: num(x.usage_records),
    incidents: num(x.incidents),
    recoveryEvents: num(x.recovery_events),
    reservations: num(x.reservations),
    agentRuns: num(x.agent_runs),
    agentRunEvents: num(x.agent_run_events),
    agentRunTombstones: num(x.agent_run_tombstones),
    agentRunChildren: num(x.agent_run_children),
  };
}
