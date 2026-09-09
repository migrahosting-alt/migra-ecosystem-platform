/**
 * TOKEN STORAGE — the sealing, the record, and the durable store.
 *
 * A Gmail refresh token is not like the conversation content already in this
 * database. It is a credential to a system that is not ours: it opens the
 * user's actual mailbox from anywhere, survives a Migra password change, and
 * does not expire on its own. So a dump of the durable store must not be a
 * permanent key to every connected mailbox — which is the claim these tests
 * exist to hold up.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  MAIL_TOKEN_KEY_ENV,
  keyIdFor,
  open,
  seal,
  sealKeyFrom,
  sealKeyProblemMessage,
  type SealBinding,
  type SealKey,
} from '../src/engine/email/tokenSealing.js';
import {
  accessTokenExpired,
  connectionStateFor,
  refusalForGrant,
  scopesFromGranted,
  storeRefusalMessage,
  type MailConnectionRecord,
} from '../src/engine/email/connectionStore.js';
import { SqliteMailConnectionStore } from '../src/engine/email/sqliteMailConnection.js';
import { GOOGLE_SCOPES } from '../src/engine/email/oauthConfig.js';
import { SqliteDurableStore } from '../src/engine/persistence/sqliteStore.js';
import { hasMailConnections } from '../src/engine/persistence/types.js';

const KEY_A = Buffer.alloc(32, 7).toString('base64');
const KEY_B = Buffer.alloc(32, 9).toString('base64');

function keyFrom(material: string): SealKey {
  const result = sealKeyFrom({ [MAIL_TOKEN_KEY_ENV]: material });
  assert.equal(result.ok, true);
  return (result as { ok: true; key: SealKey }).key;
}

const key = keyFrom(KEY_A);

const binding = (over: Partial<SealBinding> = {}): SealBinding => ({
  ownerScope: 'user:alice',
  workspaceScope: 'ws:1',
  provider: 'gmail',
  providerAccountId: 'google-account-1',
  purpose: 'refresh_token',
  ...over,
});

const REFRESH = '1//0gRealRefreshTokenValue';

/* ------------------------------------------------------------------ *
 * The key itself
 * ------------------------------------------------------------------ */

test('a valid 32-byte key is accepted and given a stable id', () => {
  const first = keyFrom(KEY_A);
  const second = keyFrom(KEY_A);
  assert.equal(first.id, second.id);
  assert.notEqual(first.id, keyFrom(KEY_B).id);
});

test('🚨 a truncated key is REFUSED, not silently used at the wrong length', () => {
  /*
   * Buffer.from(x, 'base64') does not throw on garbage — it drops invalid
   * characters and returns a SHORT buffer. Without a length check a typo'd key
   * becomes a 7-byte key, and createCipheriv is what notices, at the first
   * connection attempt in production.
   */
  const result = sealKeyFrom({ [MAIL_TOKEN_KEY_ENV]: Buffer.alloc(7, 1).toString('base64') });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.problem.kind, 'wrong_length');
    assert.match(sealKeyProblemMessage(result.problem), /32 bytes.*7/);
  }
});

test('a missing key refuses rather than degrading to plaintext', () => {
  const result = sealKeyFrom({});
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.problem.kind, 'missing');
});

test('🚨 no problem message contains key material', () => {
  for (const value of ['', Buffer.alloc(7, 1).toString('base64'), '!!!not base64!!!']) {
    const result = sealKeyFrom({ [MAIL_TOKEN_KEY_ENV]: value });
    if (!result.ok) {
      const message = sealKeyProblemMessage(result.problem);
      assert.ok(!message.includes(value) || value === '', `key material reached an operator message: ${message}`);
    }
  }
  // And the id is not the key: it is a truncated hash, so knowing it reveals
  // nothing usable.
  assert.notEqual(keyIdFor(Buffer.alloc(32, 7)), KEY_A);
});

/* ------------------------------------------------------------------ *
 * Sealing
 * ------------------------------------------------------------------ */

test('a sealed value round-trips', () => {
  const sealed = seal(key, binding(), REFRESH);
  const opened = open(key, binding(), sealed);
  assert.equal(opened.ok, true);
  if (opened.ok) assert.equal(opened.value, REFRESH);
});

test('🚨 the ciphertext does not contain the plaintext', () => {
  const sealed = seal(key, binding(), REFRESH);
  const serialised = JSON.stringify(sealed);
  assert.ok(!serialised.includes(REFRESH), 'the token is readable in the sealed value');
  assert.ok(!serialised.includes('0gRealRefresh'), 'a fragment of the token survived sealing');
});

test('🚨 the same value sealed twice produces different ciphertext', () => {
  /*
   * A reused IV in GCM is catastrophic — it leaks the XOR of two plaintexts
   * and the authentication key. A fresh IV per seal is the reason this holds.
   */
  const first = seal(key, binding(), REFRESH);
  const second = seal(key, binding(), REFRESH);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
});

test('🚨 a ciphertext MOVED TO ANOTHER USER does not open', () => {
  /*
   * The attack encryption alone does not stop. Encryption defeats a READER of
   * the database; this defeats a WRITER. An attacker connects their own
   * mailbox, copies their own sealed refresh token into a victim's row, and
   * every "my email" question the victim asks reads the ATTACKER'S inbox while
   * anything drafted goes out from it.
   *
   * That is the same graft the callback's principal check refuses, arriving
   * through the storage layer instead of the browser.
   */
  const sealed = seal(key, binding({ ownerScope: 'user:attacker' }), REFRESH);
  const opened = open(key, binding({ ownerScope: 'user:victim' }), sealed);
  assert.equal(opened.ok, false);
  if (!opened.ok) assert.equal(opened.reason, 'unreadable');
});

test('🚨 a ciphertext moved to another WORKSPACE does not open', () => {
  const sealed = seal(key, binding({ workspaceScope: 'ws:1' }), REFRESH);
  assert.equal(open(key, binding({ workspaceScope: 'ws:2' }), sealed).ok, false);
});

test('🚨 a ciphertext moved to another PROVIDER ACCOUNT does not open', () => {
  // Same user, second mailbox. Without the account in the binding, one of a
  // user's accounts could be made to answer for another.
  const sealed = seal(key, binding({ providerAccountId: 'google-account-1' }), REFRESH);
  assert.equal(open(key, binding({ providerAccountId: 'google-account-2' }), sealed).ok, false);
});

test('🚨 an access-token ciphertext cannot be pasted into the refresh column', () => {
  /*
   * Purpose is authenticated. Swapping them would either make a one-hour
   * credential masquerade as a durable one, or silently destroy the ability to
   * refresh — and both would present as an inexplicably dead connection.
   */
  const sealed = seal(key, binding({ purpose: 'access_token' }), 'ya29.access');
  assert.equal(open(key, binding({ purpose: 'refresh_token' }), sealed).ok, false);
});

test('🚨 bindings that would COLLIDE under naive concatenation stay distinct', () => {
  /*
   * Length-prefixing, not decoration. The fields have to be ADJACENT in the
   * serialisation for a concatenation collision to exist at all — owner and
   * workspace are, so owner "a" + workspace "bc" and owner "ab" + workspace
   * "c" both concatenate to "abc", and a ciphertext would move between those
   * two rows undetected.
   *
   * 🚨 The first version of this test used owner and ACCOUNT, which are not
   * adjacent: workspace and provider sit between them, so raw concatenation
   * produced different bytes anyway and the test passed against a
   * deliberately broken implementation. It proved nothing until the fields
   * were chosen to make the collision actually reachable.
   */
  const sealed = seal(key, binding({ ownerScope: 'a', workspaceScope: 'bc' }), REFRESH);
  const opened = open(key, binding({ ownerScope: 'ab', workspaceScope: 'c' }), sealed);
  assert.equal(opened.ok, false, 'two different bindings produced interchangeable additional data');
});

test('a tampered ciphertext yields nothing, not a partial plaintext', () => {
  const sealed = seal(key, binding(), REFRESH);
  const bytes = Buffer.from(sealed.ciphertext, 'base64');
  bytes[0] = bytes[0]! ^ 0xff;
  const opened = open(key, binding(), { ...sealed, ciphertext: bytes.toString('base64') });
  assert.equal(opened.ok, false);
  if (!opened.ok) assert.equal(opened.reason, 'unreadable');
});

test('🚨 a WRONG KEY is distinguished from tampering', () => {
  // Different remedies: one names rotation, the other names a corrupt or moved
  // row. Collapsing them would send an operator looking in the wrong place.
  const sealed = seal(key, binding(), REFRESH);
  const opened = open(keyFrom(KEY_B), binding(), sealed);
  assert.equal(opened.ok, false);
  if (!opened.ok) {
    assert.equal(opened.reason, 'wrong_key');
    assert.equal(opened.sealedWith, key.id);
  }
});

/* ------------------------------------------------------------------ *
 * The record
 * ------------------------------------------------------------------ */

function record(over: Partial<MailConnectionRecord> = {}): MailConnectionRecord {
  return {
    ownerScope: 'user:alice',
    workspaceScope: 'ws:1',
    provider: 'gmail',
    providerAccountId: 'google-account-1',
    accountAddress: 'alice@example.com',
    sealedAccessToken: seal(key, binding({ purpose: 'access_token' }), 'ya29.access'),
    sealedRefreshToken: seal(key, binding({ purpose: 'refresh_token' }), REFRESH),
    accessTokenExpiresAt: 3_600_000,
    grantedScopes: [GOOGLE_SCOPES.read],
    authorizationRevokedAt: null,
    connectedAt: 1_000,
    lastRefreshAt: null,
    updatedAt: 1_000,
    ...over,
  };
}

test('🚨 the record CANNOT carry a plaintext token — it is ciphertext by type', () => {
  /*
   * Structural, not a convention. The sibling adapter serialised its access
   * token through JSON.stringify because TypeScript's `private` is
   * compile-time only; a rule that depends on nobody logging the wrong object
   * fails eventually.
   */
  const serialised = JSON.stringify(record());
  assert.ok(!serialised.includes(REFRESH), 'the refresh token is readable in the record');
  assert.ok(!serialised.includes('ya29.access'), 'the access token is readable in the record');
  // The address IS present — it is display data the UI needs, and it is not a
  // credential.
  assert.ok(serialised.includes('alice@example.com'));
});

/* ------------------------------------------------------------------ *
 * State derivation
 * ------------------------------------------------------------------ */

test('🚨 an EXPIRED ACCESS TOKEN is still `connected`', () => {
  /*
   * It is the ordinary state of every connection older than an hour, and the
   * refresh path exists for it. Reporting it as expired authorization would
   * tell users to reconnect a working mailbox several times a day.
   */
  const stale = record({ accessTokenExpiresAt: 0 });
  assert.ok(accessTokenExpired(stale, 10_000_000));
  assert.equal(
    connectionStateFor({ record: stale, providerConfigured: true, seal: 'opened' }),
    'connected',
  );
});

test('a revoked grant is `authorization_expired`, and the row still exists', () => {
  assert.equal(
    connectionStateFor({ record: record({ authorizationRevokedAt: 5_000 }), providerConfigured: true, seal: 'opened' }),
    'authorization_expired',
  );
});

test('🚨 an UNREADABLE seal is NOT reported as authorization_expired', () => {
  /*
   * That state's remedy is "reconnect", and reconnecting overwrites a
   * perfectly good row to work around a misconfigured key — after which the
   * evidence of what actually went wrong is gone. The user sees unavailability,
   * whose remedy is to wait; the operator gets the real fact elsewhere.
   */
  const state = connectionStateFor({ record: record(), providerConfigured: true, seal: 'unreadable' });
  assert.notEqual(state, 'authorization_expired');
  assert.equal(state, 'provider_unavailable');
});

test('no row is not_connected; no provider is not_configured', () => {
  assert.equal(connectionStateFor({ record: null, providerConfigured: true, seal: 'opened' }), 'not_connected');
  assert.equal(connectionStateFor({ record: null, providerConfigured: false, seal: 'opened' }), 'not_configured');
  // Never having connected and having been revoked are different facts with
  // different remedies — the whole reason the row is retained.
  assert.notEqual(
    connectionStateFor({ record: null, providerConfigured: true, seal: 'opened' }),
    connectionStateFor({ record: record({ authorizationRevokedAt: 1 }), providerConfigured: true, seal: 'opened' }),
  );
});

test('a token is refreshed slightly EARLY, so it cannot expire mid-request', () => {
  const r = record({ accessTokenExpiresAt: 100_000 });
  assert.equal(accessTokenExpired(r, 100_000 - 90_000), false);
  assert.equal(accessTokenExpired(r, 100_000 - 30_000), true, 'a token about to expire was treated as fresh');
});

/* ------------------------------------------------------------------ *
 * What may be stored at all
 * ------------------------------------------------------------------ */

test('🚨 a grant with NO REFRESH TOKEN is refused rather than stored', () => {
  /*
   * The authorization URL always asks for offline access and forces consent,
   * so this is anomalous. Storing it would create a connection that works for
   * an hour, then tells the user to reconnect forever, with no way for them to
   * tell it from a real revocation. One honest failure now beats silent decay.
   */
  const refusal = refusalForGrant({ hasRefreshToken: false, grantedScopes: [GOOGLE_SCOPES.read] });
  assert.deepEqual(refusal, { kind: 'no_refresh_token' });
  assert.match(storeRefusalMessage(refusal!), /could not be connected/i);
});

test('a grant permitting nothing this product does is refused', () => {
  const refusal = refusalForGrant({ hasRefreshToken: true, grantedScopes: ['https://www.googleapis.com/auth/userinfo.email'] });
  assert.deepEqual(refusal, { kind: 'no_usable_scope' });
});

test('a read-only grant is accepted — reading without sending is a real state', () => {
  assert.equal(refusalForGrant({ hasRefreshToken: true, grantedScopes: [GOOGLE_SCOPES.read] }), null);
  assert.deepEqual(scopesFromGranted([GOOGLE_SCOPES.read]), { read: true, draft: false, send: false });
  assert.deepEqual(
    scopesFromGranted([GOOGLE_SCOPES.read, GOOGLE_SCOPES.send]),
    { read: true, draft: false, send: true },
  );
});

test('🚨 scopes are read from what was GRANTED, never from what was asked', () => {
  // Google may grant less than was requested. Recording the request would make
  // the product promise a send that is refused at dispatch.
  assert.equal(scopesFromGranted([GOOGLE_SCOPES.read]).send, false);
});

/* ------------------------------------------------------------------ *
 * The durable store, against a REAL database
 * ------------------------------------------------------------------ */

function tmpDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'migraai-maildb-')), 'state.db');
}

const ALICE = { owner: 'user:alice', workspace: 'ws:1' };
const BOB = { owner: 'user:bob', workspace: 'ws:1' };

async function store(): Promise<{ store: SqliteMailConnectionStore; close: () => void }> {
  const durable = new SqliteDurableStore(tmpDb());
  // Reaching the table through the durable store's own database handle, so the
  // test exercises the same file the store uses rather than a second one.
  const inner = new SqliteMailConnectionStore((durable as unknown as { db: never }).db);
  return { store: inner, close: () => durable.close() };
}

test('a connection round-trips through a real database', async () => {
  const h = await store();
  await h.store.put(record());
  const got = await h.store.get(ALICE, 'gmail', 'google-account-1');
  assert.ok(got);
  assert.equal(got!.accountAddress, 'alice@example.com');
  // And the stored ciphertext still opens — the JSON round-trip through the
  // database did not corrupt the sealed value.
  const opened = open(key, binding(), got!.sealedRefreshToken);
  assert.equal(opened.ok, true);
  if (opened.ok) assert.equal(opened.value, REFRESH);
  h.close();
});

test('🚨 another principal cannot read the connection, even with the right account id', async () => {
  /*
   * The storage half of "the client never names an account". The account id is
   * part of the primary key, so a query using only it would be efficient and
   * would return someone else's mailbox.
   */
  const h = await store();
  await h.store.put(record());
  assert.equal(await h.store.get(BOB, 'gmail', 'google-account-1'), null);
  assert.deepEqual(await h.store.list(BOB, 'gmail'), []);
  h.close();
});

test('🚨 marking a grant revoked does NOT delete the row', async () => {
  /*
   * The row is what records that they DID connect, which is what makes the
   * remedy "reconnect" rather than "start from nothing", and what a support
   * conversation needs three days later.
   */
  const h = await store();
  await h.store.put(record());
  await h.store.markAuthorizationRevoked({ scope: ALICE, provider: 'gmail', providerAccountId: 'google-account-1', at: 9_000 });
  const got = await h.store.get(ALICE, 'gmail', 'google-account-1');
  assert.ok(got, 'a revoked grant deleted the connection row');
  assert.equal(got!.authorizationRevokedAt, 9_000);
  assert.equal(
    connectionStateFor({ record: got!, providerConfigured: true, seal: 'opened' }),
    'authorization_expired',
  );
  h.close();
});

test('🚨 recording a refresh does NOT overwrite the refresh token', async () => {
  /*
   * Google does not reissue a refresh token on an ordinary refresh. A
   * statement that updated both columns would eventually write whatever the
   * caller happened to pass over the one credential that cannot be recovered.
   */
  const h = await store();
  await h.store.put(record());
  const before = (await h.store.get(ALICE, 'gmail', 'google-account-1'))!.sealedRefreshToken;

  await h.store.recordRefresh({
    scope: ALICE,
    provider: 'gmail',
    providerAccountId: 'google-account-1',
    sealedAccessToken: seal(key, binding({ purpose: 'access_token' }), 'ya29.newer'),
    accessTokenExpiresAt: 7_200_000,
    at: 6_000,
  });

  const after = (await h.store.get(ALICE, 'gmail', 'google-account-1'))!;
  assert.deepEqual(after.sealedRefreshToken, before, 'the refresh token was overwritten by a refresh');
  assert.equal(after.accessTokenExpiresAt, 7_200_000);
  assert.equal(after.lastRefreshAt, 6_000);
  const opened = open(key, binding({ purpose: 'access_token' }), after.sealedAccessToken);
  assert.equal(opened.ok, true);
  if (opened.ok) assert.equal(opened.value, 'ya29.newer');
  h.close();
});

test('a successful refresh clears a stale revoked mark', async () => {
  const h = await store();
  await h.store.put(record({ authorizationRevokedAt: 5_000 }));
  await h.store.recordRefresh({
    scope: ALICE,
    provider: 'gmail',
    providerAccountId: 'google-account-1',
    sealedAccessToken: seal(key, binding({ purpose: 'access_token' }), 'ya29.newer'),
    accessTokenExpiresAt: 7_200_000,
    at: 6_000,
  });
  assert.equal((await h.store.get(ALICE, 'gmail', 'google-account-1'))!.authorizationRevokedAt, null);
  h.close();
});

test('reconnecting clears the revoked mark — that is what reconnecting means', async () => {
  const h = await store();
  await h.store.put(record({ authorizationRevokedAt: 5_000 }));
  await h.store.put(record({ accountAddress: 'alice@work.example.com' }));
  const got = (await h.store.get(ALICE, 'gmail', 'google-account-1'))!;
  assert.equal(got.authorizationRevokedAt, null);
  assert.equal(got.accountAddress, 'alice@work.example.com');
  h.close();
});

test('🚨 disconnect is the ONLY thing that removes a row, and reports a no-op honestly', async () => {
  const h = await store();
  await h.store.put(record());
  assert.equal(await h.store.disconnect(ALICE, 'gmail', 'google-account-1'), true);
  assert.equal(await h.store.get(ALICE, 'gmail', 'google-account-1'), null);
  // A second disconnect removed nothing. Reporting success for that is how a
  // failed disconnect gets mistaken for a completed one.
  assert.equal(await h.store.disconnect(ALICE, 'gmail', 'google-account-1'), false);
  h.close();
});

test("🚨 one principal cannot disconnect another's account", async () => {
  const h = await store();
  await h.store.put(record());
  assert.equal(await h.store.disconnect(BOB, 'gmail', 'google-account-1'), false);
  assert.ok(await h.store.get(ALICE, 'gmail', 'google-account-1'), "another principal's disconnect removed the row");
  h.close();
});

test('a principal may hold several accounts, listed scope-first', async () => {
  const h = await store();
  await h.store.put(record());
  await h.store.put(record({ providerAccountId: 'google-account-2', accountAddress: 'alice2@example.com', connectedAt: 2_000 }));
  const all = await h.store.list(ALICE, 'gmail');
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((r) => r.providerAccountId), ['google-account-1', 'google-account-2']);
  h.close();
});

test('🚨 the connection survives a restart — it is durable, not in-memory', async () => {
  /*
   * The defect this guards against is precise and has happened here before: a
   * memory-backed store works perfectly in the local rig and quietly makes
   * users reconnect their mailbox after every Brain restart.
   */
  const p = tmpDb();
  let durable = new SqliteDurableStore(p);
  await durable.putMailConnection(record(), ALICE);
  durable.close();

  durable = new SqliteDurableStore(p); // reopen — a "restart"
  const got = await durable.getMailConnection(ALICE, 'gmail', 'google-account-1');
  assert.ok(got, 'the connection did not survive a restart');
  assert.equal(got!.accountAddress, 'alice@example.com');
  durable.close();
});

test('🚨 the durable store ANSWERS the capability, rather than being asked its class', async () => {
  /*
   * `durable instanceof SqliteDurableStore ? … : new InMemory…` is exactly how
   * the project binding ended up in memory in production. A store earns the
   * capability by implementing it; a store that lacks it must have email
   * REFUSED, not degraded to something that forgets.
   */
  const durable = new SqliteDurableStore(tmpDb());
  assert.equal(hasMailConnections(durable), true);
  assert.equal(hasMailConnections({ nothing: true }), false);
  durable.close();
});
