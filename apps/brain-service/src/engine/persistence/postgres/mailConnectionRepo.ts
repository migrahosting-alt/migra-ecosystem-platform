import type { PoolClient } from 'pg';

import type { MailConnectionRecord } from '../../email/connectionStore.js';
import type { SealedValue } from '../../email/tokenSealing.js';
import type { Scope } from '../../memory/conversationStore.js';

/**
 * Connected mail accounts, durably, on the canonical backend.
 *
 * 🚨 EVERY STATEMENT HERE FILTERS ON SCOPE, INCLUDING THE ONES THAT ALSO HAVE
 * A PRIMARY KEY.
 *
 * `provider_account_id` is part of the primary key, so a query using only it
 * would be perfectly efficient and perfectly wrong: it would find another
 * user's connection. The account id NARROWS within a scope; it never
 * identifies a row on its own. Writing the scope predicate into every
 * statement — even the ones where it looks redundant — is what makes a missed
 * filter a visible omission in a diff rather than a silent cross-tenant read.
 *
 * 🚨 NO PLAINTEXT TOKEN CROSSES THIS FILE. Both token columns carry sealed
 * values; this repo moves ciphertext and never opens it.
 */

interface Row {
  owner_scope: string;
  workspace_scope: string;
  provider: string;
  provider_account_id: string;
  account_address: string;
  access_token_sealed: SealedValue;
  refresh_token_sealed: SealedValue;
  access_token_expires_at: string | number;
  granted_scopes: string[];
  authorization_revoked_at: string | number | null;
  connected_at: string | number;
  last_refresh_at: string | number | null;
  updated_at: string | number;
}

/**
 * BIGINT arrives from node-postgres as a STRING, and `Number(null)` is 0 — so
 * a naive conversion would turn "never revoked" into "revoked at the epoch",
 * i.e. every connection permanently expired. Null is preserved deliberately.
 */
function bigint(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}
function nullableBigint(value: string | number | null): number | null {
  return value === null ? null : bigint(value);
}

function toRecord(row: Row): MailConnectionRecord {
  return {
    ownerScope: row.owner_scope,
    workspaceScope: row.workspace_scope,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    accountAddress: row.account_address,
    sealedAccessToken: row.access_token_sealed,
    sealedRefreshToken: row.refresh_token_sealed,
    accessTokenExpiresAt: bigint(row.access_token_expires_at),
    grantedScopes: row.granted_scopes,
    authorizationRevokedAt: nullableBigint(row.authorization_revoked_at),
    connectedAt: bigint(row.connected_at),
    lastRefreshAt: nullableBigint(row.last_refresh_at),
    updatedAt: bigint(row.updated_at),
  };
}

const COLUMNS = `owner_scope, workspace_scope, provider, provider_account_id, account_address,
       access_token_sealed, refresh_token_sealed, access_token_expires_at, granted_scopes,
       authorization_revoked_at, connected_at, last_refresh_at, updated_at`;

export async function listConnections(
  client: PoolClient,
  scope: Scope,
  provider: string,
): Promise<MailConnectionRecord[]> {
  const { rows } = await client.query<Row>(
    `SELECT ${COLUMNS}
       FROM mail_connection
      WHERE owner_scope = $1 AND workspace_scope = $2 AND provider = $3
      ORDER BY connected_at ASC`,
    [scope.owner, scope.workspace, provider],
  );
  return rows.map(toRecord);
}

export async function getConnection(
  client: PoolClient,
  scope: Scope,
  provider: string,
  providerAccountId: string,
): Promise<MailConnectionRecord | null> {
  const { rows } = await client.query<Row>(
    `SELECT ${COLUMNS}
       FROM mail_connection
      WHERE owner_scope = $1 AND workspace_scope = $2 AND provider = $3 AND provider_account_id = $4`,
    [scope.owner, scope.workspace, provider, providerAccountId],
  );
  const row = rows[0];
  return row ? toRecord(row) : null;
}

/**
 * Insert or replace a connection.
 *
 * An UPSERT because reconnecting is one state change: a delete-then-insert
 * leaves a window in which the user has no connection, and a concurrent read
 * would report "not connected" for an account they never disconnected.
 *
 * 🚨 `authorization_revoked_at` is reset to NULL here. That is the point of
 * reconnecting — the row records that they connected, and this grant works.
 */
export async function putConnection(client: PoolClient, record: MailConnectionRecord): Promise<void> {
  await client.query(
    `INSERT INTO mail_connection (${COLUMNS})
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (owner_scope, workspace_scope, provider, provider_account_id) DO UPDATE SET
       account_address          = EXCLUDED.account_address,
       access_token_sealed      = EXCLUDED.access_token_sealed,
       refresh_token_sealed     = EXCLUDED.refresh_token_sealed,
       access_token_expires_at  = EXCLUDED.access_token_expires_at,
       granted_scopes           = EXCLUDED.granted_scopes,
       authorization_revoked_at = NULL,
       last_refresh_at          = EXCLUDED.last_refresh_at,
       updated_at               = EXCLUDED.updated_at`,
    [
      record.ownerScope,
      record.workspaceScope,
      record.provider,
      record.providerAccountId,
      record.accountAddress,
      JSON.stringify(record.sealedAccessToken),
      JSON.stringify(record.sealedRefreshToken),
      record.accessTokenExpiresAt,
      record.grantedScopes,
      record.authorizationRevokedAt,
      record.connectedAt,
      record.lastRefreshAt,
      record.updatedAt,
    ],
  );
}

/**
 * Record a refreshed access token.
 *
 * 🚨 The refresh token is NOT touched. Google does not reissue one on an
 * ordinary refresh, so writing this statement to update both columns would
 * eventually overwrite a working refresh token with whatever the caller
 * happened to pass — and there is no way to recover it. Narrowing the
 * statement is the safeguard.
 *
 * A successful refresh also clears `authorization_revoked_at`: the grant
 * demonstrably works again.
 */
export async function recordRefresh(
  client: PoolClient,
  input: {
    scope: Scope;
    provider: string;
    providerAccountId: string;
    sealedAccessToken: SealedValue;
    accessTokenExpiresAt: number;
    at: number;
  },
): Promise<void> {
  await client.query(
    `UPDATE mail_connection
        SET access_token_sealed     = $5,
            access_token_expires_at = $6,
            last_refresh_at         = $7,
            authorization_revoked_at = NULL,
            updated_at              = $7
      WHERE owner_scope = $1 AND workspace_scope = $2 AND provider = $3 AND provider_account_id = $4`,
    [
      input.scope.owner,
      input.scope.workspace,
      input.provider,
      input.providerAccountId,
      JSON.stringify(input.sealedAccessToken),
      input.accessTokenExpiresAt,
      input.at,
    ],
  );
}

/**
 * The grant stopped working.
 *
 * 🚨 An UPDATE, never a DELETE. The row is what records that the user did
 * connect, which is what makes the remedy "reconnect" rather than "start from
 * nothing", and what a support conversation needs three days later.
 */
export async function markAuthorizationRevoked(
  client: PoolClient,
  input: { scope: Scope; provider: string; providerAccountId: string; at: number },
): Promise<void> {
  await client.query(
    `UPDATE mail_connection
        SET authorization_revoked_at = $5,
            updated_at               = $5
      WHERE owner_scope = $1 AND workspace_scope = $2 AND provider = $3 AND provider_account_id = $4`,
    [input.scope.owner, input.scope.workspace, input.provider, input.providerAccountId, input.at],
  );
}

/**
 * The user asked to disconnect. The only thing that removes a row.
 *
 * Returns whether a row was actually removed, so the caller can distinguish
 * "disconnected" from "there was nothing to disconnect" instead of reporting
 * success for a no-op — which is how a failed disconnect gets mistaken for a
 * completed one.
 */
export async function deleteConnection(
  client: PoolClient,
  scope: Scope,
  provider: string,
  providerAccountId: string,
): Promise<boolean> {
  const result = await client.query(
    `DELETE FROM mail_connection
      WHERE owner_scope = $1 AND workspace_scope = $2 AND provider = $3 AND provider_account_id = $4`,
    [scope.owner, scope.workspace, provider, providerAccountId],
  );
  return (result.rowCount ?? 0) > 0;
}
