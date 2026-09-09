/**
 * MAIL CONNECTION ROUTES, exercised through real HTTP handlers.
 *
 * The scope always comes from the request's identity, never its body. No
 * handler reads an owner out of a payload, and none finds a connection from a
 * provider account id alone — a request can ask about "my mail" and nothing
 * else.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';

import { registerMailConnectionRoutes } from '../src/engine/email/mailConnectionRoutes.js';
import type { ConnectionServiceDeps, ProviderIdentity } from '../src/engine/email/connectionService.js';
import { SqliteMailConnectionStore } from '../src/engine/email/sqliteMailConnection.js';
import { SqliteMailPendingStore } from '../src/engine/email/sqliteMailPending.js';
import { SqliteDurableStore } from '../src/engine/persistence/sqliteStore.js';
import { ENV, GOOGLE_SCOPES, IDENTITY_SCOPES, oauthConfigFrom } from '../src/engine/email/oauthConfig.js';
import { MAIL_TOKEN_KEY_ENV, sealKeyFrom, type SealKey } from '../src/engine/email/tokenSealing.js';
import type { TokenGrant } from '../src/engine/email/oauthFlow.js';

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

const NOW = 1_000_000;
const REFRESH = '1//0gTheRefreshToken';
const GRANT: TokenGrant = {
  accessToken: 'ya29.access',
  refreshToken: REFRESH,
  expiresAt: NOW + 3_600_000,
  grantedScopes: [GOOGLE_SCOPES.read],
};

/** The Brain reads the scope from headers the gateway sets, never from a body. */
const ALICE_HEADERS = { 'x-owner-scope': 'user:alice', 'x-workspace-scope': 'ws:1' };
const BOB_HEADERS = { 'x-owner-scope': 'user:bob', 'x-workspace-scope': 'ws:1' };

interface Harness {
  app: FastifyInstance;
  deps: ConnectionServiceDeps;
  readonly revoked: string[];
  close(): Promise<void>;
}

async function harness(over: Partial<ConnectionServiceDeps> & { identity?: ProviderIdentity } = {}): Promise<Harness> {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'migraai-mailroutes-')), 'state.db');
  const durable = new SqliteDurableStore(dbPath);
  const db = (durable as unknown as { db: never }).db;
  const revoked: string[] = [];

  const deps: ConnectionServiceDeps = {
    config,
    key,
    connections: new SqliteMailConnectionStore(db),
    pending: new SqliteMailPendingStore(db),
    exchange: async () => GRANT,
    identify: async () => over.identity ?? { providerAccountId: 'google-uid-1', accountAddress: 'alice@example.com' },
    revoke: async (token) => { revoked.push(token); return true; },
    now: () => NOW,
    ...over,
  };

  const app = Fastify();
  registerMailConnectionRoutes(app, {
    provider: 'gmail',
    // Exactly how the Brain derives scope elsewhere: from request identity.
    scopeFrom: (request) => ({
      owner: String(request.headers['x-owner-scope'] ?? ''),
      workspace: String(request.headers['x-workspace-scope'] ?? ''),
    }),
    service: deps,
  });
  await app.ready();

  return {
    app,
    deps,
    get revoked() { return revoked; },
    close: async () => { await app.close(); durable.close(); },
  };
}

async function begin(h: Harness, headers = ALICE_HEADERS, returnTo?: string): Promise<string> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/ai/account/mail/begin',
    headers,
    payload: returnTo ? { returnTo } : {},
  });
  assert.equal(res.statusCode, 200);
  return new URL(res.json<{ authorizationUrl: string }>().authorizationUrl).searchParams.get('state')!;
}

/* ------------------------------------------------------------------ *
 * Begin
 * ------------------------------------------------------------------ */

test('begin returns a consent URL, and asks for READ only', async () => {
  const h = await harness();
  const res = await h.app.inject({ method: 'POST', url: '/api/ai/account/mail/begin', headers: ALICE_HEADERS, payload: {} });
  assert.equal(res.statusCode, 200);
  const url = new URL(res.json<{ authorizationUrl: string }>().authorizationUrl);
  const scopes = url.searchParams.get('scope')!.split(' ');
  assert.ok(scopes.includes(GOOGLE_SCOPES.read));
  /*
   * The identity scopes are requested too, and they are NOT mailbox authority:
   * without them the completion step cannot name the account, and a consent
   * that visibly succeeds produces no connection.
   */
  for (const identity of IDENTITY_SCOPES) assert.ok(scopes.includes(identity), `missing identity scope ${identity}`);
  // 🚨 Send is not requested until governed send is wired and qualified.
  assert.ok(!scopes.includes(GOOGLE_SCOPES.send), 'send permission was requested up front');
  assert.ok(!scopes.includes(GOOGLE_SCOPES.draft), 'draft permission was requested up front');
  await h.close();
});

test('🚨 begin is a POST — it mints state and writes a row', async () => {
  // A GET would be triggerable by a link preview, a prefetch or a crawler.
  const h = await harness();
  const res = await h.app.inject({ method: 'GET', url: '/api/ai/account/mail/begin', headers: ALICE_HEADERS });
  assert.equal(res.statusCode, 404, 'beginning a connection is reachable by GET');
  await h.close();
});

/* ------------------------------------------------------------------ *
 * 🚨 Callback
 * ------------------------------------------------------------------ */

test('a completed callback connects the account and says where to land', async () => {
  const h = await harness();
  const state = await begin(h, ALICE_HEADERS, '/chat/abc');
  const res = await h.app.inject({
    method: 'POST', url: '/api/ai/account/mail/callback', headers: ALICE_HEADERS,
    payload: { state, code: 'code-1' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { connected: true, returnTo: '/chat/abc', account: 'alice@example.com' });
  await h.close();
});

test('🚨 a callback arriving in ANOTHER session connects nothing', async () => {
  /*
   * The attack: get a victim's browser to complete a callback carrying the
   * attacker's code. Accepting it would connect the victim's Migra account to
   * the attacker's mailbox.
   */
  const h = await harness();
  const state = await begin(h, ALICE_HEADERS);
  const res = await h.app.inject({
    method: 'POST', url: '/api/ai/account/mail/callback', headers: BOB_HEADERS,
    payload: { state, code: 'code-1' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json<{ connected: boolean }>().connected, false);
  assert.deepEqual(await h.deps.connections.list({ owner: 'user:bob', workspace: 'ws:1' }, 'gmail'), []);
  await h.close();
});

test('🚨 a refused callback is 400, not 500', async () => {
  // A forged, replayed or expired callback is a refusal, not a fault.
  // Reporting it as a server error would page someone every time a user left a
  // consent screen open too long.
  const h = await harness();
  const res = await h.app.inject({
    method: 'POST', url: '/api/ai/account/mail/callback', headers: ALICE_HEADERS,
    payload: { state: 'never-minted', code: 'c' },
  });
  assert.equal(res.statusCode, 400);
  await h.close();
});

test('🚨 the three forged-callback refusals are INDISTINGUISHABLE over HTTP', async () => {
  const h = await harness();

  const forged = await h.app.inject({
    method: 'POST', url: '/api/ai/account/mail/callback', headers: ALICE_HEADERS,
    payload: { state: 'never-minted', code: 'c' },
  });

  const state = await begin(h, ALICE_HEADERS);
  await h.app.inject({
    method: 'POST', url: '/api/ai/account/mail/callback', headers: ALICE_HEADERS, payload: { state, code: 'c' },
  });
  const replayed = await h.app.inject({
    method: 'POST', url: '/api/ai/account/mail/callback', headers: ALICE_HEADERS, payload: { state, code: 'c' },
  });

  const otherState = await begin(h, ALICE_HEADERS);
  const mismatched = await h.app.inject({
    method: 'POST', url: '/api/ai/account/mail/callback', headers: BOB_HEADERS,
    payload: { state: otherState, code: 'c' },
  });

  const bodies = new Set([forged.body, replayed.body, mismatched.body]);
  assert.equal(bodies.size, 1, `the refusals are distinguishable and can be probed: ${[...bodies].join(' | ')}`);
  await h.close();
});

test('🚨 no response names a token, a scope string or a provider error code', async () => {
  const h = await harness();
  const state = await begin(h, ALICE_HEADERS);
  const ok = await h.app.inject({
    method: 'POST', url: '/api/ai/account/mail/callback', headers: ALICE_HEADERS, payload: { state, code: 'c' },
  });
  const status = await h.app.inject({ method: 'GET', url: '/api/ai/account/mail', headers: ALICE_HEADERS });
  for (const body of [ok.body, status.body]) {
    assert.ok(!body.includes(REFRESH), 'a refresh token reached an HTTP response');
    assert.ok(!body.includes('ya29'), 'an access token reached an HTTP response');
    assert.ok(!body.includes('googleapis.com'), `a raw provider scope reached an HTTP response: ${body}`);
    assert.ok(!body.includes('invalid_grant'), 'a provider error code reached an HTTP response');
  }
  await h.close();
});

test('🚨 a body claiming ANOTHER principal is ignored on every route', async () => {
  /*
   * The routes claim the scope always comes from the request's identity and
   * never from its payload. Until this test existed, nothing checked it: every
   * other request here sends an honest body, so a handler that read an owner
   * out of the payload would have passed the whole file.
   *
   * Alice connects. Then each route is called with BOB's identity and a body
   * that names alice — the shape an attacker would send.
   */
  const h = await harness();
  await connect(h, ALICE_HEADERS);
  const impersonation = { ownerScope: 'user:alice', owner: 'user:alice', workspaceScope: 'ws:1' };

  /*
   * Measured, not assumed: Fastify hands a GET handler NO body — `request.body`
   * is undefined even when one is sent. So this assertion is carried by the
   * framework rather than by anything in the route, and a mutation that made
   * the handler read a body-supplied owner is semantically equivalent here.
   * It stays because the guarantee should hold if the route ever changes shape;
   * the two below are the ones that actually pin behaviour.
   */
  const status = await h.app.inject({
    method: 'GET', url: '/api/ai/account/mail', headers: BOB_HEADERS, payload: impersonation,
  });
  assert.equal(status.json<{ state: string }>().state, 'not_connected', 'a payload named the owner for status');

  const removal = await h.app.inject({
    method: 'DELETE', url: '/api/ai/account/mail', headers: BOB_HEADERS,
    payload: { ...impersonation, providerAccountId: 'google-uid-1' },
  });
  assert.equal(removal.json<{ removed: boolean }>().removed, false, 'a payload named the owner for disconnect');

  const state = await begin(h, ALICE_HEADERS);
  const callback = await h.app.inject({
    method: 'POST', url: '/api/ai/account/mail/callback', headers: BOB_HEADERS,
    payload: { ...impersonation, state, code: 'c' },
  });
  assert.equal(callback.statusCode, 400, 'a payload named the owner for the callback');

  // Alice's connection is untouched throughout.
  assert.ok(await h.deps.connections.get({ owner: 'user:alice', workspace: 'ws:1' }, 'gmail', 'google-uid-1'));
  assert.deepEqual(h.revoked, []);
  await h.close();
});

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

test('status reports unconnected, then connected, in the engine\'s own words', async () => {
  const h = await harness();
  const before = await h.app.inject({ method: 'GET', url: '/api/ai/account/mail', headers: ALICE_HEADERS });
  assert.equal(before.json<{ state: string }>().state, 'not_connected');

  const state = await begin(h, ALICE_HEADERS);
  await h.app.inject({
    method: 'POST', url: '/api/ai/account/mail/callback', headers: ALICE_HEADERS, payload: { state, code: 'c' },
  });

  const after = await h.app.inject({ method: 'GET', url: '/api/ai/account/mail', headers: ALICE_HEADERS });
  const body = after.json<{ state: string; account?: string; scopes: Record<string, boolean> }>();
  assert.equal(body.state, 'connected');
  assert.equal(body.account, 'alice@example.com');
  assert.deepEqual(body.scopes, { read: true, draft: false, send: false });
  await h.close();
});

test("🚨 status never shows another principal's connection", async () => {
  const h = await harness();
  const state = await begin(h, ALICE_HEADERS);
  await h.app.inject({
    method: 'POST', url: '/api/ai/account/mail/callback', headers: ALICE_HEADERS, payload: { state, code: 'c' },
  });
  const bob = await h.app.inject({ method: 'GET', url: '/api/ai/account/mail', headers: BOB_HEADERS });
  assert.equal(bob.json<{ state: string }>().state, 'not_connected');
  await h.close();
});

/* ------------------------------------------------------------------ *
 * Disconnect
 * ------------------------------------------------------------------ */

async function connect(h: Harness, headers = ALICE_HEADERS): Promise<void> {
  const state = await begin(h, headers);
  const res = await h.app.inject({
    method: 'POST', url: '/api/ai/account/mail/callback', headers, payload: { state, code: 'c' },
  });
  assert.equal(res.statusCode, 200);
}

test('disconnect revokes and removes, without the client naming an account', async () => {
  const h = await harness();
  await connect(h);
  const res = await h.app.inject({ method: 'DELETE', url: '/api/ai/account/mail', headers: ALICE_HEADERS, payload: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json<{ removed: boolean }>().removed, true);
  assert.deepEqual(h.revoked, [REFRESH], 'the grant was removed without being revoked at the provider');
  await h.close();
});

test("🚨 one principal cannot disconnect another's mailbox by naming it", async () => {
  const h = await harness();
  await connect(h);
  const res = await h.app.inject({
    method: 'DELETE', url: '/api/ai/account/mail', headers: BOB_HEADERS,
    payload: { providerAccountId: 'google-uid-1' },
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json<{ removed: boolean }>().removed, false);
  assert.deepEqual(h.revoked, [], "another principal's refresh token was sent to the provider");
  assert.ok(
    await h.deps.connections.get({ owner: 'user:alice', workspace: 'ws:1' }, 'gmail', 'google-uid-1'),
    "another principal's connection was removed",
  );
  await h.close();
});

test('🚨 an unconfirmed revocation SAYS the grant may still be live', async () => {
  const h = await harness({ revoke: async () => false });
  await connect(h);
  const res = await h.app.inject({ method: 'DELETE', url: '/api/ai/account/mail', headers: ALICE_HEADERS, payload: {} });
  const body = res.json<{ removed: boolean; message?: string }>();
  assert.equal(body.removed, true);
  assert.match(body.message ?? '', /could not confirm/i, 'an unconfirmed revocation was reported as clean');
  await h.close();
});

test('disconnecting nothing is 404, not a reported success', async () => {
  const h = await harness();
  const res = await h.app.inject({ method: 'DELETE', url: '/api/ai/account/mail', headers: ALICE_HEADERS, payload: {} });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json<{ removed: boolean }>().removed, false);
  await h.close();
});

test('🚨 with SEVERAL accounts and none named, disconnect refuses rather than guessing', async () => {
  /*
   * Silently disconnecting the first of several would remove a mailbox the
   * user did not choose, and there is no undo.
   */
  const h = await harness();
  await connect(h);
  const second = await harnessSecondAccount(h);
  assert.equal(second, 2);

  const res = await h.app.inject({ method: 'DELETE', url: '/api/ai/account/mail', headers: ALICE_HEADERS, payload: {} });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json<{ removed: boolean }>().removed, false);
  assert.deepEqual(h.revoked, [], 'a mailbox was revoked without the user choosing it');

  // Naming one works.
  const named = await h.app.inject({
    method: 'DELETE', url: '/api/ai/account/mail', headers: ALICE_HEADERS,
    payload: { providerAccountId: 'google-uid-2' },
  });
  assert.equal(named.json<{ removed: boolean }>().removed, true);
  await h.close();
});

/** Connect a second mailbox for the same principal. Returns how many exist. */
async function harnessSecondAccount(h: Harness): Promise<number> {
  const scope = { owner: 'user:alice', workspace: 'ws:1' };
  const first = (await h.deps.connections.list(scope, 'gmail'))[0]!;
  await h.deps.connections.put({
    ...first,
    providerAccountId: 'google-uid-2',
    accountAddress: 'alice.work@example.com',
    connectedAt: first.connectedAt + 1,
  });
  return (await h.deps.connections.list(scope, 'gmail')).length;
}
