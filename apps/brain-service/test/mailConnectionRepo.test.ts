/**
 * The mail connection on the backend production actually runs.
 *
 * The SQLite tests prove the SEMANTICS; this proves the SQL. They are two
 * separate implementations of one contract, and a divergence between them is
 * precisely the class of defect that put the project binding in memory on
 * production while every local test passed.
 *
 * It also proves migration 27 applies at all — a broken DDL would otherwise
 * first be discovered by a Brain refusing to start.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { PostgresConnection } from '../src/engine/persistence/postgres/pool.js';
import { withScope } from '../src/engine/persistence/postgres/conversationRepo.js';
import {
  deleteConnection, getConnection, listConnections, markAuthorizationRevoked, putConnection, recordRefresh,
} from '../src/engine/persistence/postgres/mailConnectionRepo.js';
import {
  appRoleUrl, postgresTestSkipReason, startDisposablePostgres, type DisposablePostgres,
} from './support/disposablePostgres.js';
import type { MailConnectionRecord } from '../src/engine/email/connectionStore.js';
import type { SealedValue } from '../src/engine/email/tokenSealing.js';

let pg: DisposablePostgres | undefined;
let skip: string | null = null;
let appUrl: string;

const A = { ownerScope: 'user:alice', workspaceScope: 'org:acme' };
const B = { ownerScope: 'user:bob', workspaceScope: 'org:globex' };
const ASCOPE = { owner: A.ownerScope, workspace: A.workspaceScope };
const BSCOPE = { owner: B.ownerScope, workspace: B.workspaceScope };

before(async () => {
  skip = await postgresTestSkipReason();
  if (!skip) {
    pg = await startDisposablePostgres();
    const c = new PostgresConnection({ databaseUrl: pg.databaseUrl });
    await c.migrate();
    await c.close();
    appUrl = await appRoleUrl(pg.databaseUrl);
  }
}, { timeout: 180_000 });

after(async () => { await pg?.stop(); });

async function scoped<T>(scope: typeof A, fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = new PostgresConnection({ databaseUrl: appUrl });
  try {
    return await c.transaction((client) => withScope(client, scope, () => fn(client)));
  } finally {
    await c.close();
  }
}

const sealed = (marker: string): SealedValue => ({
  keyId: 'aaaaaaaaaaaaaaaa',
  iv: Buffer.alloc(12, 1).toString('base64'),
  tag: Buffer.alloc(16, 2).toString('base64'),
  ciphertext: Buffer.from(marker).toString('base64'),
});

function record(over: Partial<MailConnectionRecord> = {}): MailConnectionRecord {
  return {
    ownerScope: A.ownerScope,
    workspaceScope: A.workspaceScope,
    provider: 'gmail',
    providerAccountId: 'google-account-1',
    accountAddress: 'alice@example.com',
    sealedAccessToken: sealed('access-original'),
    sealedRefreshToken: sealed('refresh-original'),
    accessTokenExpiresAt: 3_600_000,
    grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    authorizationRevokedAt: null,
    connectedAt: 1_000,
    lastRefreshAt: null,
    updatedAt: 1_000,
    ...over,
  };
}

test('migration 27 applies and a connection round-trips', async (t) => {
  if (skip) return t.skip(skip);

  await scoped(A, (c) => putConnection(c, record()));
  const got = await scoped(A, (c) => getConnection(c, ASCOPE, 'gmail', 'google-account-1'));
  assert.ok(got);
  assert.equal(got!.accountAddress, 'alice@example.com');
  // The sealed value survived JSONB unchanged — a re-encoding here would make
  // every stored token permanently unopenable.
  assert.deepEqual(got!.sealedRefreshToken, sealed('refresh-original'));
  assert.deepEqual(got!.grantedScopes, ['https://www.googleapis.com/auth/gmail.readonly']);
});

test('🚨 BIGINT columns do not arrive as strings, and null does not become the epoch', async (t) => {
  if (skip) return t.skip(skip);
  /*
   * node-postgres returns BIGINT as a STRING, and `Number(null)` is 0. A naive
   * conversion would turn "never revoked" into "revoked at the epoch" — every
   * connection in the deployment permanently expired.
   */
  await scoped(A, (c) => putConnection(c, record({ providerAccountId: 'bigint-1' })));
  const got = await scoped(A, (c) => getConnection(c, ASCOPE, 'gmail', 'bigint-1'));
  assert.equal(typeof got!.accessTokenExpiresAt, 'number');
  assert.equal(got!.accessTokenExpiresAt, 3_600_000);
  assert.equal(got!.authorizationRevokedAt, null, 'never-revoked became a timestamp');
  assert.equal(got!.lastRefreshAt, null);
});

test('🚨 row-level security is ENABLED and FORCED on the credential table', async (t) => {
  if (skip) return t.skip(skip);
  /*
   * Asserted against the catalog directly, not inferred from behaviour. The
   * repo also writes an explicit scope predicate into every statement, so a
   * behavioural test passes whether or not RLS is on — which means a migration
   * edit that dropped the policy would go unnoticed while the predicate
   * silently carried it. This pins the layer that holds when a predicate is
   * forgotten.
   *
   * FORCE is asserted too: without it the table owner bypasses its own policy.
   */
  const c = new PostgresConnection({ databaseUrl: pg!.databaseUrl });
  try {
    const { rows } = await c.transaction((client) => client.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'mail_connection'`,
    ));
    assert.equal(rows[0]?.relrowsecurity, true, 'row-level security is not enabled on mail_connection');
    assert.equal(rows[0]?.relforcerowsecurity, true, 'row-level security is not FORCED on mail_connection');

    const policies = await c.transaction((client) => client.query<{ polname: string }>(
      `SELECT polname FROM pg_policy WHERE polrelid = 'mail_connection'::regclass`,
    ));
    assert.ok(policies.rows.some((r) => r.polname === 'mail_connection_scope'), 'the scope policy is missing');
  } finally {
    await c.close();
  }
});

test("🚨 another principal cannot read a connection, even naming the right account id", async (t) => {
  if (skip) return t.skip(skip);
  await scoped(A, (c) => putConnection(c, record({ providerAccountId: 'isolated-1' })));
  assert.equal(await scoped(B, (c) => getConnection(c, BSCOPE, 'gmail', 'isolated-1')), null);
  assert.deepEqual(await scoped(B, (c) => listConnections(c, BSCOPE, 'gmail')), []);
});

test('🚨 revoking does NOT delete the row', async (t) => {
  if (skip) return t.skip(skip);
  await scoped(A, (c) => putConnection(c, record({ providerAccountId: 'revoke-1' })));
  await scoped(A, (c) => markAuthorizationRevoked(c, {
    scope: ASCOPE, provider: 'gmail', providerAccountId: 'revoke-1', at: 9_000,
  }));
  const got = await scoped(A, (c) => getConnection(c, ASCOPE, 'gmail', 'revoke-1'));
  assert.ok(got, 'a revoked grant deleted the connection row');
  assert.equal(got!.authorizationRevokedAt, 9_000);
});

test('🚨 a refresh does not overwrite the refresh token', async (t) => {
  if (skip) return t.skip(skip);
  await scoped(A, (c) => putConnection(c, record({ providerAccountId: 'refresh-1' })));
  await scoped(A, (c) => recordRefresh(c, {
    scope: ASCOPE,
    provider: 'gmail',
    providerAccountId: 'refresh-1',
    sealedAccessToken: sealed('access-newer'),
    accessTokenExpiresAt: 7_200_000,
    at: 6_000,
  }));
  const got = await scoped(A, (c) => getConnection(c, ASCOPE, 'gmail', 'refresh-1'));
  assert.deepEqual(got!.sealedRefreshToken, sealed('refresh-original'), 'the refresh token was overwritten');
  assert.deepEqual(got!.sealedAccessToken, sealed('access-newer'));
  assert.equal(got!.lastRefreshAt, 6_000);
});

test('reconnecting clears a revoked mark; disconnect reports a no-op honestly', async (t) => {
  if (skip) return t.skip(skip);
  await scoped(A, (c) => putConnection(c, record({ providerAccountId: 'lifecycle-1', authorizationRevokedAt: 5_000 })));
  await scoped(A, (c) => putConnection(c, record({ providerAccountId: 'lifecycle-1' })));
  const reconnected = await scoped(A, (c) => getConnection(c, ASCOPE, 'gmail', 'lifecycle-1'));
  assert.equal(reconnected!.authorizationRevokedAt, null);

  assert.equal(await scoped(A, (c) => deleteConnection(c, ASCOPE, 'gmail', 'lifecycle-1')), true);
  assert.equal(await scoped(A, (c) => deleteConnection(c, ASCOPE, 'gmail', 'lifecycle-1')), false);
});

test("🚨 one principal cannot disconnect another's account", async (t) => {
  if (skip) return t.skip(skip);
  await scoped(A, (c) => putConnection(c, record({ providerAccountId: 'guard-1' })));
  assert.equal(await scoped(B, (c) => deleteConnection(c, BSCOPE, 'gmail', 'guard-1')), false);
  assert.ok(await scoped(A, (c) => getConnection(c, ASCOPE, 'gmail', 'guard-1')), "another principal's disconnect removed the row");
});
