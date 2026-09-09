/**
 * CONNECTING A MAILBOX — begin, complete, report, disconnect.
 *
 * The attack shaping the callback is concrete: get a victim's browser to
 * complete a callback carrying the ATTACKER'S authorization code, and the
 * victim's account is connected to the attacker's mailbox. Everything below
 * is downstream of refusing that.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  beginConnection,
  completeConnection,
  connectionStatus,
  disconnectConnection,
  type ConnectionServiceDeps,
  type ProviderIdentity,
} from '../src/engine/email/connectionService.js';
import { hashState } from '../src/engine/email/pendingAuthorization.js';
import { SqliteMailPendingStore } from '../src/engine/email/sqliteMailPending.js';
import { SqliteMailConnectionStore } from '../src/engine/email/sqliteMailConnection.js';
import { SqliteDurableStore } from '../src/engine/persistence/sqliteStore.js';
import { GOOGLE_SCOPES, IDENTITY_SCOPES, oauthConfigFrom, ENV } from '../src/engine/email/oauthConfig.js';
import { MAIL_TOKEN_KEY_ENV, open, sealKeyFrom, type SealKey } from '../src/engine/email/tokenSealing.js';
import { STATE_TTL_MS, type TokenGrant } from '../src/engine/email/oauthFlow.js';

const keyResult = sealKeyFrom({ [MAIL_TOKEN_KEY_ENV]: Buffer.alloc(32, 7).toString('base64') });
assert.equal(keyResult.ok, true);
const key = (keyResult as { ok: true; key: SealKey }).key;

const configResult = oauthConfigFrom({
  [ENV.clientId]: 'client-123.apps.googleusercontent.com',
  [ENV.clientSecret]: 'GOCSPX-not-real',
  [ENV.publicOrigin]: 'https://chat.example.com',
});
assert.equal(configResult.ok, true);
const config = (configResult as { ok: true; config: { clientId: string; hasSecret: boolean; redirectUri: string } }).config;

const ALICE = { owner: 'user:alice', workspace: 'ws:1' };
const BOB = { owner: 'user:bob', workspace: 'ws:1' };
const NOW = 1_000_000;
const REFRESH = '1//0gTheRefreshToken';

const GRANT: TokenGrant = {
  accessToken: 'ya29.access',
  refreshToken: REFRESH,
  expiresAt: NOW + 3_600_000,
  grantedScopes: [GOOGLE_SCOPES.read],
};

const IDENTITY: ProviderIdentity = {
  providerAccountId: 'google-uid-1',
  accountAddress: 'alice@example.com',
};

function tmpDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'migraai-mailsvc-')), 'state.db');
}

interface Harness {
  deps: ConnectionServiceDeps;
  readonly exchanges: number;
  readonly revoked: string[];
  close(): void;
}

function harness(over: Partial<ConnectionServiceDeps> & { grant?: TokenGrant; revokeOk?: boolean } = {}): Harness {
  const durable = new SqliteDurableStore(tmpDb());
  const db = (durable as unknown as { db: never }).db;
  let exchanges = 0;
  const revoked: string[] = [];

  const deps: ConnectionServiceDeps = {
    config,
    key,
    connections: new SqliteMailConnectionStore(db),
    pending: new SqliteMailPendingStore(db),
    exchange: async () => { exchanges += 1; return over.grant ?? GRANT; },
    identify: async () => IDENTITY,
    revoke: async (token) => { revoked.push(token); return over.revokeOk ?? true; },
    now: () => NOW,
    ...over,
  };

  return {
    deps,
    get exchanges() { return exchanges; },
    get revoked() { return revoked; },
    close: () => durable.close(),
  };
}

/** The raw state Google would return, recovered from what begin() minted. */
function stateFrom(authorizationUrl: string): string {
  return new URL(authorizationUrl).searchParams.get('state')!;
}

/* ------------------------------------------------------------------ *
 * Begin
 * ------------------------------------------------------------------ */

test('beginning a connection produces a URL carrying a fresh state', async () => {
  const h = harness();
  const first = await beginConnection({ scope: ALICE, provider: 'gmail', grants: ['read'], deps: h.deps });
  const second = await beginConnection({ scope: ALICE, provider: 'gmail', grants: ['read'], deps: h.deps });
  assert.notEqual(stateFrom(first.authorizationUrl), stateFrom(second.authorizationUrl));
  const url = new URL(first.authorizationUrl);
  assert.equal(url.searchParams.get('redirect_uri'), 'https://chat.example.com/api/account/mail/callback');
  /*
   * Mailbox authority is READ and nothing else; the identity scopes are
   * separate and required, because completing a connection has to ask Google
   * whose mailbox the token opens. Asserted as a SET rather than a string so
   * the two concerns cannot be confused with each other.
   */
  const scopes = url.searchParams.get('scope')!.split(' ');
  assert.ok(scopes.includes(GOOGLE_SCOPES.read));
  for (const identity of IDENTITY_SCOPES) assert.ok(scopes.includes(identity));
  assert.ok(!scopes.includes(GOOGLE_SCOPES.send), 'send permission was requested');
  assert.ok(!scopes.includes(GOOGLE_SCOPES.draft), 'draft permission was requested');
  h.close();
});

test('🚨 the raw state is NEVER stored — only its hash', async () => {
  /*
   * Short-lived, but the same argument that seals the tokens applies: a dump of
   * the pending table must not let anyone resume someone else's attempt.
   */
  const h = harness();
  const begun = await beginConnection({ scope: ALICE, provider: 'gmail', grants: ['read'], deps: h.deps });
  const raw = stateFrom(begun.authorizationUrl);

  assert.equal(await h.deps.pending.take(raw), null, 'the raw state is a usable lookup key');
  const byHash = await h.deps.pending.take(hashState(raw));
  assert.ok(byHash, 'the attempt was not stored under its hash');
  assert.ok(!JSON.stringify(byHash).includes(raw), 'the raw state is recoverable from storage');
  h.close();
});

test('🚨 a hostile returnTo is refused at MINT time, before it is stored', async () => {
  // A hostile value must never reach storage, where a later change to the
  // redirect path could come to trust it.
  const h = harness();
  const begun = await beginConnection({
    scope: ALICE, provider: 'gmail', grants: ['read'], returnTo: '//evil.com', deps: h.deps,
  });
  const stored = await h.deps.pending.take(hashState(stateFrom(begun.authorizationUrl)));
  assert.equal(stored!.returnTo, '/', 'an off-site destination was persisted');
  h.close();
});

/* ------------------------------------------------------------------ *
 * 🚨 Complete
 * ------------------------------------------------------------------ */

async function begunState(h: Harness, scope = ALICE, returnTo?: string): Promise<string> {
  const begun = await beginConnection({
    scope, provider: 'gmail', grants: ['read'], ...(returnTo ? { returnTo } : {}), deps: h.deps,
  });
  return stateFrom(begun.authorizationUrl);
}

test('a completed callback stores a connection and lands the user back', async () => {
  const h = harness();
  const state = await begunState(h, ALICE, '/chat/abc');
  const result = await completeConnection({ scope: ALICE, state, code: 'code-1', error: undefined, deps: h.deps });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.returnTo, '/chat/abc');
    assert.equal(result.account.accountAddress, 'alice@example.com');
  }
  const stored = await h.deps.connections.get(ALICE, 'gmail', 'google-uid-1');
  assert.ok(stored, 'nothing was stored for a completed connection');
  h.close();
});

test('🚨 the stored refresh token is SEALED, and opens only for its own row', async () => {
  const h = harness();
  const state = await begunState(h);
  await completeConnection({ scope: ALICE, state, code: 'code-1', error: undefined, deps: h.deps });
  const stored = (await h.deps.connections.get(ALICE, 'gmail', 'google-uid-1'))!;

  assert.ok(!JSON.stringify(stored).includes(REFRESH), 'the refresh token is readable in the stored row');
  const mine = open(key, {
    ownerScope: ALICE.owner, workspaceScope: ALICE.workspace, provider: 'gmail',
    providerAccountId: 'google-uid-1', purpose: 'refresh_token',
  }, stored.sealedRefreshToken);
  assert.equal(mine.ok, true);
  if (mine.ok) assert.equal(mine.value, REFRESH);

  // The same ciphertext read as if it were Bob's row does not open.
  const grafted = open(key, {
    ownerScope: BOB.owner, workspaceScope: BOB.workspace, provider: 'gmail',
    providerAccountId: 'google-uid-1', purpose: 'refresh_token',
  }, stored.sealedRefreshToken);
  assert.equal(grafted.ok, false, 'a stored token opens for another principal');
  h.close();
});

test('🚨 a callback arriving in ANOTHER session stores nothing and exchanges nothing', async () => {
  /*
   * The attack, precisely: alice begins the flow, the callback lands in bob's
   * session carrying a code. Accepting it would connect bob's Migra account to
   * a mailbox bob did not authorise — or graft an attacker's mailbox onto a
   * victim.
   */
  const h = harness();
  const state = await begunState(h, ALICE);
  const result = await completeConnection({ scope: BOB, state, code: 'code-1', error: undefined, deps: h.deps });
  assert.equal(result.ok, false);
  if (!result.ok && 'refusal' in result) assert.equal(result.refusal.kind, 'principal_mismatch');
  assert.equal(h.exchanges, 0, 'a code was exchanged for a mismatched principal');
  assert.deepEqual(await h.deps.connections.list(BOB, 'gmail'), []);
  h.close();
});

test('🚨 a replayed callback is refused, and costs no exchange', async () => {
  const h = harness();
  const state = await begunState(h);
  assert.equal((await completeConnection({ scope: ALICE, state, code: 'c', error: undefined, deps: h.deps })).ok, true);
  const replay = await completeConnection({ scope: ALICE, state, code: 'c', error: undefined, deps: h.deps });
  assert.equal(replay.ok, false);
  if (!replay.ok && 'refusal' in replay) assert.equal(replay.refusal.kind, 'state_replayed');
  assert.equal(h.exchanges, 1, 'a replayed callback reached the provider');
  h.close();
});

test('an expired attempt is refused', async () => {
  const h = harness();
  const state = await begunState(h);
  // The same stores, so the attempt genuinely exists — only the clock moves.
  const result = await completeConnection({
    scope: ALICE, state, code: 'c', error: undefined,
    deps: { ...h.deps, now: () => NOW + STATE_TTL_MS + 1 },
  });
  assert.equal(result.ok, false);
  if (!result.ok && 'refusal' in result) assert.equal(result.refusal.kind, 'state_expired');
  assert.equal(h.exchanges, 0, 'an expired attempt reached the provider');
  h.close();
});

test('a forged state that was never minted is refused', async () => {
  const h = harness();
  const result = await completeConnection({
    scope: ALICE, state: 'never-minted', code: 'c', error: undefined, deps: h.deps,
  });
  assert.equal(result.ok, false);
  assert.equal(h.exchanges, 0);
  h.close();
});

test('a user pressing Cancel is an ordinary outcome', async () => {
  const h = harness();
  const state = await begunState(h);
  const result = await completeConnection({ scope: ALICE, state, code: undefined, error: 'access_denied', deps: h.deps });
  assert.equal(result.ok, false);
  if (!result.ok && 'refusal' in result) assert.equal(result.refusal.kind, 'user_declined');
  h.close();
});

test('🚨 a grant with no refresh token stores NOTHING', async () => {
  const h = harness({ grant: { ...GRANT, refreshToken: undefined } });
  const state = await begunState(h);
  const result = await completeConnection({ scope: ALICE, state, code: 'c', error: undefined, deps: h.deps });
  assert.equal(result.ok, false);
  if (!result.ok && 'storeRefusal' in result) assert.equal(result.storeRefusal.kind, 'no_refresh_token');
  assert.deepEqual(await h.deps.connections.list(ALICE, 'gmail'), [], 'an unusable grant was stored anyway');
  h.close();
});

test('🚨 the account identity comes from the PROVIDER, not the request', async () => {
  /*
   * A flow that recorded a client-supplied address would let someone label
   * their own mailbox as a colleague's, and every screen afterwards would agree
   * with the label.
   */
  const h = harness({ identify: async () => ({ providerAccountId: 'uid-real', accountAddress: 'real@example.com' }) });
  const state = await begunState(h);
  const result = await completeConnection({ scope: ALICE, state, code: 'c', error: undefined, deps: h.deps });
  assert.equal(result.ok, true);
  const stored = (await h.deps.connections.list(ALICE, 'gmail'))[0]!;
  assert.equal(stored.providerAccountId, 'uid-real');
  assert.equal(stored.accountAddress, 'real@example.com');
  h.close();
});

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

test('status distinguishes unconfigured, unconnected and connected', async () => {
  const h = harness();
  const args = { scope: ALICE, provider: 'gmail', connections: h.deps.connections, now: () => NOW };

  assert.equal((await connectionStatus({ ...args, providerConfigured: false })).state, 'not_configured');
  assert.equal((await connectionStatus({ ...args, providerConfigured: true })).state, 'not_connected');

  const state = await begunState(h);
  await completeConnection({ scope: ALICE, state, code: 'c', error: undefined, deps: h.deps });
  const connected = await connectionStatus({ ...args, providerConfigured: true });
  assert.equal(connected.state, 'connected');
  assert.equal(connected.account, 'alice@example.com');
  assert.deepEqual(connected.scopes, { read: true, draft: false, send: false });
  h.close();
});

test('🚨 a revoked connection does not report the address it can no longer read', async () => {
  // Showing it would imply access we do not have.
  const h = harness();
  const state = await begunState(h);
  await completeConnection({ scope: ALICE, state, code: 'c', error: undefined, deps: h.deps });
  await h.deps.connections.markAuthorizationRevoked({
    scope: ALICE, provider: 'gmail', providerAccountId: 'google-uid-1', at: NOW,
  });
  const status = await connectionStatus({
    scope: ALICE, provider: 'gmail', providerConfigured: true, connections: h.deps.connections, now: () => NOW,
  });
  assert.equal(status.state, 'authorization_expired');
  assert.equal(status.account, undefined, 'a mailbox we cannot read was still named as connected');
  h.close();
});

test("🚨 status never leaks a token, a scope string or a provider code", async () => {
  const h = harness();
  const state = await begunState(h);
  await completeConnection({ scope: ALICE, state, code: 'c', error: undefined, deps: h.deps });
  const serialised = JSON.stringify(await connectionStatus({
    scope: ALICE, provider: 'gmail', providerConfigured: true, connections: h.deps.connections, now: () => NOW,
  }));
  assert.ok(!serialised.includes(REFRESH));
  assert.ok(!serialised.includes('ya29'));
  assert.ok(!serialised.includes('googleapis.com'), `a raw scope string reached the UI: ${serialised}`);
  h.close();
});

test("another principal's connection is invisible in status", async () => {
  const h = harness();
  const state = await begunState(h, ALICE);
  await completeConnection({ scope: ALICE, state, code: 'c', error: undefined, deps: h.deps });
  const bob = await connectionStatus({
    scope: BOB, provider: 'gmail', providerConfigured: true, connections: h.deps.connections, now: () => NOW,
  });
  assert.equal(bob.state, 'not_connected');
  h.close();
});

/* ------------------------------------------------------------------ *
 * Disconnect
 * ------------------------------------------------------------------ */

async function connected(h: Harness): Promise<void> {
  const state = await begunState(h);
  const result = await completeConnection({ scope: ALICE, state, code: 'c', error: undefined, deps: h.deps });
  assert.equal(result.ok, true);
}

test('🚨 disconnect REVOKES at the provider before deleting our row', async () => {
  /*
   * A deletion without an attempted revocation leaves a live grant at Google
   * that nothing in this product can ever reach again — invisible to the user
   * and to us.
   */
  const h = harness();
  await connected(h);
  const result = await disconnectConnection({
    scope: ALICE, provider: 'gmail', providerAccountId: 'google-uid-1', deps: h.deps,
  });
  assert.deepEqual(h.revoked, [REFRESH], 'the grant was deleted without being revoked');
  assert.equal(result.removed, true);
  assert.equal(result.mayRemainAtProvider, false);
  assert.equal(await h.deps.connections.get(ALICE, 'gmail', 'google-uid-1'), null);
  h.close();
});

test('🚨 a FAILED revocation still deletes, and SAYS the grant may be live', async () => {
  /*
   * Reporting a clean disconnection we did not achieve is the one outcome that
   * leaves someone believing their mail is disconnected when it is not.
   */
  const h = harness({ revokeOk: false });
  await connected(h);
  const result = await disconnectConnection({
    scope: ALICE, provider: 'gmail', providerAccountId: 'google-uid-1', deps: h.deps,
  });
  assert.equal(result.removed, true, 'a failed revocation blocked the deletion the user asked for');
  assert.equal(result.mayRemainAtProvider, true, 'a failed revocation was reported as a clean disconnection');
  h.close();
});

test('a revocation that THROWS does not block the deletion', async () => {
  const h = harness({ revoke: async () => { throw new Error('network'); } });
  await connected(h);
  const result = await disconnectConnection({
    scope: ALICE, provider: 'gmail', providerAccountId: 'google-uid-1', deps: h.deps,
  });
  assert.equal(result.removed, true);
  assert.equal(result.mayRemainAtProvider, true);
  h.close();
});

test("🚨 one principal cannot disconnect another's mailbox", async () => {
  const h = harness();
  await connected(h);
  const result = await disconnectConnection({
    scope: BOB, provider: 'gmail', providerAccountId: 'google-uid-1', deps: h.deps,
  });
  assert.equal(result.removed, false);
  assert.deepEqual(h.revoked, [], "another principal's refresh token was sent to the provider");
  assert.ok(await h.deps.connections.get(ALICE, 'gmail', 'google-uid-1'), "another principal's row was removed");
  h.close();
});

test('disconnecting nothing reports nothing removed, rather than success', async () => {
  const h = harness();
  const result = await disconnectConnection({
    scope: ALICE, provider: 'gmail', providerAccountId: 'absent', deps: h.deps,
  });
  assert.deepEqual(result, { removed: false, mayRemainAtProvider: false });
  h.close();
});

/* ------------------------------------------------------------------ *
 * Housekeeping
 * ------------------------------------------------------------------ */

test('abandoned attempts are prunable by age', async () => {
  const h = harness();
  await begunState(h);
  assert.equal(await h.deps.pending.pruneOlderThan(NOW - 1), 0, 'a live attempt was pruned');
  assert.equal(await h.deps.pending.pruneOlderThan(NOW + 1), 1, 'an abandoned attempt was not pruned');
  h.close();
});
