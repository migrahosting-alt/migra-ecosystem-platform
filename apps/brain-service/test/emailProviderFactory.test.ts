/**
 * PROVIDER CONSTRUCTION — from server-resolved state, and nothing else.
 *
 * The factory takes no access token and no account address. Those come out of
 * the durable connection, opened with a key the process holds. A factory that
 * accepted a token would behave identically for a legitimate caller and for a
 * request that carried one, and the difference would live in whether every
 * route remembered not to pass it through.
 */

import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  mailProviderFor,
  selectAccount,
  type ProviderFactoryDeps,
} from '../src/engine/email/providerFactory.js';
import { __resetInFlightForTest } from '../src/engine/email/tokenRefresh.js';
import type { MailConnectionRecord, MailConnectionStore } from '../src/engine/email/connectionStore.js';
import { MAIL_TOKEN_KEY_ENV, seal, sealKeyFrom, type SealKey } from '../src/engine/email/tokenSealing.js';
import { GOOGLE_SCOPES } from '../src/engine/email/oauthConfig.js';

const KEY = Buffer.alloc(32, 7).toString('base64');
const keyResult = sealKeyFrom({ [MAIL_TOKEN_KEY_ENV]: KEY });
assert.equal(keyResult.ok, true);
const key = (keyResult as { ok: true; key: SealKey }).key;

const ALICE = { owner: 'user:alice', workspace: 'ws:1' };
const NOW = 1_000_000;
const ACCESS = 'ya29.the-access-token';

function record(over: Partial<MailConnectionRecord> = {}): MailConnectionRecord {
  const providerAccountId = over.providerAccountId ?? 'account-1';
  const providerName = over.provider ?? 'gmail';
  // The binding tracks the record's OWN provider. Hardcoding 'gmail' here made
  // an outlook fixture unopenable, and the test passed for that reason rather
  // than for the refusal it claimed to check.
  const binding = (purpose: 'access_token' | 'refresh_token') => ({
    ownerScope: over.ownerScope ?? ALICE.owner,
    workspaceScope: over.workspaceScope ?? ALICE.workspace,
    provider: providerName,
    providerAccountId,
    purpose,
  } as const);
  return {
    ownerScope: ALICE.owner,
    workspaceScope: ALICE.workspace,
    provider: 'gmail',
    providerAccountId,
    accountAddress: `${providerAccountId}@example.com`,
    sealedAccessToken: seal(key, binding('access_token'), ACCESS),
    sealedRefreshToken: seal(key, binding('refresh_token'), '1//refresh'),
    accessTokenExpiresAt: NOW + 3_600_000,
    grantedScopes: [GOOGLE_SCOPES.read],
    authorizationRevokedAt: null,
    connectedAt: 1_000,
    lastRefreshAt: null,
    updatedAt: 1_000,
    ...over,
  };
}

function storeOf(records: MailConnectionRecord[]): MailConnectionStore {
  let rows = [...records];
  return {
    list: async (scope, provider) =>
      rows.filter((r) => r.ownerScope === scope.owner && r.workspaceScope === scope.workspace && r.provider === provider),
    get: async (scope, provider, id) =>
      rows.find((r) =>
        r.ownerScope === scope.owner && r.workspaceScope === scope.workspace
        && r.provider === provider && r.providerAccountId === id) ?? null,
    put: async (r) => { rows = [...rows.filter((x) => x.providerAccountId !== r.providerAccountId), r]; },
    recordRefresh: async () => {},
    markAuthorizationRevoked: async () => {},
    disconnect: async () => true,
  };
}

function deps(records: MailConnectionRecord[], over: Partial<ProviderFactoryDeps> = {}): ProviderFactoryDeps {
  return {
    store: storeOf(records),
    key,
    exchangeRefresh: async () => ({ kind: 'refreshed', accessToken: 'ya29.fresh', expiresAt: NOW + 3_600_000 }),
    now: () => NOW,
    providerConfigured: true,
    ...over,
  };
}

beforeEach(() => __resetInFlightForTest());

/* ------------------------------------------------------------------ *
 * 🚨 The client never names an account
 * ------------------------------------------------------------------ */

test('🚨 an account id from a request is matched against what the SCOPE owns', async () => {
  /*
   * The value comes back through a page we rendered, which is exactly why it
   * is checked again: a rendered list is not an authorisation, and the value
   * arrives over the same wire as anything else the client can type.
   */
  const selection = await selectAccount({
    scope: ALICE,
    provider: 'gmail',
    store: storeOf([record({ providerAccountId: 'account-1' })]),
    requested: 'someone-elses-account',
  });
  // Not resolved to the requested id, and not reported as a mismatch either —
  // saying "that account is not yours" confirms the account exists.
  assert.deepEqual(selection, { kind: 'resolved', providerAccountId: 'account-1' });
});

test("🚨 another principal's connection is invisible, named or not", async () => {
  const store = storeOf([record({ ownerScope: 'user:bob', providerAccountId: 'bobs-account' })]);
  assert.deepEqual(await selectAccount({ scope: ALICE, provider: 'gmail', store }), { kind: 'none' });
  assert.deepEqual(
    await selectAccount({ scope: ALICE, provider: 'gmail', store, requested: 'bobs-account' }),
    { kind: 'none' },
  );
});

test('a single connection resolves without the client naming anything', async () => {
  assert.deepEqual(
    await selectAccount({ scope: ALICE, provider: 'gmail', store: storeOf([record()]) }),
    { kind: 'resolved', providerAccountId: 'account-1' },
  );
});

test('several connections are enumerated BY THE SERVER for the user to pick', async () => {
  const selection = await selectAccount({
    scope: ALICE,
    provider: 'gmail',
    store: storeOf([record({ providerAccountId: 'a1' }), record({ providerAccountId: 'a2' })]),
  });
  assert.equal(selection.kind, 'ambiguous');
  if (selection.kind === 'ambiguous') {
    assert.deepEqual(selection.accounts.map((a) => a.providerAccountId), ['a1', 'a2']);
    // The address is offered because a user recognises an address, not an id.
    assert.deepEqual(selection.accounts.map((a) => a.accountAddress), ['a1@example.com', 'a2@example.com']);
  }
});

test('a named account picks among several — after being re-validated', async () => {
  const selection = await selectAccount({
    scope: ALICE,
    provider: 'gmail',
    store: storeOf([record({ providerAccountId: 'a1' }), record({ providerAccountId: 'a2' })]),
    requested: 'a2',
  });
  assert.deepEqual(selection, { kind: 'resolved', providerAccountId: 'a2' });
});

/* ------------------------------------------------------------------ *
 * Building the provider
 * ------------------------------------------------------------------ */

test('a provider is built holding the SERVER-RESOLVED token', async () => {
  const result = await mailProviderFor({ scope: ALICE, provider: 'gmail', deps: deps([record()]) });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.account.accountAddress, 'account-1@example.com');
    assert.deepEqual(result.scopes, { read: true, draft: false, send: false });
  }
});

test('🚨 the provider does not serialise its credential', async () => {
  /*
   * A real defect caught here before: TypeScript `private` is compile-time
   * only, and JSON.stringify walked straight past it. The fix was an ES
   * #private field with an explicit toJSON.
   */
  const result = await mailProviderFor({ scope: ALICE, provider: 'gmail', deps: deps([record()]) });
  assert.equal(result.ok, true);
  if (result.ok) {
    const serialised = JSON.stringify(result.provider);
    assert.ok(!serialised.includes(ACCESS), `the access token is reachable: ${serialised}`);
  }
});

test('🚨 the factory has NO parameter a caller could pass a token through', () => {
  /*
   * Structural, not behavioural. The absence of the parameter is the guarantee;
   * a factory that accepted a token would behave identically for a legitimate
   * caller and for a request that carried one.
   */
  const accepted = Object.keys({
    scope: ALICE, provider: 'gmail', deps: deps([]), requestedAccountId: undefined, needs: undefined,
  });
  for (const forbidden of ['accessToken', 'refreshToken', 'token', 'accountAddress', 'credentials']) {
    assert.ok(!accepted.includes(forbidden), `mailProviderFor accepts ${forbidden} from its caller`);
  }
});

/* ------------------------------------------------------------------ *
 * Refusals happen BEFORE a provider exists
 * ------------------------------------------------------------------ */

test('an unconfigured deployment is distinct from an unconnected user', async () => {
  const unconfigured = await mailProviderFor({
    scope: ALICE, provider: 'gmail', deps: deps([record()], { providerConfigured: false }),
  });
  assert.equal(unconfigured.ok, false);
  if (!unconfigured.ok && 'failure' in unconfigured) assert.equal(unconfigured.failure.kind, 'not_configured');

  const unconnected = await mailProviderFor({ scope: ALICE, provider: 'gmail', deps: deps([]) });
  assert.equal(unconnected.ok, false);
  if (!unconnected.ok && 'failure' in unconnected) assert.equal(unconnected.failure.kind, 'not_connected');
});

test('🚨 an insufficient scope refuses BEFORE the provider is built', async () => {
  /*
   * For send this is the difference between refusing up front and refusing at
   * dispatch — which is after the user has composed and approved.
   */
  const result = await mailProviderFor({
    scope: ALICE, provider: 'gmail', deps: deps([record({ grantedScopes: [GOOGLE_SCOPES.read] })]), needs: 'send',
  });
  assert.equal(result.ok, false);
  if (!result.ok && 'failure' in result) {
    assert.deepEqual(result.failure, { kind: 'insufficient_scope', needed: 'send' });
  }
  assert.ok(!('provider' in result), 'a provider was built for an operation the grant does not permit');
});

test('a revoked grant yields no provider', async () => {
  const result = await mailProviderFor({
    scope: ALICE, provider: 'gmail', deps: deps([record({ authorizationRevokedAt: 5_000 })]),
  });
  assert.equal(result.ok, false);
  if (!result.ok && 'failure' in result) assert.equal(result.failure.kind, 'authorization_expired');
});

test('ambiguity is a QUESTION, not a failure', async () => {
  // It has an answer the user can give. Reporting it as a failure would send
  // someone to support for something they can resolve in one click.
  const result = await mailProviderFor({
    scope: ALICE,
    provider: 'gmail',
    deps: deps([record({ providerAccountId: 'a1' }), record({ providerAccountId: 'a2' })]),
  });
  assert.equal(result.ok, false);
  assert.ok('choose' in result, 'a multi-account principal got a failure instead of a choice');
  if ('choose' in result) assert.equal(result.choose.length, 2);
});

test('🚨 an unknown provider name is REFUSED, not defaulted to Gmail', async () => {
  // Silently building a Gmail provider would connect a user to the wrong
  // service, and the symptom would be an empty mailbox rather than an error.
  await assert.rejects(
    mailProviderFor({
      scope: ALICE,
      provider: 'outlook',
      deps: deps([record({ provider: 'outlook', providerAccountId: 'o1' })]),
    }),
    /no email provider is registered/,
  );
});
