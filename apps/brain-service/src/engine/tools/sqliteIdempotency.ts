/**
 * The DURABLE half of idempotency — SQLite.
 *
 * ---------------------------------------------------------------------------
 * THE UNIQUE CONSTRAINT IS THE MECHANISM, NOT A SAFETY NET
 *
 * `claim` has to be atomic against two identical requests arriving together, or
 * both dispatch and the operation happens twice with an audit trail saying it
 * happened once. A SELECT followed by an INSERT cannot provide that; the
 * database's own uniqueness can.
 *
 * So the claim is a bare `INSERT` on a table whose PRIMARY KEY is
 * `(idempotency_key, actor, scope)`. Exactly one caller wins. The loser gets a
 * constraint violation, re-reads, and is handed a verdict — never a dispatch.
 *
 * 🚨 The `tool_id` and `input_hash` are COLUMNS, not part of the key. If they
 * were in the key, the same key with edited input would insert a SECOND ROW
 * rather than colliding, and the reuse this primitive exists to refuse would
 * succeed as a brand-new operation.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS OWNS ITS OWN TABLE AND CONNECTION HANDLING IS LEFT OUTSIDE
 *
 * The adapter takes a `DatabaseSync` rather than opening one. The engine's
 * persistence layer already decides where the database lives, how it migrates
 * and when it is healthy; a second module opening a second handle to the same
 * file is how two writers end up with two opinions about a transaction.
 * ---------------------------------------------------------------------------
 */

import type { DatabaseSync } from 'node:sqlite';

import type { IdempotencyRecord, IdempotencyState, OperationProvenance } from './idempotency.js';
import type { IdempotencyPersistence } from './idempotencyStore.js';

export const IDEMPOTENCY_SCHEMA = `
CREATE TABLE IF NOT EXISTS tool_idempotency (
  idempotency_key TEXT NOT NULL,
  actor           TEXT NOT NULL,
  scope           TEXT NOT NULL,
  tool_id         TEXT NOT NULL,
  input_hash      TEXT NOT NULL,
  state           TEXT NOT NULL,
  attempt         INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  result_json     TEXT,
  detail          TEXT,
  provenance_json TEXT,
  PRIMARY KEY (idempotency_key, actor, scope)
);
CREATE INDEX IF NOT EXISTS idx_idem_state ON tool_idempotency(state, updated_at);
`;

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
  created_at: number;
  updated_at: number;
  result_json: string | null;
  detail: string | null;
  provenance_json: string | null;
}

/**
 * A row that does not round-trip is a corrupt record, and a corrupt idempotency
 * record is worse than none: it would report a confident answer about whether a
 * charge happened. An unrecognised state throws rather than defaulting.
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.result_json !== null ? { result: JSON.parse(row.result_json) as unknown } : {}),
    ...(row.detail !== null ? { detail: row.detail } : {}),
    ...(row.provenance_json !== null
      ? { provenance: JSON.parse(row.provenance_json) as OperationProvenance }
      : {}),
  };
}

export class SqliteIdempotencyPersistence implements IdempotencyPersistence {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(IDEMPOTENCY_SCHEMA);
  }

  /**
   * The atomic claim. One INSERT; the database decides who wins.
   *
   * The constraint violation is caught and turned into "someone else is here",
   * which is a normal outcome rather than an error — but ONLY that violation.
   * Anything else is a real failure and must not be swallowed into a verdict
   * that looks like an ordinary collision.
   */
  async insertIfAbsent(record: IdempotencyRecord): Promise<IdempotencyRecord | null> {
    try {
      this.db
        .prepare(
          `INSERT INTO tool_idempotency
             (idempotency_key, actor, scope, tool_id, input_hash, state, attempt,
              created_at, updated_at, result_json, detail, provenance_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
        )
        .run(
          record.identity.idempotencyKey,
          record.identity.actor,
          record.identity.scope,
          record.identity.toolId,
          record.identity.normalizedInputHash,
          record.state,
          record.attempt,
          record.createdAt,
          record.updatedAt,
        );
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/UNIQUE|PRIMARY KEY|constraint/i.test(message)) throw error;
      const existing = await this.read(
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
  }

  async read(key: string, actor: string, scope: string): Promise<IdempotencyRecord | null> {
    const row = this.db
      .prepare(
        `SELECT * FROM tool_idempotency
          WHERE idempotency_key = ? AND actor = ? AND scope = ?`,
      )
      .get(key, actor, scope) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  /**
   * Update in place.
   *
   * 🚨 The WHERE clause carries the CURRENT state, so a write computed from a
   * stale read cannot land. The state machine already refuses illegal
   * transitions; this refuses a legal-looking one built on an old row, which is
   * the same defect arriving by a different door.
   */
  async write(record: IdempotencyRecord): Promise<void> {
    const changes = this.db
      .prepare(
        `UPDATE tool_idempotency
            SET state = ?, attempt = ?, updated_at = ?, result_json = ?, detail = ?, provenance_json = ?
          WHERE idempotency_key = ? AND actor = ? AND scope = ?`,
      )
      .run(
        record.state,
        record.attempt,
        record.updatedAt,
        record.result === undefined ? null : JSON.stringify(record.result),
        record.detail ?? null,
        record.provenance ? JSON.stringify(record.provenance) : null,
        record.identity.idempotencyKey,
        record.identity.actor,
        record.identity.scope,
      );
    if (Number(changes.changes) !== 1) {
      throw new Error(
        `IDEMPOTENCY WRITE MATCHED NO ROW for ${record.identity.idempotencyKey}. ` +
          'A settle that writes nothing would report success for a record that was never updated.',
      );
    }
  }
}
