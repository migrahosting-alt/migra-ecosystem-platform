/**
 * MigraAI Engine — PostgreSQL agent run children (Group 4).
 *
 * Children carry their own optimistic-concurrency counter (`revision`) rather
 * than sharing the parent run's `version`, so a child transition never contends
 * with a parent transition. The guard order is SQLite's and is load-bearing:
 * TERMINAL_CHILD_IMMUTABLE is checked BEFORE STALE_REVISION, so a caller holding
 * a perfectly fresh revision still cannot rewrite a finished operation.
 *
 * As in agentRunRepo.ts, the read that feeds the guards takes `FOR UPDATE`. The
 * SQLite version can read-then-update safely because writers are serialised;
 * here the lock is what stops two callers with the same expectedRevision from
 * both passing their guards.
 */

import type { PoolClient } from 'pg';
import { DURABLE_CHILD_TERMINAL_STATES, isLegalChildTransition } from '../types.js';
import { isAgentTerminal } from './agentRunRepo.js';
import type {
  AgentRunChildTransitionInput,
  AgentRunChildWriteResult,
  DurableAgentRunChild,
  DurableChildState,
} from '../types.js';

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const optNum = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v));
const optStr = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));


export function rowToAgentRunChild(r: Record<string, unknown>): DurableAgentRunChild {
  return {
    childId: String(r.child_id), runId: String(r.run_id), kind: String(r.kind),
    attempt: num(r.attempt), state: String(r.state) as DurableChildState,
    // BIGINT 0/1, preserving the SQLite value domain.
    required: num(r.required) === 1,
    revision: num(r.revision), createdAt: num(r.created_at),
    startedAt: optNum(r.started_at), endedAt: optNum(r.ended_at),
    terminalCategory: optStr(r.terminal_category) as DurableAgentRunChild['terminalCategory'],
    terminalEvidenceJson: optStr(r.terminal_evidence_json),
    cancellationRequestedAt: optNum(r.cancellation_requested_at),
    cancellationConfirmedAt: optNum(r.cancellation_confirmed_at),
    errorJson: optStr(r.error_json), metadataJson: optStr(r.metadata_json),
    schemaVersion: num(r.schema_version), updatedAt: num(r.updated_at),
  } as DurableAgentRunChild;
}

export async function loadAgentRunChild(
  client: PoolClient, childId: string,
): Promise<DurableAgentRunChild | undefined> {
  const r = await client.query(`SELECT * FROM agent_run_children WHERE child_id = $1`, [childId]);
  return r.rowCount === 1 ? rowToAgentRunChild(r.rows[0] as Record<string, unknown>) : undefined;
}

export async function loadAgentRunChildren(
  client: PoolClient, runId: string,
): Promise<DurableAgentRunChild[]> {
  const r = await client.query(
    `SELECT * FROM agent_run_children WHERE run_id = $1 ORDER BY created_at ASC, child_id ASC`,
    [runId]);
  return r.rows.map((x: Record<string, unknown>) => rowToAgentRunChild(x));
}

/**
 * Insert a child under a live parent.
 *
 * The composite foreign key would also refuse an unowned or cross-tenant
 * parent, but callers branch on the typed refusal — an unowned child must never
 * be dispatched, and a constraint violation is not something a caller can
 * usefully branch on.
 */
export async function insertAgentRunChild(
  client: PoolClient, child: DurableAgentRunChild,
): Promise<AgentRunChildWriteResult> {
  const parent = await client.query(
    `SELECT state FROM agent_runs WHERE run_id = $1 FOR UPDATE`, [child.runId]);
  if (parent.rowCount !== 1) return { ok: false, code: 'UNKNOWN_PARENT' };
  const parentState = String((parent.rows[0] as { state: string }).state);
  if (isAgentTerminal(parentState)) return { ok: false, code: 'PARENT_TERMINAL' };

  // Duplicate by id OR by the (run, kind, attempt) identity — both are the same
  // child from the caller's point of view.
  const existing = await client.query(
    `SELECT * FROM agent_run_children
     WHERE child_id = $1 OR (run_id = $2 AND kind = $3 AND attempt = $4)
     LIMIT 1`,
    [child.childId, child.runId, child.kind, child.attempt]);
  if (existing.rowCount === 1) {
    return {
      ok: false, code: 'DUPLICATE_CHILD',
      current: rowToAgentRunChild(existing.rows[0] as Record<string, unknown>),
    };
  }

  await client.query(
    `INSERT INTO agent_run_children
       (child_id, run_id, kind, attempt, state, required, revision, created_at, started_at,
        ended_at, terminal_category, terminal_evidence_json, cancellation_requested_at,
        cancellation_confirmed_at, error_json, metadata_json, schema_version, updated_at,
        owner_scope, workspace_scope)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             current_setting('migrapilot.owner_scope'),
             current_setting('migrapilot.workspace_scope'))`,
    [
      child.childId, child.runId, child.kind, child.attempt, child.state,
      child.required ? 1 : 0, child.revision, child.createdAt,
      child.startedAt ?? null, child.endedAt ?? null, child.terminalCategory ?? null,
      child.terminalEvidenceJson ?? null, child.cancellationRequestedAt ?? null,
      child.cancellationConfirmedAt ?? null, child.errorJson ?? null,
      child.metadataJson ?? null, child.schemaVersion, child.updatedAt,
    ],
  );
  return { ok: true, child: { ...child } };
}

/**
 * Revision-guarded child transition.
 *
 * Guard order matters and is SQLite's: terminal-immutability is decided before
 * the revision compare, so finishing a child is genuinely final.
 */
export async function transitionAgentRunChild(
  client: PoolClient, input: AgentRunChildTransitionInput,
): Promise<AgentRunChildWriteResult> {
  const locked = await client.query(
    `SELECT * FROM agent_run_children WHERE child_id = $1 FOR UPDATE`, [input.childId]);
  if (locked.rowCount !== 1) return { ok: false, code: 'UNKNOWN_CHILD' };
  const current = rowToAgentRunChild(locked.rows[0] as Record<string, unknown>);

  if (DURABLE_CHILD_TERMINAL_STATES.has(current.state)) {
    return { ok: false, code: 'TERMINAL_CHILD_IMMUTABLE', current };
  }
  if (current.revision !== input.expectedRevision) {
    return { ok: false, code: 'STALE_REVISION', current };
  }
  if (!isLegalChildTransition(current.state, input.nextState)) {
    return { ok: false, code: 'ILLEGAL_TRANSITION', current };
  }

  const updated = await client.query(
    `UPDATE agent_run_children SET
       state = $1, revision = revision + 1,
       started_at = COALESCE($2, started_at),
       ended_at = COALESCE($3, ended_at),
       terminal_category = COALESCE($4, terminal_category),
       terminal_evidence_json = COALESCE($5, terminal_evidence_json),
       cancellation_requested_at = COALESCE($6, cancellation_requested_at),
       cancellation_confirmed_at = COALESCE($7, cancellation_confirmed_at),
       error_json = COALESCE($8, error_json),
       metadata_json = COALESCE($9, metadata_json),
       updated_at = $10
     WHERE child_id = $11 AND revision = $12
     RETURNING *`,
    [
      input.nextState, input.startedAt ?? null, input.endedAt ?? null,
      input.terminalCategory ?? null, input.terminalEvidenceJson ?? null,
      input.cancellationRequestedAt ?? null, input.cancellationConfirmedAt ?? null,
      input.errorJson ?? null, input.metadataJson ?? null, input.at,
      input.childId, input.expectedRevision,
    ],
  );
  // Unreachable while the row lock is held, but kept as the same defensive
  // refusal SQLite makes rather than assuming the lock.
  if (updated.rowCount !== 1) return { ok: false, code: 'STALE_REVISION', current };

  return { ok: true, child: rowToAgentRunChild(updated.rows[0] as Record<string, unknown>) };
}
