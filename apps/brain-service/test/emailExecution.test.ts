/**
 * EXECUTING A MAIL CAPABILITY — against the caller's own mailbox, or not at all.
 *
 * The binding this module holds is deliberately shared: an OAuth client, a
 * sealing key, a store handle. Deployment facts, one per process. What is never
 * shared is the connection — resolved per call from the principal the executor
 * passed in, and retained between calls not at all.
 *
 * A binding that cached a resolved provider would recreate, in the execution
 * path, the exact defect the readiness path was just fixed for.
 */

import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { bindEmailExecution, executeEmailSearch } from '../src/engine/email/emailExecution.js';
import { __resetInFlightForTest } from '../src/engine/email/tokenRefresh.js';
import type { MailConnectionRecord, MailConnectionStore } from '../src/engine/email/connectionStore.js';
import { MAIL_TOKEN_KEY_ENV, seal, sealKeyFrom, type SealKey } from '../src/engine/email/tokenSealing.js';
import { GOOGLE_SCOPES } from '../src/engine/email/oauthConfig.js';
import type { ToolHandlerContext } from '../src/engine/models/capabilityRegistry.js';

const keyResult = sealKeyFrom({ [MAIL_TOKEN_KEY_ENV]: Buffer.alloc(32, 7).toString('base64') });
assert.equal(keyResult.ok, true);
const key = (keyResult as { ok: true; key: SealKey }).key;

const NOW = 1_000_000;
const ALICE = { owner: 'user:alice', workspace: 'ws:1' };
const BOB = { owner: 'user:bob', workspace: 'ws:1' };

function record(scope: { owner: string; workspace: string }, accountId: string, over: Partial<MailConnectionRecord> = {}): MailConnectionRecord {
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
    sealedAccessToken: seal(key, binding('access_token'), `token-for-${accountId}`),
    sealedRefreshToken: seal(key, binding('refresh_token'), `refresh-${accountId}`),
    accessTokenExpiresAt: NOW + 3_600_000,
    grantedScopes: [GOOGLE_SCOPES.read],
    authorizationRevokedAt: null,
    connectedAt: 1_000,
    lastRefreshAt: null,
    updatedAt: 1_000,
    ...over,
  };
}

/** Records what the store was asked for, so cross-tenant reads are visible. */
function storeOf(records: MailConnectionRecord[]) {
  const lookups: string[] = [];
  const store: MailConnectionStore = {
    list: async (scope, provider) => {
      lookups.push(`list:${scope.owner}`);
      return records.filter((r) => r.ownerScope === scope.owner && r.workspaceScope === scope.workspace && r.provider === provider);
    },
    get: async (scope, provider, id) => {
      lookups.push(`get:${scope.owner}`);
      return records.find((r) =>
        r.ownerScope === scope.owner && r.workspaceScope === scope.workspace
        && r.provider === provider && r.providerAccountId === id) ?? null;
    },
    put: async () => {},
    recordRefresh: async () => {},
    markAuthorizationRevoked: async () => {},
    disconnect: async () => true,
  };
  return { store, lookups };
}

function bind(records: MailConnectionRecord[]) {
  const { store, lookups } = storeOf(records);
  bindEmailExecution({
    connections: store,
    key,
    refresh: async () => ({ kind: 'refreshed', accessToken: 'fresh', expiresAt: NOW + 3_600_000 }),
    now: () => NOW,
  });
  return { lookups };
}

const ctxFor = (scope: { owner: string; workspace: string }): ToolHandlerContext => ({ principal: scope });
const QUERY = { keywords: 'invoice', limit: 10 };

afterEach(() => {
  bindEmailExecution(null);
  __resetInFlightForTest();
});

/* ------------------------------------------------------------------ *
 * 🚨 Refusals that must happen before anything is read
 * ------------------------------------------------------------------ */

test('🚨 with NO principal, nothing is read and the call is refused', async () => {
  /*
   * A mailbox read with no principal does not fail safe by accident. It either
   * finds nothing — which renders as a claim about a mailbox nobody opened —
   * or it finds whichever connection the code happened to reach.
   */
  const { lookups } = bind([record(ALICE, 'alice-1')]);
  const result = await executeEmailSearch(QUERY as never, undefined);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'refused');
  assert.deepEqual(lookups, [], 'the store was queried with no principal');
});

test('🚨 a missing principal is a REFUSAL, not a thrown error', async () => {
  // An exception here surfaces as a 500 on a chat turn. This surfaces as the
  // capability honestly reporting it cannot act.
  bind([]);
  await assert.doesNotReject(() => executeEmailSearch(QUERY as never, {} as ToolHandlerContext));
});

test('an unconfigured deployment reports not_configured', async () => {
  bindEmailExecution(null);
  const result = await executeEmailSearch(QUERY as never, ctxFor(ALICE));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'not_configured');
});

test('a principal with no connection is not_connected, never "no results"', async () => {
  /*
   * "No messages found" asserts something about a mailbox nobody opened. The
   * two are different facts with different remedies.
   */
  bind([record(ALICE, 'alice-1')]);
  const result = await executeEmailSearch(QUERY as never, ctxFor(BOB));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'not_connected');
});

/* ------------------------------------------------------------------ *
 * 🚨 Whose mailbox
 * ------------------------------------------------------------------ */

test('🚨 the store is only ever asked about the CALLER', async () => {
  const { lookups } = bind([record(ALICE, 'alice-1'), record(BOB, 'bob-1')]);
  await executeEmailSearch(QUERY as never, ctxFor(ALICE));
  assert.ok(lookups.length > 0, 'nothing was looked up at all');
  for (const lookup of lookups) {
    assert.ok(lookup.endsWith(ALICE.owner), `a lookup crossed a principal boundary: ${lookup}`);
  }
});

test("🚨 two principals do not see each other's mail", async () => {
  /*
   * The property the whole per-call resolution exists for. One binding, two
   * callers, two connected accounts — and the answers must not bleed.
   */
  const { lookups } = bind([record(ALICE, 'alice-1'), record(BOB, 'bob-1')]);

  const forAlice = await executeEmailSearch(QUERY as never, ctxFor(ALICE));
  const aliceLookups = [...lookups];
  lookups.length = 0;
  __resetInFlightForTest();
  const forBob = await executeEmailSearch(QUERY as never, ctxFor(BOB));
  const bobLookups = [...lookups];

  /*
   * The traces must be DISJOINT. Asserting only that both calls failed would
   * pass even if each had resolved the other's connection — the Gmail adapter
   * is unreachable in a test, so every path ends in a provider failure and the
   * outcome alone cannot tell a correct resolution from a crossed one.
   */
  assert.ok(aliceLookups.length > 0 && bobLookups.length > 0, 'a call resolved nothing at all');
  for (const lookup of aliceLookups) {
    assert.ok(lookup.endsWith(ALICE.owner), `alice's call touched ${lookup}`);
  }
  for (const lookup of bobLookups) {
    assert.ok(lookup.endsWith(BOB.owner), `bob's call touched ${lookup}`);
  }

  // And neither was told they have no connection, which is what a crossed or
  // empty resolution would have produced.
  assert.equal(forAlice.ok, false);
  assert.equal(forBob.ok, false);
  if (!forAlice.ok && !forBob.ok) {
    for (const failure of [forAlice.failure, forBob.failure]) {
      assert.notEqual(failure.kind, 'not_connected', 'a connected principal was reported unconnected');
    }
  }
});

test('🚨 a revoked grant refuses before any provider call', async () => {
  bind([record(ALICE, 'alice-1', { authorizationRevokedAt: 5_000 })]);
  const result = await executeEmailSearch(QUERY as never, ctxFor(ALICE));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, 'authorization_expired');
});

test('🚨 a grant without READ scope refuses, and says which scope', async () => {
  bind([record(ALICE, 'alice-1', { grantedScopes: [GOOGLE_SCOPES.send] })]);
  const result = await executeEmailSearch(QUERY as never, ctxFor(ALICE));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.kind, 'insufficient_scope');
    if (result.failure.kind === 'insufficient_scope') assert.equal(result.failure.needed, 'read');
  }
});

test('🚨 several accounts and none chosen: refuse rather than pick one', async () => {
  /*
   * Reading the wrong inbox is not a smaller mistake than reading none, and
   * there is no undo for having read it.
   */
  bind([record(ALICE, 'alice-1'), record(ALICE, 'alice-2')]);
  const result = await executeEmailSearch(QUERY as never, ctxFor(ALICE));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.failure.kind, 'refused');
    if (result.failure.kind === 'refused') assert.match(result.failure.reason, /choose which/i);
  }
});

test('🚨 no failure reason names a provider or a credential', async () => {
  bind([record(ALICE, 'alice-1', { authorizationRevokedAt: 1 })]);
  const result = await executeEmailSearch(QUERY as never, ctxFor(ALICE));
  const serialised = JSON.stringify(result);
  assert.ok(!/refresh-alice|token-for-alice/.test(serialised), 'a credential reached a failure');
  assert.ok(!/invalid_grant|googleapis/.test(serialised), 'provider vocabulary reached a failure');
});

/* ------------------------------------------------------------------ *
 * 🚨 Through the REAL executor
 * ------------------------------------------------------------------ */

test('🚨 the principal survives the trip from the executor to the handler', async () => {
  /*
   * 🚨 THIS TEST EXISTS BECAUSE ITS ABSENCE WAS INVISIBLE.
   *
   * Every other test in this file calls `executeEmailSearch` directly, so
   * deleting the principal where `executeToolCore` builds the handler context
   * broke nothing — the one line that carries identity from an HTTP request to
   * a mailbox read was covered by no test at all.
   *
   * Handing the capability a principal must therefore be observed END TO END:
   * if it is dropped, the handler refuses for want of one, and that refusal is
   * what this asserts against.
   */
  const { CapabilityRegistry } = await import('../src/engine/models/capabilityRegistry.js');
  const { ToolApprovalStore } = await import('../src/engine/tools/toolApprovalStore.js');
  const { ToolAudit } = await import('../src/engine/tools/toolAudit.js');
  const { executeToolCore } = await import('../src/engine/tools/toolExecutor.js');

  bind([record(ALICE, 'alice-1')]);
  const deps = {
    registry: new CapabilityRegistry(),
    approvals: new ToolApprovalStore(),
    audit: new ToolAudit(),
  };

  const connected = {
    state: 'connected' as const,
    account: 'alice-1@example.com',
    scopes: { read: true, draft: false, send: false },
    checkedAt: '2026-09-08T12:00:00Z',
  };
  const withPrincipal = await executeToolCore(deps, {
    tool: 'migra.email',
    input: { keywords: 'invoice', limit: 5 },
    requestId: 'req-with',
    principal: ALICE,
    // Exactly what the route resolves for this caller before executing.
    readiness: { mail: connected },
  });

  const asJson = JSON.stringify(withPrincipal);
  assert.ok(
    !/did not identify whose email/i.test(asJson),
    `the principal was lost between the executor and the handler: ${asJson}`,
  );

  // And without one, the very same call refuses — which is what makes the
  // assertion above sensitive rather than vacuous.
  __resetInFlightForTest();
  const withoutPrincipal = await executeToolCore(deps, {
    tool: 'migra.email',
    input: { keywords: 'invoice', limit: 5 },
    requestId: 'req-without',
    // Same availability context; only the PRINCIPAL is missing, so the gate
    // opens and the handler is the thing that refuses.
    readiness: { mail: connected },
  });
  assert.match(
    JSON.stringify(withoutPrincipal),
    /did not identify whose email/i,
    'a call with no principal was allowed to proceed',
  );
});
