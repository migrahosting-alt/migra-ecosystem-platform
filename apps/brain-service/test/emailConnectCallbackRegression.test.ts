/**
 * THE CONNECT CALLBACK, END TO END — the one path a user cannot work around.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHAT THIS EXISTS TO STOP HAPPENING AGAIN
 *
 * A user completed Google's consent screen, the browser returned to MigraPilot,
 * and Settings said "No mailbox is connected". Twice. The Brain answered the
 * callback with an unhandled 500.
 *
 * The cause was a scope that was never requested. Completing a connection asks
 * Google whose mailbox a token opens, and that lookup needs `openid`/`email` —
 * but the authorization URL only ever asked for `gmail.readonly`. It worked for
 * months by ACCIDENT: the account had already granted the identity scopes
 * through "Sign in with Google", and `include_granted_scopes=true` carried them
 * into every new grant. The day that grant was revoked, the next consent
 * returned `gmail.readonly` alone, the identity lookup 401'd, and the throw
 * escaped as a 500 — with nothing in the response naming a missing scope.
 *
 * Two defects, and this file holds both: the missing request, and the crash.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  beginConnection, completeConnection, connectionStatus,
  type ConnectionServiceDeps,
} from '../src/engine/email/connectionService.js';
import { SqliteMailPendingStore } from '../src/engine/email/sqliteMailPending.js';
import { SqliteMailConnectionStore } from '../src/engine/email/sqliteMailConnection.js';
import { SqliteDurableStore } from '../src/engine/persistence/sqliteStore.js';
import {
  GOOGLE_SCOPES, IDENTITY_SCOPES, oauthConfigFrom, ENV,
} from '../src/engine/email/oauthConfig.js';
import { MAIL_TOKEN_KEY_ENV, sealKeyFrom, type SealKey } from '../src/engine/email/tokenSealing.js';
import { callbackRefusalMessage, type TokenGrant } from '../src/engine/email/oauthFlow.js';
import type { ProviderIdentity } from '../src/engine/email/connectionService.js';

const keyResult = sealKeyFrom({ [MAIL_TOKEN_KEY_ENV]: Buffer.alloc(32, 11).toString('base64') });
assert.equal(keyResult.ok, true);
const key = (keyResult as { ok: true; key: SealKey }).key;

const configResult = oauthConfigFrom({
  [ENV.clientId]: 'client-123.apps.googleusercontent.com',
  [ENV.clientSecret]: 'GOCSPX-not-real',
  [ENV.publicOrigin]: 'https://chat.example.com',
});
assert.equal(configResult.ok, true);
const config = (configResult as { ok: true; config: never }).config;

const ALICE = { owner: 'user:alice', workspace: 'ws:1' };
const BOB = { owner: 'user:bob', workspace: 'ws:1' };
const NOW = 1_000_000;

/** What Google returns for a read-only consent — identity scopes included. */
const GRANT: TokenGrant = {
  accessToken: 'ya29.access',
  refreshToken: '1//0gTheRefreshToken',
  expiresAt: NOW + 3_600_000,
  grantedScopes: [GOOGLE_SCOPES.read],
};

const IDENTITY: ProviderIdentity = {
  providerAccountId: 'google-uid-1',
  accountAddress: 'qa@example.com',
};

function harness(over: Partial<ConnectionServiceDeps> = {}) {
  const durable = new SqliteDurableStore(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'migraai-cb-')), 'state.db'),
  );
  const db = (durable as unknown as { db: never }).db;
  const connections = new SqliteMailConnectionStore(db);
  const deps: ConnectionServiceDeps = {
    config,
    key,
    connections,
    pending: new SqliteMailPendingStore(db),
    exchange: async () => GRANT,
    identify: async () => IDENTITY,
    revoke: async () => true,
    now: () => NOW,
    ...over,
  };
  return { deps, connections, close: () => durable.close() };
}

const stateOf = (url: string) => new URL(url).searchParams.get('state')!;

/* ------------------------------------------------------------------ *
 * 🚨 THE HEADLINE
 * ------------------------------------------------------------------ */

test('🚨 a successful callback with an authenticated principal creates EXACTLY ONE scoped connection, and status reports connected', async () => {
  const h = harness();
  try {
    const begun = await beginConnection({
      scope: ALICE, provider: 'gmail', grants: ['read'], returnTo: '/settings', deps: h.deps,
    });

    const completed = await completeConnection({
      scope: ALICE,
      state: stateOf(begun.authorizationUrl),
      code: 'google-authorization-code',
      error: undefined,
      deps: h.deps,
    });

    assert.equal(completed.ok, true, `the callback refused: ${JSON.stringify(completed)}`);

    // EXACTLY ONE. Not zero — the defect this replaces — and not two.
    const rows = await h.connections.list(ALICE, 'gmail');
    assert.equal(rows.length, 1, 'a completed consent must leave exactly one connection');
    assert.equal(rows[0]!.ownerScope, ALICE.owner);
    assert.equal(rows[0]!.workspaceScope, ALICE.workspace);
    assert.equal(rows[0]!.providerAccountId, IDENTITY.providerAccountId);

    // Nobody else gained one.
    assert.equal((await h.connections.list(BOB, 'gmail')).length, 0);

    /*
     * 🚨 AND SETTINGS SAYS SO IMMEDIATELY. The user's whole experience of the
     * bug was this line reading "not connected" after a consent that worked, so
     * the assertion is on the exact function the Settings route calls.
     */
    const status = await connectionStatus({
      scope: ALICE, provider: 'gmail', providerConfigured: true,
      connections: h.connections, now: () => NOW,
    });
    assert.equal(status.state, 'connected');
    assert.equal(status.account, IDENTITY.accountAddress);
    assert.equal(status.scopes.read, true);
    assert.equal(status.scopes.send, false, 'send must not appear from a read-only consent');
  } finally {
    h.close();
  }
});

/* ------------------------------------------------------------------ *
 * 🚨 The scope that was never asked for
 * ------------------------------------------------------------------ */

test('🚨 the authorization URL REQUESTS the identity scopes the completion depends on', async () => {
  /*
   * The root cause, asserted at the only place it can be fixed. Completing a
   * connection calls Google's OIDC userinfo endpoint; without these it 401s and
   * a consent that visibly succeeded produces no connection at all.
   */
  const h = harness();
  try {
    const begun = await beginConnection({ scope: ALICE, provider: 'gmail', grants: ['read'], deps: h.deps });
    const scopes = new URL(begun.authorizationUrl).searchParams.get('scope')!.split(' ');

    for (const needed of IDENTITY_SCOPES) {
      assert.ok(scopes.includes(needed), `the consent does not request "${needed}", so the account cannot be identified`);
    }
    assert.ok(scopes.includes(GOOGLE_SCOPES.read), 'the mailbox scope is still requested');

    // 🚨 And identity did NOT smuggle in mailbox authority.
    assert.ok(!scopes.includes(GOOGLE_SCOPES.send), 'send scope appeared in a read-only consent');
    assert.ok(!scopes.includes(GOOGLE_SCOPES.draft), 'draft scope appeared in a read-only consent');
  } finally {
    h.close();
  }
});

/* ------------------------------------------------------------------ *
 * 🚨 The crash
 * ------------------------------------------------------------------ */

test('🚨 an identity lookup that fails is a REFUSAL, never an unhandled throw', async () => {
  /*
   * It threw, and Fastify turned it into a 500 on a consent the user had just
   * completed. A refusal carries words and a remedy; a 500 carries neither.
   */
  const h = harness({
    identify: async () => { throw new Error('identity lookup failed'); },
  });
  try {
    const begun = await beginConnection({ scope: ALICE, provider: 'gmail', grants: ['read'], deps: h.deps });

    const completed = await completeConnection({
      scope: ALICE, state: stateOf(begun.authorizationUrl), code: 'code', error: undefined, deps: h.deps,
    });

    assert.equal(completed.ok, false);
    assert.ok('refusal' in completed, `expected a refusal, got: ${JSON.stringify(completed)}`);
    if ('refusal' in completed) {
      assert.equal(completed.refusal.kind, 'identify_failed');
      // The user is told something true and actionable, with no Google words.
      const message = callbackRefusalMessage(completed.refusal);
      assert.match(message, /could not be connected/i);
      assert.ok(!/scope|oidc|userinfo|google/i.test(message), 'an operator fact leaked into the user message');
    }

    // 🚨 AND NOTHING WAS STORED. A half-written connection would be worse than
    // none: it would report connected and fail on the first read.
    assert.equal((await h.connections.list(ALICE, 'gmail')).length, 0);
  } finally {
    h.close();
  }
});

/* ------------------------------------------------------------------ *
 * Once, and only once
 * ------------------------------------------------------------------ */

test('🚨 replaying the same callback does not create a second connection', async () => {
  const h = harness();
  try {
    const begun = await beginConnection({ scope: ALICE, provider: 'gmail', grants: ['read'], deps: h.deps });
    const state = stateOf(begun.authorizationUrl);

    const first = await completeConnection({ scope: ALICE, state, code: 'code', error: undefined, deps: h.deps });
    const second = await completeConnection({ scope: ALICE, state, code: 'code', error: undefined, deps: h.deps });

    assert.equal(first.ok, true);
    assert.equal(second.ok, false, 'a replayed state was accepted');
    assert.equal((await h.connections.list(ALICE, 'gmail')).length, 1, 'a replay created a second connection');
  } finally {
    h.close();
  }
});

test('🚨 another principal cannot complete someone else\'s consent', async () => {
  // The state was minted for Alice. Bob presenting it must not connect anything
  // — to Bob, or to Alice.
  const h = harness();
  try {
    const begun = await beginConnection({ scope: ALICE, provider: 'gmail', grants: ['read'], deps: h.deps });

    const stolen = await completeConnection({
      scope: BOB, state: stateOf(begun.authorizationUrl), code: 'code', error: undefined, deps: h.deps,
    });

    assert.equal(stolen.ok, false);
    assert.equal((await h.connections.list(BOB, 'gmail')).length, 0);
    assert.equal((await h.connections.list(ALICE, 'gmail')).length, 0);
  } finally {
    h.close();
  }
});
