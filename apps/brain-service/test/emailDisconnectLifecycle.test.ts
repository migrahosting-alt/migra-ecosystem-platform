/**
 * DISCONNECT, END TO END — and what must change the instant it happens.
 *
 * Disconnecting is the half of the account lifecycle that is easy to ship
 * almost-right: the row goes away, and something somewhere keeps working
 * because it cached a provider, a connection or a readiness answer. Then a user
 * who revoked access watches their mail keep being read.
 *
 * So these run against a REAL database and assert the transitions, not the
 * intentions.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { bindEmailExecution, executeEmailSearch } from '../src/engine/email/emailExecution.js';
import { connectionStatus, disconnectConnection } from '../src/engine/email/connectionService.js';
import { emailReadinessFor } from '../src/engine/email/emailReadiness.js';
import { __resetInFlightForTest } from '../src/engine/email/tokenRefresh.js';
import { SqliteMailConnectionStore } from '../src/engine/email/sqliteMailConnection.js';
import { SqliteDurableStore } from '../src/engine/persistence/sqliteStore.js';
import { GOOGLE_SCOPES } from '../src/engine/email/oauthConfig.js';
import { MAIL_TOKEN_KEY_ENV, seal, sealKeyFrom, type SealKey } from '../src/engine/email/tokenSealing.js';
import type { MailConnectionRecord } from '../src/engine/email/connectionStore.js';

const keyResult = sealKeyFrom({ [MAIL_TOKEN_KEY_ENV]: Buffer.alloc(32, 7).toString('base64') });
assert.equal(keyResult.ok, true);
const key = (keyResult as { ok: true; key: SealKey }).key;

const NOW = 1_000_000;
const ALICE = { owner: 'user:alice', workspace: 'ws:1' };
const BOB = { owner: 'user:bob', workspace: 'ws:1' };

function record(scope: typeof ALICE, accountId: string): MailConnectionRecord {
  const binding = (purpose: 'access_token' | 'refresh_token') => ({
    ownerScope: scope.owner,
    workspaceScope: scope.workspace,
    provider: 'gmail',
    providerAccountId: accountId,
    purpose,
  } as const);
  return {
    ownerScope: scope.owner,
    workspaceScope: scope.workspace,
    provider: 'gmail',
    providerAccountId: accountId,
    accountAddress: `${accountId}@example.com`,
    sealedAccessToken: seal(key, binding('access_token'), `access-${accountId}`),
    sealedRefreshToken: seal(key, binding('refresh_token'), `refresh-${accountId}`),
    accessTokenExpiresAt: NOW + 3_600_000,
    grantedScopes: [GOOGLE_SCOPES.read],
    authorizationRevokedAt: null,
    connectedAt: 1_000,
    lastRefreshAt: null,
    updatedAt: 1_000,
  };
}

async function rig() {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'migraai-disconnect-')), 'state.db');
  const durable = new SqliteDurableStore(dbPath);
  const connections = new SqliteMailConnectionStore((durable as unknown as { db: never }).db);
  const revoked: string[] = [];

  await connections.put(record(ALICE, 'alice-1'));
  await connections.put(record(BOB, 'bob-1'));

  bindEmailExecution({
    connections,
    key,
    refresh: async () => ({ kind: 'refreshed', accessToken: 'fresh', expiresAt: NOW + 3_600_000 }),
    now: () => NOW,
  });

  const status = (scope: typeof ALICE) =>
    connectionStatus({ scope, provider: 'gmail', providerConfigured: true, connections, now: () => NOW });

  const search = async (scope: typeof ALICE) => {
    __resetInFlightForTest();
    return executeEmailSearch({ keywords: 'invoice', limit: 5 } as never, { principal: scope });
  };

  return {
    connections,
    revoked,
    status,
    search,
    disconnect: (scope: typeof ALICE, accountId: string) =>
      disconnectConnection({
        scope,
        provider: 'gmail',
        providerAccountId: accountId,
        deps: {
          connections,
          key,
          revoke: async (token) => { revoked.push(token); return true; },
        },
      }),
    close: () => { bindEmailExecution(null); durable.close(); },
  };
}

/* ------------------------------------------------------------------ *
 * 🚨 The transition
 * ------------------------------------------------------------------ */

test('🚨 readiness flips to not-connected the moment the row goes', async () => {
  const r = await rig();

  const before = await r.status(ALICE);
  assert.equal(before.state, 'connected');
  assert.equal(emailReadinessFor(before).ready, true);

  await r.disconnect(ALICE, 'alice-1');

  const after = await r.status(ALICE);
  assert.equal(after.state, 'not_connected', 'a disconnected account still reported as connected');
  const readiness = emailReadinessFor(after);
  assert.equal(readiness.ready, false);
  // And it becomes theirs to fix again, rather than a dead row.
  assert.equal(readiness.remedy, 'connect-account');
  r.close();
});

test('🚨 NO STALE PROVIDER survives a disconnect', async () => {
  /*
   * The failure this exists for: a cached provider, connection or readiness
   * answer keeps working after the row is gone, and someone who revoked access
   * watches their mail keep being read.
   *
   * Proven by EXECUTING, not by inspecting a cache — a cache that is not there
   * cannot be asserted about directly, so the observable behaviour is the
   * evidence.
   */
  const r = await rig();

  const before = await r.search(ALICE);
  assert.equal(before.ok, false);
  if (!before.ok) {
    assert.notEqual(before.failure.kind, 'not_connected', 'a connected account did not resolve');
  }

  await r.disconnect(ALICE, 'alice-1');

  const after = await r.search(ALICE);
  assert.equal(after.ok, false);
  if (!after.ok) {
    assert.equal(after.failure.kind, 'not_connected',
      'a mailbox was still reachable after the user disconnected it');
  }
  r.close();
});

test('🚨 the refresh token is REVOKED at the provider before the row is removed', async () => {
  // A deletion without an attempted revocation leaves a live grant nothing in
  // this product can ever reach again.
  const r = await rig();
  await r.disconnect(ALICE, 'alice-1');
  assert.deepEqual(r.revoked, ['refresh-alice-1']);
  r.close();
});

/* ------------------------------------------------------------------ *
 * 🚨 Only the caller's connection
 * ------------------------------------------------------------------ */

test("🚨 another principal's connection is untouched, and still works", async () => {
  const r = await rig();
  await r.disconnect(ALICE, 'alice-1');

  const bob = await r.status(BOB);
  assert.equal(bob.state, 'connected', "disconnecting alice removed bob's connection");
  assert.equal(bob.account, 'bob-1@example.com');
  assert.equal(emailReadinessFor(bob).ready, true);

  const search = await r.search(BOB);
  assert.equal(search.ok, false);
  if (!search.ok) {
    assert.notEqual(search.failure.kind, 'not_connected', "bob's mailbox stopped resolving");
  }
  r.close();
});

test("🚨 one principal cannot disconnect another's account by naming it", async () => {
  /*
   * 🚨 THIS PROVES THE SERVICE GUARD, NOT THE STORE'S SQL.
   *
   * `disconnectConnection` looks the row up scoped BEFORE deleting, so it
   * returns early here and the store's DELETE is never reached — meaning
   * removing the store's own scope predicate does not fail this file. Measured,
   * not assumed: that mutation was run.
   *
   * The store's predicate is proven separately in `emailTokenStorage.test.ts`,
   * which calls `disconnect` directly and does fail under it. Two layers, two
   * tests — and the note is here so the gap in THIS file is not mistaken for a
   * gap in the guarantee.
   */
  const r = await rig();
  const result = await r.disconnect(BOB, 'alice-1');
  assert.equal(result.removed, false);
  assert.deepEqual(r.revoked, [], "another principal's refresh token was sent to the provider");
  assert.equal((await r.status(ALICE)).state, 'connected', "alice's connection was removed by bob");
  r.close();
});

test('disconnecting twice reports the second as a no-op', async () => {
  // Reporting success for a no-op is how a failed disconnect gets mistaken for
  // a completed one.
  const r = await rig();
  assert.equal((await r.disconnect(ALICE, 'alice-1')).removed, true);
  assert.equal((await r.disconnect(ALICE, 'alice-1')).removed, false);
  r.close();
});

test('🚨 reconnecting after a disconnect works, and is a fresh row', async () => {
  /*
   * Disconnect DELETES, unlike revocation which marks. So reconnecting is a
   * first-time connection again — there is no retained "you used to have this"
   * state, which is the difference between the two operations.
   */
  const r = await rig();
  await r.disconnect(ALICE, 'alice-1');
  assert.equal((await r.status(ALICE)).state, 'not_connected');

  await r.connections.put(record(ALICE, 'alice-1'));
  const after = await r.status(ALICE);
  assert.equal(after.state, 'connected');
  assert.equal(emailReadinessFor(after).ready, true);
  r.close();
});
