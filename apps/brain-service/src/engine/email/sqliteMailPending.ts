/**
 * In-flight OAuth attempts — SQLite.
 *
 * 🚨 `node:sqlite` has no DELETE ... RETURNING, so `take` reads and deletes
 * inside a TRANSACTION. That is what preserves the atomicity the Postgres
 * adapter gets from one statement: without it the two adapters would enforce
 * single-use differently, and only the weaker one would ship to a developer's
 * machine where the concurrency bug is hardest to notice.
 */

import type { DatabaseSync } from 'node:sqlite';

import type { GrantKind } from './oauthConfig.js';
import type { PendingAuthorizationStore, PendingRecord } from './pendingAuthorization.js';

export const MAIL_PENDING_SCHEMA = `
CREATE TABLE IF NOT EXISTS mail_oauth_pending (
  state_hash      TEXT PRIMARY KEY,
  owner_scope     TEXT    NOT NULL,
  workspace_scope TEXT    NOT NULL,
  provider        TEXT    NOT NULL,
  grants          TEXT    NOT NULL,
  return_to       TEXT    NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_oauth_pending_created_idx ON mail_oauth_pending (created_at);
`;

interface Row {
  state_hash: string;
  owner_scope: string;
  workspace_scope: string;
  provider: string;
  grants: string;
  return_to: string;
  created_at: number;
}

export class SqliteMailPendingStore implements PendingAuthorizationStore {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(MAIL_PENDING_SCHEMA);
  }

  async put(record: PendingRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO mail_oauth_pending
           (state_hash, owner_scope, workspace_scope, provider, grants, return_to, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        record.stateHash,
        record.ownerScope,
        record.workspaceScope,
        record.provider,
        JSON.stringify(record.grants),
        record.returnTo,
        record.createdAt,
      );
  }

  async take(stateHash: string): Promise<PendingRecord | null> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db
        .prepare(
          `SELECT state_hash, owner_scope, workspace_scope, provider, grants, return_to, created_at
             FROM mail_oauth_pending WHERE state_hash = ?`,
        )
        .get(stateHash) as unknown as Row | undefined;
      if (row) {
        this.db.prepare(`DELETE FROM mail_oauth_pending WHERE state_hash = ?`).run(stateHash);
      }
      this.db.exec('COMMIT');
      if (!row) return null;
      return {
        stateHash: row.state_hash,
        ownerScope: row.owner_scope,
        workspaceScope: row.workspace_scope,
        provider: row.provider,
        grants: JSON.parse(row.grants) as GrantKind[],
        returnTo: row.return_to,
        createdAt: row.created_at,
      };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async pruneOlderThan(cutoff: number): Promise<number> {
    const result = this.db.prepare(`DELETE FROM mail_oauth_pending WHERE created_at < ?`).run(cutoff);
    return Number(result.changes ?? 0);
  }
}
