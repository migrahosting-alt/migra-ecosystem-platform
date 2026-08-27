/**
 * Durable readiness for documents processed outside a request.
 *
 * Scoped like everything else here: the table runs under row-level security, so
 * a read without a declared scope sees nothing rather than another tenant's
 * documents. An empty result therefore means "this scope has no record", never
 * "no such document exists anywhere".
 */

import type { PoolClient } from 'pg';

import type {
  DocumentReadiness,
  DocumentState,
  ProcessingStage,
} from '../../rag/documentReadiness.js';

interface ScopedRequest {
  ownerScope: string;
  workspaceScope: string;
}

function toReadiness(row: Record<string, unknown>): DocumentReadiness {
  const num = (v: unknown): number | undefined => {
    const n = Number(v);
    return v === null || v === undefined || !Number.isFinite(n) ? undefined : n;
  };
  return {
    fileName: String(row.file_name ?? ''),
    state: String(row.state ?? 'stored') as DocumentState,
    ...(row.stage ? { stage: String(row.stage) as ProcessingStage } : {}),
    ...(row.detail ? { detail: String(row.detail) } : {}),
    ...(num(row.pages_total) !== undefined ? { pagesTotal: num(row.pages_total)! } : {}),
    ...(num(row.pages_done) !== undefined ? { pagesDone: num(row.pages_done)! } : {}),
    ...(num(row.ordered_pages) !== undefined ? { orderedPages: num(row.ordered_pages)! } : {}),
    ...(num(row.unplaced_pages) !== undefined ? { unplacedPages: num(row.unplaced_pages)! } : {}),
    ...(row.sequence_complete === null || row.sequence_complete === undefined
      ? {}
      : { sequenceComplete: Boolean(row.sequence_complete) }),
    ...(row.failure_reason ? { failureReason: String(row.failure_reason) } : {}),
    ...(num(row.started_at) !== undefined ? { startedAt: num(row.started_at)! } : {}),
    ...(num(row.updated_at) !== undefined ? { updatedAt: num(row.updated_at)! } : {}),
  };
}

/**
 * Write the current state, replacing whatever was there.
 *
 * An UPSERT rather than an insert-or-update dance: a job that restarts must be
 * able to say where it is without first discovering whether anyone recorded it,
 * and two writers racing on the same document should leave the later fact
 * standing rather than one of them erroring.
 */
export async function recordReadiness(
  client: PoolClient,
  scope: ScopedRequest,
  readiness: DocumentReadiness,
  now: number,
): Promise<void> {
  await client.query(
    `INSERT INTO document_processing
       (owner_scope, workspace_scope, file_name, state, stage, detail,
        pages_total, pages_done, ordered_pages, unplaced_pages, sequence_complete,
        failure_reason, started_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::int,$8::int,$9::int,$10::int,$11::boolean,$12,
             COALESCE($13::bigint, $14::bigint), $14::bigint)
     ON CONFLICT (owner_scope, workspace_scope, file_name) DO UPDATE SET
       state = EXCLUDED.state,
       stage = EXCLUDED.stage,
       detail = EXCLUDED.detail,
       pages_total = EXCLUDED.pages_total,
       pages_done = EXCLUDED.pages_done,
       ordered_pages = EXCLUDED.ordered_pages,
       unplaced_pages = EXCLUDED.unplaced_pages,
       sequence_complete = EXCLUDED.sequence_complete,
       failure_reason = EXCLUDED.failure_reason,
       updated_at = EXCLUDED.updated_at`,
    [
      scope.ownerScope, scope.workspaceScope, readiness.fileName,
      readiness.state, readiness.stage ?? null, readiness.detail ?? null,
      readiness.pagesTotal ?? null, readiness.pagesDone ?? null,
      readiness.orderedPages ?? null, readiness.unplacedPages ?? null,
      readiness.sequenceComplete ?? null,
      readiness.failureReason ?? null, readiness.startedAt ?? null, now,
    ],
  );
}

export async function readReadiness(
  client: PoolClient,
  scope: ScopedRequest,
  fileName: string,
): Promise<DocumentReadiness | undefined> {
  const { rows } = await client.query<Record<string, unknown>>(
    `SELECT * FROM document_processing
      WHERE owner_scope = $1 AND workspace_scope = $2 AND file_name = $3`,
    [scope.ownerScope, scope.workspaceScope, fileName],
  );
  return rows[0] ? toReadiness(rows[0]) : undefined;
}

export async function listReadiness(
  client: PoolClient,
  scope: ScopedRequest,
): Promise<DocumentReadiness[]> {
  const { rows } = await client.query<Record<string, unknown>>(
    `SELECT * FROM document_processing
      WHERE owner_scope = $1 AND workspace_scope = $2
      ORDER BY updated_at DESC`,
    [scope.ownerScope, scope.workspaceScope],
  );
  return rows.map(toReadiness);
}

/**
 * Jobs that were mid-flight when the process died.
 *
 * A restart leaves `processing` rows that nothing is working on any more, and
 * they must not sit there implying progress forever. The caller decides whether
 * to resume or to mark them failed; this only reports them, because "interrupted"
 * is a fact and "abandoned" is a judgement.
 */
export async function findInterrupted(
  client: PoolClient,
  scope: ScopedRequest,
): Promise<DocumentReadiness[]> {
  const { rows } = await client.query<Record<string, unknown>>(
    `SELECT * FROM document_processing
      WHERE owner_scope = $1 AND workspace_scope = $2 AND state = 'processing'`,
    [scope.ownerScope, scope.workspaceScope],
  );
  return rows.map(toReadiness);
}

export async function deleteReadiness(
  client: PoolClient,
  scope: ScopedRequest,
  fileName: string,
): Promise<void> {
  await client.query(
    `DELETE FROM document_processing
      WHERE owner_scope = $1 AND workspace_scope = $2 AND file_name = $3`,
    [scope.ownerScope, scope.workspaceScope, fileName],
  );
}
