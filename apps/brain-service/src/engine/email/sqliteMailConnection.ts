/**
 * Connected mail accounts — SQLite.
 *
 * The local/dev/test adapter. It exists so the connect flow can be exercised
 * end to end without PostgreSQL; production refuses to run on SQLite, and
 * `persistenceConfig` enforces that at startup.
 *
 * 🚨 THE SEALING IS NOT RELAXED HERE. A local SQLite file is if anything more
 * exposed than a managed database — it sits in a working directory, gets
 * copied into a tarball, and ends up attached to a bug report. The same sealed
 * values are written, so a stolen dev database is not a mailbox either.
 */

import type { DatabaseSync } from 'node:sqlite';

import type { MailConnectionRecord } from './connectionStore.js';
import type { SealedValue } from './tokenSealing.js';
import type { Scope } from '../memory/conversationStore.js';

export const MAIL_CONNECTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS mail_connection (
  owner_scope              TEXT    NOT NULL,
  workspace_scope          TEXT    NOT NULL,
  provider                 TEXT    NOT NULL,
  provider_account_id      TEXT    NOT NULL,
  account_address          TEXT    NOT NULL,
  -- Sealed JSON. No plaintext token is written to this file.
  access_token_sealed      TEXT    NOT NULL,
  refresh_token_sealed     TEXT    NOT NULL,
  access_token_expires_at  INTEGER NOT NULL,
  granted_scopes           TEXT    NOT NULL,
  -- Non-null means authorization_expired. The row is RETAINED.
  authorization_revoked_at INTEGER,
  connected_at             INTEGER NOT NULL,
  last_refresh_at          INTEGER,
  updated_at               INTEGER NOT NULL,
  PRIMARY KEY (owner_scope, workspace_scope, provider, provider_account_id)
);
`;

interface Row {
  owner_scope: string;
  workspace_scope: string;
  provider: string;
  provider_account_id: string;
  account_address: string;
  access_token_sealed: string;
  refresh_token_sealed: string;
  access_token_expires_at: number;
  granted_scopes: string;
  authorization_revoked_at: number | null;
  connected_at: number;
  last_refresh_at: number | null;
  updated_at: number;
}

function toRecord(row: Row): MailConnectionRecord {
  return {
    ownerScope: row.owner_scope,
    workspaceScope: row.workspace_scope,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    accountAddress: row.account_address,
    sealedAccessToken: JSON.parse(row.access_token_sealed) as SealedValue,
    sealedRefreshToken: JSON.parse(row.refresh_token_sealed) as SealedValue,
    accessTokenExpiresAt: row.access_token_expires_at,
    grantedScopes: JSON.parse(row.granted_scopes) as string[],
    authorizationRevokedAt: row.authorization_revoked_at,
    connectedAt: row.connected_at,
    lastRefreshAt: row.last_refresh_at,
    updatedAt: row.updated_at,
  };
}

const COLUMNS = `owner_scope, workspace_scope, provider, provider_account_id, account_address,
       access_token_sealed, refresh_token_sealed, access_token_expires_at, granted_scopes,
       authorization_revoked_at, connected_at, last_refresh_at, updated_at`;

export class SqliteMailConnectionStore {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(MAIL_CONNECTION_SCHEMA);
  }

  async list(scope: Scope, provider: string): Promise<MailConnectionRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM mail_connection
          WHERE owner_scope = ? AND workspace_scope = ? AND provider = ?
          ORDER BY connected_at ASC`,
      )
      .all(scope.owner, scope.workspace, provider) as unknown as Row[];
    return rows.map(toRecord);
  }

  async get(scope: Scope, provider: string, providerAccountId: string): Promise<MailConnectionRecord | null> {
    const row = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM mail_connection
          WHERE owner_scope = ? AND workspace_scope = ? AND provider = ? AND provider_account_id = ?`,
      )
      .get(scope.owner, scope.workspace, provider, providerAccountId) as unknown as Row | undefined;
    return row ? toRecord(row) : null;
  }

  /** Reconnecting clears the revoked mark — that is what reconnecting means. */
  async put(record: MailConnectionRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO mail_connection (${COLUMNS})
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(owner_scope, workspace_scope, provider, provider_account_id) DO UPDATE SET
           account_address          = excluded.account_address,
           access_token_sealed      = excluded.access_token_sealed,
           refresh_token_sealed     = excluded.refresh_token_sealed,
           access_token_expires_at  = excluded.access_token_expires_at,
           granted_scopes           = excluded.granted_scopes,
           authorization_revoked_at = NULL,
           last_refresh_at          = excluded.last_refresh_at,
           updated_at               = excluded.updated_at`,
      )
      .run(
        record.ownerScope,
        record.workspaceScope,
        record.provider,
        record.providerAccountId,
        record.accountAddress,
        JSON.stringify(record.sealedAccessToken),
        JSON.stringify(record.sealedRefreshToken),
        record.accessTokenExpiresAt,
        JSON.stringify(record.grantedScopes),
        record.authorizationRevokedAt,
        record.connectedAt,
        record.lastRefreshAt,
        record.updatedAt,
      );
  }

  /** 🚨 Deliberately does NOT write the refresh token — see the Postgres repo. */
  async recordRefresh(input: {
    scope: Scope;
    provider: string;
    providerAccountId: string;
    sealedAccessToken: SealedValue;
    accessTokenExpiresAt: number;
    at: number;
  }): Promise<void> {
    this.db
      .prepare(
        `UPDATE mail_connection
            SET access_token_sealed      = ?,
                access_token_expires_at  = ?,
                last_refresh_at          = ?,
                authorization_revoked_at = NULL,
                updated_at               = ?
          WHERE owner_scope = ? AND workspace_scope = ? AND provider = ? AND provider_account_id = ?`,
      )
      .run(
        JSON.stringify(input.sealedAccessToken),
        input.accessTokenExpiresAt,
        input.at,
        input.at,
        input.scope.owner,
        input.scope.workspace,
        input.provider,
        input.providerAccountId,
      );
  }

  /** An UPDATE, never a DELETE. The row is the record that they connected. */
  async markAuthorizationRevoked(input: {
    scope: Scope;
    provider: string;
    providerAccountId: string;
    at: number;
  }): Promise<void> {
    this.db
      .prepare(
        `UPDATE mail_connection SET authorization_revoked_at = ?, updated_at = ?
          WHERE owner_scope = ? AND workspace_scope = ? AND provider = ? AND provider_account_id = ?`,
      )
      .run(input.at, input.at, input.scope.owner, input.scope.workspace, input.provider, input.providerAccountId);
  }

  async disconnect(scope: Scope, provider: string, providerAccountId: string): Promise<boolean> {
    const result = this.db
      .prepare(
        `DELETE FROM mail_connection
          WHERE owner_scope = ? AND workspace_scope = ? AND provider = ? AND provider_account_id = ?`,
      )
      .run(scope.owner, scope.workspace, provider, providerAccountId);
    return Number(result.changes ?? 0) > 0;
  }
}
