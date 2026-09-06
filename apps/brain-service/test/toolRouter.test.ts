import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hashInput,
  routeToolInvocation,
  verifyUnchangedBeforeExecute,
  type CapabilityState,
  type RouterResolvers,
  type ToolRequest,
} from '../src/engine/tools/toolRouter.js';

/**
 * THE ROUTER MAY GATHER FACTS. IT MAY NOT DECIDE POLICY.
 *
 * So these tests do two things the router cannot be trusted to do for itself:
 * they assert WHICH resolvers were called (scheduling is allowed, and stopping
 * early is the only thing it decides), and they assert the verdict always equals
 * what the pure decider would return from the same facts.
 *
 * The second is the one that matters. A router that quietly short-circuits "it's
 * read-only, let it through" would pass every happy-path test ever written.
 */

interface Input { to: string; body: string }

/**
 * Records every resolver call, so "who was asked" is assertable.
 *
 * 🚨 THE RECORDING WRAPS THE OVERRIDES, not the other way round. The first
 * version spread `over` on top of the recording resolvers, so any resolver a
 * test replaced silently stopped recording — and the call log under-reported,
 * making "it stopped early" look true when it was not. A harness that cannot
 * see the thing it asserts is worse than no harness.
 */
function resolvers(over: Partial<RouterResolvers<Input>> & { capability?: CapabilityState } = {}) {
  const calls: string[] = [];
  const defaults: RouterResolvers<Input> = {
    capabilityState: () => over.capability ?? 'available',
    connectionState: () => ({ state: 'connected', identity: 'me@example.com' }),
    authorization: () => ({ authorized: true, basis: 'workspace-role' }),
    normalize: (i) => ({ to: i.to.trim().toLowerCase(), body: i.body.trim() }),
    preflight: () => ({ state: 'passed' }),
    consent: (_t, hash) => ({ state: 'valid', approvalId: 'a1', inputHash: hash }),
  };
  const merged = { ...defaults, ...over } as RouterResolvers<Input>;
  const record = <A extends unknown[], R>(name: string, fn: (...a: A) => R) => (...a: A): R => {
    calls.push(name);
    return fn(...a);
  };
  const r: RouterResolvers<Input> = {
    capabilityState: record('capability', merged.capabilityState),
    connectionState: record('connection', merged.connectionState),
    authorization: record('authorization', merged.authorization),
    normalize: record('normalize', merged.normalize),
    preflight: record('preflight', merged.preflight),
    consent: record('consent', merged.consent),
  };
  return { calls, r };
}

/*
 * Mutability comes from the MANIFEST, so the fixture names a tool rather than
 * declaring a property. `documents.search` is read-only; `test.mutating` is the
 * mutating fixture registered for these tests.
 */
const req = (mutating: boolean): ToolRequest<Input> => ({
  toolId: mutating ? 'test.mutating' : 'documents.search',
  input: { to: '  ME@Example.com ', body: ' hello ' },
});

test('a read-only tool routes to executable without a consent lookup', async () => {
  const { calls, r } = resolvers();
  const routed = await routeToolInvocation(req(false), r);
  assert.equal(routed.decision.executable, true);
  assert.equal(routed.decision.requiresConsent, false);
  assert.ok(!calls.includes('consent'), 'a read-only tool must not ask for consent');
});

test('a mutating tool with valid bound consent is executable', async () => {
  const { r } = resolvers();
  const routed = await routeToolInvocation(req(true), r);
  assert.equal(routed.decision.executable, true);
  assert.equal(routed.decision.consentState, 'valid');
  assert.equal(routed.consentState.inputHash, routed.inputHash);
});

test('🚨 it stops at the first blocked gate and asks nothing further', async () => {
  // Scheduling, not policy: a connector lookup for a capability the platform
  // cannot offer is work nobody needs, and an unauthorized user must never be
  // asked to approve anything.
  for (const [capability, expectedCalls] of [
    ['unknown', ['capability']],
    ['ungranted', ['capability']],
    ['backend_unavailable', ['capability']],
  ] as Array<[CapabilityState, string[]]>) {
    const { calls, r } = resolvers({ capability });
    const routed = await routeToolInvocation(req(true), r);
    assert.equal(routed.decision.executable, false);
    assert.deepEqual(calls, expectedCalls, `${capability} asked too much`);
  }
});

test('a disconnected account stops before authorization and before consent', async () => {
  const { calls, r } = resolvers({ connectionState: () => ({ state: 'not_connected' }) });
  const routed = await routeToolInvocation(req(true), r);
  assert.equal(routed.decision.blockedAt, 'connection:not-connected');
  assert.equal(routed.decision.action, 'connect');
  assert.deepEqual(calls, ['capability', 'connection']);
});

test('🚨 an unauthorized user is never asked to approve anything', async () => {
  const { calls, r } = resolvers({ authorization: () => ({ authorized: false, basis: 'not-a-member' }) });
  const routed = await routeToolInvocation(req(true), r);
  assert.equal(routed.decision.blockedAt, 'authorization:denied');
  assert.ok(!calls.includes('consent'), 'consent was sought from someone with no access');
  assert.ok(!calls.includes('preflight'), 'preflight ran for someone with no access');
});

test('🚨 consent is sought only AFTER preflight passes', async () => {
  /*
   * Asking someone to approve a send to an address that does not exist spends
   * their attention on a decision that cannot matter.
   */
  const { calls, r } = resolvers({ preflight: () => ({ state: 'failed', reason: 'That recipient does not exist.' }) });
  const routed = await routeToolInvocation(req(true), r);
  assert.equal(routed.decision.executable, false);
  assert.equal(routed.decision.blockedAt, 'preflight:failed');
  assert.equal(routed.decision.reason, 'That recipient does not exist.');
  assert.ok(!calls.includes('consent'), 'consent was sought for an action already known to fail');
  assert.deepEqual(calls, ['capability', 'connection', 'authorization', 'normalize', 'preflight']);
});

test('preflight that never ran is a fault, not a pass', async () => {
  // Defaulting to `passed` would let a caller skip validation by not mentioning it.
  const { r } = resolvers({ preflight: () => ({ state: 'not_run' }) });
  const routed = await routeToolInvocation(req(true), r);
  assert.equal(routed.decision.executable, false);
  assert.equal(routed.decision.blockedAt, 'preflight:not-run');
});

test('🚨 the hash binds the NORMALIZED input, not the request as it arrived', async () => {
  /*
   * Hashing the raw request and executing the normalized one produces an
   * approval that binds nothing at all.
   */
  const { r } = resolvers();
  const routed = await routeToolInvocation(req(true), r);
  const raw = hashInput({ to: '  ME@Example.com ', body: ' hello ' });
  const normalized = hashInput({ to: 'me@example.com', body: 'hello' });
  assert.equal(routed.inputHash, normalized);
  assert.notEqual(routed.inputHash, raw);
  assert.deepEqual(routed.normalizedInput, { to: 'me@example.com', body: 'hello' });
});

test('the hash is stable across key order', async () => {
  assert.equal(hashInput({ a: 1, b: [2, { c: 3, d: 4 }] }), hashInput({ b: [2, { d: 4, c: 3 }], a: 1 }));
  assert.notEqual(hashInput({ a: 1 }), hashInput({ a: 2 }));
});

test('🚨 anything that changes after approval invalidates it', async () => {
  // The re-check immediately before the side effect. The window between "I
  // approved this" and "this runs" is short and not empty.
  const { r } = resolvers();
  const request = req(true);
  const routed = await routeToolInvocation(request, r);
  assert.equal(routed.decision.executable, true);

  const drifted = await verifyUnchangedBeforeExecute(routed, r, { to: 'someone.else@example.com', body: 'hello' });
  assert.match(drifted!, /changed since you approved/);

  const unchanged = await verifyUnchangedBeforeExecute(routed, r, request.input);
  assert.equal(unchanged, null);
});

test('a non-executable decision can never reach execution', async () => {
  const { r } = resolvers({ authorization: () => ({ authorized: false, basis: 'not-a-member' }) });
  const routed = await routeToolInvocation(req(true), r);
  const refusal = await verifyUnchangedBeforeExecute(routed, r, req(true).input);
  assert.ok(refusal, 'a blocked decision must not be allowed through the final check');
});

test('the evidence object carries every gate, including the ones not reached', async () => {
  const { r } = resolvers({ capability: 'backend_unavailable' });
  const routed = await routeToolInvocation(req(true), r);
  assert.equal(routed.capabilityState, 'backend_unavailable');
  assert.equal(routed.authorizationState, null, 'unreached gates are null, not guessed');
  assert.equal(routed.preflightState.state, 'not_run');
  assert.equal(routed.inputHash, null);
  assert.ok(routed.decisionId.startsWith('dec_'));
});

test('the evidence object leaks no secret and no internal identifier', async () => {
  const { r } = resolvers();
  const routed = await routeToolInvocation(req(true), r);
  const blob = JSON.stringify(routed);
  for (const forbidden of [/token/i, /secret/i, /password/i, /bearer/i]) {
    assert.ok(!forbidden.test(blob), `evidence leaked ${forbidden}`);
  }
  // The user-facing sentence, specifically, must stay clean.
  const denied = await routeToolInvocation(req(true), resolvers({ capability: 'ungranted' }).r);
  assert.ok(!/\b[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\b/.test(denied.decision.reason ?? ''), denied.decision.reason);
});

test('🚨 the router adds no policy of its own', async () => {
  /*
   * The property that keeps the two layers from drifting: for the same gathered
   * facts, the router's verdict must be exactly the decider's. A router that
   * short-circuited "read-only, let it through" would pass every happy-path test
   * and fail this one.
   */
  const { decideToolInvocation } = await import('../src/engine/tools/toolDecision.js');
  for (const capability of ['unknown', 'ungranted', 'backend_unavailable', 'available'] as CapabilityState[]) {
    for (const mutating of [false, true]) {
      const { r } = resolvers({ capability });
      const routed = await routeToolInvocation(req(mutating), r);
      const manifest = (await import('../src/engine/tools/toolManifest.js')).toolManifest(
        mutating ? 'test.mutating' : 'documents.search',
      )!;
      const direct = decideToolInvocation({
        capability: manifest.capability,
        toolId: manifest.toolId,
        registered: capability !== 'unknown',
        grantHeld: capability !== 'unknown' && capability !== 'ungranted',
        backendAvailable: capability === 'available',
        connection: routed.connectionState.state,
        userAuthorized: routed.authorizationState?.authorized ?? false,
        ...(routed.authorizationState?.basis ? { authorizationBasis: routed.authorizationState.basis } : {}),
        preflight: routed.preflightState,
        mutating,
        ...(routed.inputHash ? { inputHash: routed.inputHash } : {}),
        ...(mutating ? { consent: routed.consentState } : {}),
      });
      assert.deepEqual(routed.decision, direct, `${capability}/${mutating}: router disagreed with the decider`);
    }
  }
});
