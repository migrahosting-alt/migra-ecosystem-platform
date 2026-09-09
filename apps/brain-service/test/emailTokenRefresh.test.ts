/**
 * REFRESH — and the three states that must never be collapsed.
 *
 * An expired access token is ordinary. A revoked grant needs the user. A
 * provider outage needs nothing but time. The dangerous collapse is the third
 * into the second: a 500 read as revocation tells every connected user to
 * reconnect, during an outage, when reconnecting cannot possibly work.
 */

import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  __resetInFlightForTest,
  requireScope,
  resolveAuthorization,
  type RefreshDeps,
  type RefreshOutcome,
} from '../src/engine/email/tokenRefresh.js';
import type { MailConnectionRecord, MailConnectionStore } from '../src/engine/email/connectionStore.js';
import { MAIL_TOKEN_KEY_ENV, seal, sealKeyFrom, type SealKey } from '../src/engine/email/tokenSealing.js';
import { GOOGLE_SCOPES } from '../src/engine/email/oauthConfig.js';

const KEY_A = Buffer.alloc(32, 7).toString('base64');
const KEY_B = Buffer.alloc(32, 9).toString('base64');

function keyFrom(material: string): SealKey {
  const result = sealKeyFrom({ [MAIL_TOKEN_KEY_ENV]: material });
  assert.equal(result.ok, true);
  return (result as { ok: true; key: SealKey }).key;
}

const key = keyFrom(KEY_A);
const SCOPE = { owner: 'user:alice', workspace: 'ws:1' };
const REFRESH_TOKEN = '1//0gTheRefreshToken';
const NOW = 1_000_000;

function bindingFor(purpose: 'access_token' | 'refresh_token') {
  return {
    ownerScope: SCOPE.owner,
    workspaceScope: SCOPE.workspace,
    provider: 'gmail',
    providerAccountId: 'account-1',
    purpose,
  } as const;
}

function record(over: Partial<MailConnectionRecord> = {}): MailConnectionRecord {
  return {
    ownerScope: SCOPE.owner,
    workspaceScope: SCOPE.workspace,
    provider: 'gmail',
    providerAccountId: 'account-1',
    accountAddress: 'alice@example.com',
    sealedAccessToken: seal(key, bindingFor('access_token'), 'ya29.stored'),
    sealedRefreshToken: seal(key, bindingFor('refresh_token'), REFRESH_TOKEN),
    accessTokenExpiresAt: NOW + 3_600_000,
    grantedScopes: [GOOGLE_SCOPES.read],
    authorizationRevokedAt: null,
    connectedAt: 1_000,
    lastRefreshAt: null,
    updatedAt: 1_000,
    ...over,
  };
}

interface Harness {
  deps: RefreshDeps;
  readonly refreshCalls: number;
  readonly revokedAt: number[];
  readonly refreshedWith: string[];
  readonly stored: MailConnectionRecord | null;
}

function harness(options: {
  record?: MailConnectionRecord | null;
  outcome?: RefreshOutcome;
  key?: SealKey;
  now?: number;
} = {}): Harness {
  let current = options.record === undefined ? record() : options.record;
  let refreshCalls = 0;
  const revokedAt: number[] = [];
  const refreshedWith: string[] = [];

  const store: MailConnectionStore = {
    list: async () => (current ? [current] : []),
    get: async () => current,
    put: async (r) => { current = r; },
    recordRefresh: async (input) => {
      if (current) {
        current = {
          ...current,
          sealedAccessToken: input.sealedAccessToken,
          accessTokenExpiresAt: input.accessTokenExpiresAt,
          lastRefreshAt: input.at,
          authorizationRevokedAt: null,
        };
      }
    },
    markAuthorizationRevoked: async (input) => {
      revokedAt.push(input.at);
      if (current) current = { ...current, authorizationRevokedAt: input.at };
    },
    disconnect: async () => { current = null; return true; },
  };

  return {
    deps: {
      store,
      key: options.key ?? key,
      exchangeRefresh: async (token) => {
        refreshCalls += 1;
        refreshedWith.push(token);
        return options.outcome ?? { kind: 'refreshed', accessToken: 'ya29.fresh', expiresAt: NOW + 3_600_000 };
      },
      now: () => options.now ?? NOW,
    },
    get refreshCalls() { return refreshCalls; },
    get revokedAt() { return revokedAt; },
    get refreshedWith() { return refreshedWith; },
    get stored() { return current; },
  };
}

const resolve = (h: Harness) =>
  resolveAuthorization({ scope: SCOPE, provider: 'gmail', providerAccountId: 'account-1', deps: h.deps });

beforeEach(() => __resetInFlightForTest());

/* ------------------------------------------------------------------ *
 * The ordinary path
 * ------------------------------------------------------------------ */

test('a valid access token is used WITHOUT contacting the provider', async () => {
  const h = harness();
  const result = await resolve(h);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.accessToken, 'ya29.stored');
  assert.equal(h.refreshCalls, 0, 'a valid token was refreshed anyway');
});

test('🚨 an EXPIRED access token refreshes silently — the user is told nothing', async () => {
  /*
   * This is the state of every connection older than an hour. Surfacing it
   * would tell users to reconnect a working mailbox several times a day.
   */
  const h = harness({ record: record({ accessTokenExpiresAt: NOW - 1 }) });
  const result = await resolve(h);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.accessToken, 'ya29.fresh');
  assert.equal(h.refreshCalls, 1);
  assert.deepEqual(h.revokedAt, [], 'an ordinary expiry marked the grant revoked');
});

test('a refreshed token is persisted, so the next request does not refresh again', async () => {
  const h = harness({ record: record({ accessTokenExpiresAt: NOW - 1 }) });
  await resolve(h);
  assert.equal(h.stored!.accessTokenExpiresAt, NOW + 3_600_000);
  assert.equal(h.stored!.lastRefreshAt, NOW);

  __resetInFlightForTest();
  await resolve(h);
  assert.equal(h.refreshCalls, 1, 'the refreshed token was not persisted');
});

/* ------------------------------------------------------------------ *
 * 🚨 The three states, kept apart
 * ------------------------------------------------------------------ */

test('🚨 a provider OUTAGE does not mark the grant revoked', async () => {
  /*
   * The defect this exists to prevent: a 500 or a timeout classified as
   * revocation marks every connected user's grant as expired, and tells them
   * all to reconnect — during an outage, when reconnecting cannot work.
   */
  const h = harness({ record: record({ accessTokenExpiresAt: NOW - 1 }), outcome: { kind: 'unavailable' } });
  const result = await resolve(h);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'provider_unavailable');
  assert.deepEqual(h.revokedAt, [], 'an outage marked a working grant as revoked');
  assert.equal(h.stored!.authorizationRevokedAt, null, 'an outage was persisted as a revocation');
});

test('🚨 only an explicit invalid_grant marks the grant revoked, and the row survives', async () => {
  const h = harness({ record: record({ accessTokenExpiresAt: NOW - 1 }), outcome: { kind: 'invalid_grant' } });
  const result = await resolve(h);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'authorization_expired');
  assert.deepEqual(h.revokedAt, [NOW]);
  assert.ok(h.stored, 'a revoked grant deleted the connection');
});

test('🚨 revocation is STICKY — a dead grant is not retried on every request', async () => {
  /*
   * Retrying would send a known-dead refresh token to Google on every request
   * the user makes: pointless, and the fastest way to earn a rate limit that
   * then breaks the users whose grants do work.
   */
  const h = harness({ record: record({ authorizationRevokedAt: 5_000, accessTokenExpiresAt: NOW - 1 }) });
  const result = await resolve(h);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'authorization_expired');
  assert.equal(h.refreshCalls, 0, 'a known-dead grant was sent to the provider again');
});

test('no connection is not_connected — distinct from a revoked one', async () => {
  const h = harness({ record: null });
  const result = await resolve(h);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'not_connected');

  const revoked = harness({ record: record({ authorizationRevokedAt: 1 }) });
  const other = await resolve(revoked);
  assert.equal(other.ok, false);
  if (!other.ok && !result.ok) {
    assert.notEqual(other.failure.kind, result.failure.kind, 'never-connected and revoked are indistinguishable');
  }
});

test('🚨 an UNREADABLE seal is not a revocation — the row is left intact', async () => {
  /*
   * A wrong key is a deployment fault. Marking it revoked would tell the user
   * to reconnect, and reconnecting overwrites the row — destroying the evidence
   * of what actually went wrong.
   */
  const h = harness({ record: record({ accessTokenExpiresAt: NOW - 1 }), key: keyFrom(KEY_B) });
  const result = await resolve(h);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'provider_unavailable');
  assert.deepEqual(h.revokedAt, [], 'a wrong key marked the grant revoked');
  assert.equal(h.refreshCalls, 0, 'an unopenable token was sent to the provider');
});

/* ------------------------------------------------------------------ *
 * Single flight
 * ------------------------------------------------------------------ */

test('🚨 concurrent callers share ONE refresh', async () => {
  const h = harness({ record: record({ accessTokenExpiresAt: NOW - 1 }) });
  const results = await Promise.all([resolve(h), resolve(h), resolve(h)]);
  assert.equal(h.refreshCalls, 1, `${h.refreshCalls} refreshes ran for one connection`);
  for (const r of results) assert.equal(r.ok, true);
});

test('a different connection is NOT collapsed into an in-flight refresh', async () => {
  // Keying single-flight too coarsely would make one user's refresh answer
  // another user's request — with another user's token.
  const h = harness({ record: record({ accessTokenExpiresAt: NOW - 1 }) });
  await Promise.all([
    resolveAuthorization({ scope: SCOPE, provider: 'gmail', providerAccountId: 'account-1', deps: h.deps }),
    resolveAuthorization({ scope: { owner: 'user:bob', workspace: 'ws:1' }, provider: 'gmail', providerAccountId: 'account-1', deps: h.deps }),
  ]);
  assert.equal(h.refreshCalls, 2, 'two different principals shared one refresh');
});

test('a failed refresh does not poison the next attempt', async () => {
  // The in-flight entry must be cleared on failure too, or one outage would
  // make the connection permanently unusable until the process restarts.
  const h = harness({ record: record({ accessTokenExpiresAt: NOW - 1 }), outcome: { kind: 'unavailable' } });
  await resolve(h);
  const second = await resolve(h);
  assert.equal(second.ok, false);
  assert.equal(h.refreshCalls, 2, 'a failed refresh was cached and never retried');
});

/* ------------------------------------------------------------------ *
 * 🚨 The refresh token stays in the process
 * ------------------------------------------------------------------ */

test('🚨 the refresh token is never returned, and never reaches a failure', async () => {
  const ok = harness({ record: record({ accessTokenExpiresAt: NOW - 1 }) });
  const success = await resolve(ok);
  assert.ok(!JSON.stringify(success).includes(REFRESH_TOKEN), 'the refresh token was returned to the caller');
  // It DID reach the exchange — that is the one place it belongs.
  assert.deepEqual(ok.refreshedWith, [REFRESH_TOKEN]);

  __resetInFlightForTest();
  const bad = harness({ record: record({ accessTokenExpiresAt: NOW - 1 }), outcome: { kind: 'invalid_grant' } });
  const failure = await resolve(bad);
  assert.ok(!JSON.stringify(failure).includes(REFRESH_TOKEN), 'the refresh token leaked through a failure');
});

/* ------------------------------------------------------------------ *
 * Scopes, resolved separately
 * ------------------------------------------------------------------ */

test('🚨 read and send are resolved SEPARATELY', async () => {
  /*
   * A user may reasonably connect for reading only. A single `authorized`
   * boolean would either hide working search or promise a send that is refused
   * at dispatch — and the second is worse, because they learn after composing.
   */
  const h = harness({ record: record({ grantedScopes: [GOOGLE_SCOPES.read] }) });
  const result = await resolve(h);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(requireScope(result.value, 'read'), { ok: true });
    const send = requireScope(result.value, 'send');
    assert.equal(send.ok, false);
    if (!send.ok) assert.deepEqual(send.failure, { kind: 'insufficient_scope', needed: 'send' });
  }
});

test('🚨 a NARROWED grant returned by a refresh replaces the stored one', async () => {
  /*
   * Google may return fewer scopes than before if the user has adjusted
   * permissions. Keeping the stored value would promise a send that is refused
   * at dispatch.
   */
  const h = harness({
    record: record({ accessTokenExpiresAt: NOW - 1, grantedScopes: [GOOGLE_SCOPES.read, GOOGLE_SCOPES.send] }),
    outcome: { kind: 'refreshed', accessToken: 'ya29.fresh', expiresAt: NOW + 3_600_000, grantedScopes: [GOOGLE_SCOPES.read] },
  });
  const result = await resolve(h);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.scopes.read, true);
    assert.equal(result.value.scopes.send, false, 'a withdrawn send scope was still reported as granted');
  }
});

test('a refresh that states no scopes keeps the stored grant', async () => {
  // Google usually omits `scope` on refresh. Treating that as "nothing granted"
  // would break every connection on its first refresh.
  const h = harness({
    record: record({ accessTokenExpiresAt: NOW - 1, grantedScopes: [GOOGLE_SCOPES.read, GOOGLE_SCOPES.send] }),
    outcome: { kind: 'refreshed', accessToken: 'ya29.fresh', expiresAt: NOW + 3_600_000 },
  });
  const result = await resolve(h);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.scopes.send, true, 'an omitted scope list was read as a withdrawal');
});
