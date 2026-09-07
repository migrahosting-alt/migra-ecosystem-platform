import type { PoolClient } from 'pg';

import type {
  IdempotencyRecord,
  IdempotencyState,
  OperationProvenance,
} from '../../tools/idempotency.js';

/**
 * Durable idempotency on the canonical backend.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE CLAIM IS ONE INSERT, AND THE DATABASE DECIDES WHO WINS
 *
 * The interesting window is two identical requests arriving together — a double
 * click, a reconnect, a retrying proxy. Read-then-write loses that race: both
 * read "nothing stored", both claim, both dispatch, and the operation happens
 * twice with an audit trail saying it happened once.
 *
 * `ON CONFLICT DO NOTHING` plus a rowCount is the whole concurrency story, the
 * same shape `assertionNonceRepo` uses for replay protection and for the same
 * reason: exactly one caller can win a primary key.
 *
 * ---------------------------------------------------------------------------
 * WHY THE KEY IS (idempotency_key, actor, scope)
 *
 * Not the key alone — two tenants may legitimately choose the same key and
 * neither should see the other's operation. Not the whole operation identity —
 * if tool_id or input_hash were part of the key, the same key with edited input
 * would INSERT A SECOND ROW instead of colliding, and the reuse this primitive
 * exists to refuse would succeed as a brand-new operation.
 *
 * So tool and input hash are attributes, compared on read by the pure layer.
 * The collision has to HAPPEN for the refusal to be possible.
 * ---------------------------------------------------------------------------
 */

const STATES: readonly IdempotencyState[] = [
  'pending',
  'committed',
  'failed_before_dispatch',
  'outcome_unknown',
];

interface Row {
  idempotency_key: string;
  actor: string;
  scope: string;
  tool_id: string;
  input_hash: string;
  state: string;
  attempt: number;
  created_at: string | number;
  updated_at: string | number;
  result_json: unknown;
  detail: string | null;
  provenance_json: unknown;
}

/**
 * A row that does not round-trip is a CORRUPT record, and a corrupt idempotency
 * record is worse than none: it would answer confidently about whether a charge
 * happened. An unrecognised state throws rather than defaulting.
 */
function toRecord(row: Row): IdempotencyRecord {
  if (!STATES.includes(row.state as IdempotencyState)) {
    throw new Error(
      `CORRUPT IDEMPOTENCY ROW ${row.idempotency_key}: unknown state ${JSON.stringify(row.state)}.`,
    );
  }
  return {
    identity: {
      idempotencyKey: row.idempotency_key,
      toolId: row.tool_id,
      actor: row.actor,
      scope: row.scope,
      normalizedInputHash: row.input_hash,
    },
    state: row.state as IdempotencyState,
    attempt: row.attempt,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    ...(row.result_json !== null && row.result_json !== undefined ? { result: row.result_json } : {}),
    ...(row.detail !== null ? { detail: row.detail } : {}),
    ...(row.provenance_json !== null && row.provenance_json !== undefined
      ? { provenance: row.provenance_json as OperationProvenance }
      : {}),
  };
}

/**
 * Insert if absent; otherwise return the stored record WITHOUT modifying it.
 *
 * `DO NOTHING` then re-read, rather than `DO UPDATE … RETURNING`: the loser of
 * the race must observe what the winner wrote, not overwrite any part of it.
 */
export async function insertIfAbsent(
  client: PoolClient,
  record: IdempotencyRecord,
): Promise<IdempotencyRecord | null> {
  const { rowCount } = await client.query(
    `INSERT INTO tool_idempotency
       (idempotency_key, actor, scope, tool_id, input_hash, state, attempt,
        created_at, updated_at, result_json, detail, provenance_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,NULL)
     ON CONFLICT (idempotency_key, actor, scope) DO NOTHING`,
    [
      record.identity.idempotencyKey,
      record.identity.actor,
      record.identity.scope,
      record.identity.toolId,
      record.identity.normalizedInputHash,
      record.state,
      record.attempt,
      record.createdAt,
      record.updatedAt,
    ],
  );
  if ((rowCount ?? 0) === 1) return null;

  const existing = await readRecord(
    client,
    record.identity.idempotencyKey,
    record.identity.actor,
    record.identity.scope,
  );
  if (!existing) {
    // The insert lost a race and the row then vanished. Nothing here can be
    // said honestly, so say nothing rather than guess.
    throw new Error(
      `IDEMPOTENCY CLAIM UNRESOLVABLE for ${record.identity.idempotencyKey}: ` +
        'the insert collided but no row could be read back.',
    );
  }
  return existing;
}

export async function readRecord(
  client: PoolClient,
  key: string,
  actor: string,
  scope: string,
): Promise<IdempotencyRecord | null> {
  const { rows } = await client.query<Row>(
    `SELECT * FROM tool_idempotency
      WHERE idempotency_key = $1 AND actor = $2 AND scope = $3`,
    [key, actor, scope],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

/**
 * Update in place.
 *
 * 🚨 A WRITE THAT MATCHES NO ROW IS AN ERROR, never a quiet success. A settle
 * that silently wrote nothing would report a committed operation for a record
 * that was never updated — which is the one lie this primitive must not tell.
 */
export async function writeRecord(client: PoolClient, record: IdempotencyRecord): Promise<void> {
  const { rowCount } = await client.query(
    `UPDATE tool_idempotency
        SET state = $1, attempt = $2, updated_at = $3,
            result_json = $4, detail = $5, provenance_json = $6
      WHERE idempotency_key = $7 AND actor = $8 AND scope = $9`,
    [
      record.state,
      record.attempt,
      record.updatedAt,
      record.result === undefined ? null : JSON.stringify(record.result),
      record.detail ?? null,
      record.provenance ? JSON.stringify(record.provenance) : null,
      record.identity.idempotencyKey,
      record.identity.actor,
      record.identity.scope,
    ],
  );
  if ((rowCount ?? 0) !== 1) {
    throw new Error(
      `IDEMPOTENCY WRITE MATCHED NO ROW for ${record.identity.idempotencyKey}. ` +
        'A settle that writes nothing would report success for a record that was never updated.',
    );
  }
}
