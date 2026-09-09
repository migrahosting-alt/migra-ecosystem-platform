import type { PoolClient } from 'pg';

import type { GrantKind } from '../../email/oauthConfig.js';
import type { PendingRecord } from '../../email/pendingAuthorization.js';

/**
 * In-flight OAuth attempts.
 *
 * 🚨 `take` is ONE statement. `DELETE ... RETURNING` is what makes single-use
 * atomic; a SELECT followed by a DELETE leaves a window in which two
 * concurrent callbacks both succeed, and the replayed callback is exactly the
 * request that would find it.
 *
 * There is no scope predicate on `take`, and that is deliberate rather than an
 * omission: a callback arrives before we know whose it is, and this row is what
 * tells us. Ownership is enforced afterwards, by comparing the recorded
 * principal to the session making the callback — which is the check that stops
 * a mailbox being grafted onto someone else.
 */

interface Row {
  state_hash: string;
  owner_scope: string;
  workspace_scope: string;
  provider: string;
  grants: string[];
  return_to: string;
  created_at: string | number;
}

function toRecord(row: Row): PendingRecord {
  return {
    stateHash: row.state_hash,
    ownerScope: row.owner_scope,
    workspaceScope: row.workspace_scope,
    provider: row.provider,
    grants: row.grants as GrantKind[],
    returnTo: row.return_to,
    createdAt: typeof row.created_at === 'number' ? row.created_at : Number(row.created_at),
  };
}

export async function putPending(client: PoolClient, record: PendingRecord): Promise<void> {
  await client.query(
    `INSERT INTO mail_oauth_pending
       (state_hash, owner_scope, workspace_scope, provider, grants, return_to, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      record.stateHash,
      record.ownerScope,
      record.workspaceScope,
      record.provider,
      record.grants,
      record.returnTo,
      record.createdAt,
    ],
  );
}

export async function takePending(client: PoolClient, stateHash: string): Promise<PendingRecord | null> {
  const { rows } = await client.query<Row>(
    `DELETE FROM mail_oauth_pending
      WHERE state_hash = $1
      RETURNING state_hash, owner_scope, workspace_scope, provider, grants, return_to, created_at`,
    [stateHash],
  );
  const row = rows[0];
  return row ? toRecord(row) : null;
}

export async function prunePending(client: PoolClient, cutoff: number): Promise<number> {
  const result = await client.query(`DELETE FROM mail_oauth_pending WHERE created_at < $1`, [cutoff]);
  return result.rowCount ?? 0;
}
