import assert from 'node:assert/strict';
import test from 'node:test';

import type { Conversation, Scope } from '../src/engine/memory/conversationStore.js';
import {
  executeRename,
  normalizeRename,
  preflightRename,
  type RenameConversationInput,
} from '../src/engine/tools/renameConversationTool.js';
import { isIndeterminate } from '../src/engine/tools/mutationOutcome.js';
import {
  hashInput,
  routeToolInvocation,
  verifyUnchangedBeforeExecute,
  type CapabilityState,
  type ConsentFact,
  type RouterResolvers,
} from '../src/engine/tools/toolRouter.js';
import { toolManifest } from '../src/engine/tools/toolManifest.js';

/**
 * THE FIRST MUTATING TOOL — the consent lifecycle, end to end.
 *
 * Rename is internal and reversible, so the matrix measures the FRAMEWORK rather
 * than the blast radius: exact-input binding, replay refusal, expiry, the
 * re-hash immediately before dispatch, and the outcome nobody likes admitting —
 * dispatched, and we do not know whether it committed.
 */

const scope: Scope = { owner: 'owner-a', workspace: 'ws-a' };
const TOOL = 'conversations.rename';

/** A conversation store thin enough to fault-inject, real enough to persist. */
function store(initial = 'Old title') {
  const conv: Conversation = {
    id: 'c1', ownerScope: scope.owner, workspaceScope: scope.workspace,
    title: initial, memoryMode: 'durable', createdAt: 1, updatedAt: 1,
  } as Conversation;
  let failWith: unknown = null;
  let commitButThrow = false;
  let readFails = false;
  return {
    conv,
    faults: {
      throwOnRename(e: unknown) { failWith = e; },
      commitThenThrow(e: unknown) { commitButThrow = true; failWith = e; },
      breakReads() { readFails = true; },
    },
    getConversation(id: string, s: Scope): Conversation | undefined {
      if (readFails) throw new Error('read failed');
      return id === conv.id && s.owner === scope.owner ? conv : undefined;
    },
    async renameConversation(id: string, s: Scope, title: string): Promise<Conversation | undefined> {
      if (id !== conv.id || s.owner !== scope.owner) return undefined;
      if (commitButThrow) { conv.title = title; throw failWith; }
      if (failWith) throw failWith;
      conv.title = title.slice(0, 200);
      conv.updatedAt = 2;
      return conv;
    },
  };
}

function resolvers(
  s: ReturnType<typeof store>,
  over: Partial<RouterResolvers<RenameConversationInput>> & {
    capability?: CapabilityState;
    consentFor?: ConsentFact;
  } = {},
) {
  const calls: string[] = [];
  const defaults: RouterResolvers<RenameConversationInput> = {
    capabilityState: () => over.capability ?? 'available',
    connectionState: () => ({ state: 'not_required' }),
    authorization: () => ({ authorized: true, basis: 'conversation-owner' }),
    normalize: normalizeRename,
    preflight: (i) => preflightRename(i, { getConversation: s.getConversation, scope }),
    // Consent is minted bound to the hash the router computed — which is the
    // whole point: it cannot be minted before the normalized input is known.
    consent: (_t, hash) => over.consentFor ?? { state: 'valid', approvalId: 'ap_1', inputHash: hash },
  };
  const merged = { ...defaults, ...over } as RouterResolvers<RenameConversationInput>;
  const rec = <A extends unknown[], R>(n: string, f: (...a: A) => R) => (...a: A): R => { calls.push(n); return f(...a); };
  return {
    calls,
    r: {
      capabilityState: rec('capability', merged.capabilityState),
      connectionState: rec('connection', merged.connectionState),
      authorization: rec('authorization', merged.authorization),
      normalize: rec('normalize', merged.normalize),
      preflight: rec('preflight', merged.preflight),
      consent: rec('consent', merged.consent),
    } as RouterResolvers<RenameConversationInput>,
  };
}

const run = async (
  s: ReturnType<typeof store>,
  input: RenameConversationInput,
  over?: Parameters<typeof resolvers>[1],
) => {
  const { calls, r } = resolvers(s, over);
  const routed = await routeToolInvocation({ toolId: TOOL, input }, r);
  const result = await executeRename(routed, {
    getConversation: s.getConversation,
    renameConversation: s.renameConversation,
    scope,
    mkInvocationId: () => 'inv-1',
  });
  return { calls, routed, result };
};

const NEW = { conversationId: 'c1', title: 'New title' };

// ── manifest and bypass ────────────────────────────────────────────────────

test('the manifest says mutating, and a request cannot say otherwise', () => {
  assert.equal(toolManifest(TOOL)!.mutating, true);
  // There is no field on ToolRequest to override it; this is the type-level fact
  // the bypass test in the router suite covers behaviourally.
  assert.equal(toolManifest(TOOL)!.connection, 'none');
});

test('routing a mutating tool requires consent', async () => {
  const s = store();
  const { routed } = await run(s, NEW);
  assert.equal(routed.decision.requiresConsent, true);
});

// ── gates before consent ───────────────────────────────────────────────────

test('🚨 an unauthorized user never reaches consent', async () => {
  const s = store();
  const { calls, result } = await run(s, NEW, { authorization: () => ({ authorized: false, basis: 'not-owner' }) });
  assert.equal(result.outcome, 'refused_policy');
  assert.ok(!calls.includes('consent'), 'consent was sought from someone with no access');
  assert.equal(s.conv.title, 'Old title', 'nothing may have changed');
});

test('🚨 preflight failure never mints consent', async () => {
  const s = store();
  const { calls, result } = await run(s, { conversationId: 'c1', title: '' });
  assert.equal(result.outcome, 'preflight_failed');
  assert.ok(!calls.includes('consent'));
  assert.equal(s.conv.title, 'Old title');
});

test('a rename to the title it already has is refused before consent', async () => {
  const s = store('Same');
  const { calls, result } = await run(s, { conversationId: 'c1', title: 'Same' });
  assert.equal(result.outcome, 'preflight_failed');
  assert.match(result.message!, /already/);
  assert.ok(!calls.includes('consent'), 'approval was sought for a change that changes nothing');
});

test('a missing conversation fails preflight without confirming what exists', async () => {
  const s = store();
  const { result } = await run(s, { conversationId: 'nope', title: 'X' });
  assert.equal(result.outcome, 'preflight_failed');
  assert.equal(result.message, 'That conversation could not be found.');
});

test('🚨 consent is requested only after the normalized input is known', async () => {
  const s = store();
  const { calls } = await run(s, NEW);
  assert.ok(calls.indexOf('normalize') < calls.indexOf('consent'), 'consent preceded normalization');
  assert.ok(calls.indexOf('preflight') < calls.indexOf('consent'), 'consent preceded preflight');
});

test('the confirmation names the real before-and-after, normalized', async () => {
  const s = store('Old title');
  const pf = preflightRename(normalizeRename({ conversationId: 'c1', title: '  New   title  ' }), {
    getConversation: s.getConversation, scope,
  });
  assert.equal(pf.state, 'passed');
  assert.equal(pf.preview, 'Rename this conversation from “Old title” to “New title”');
});

// ── consent binding ────────────────────────────────────────────────────────

test('🚨 approval binds toolId AND the normalized input hash', async () => {
  const s = store();
  const { routed } = await run(s, NEW);
  assert.equal(routed.consentState.inputHash, routed.inputHash);
  assert.equal(routed.inputHash, hashInput(normalizeRename(NEW)));
});

test('🚨 an approval for conversation X cannot authorize conversation Y', async () => {
  const s = store();
  const forX = hashInput(normalizeRename({ conversationId: 'c1', title: 'New title' }));
  // Approval minted for c1, presented for a rename of c2.
  const { result } = await run(s, { conversationId: 'c2', title: 'New title' }, {
    consentFor: { state: 'valid', approvalId: 'ap_x', inputHash: forX },
  });
  assert.notEqual(result.outcome, 'success');
  assert.equal(s.conv.title, 'Old title');
});

test('🚨 an approval for tool A cannot authorize tool B', async () => {
  // The hash is over the input only, so tool binding is the store's job — the
  // router asks the consent resolver PER TOOL ID, and the resolver must scope by
  // it. Asserted here as the contract the resolver has to honour.
  const s = store();
  const seen: string[] = [];
  await run(s, NEW, {
    consent: (toolId, hash) => { seen.push(toolId); return { state: 'valid', approvalId: 'a', inputHash: hash }; },
  });
  assert.deepEqual(seen, [TOOL], 'consent must be looked up under the invoking tool id');
});

test('changed title after approval → hash mismatch → refusal', async () => {
  const s = store();
  const approvedHash = hashInput(normalizeRename({ conversationId: 'c1', title: 'Approved title' }));
  const { result } = await run(s, { conversationId: 'c1', title: 'Sneaky different title' }, {
    consentFor: { state: 'valid', approvalId: 'ap_1', inputHash: approvedHash },
  });
  assert.equal(result.outcome, 'refused_policy');
  assert.match(result.message!, /changed since you approved/);
  assert.equal(s.conv.title, 'Old title', 'the unapproved title must not persist');
});

test('consumed approval → replay refused', async () => {
  const s = store();
  const { result } = await run(s, NEW, { consentFor: { state: 'consumed', inputHash: 'x' } });
  assert.equal(result.outcome, 'refused_policy');
  assert.match(result.message!, /already used/);
  assert.equal(s.conv.title, 'Old title');
});

test('expired approval → refused, and says which', async () => {
  const s = store();
  const { result } = await run(s, NEW, { consentFor: { state: 'expired', inputHash: 'x' } });
  assert.equal(result.outcome, 'refused_policy');
  assert.match(result.message!, /expired/);
});

test('verifyUnchangedBeforeExecute catches drift between approval and dispatch', async () => {
  const s = store();
  const { routed, r } = { ...(await run(s, NEW)), r: resolvers(s).r };
  assert.equal(await verifyUnchangedBeforeExecute(routed, r, NEW), null);
  const drifted = await verifyUnchangedBeforeExecute(routed, r, { conversationId: 'c1', title: 'Different' });
  assert.match(drifted!, /changed since you approved/);
});

// ── execution ──────────────────────────────────────────────────────────────

test('the exact approved input executes, once, and returns the PERSISTED state', async () => {
  const s = store();
  const { result } = await run(s, NEW);
  assert.equal(result.outcome, 'success');
  assert.deepEqual(result.conversation, { id: 'c1', title: 'New title' });
  assert.equal(s.conv.title, 'New title', 'the store holds the new title');
  assert.equal(result.provenance.stage, 'committed');
});

test('the persisted state is read back, not echoed from the request', async () => {
  // A store that silently stores something else must not be reported as success.
  const s = store();
  const original = s.renameConversation;
  const lying = {
    ...s,
    async renameConversation(id: string, sc: Scope, _title: string) {
      return original.call(s, id, sc, 'SOMETHING ELSE');
    },
  };
  const { r } = resolvers(s);
  const routed = await routeToolInvocation({ toolId: TOOL, input: NEW }, r);
  const result = await executeRename(routed, {
    getConversation: s.getConversation, renameConversation: lying.renameConversation,
    scope, mkInvocationId: () => 'inv-1',
  });
  assert.notEqual(result.outcome, 'success');
  assert.equal(result.outcome, 'outcome_unknown_after_dispatch');
});

test('backend failure AFTER consent is backend_failed, not "approval failed"', async () => {
  const s = store();
  s.faults.throwOnRename(new Error('invalid title for this row'));
  const { result } = await run(s, NEW);
  assert.equal(result.outcome, 'backend_failed_before_side_effect');
  assert.equal(result.provenance.stage, 'failed_before_commit');
  // The consent was fine; the message must not blame it.
  assert.ok(!/approval|consent/i.test(result.message!), result.message);
  assert.equal(result.provenance.consentId, 'ap_1', 'the consent that authorised it is still recorded');
});

// ── the outcome nobody likes admitting ─────────────────────────────────────

test('🚨 dispatched, connection died, and the write DID land → success by observation', async () => {
  /*
   * A rename is idempotent, so uncertainty is resolved by LOOKING. Reporting
   * "failed" here would invite a retry; reporting "unknown" when the answer is
   * observable would be needlessly alarming.
   */
  const s = store();
  s.faults.commitThenThrow(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
  const { result } = await run(s, NEW);
  assert.equal(result.outcome, 'success');
  assert.equal(result.conversation!.title, 'New title');
});

test('🚨 dispatched, connection died, and the write did NOT land → clean failure', async () => {
  const s = store();
  s.faults.throwOnRename(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
  const { result } = await run(s, NEW);
  assert.equal(result.outcome, 'backend_failed_before_side_effect');
  assert.equal(s.conv.title, 'Old title');
});

test('🚨 dispatched and UNOBSERVABLE → outcome_unknown_after_dispatch', async () => {
  /*
   * The write went out, the connection died, and the read-back fails too. There
   * is no honest answer except "we do not know" — and the message must tell the
   * user to check rather than to retry.
   */
  const s = store();
  s.faults.throwOnRename(Object.assign(new Error('socket hang up'), { code: 'ETIMEDOUT' }));
  s.faults.breakReads();
  const { r } = resolvers(s);
  // Route with a working read, then break reads before execution.
  const routed = await routeToolInvocation({ toolId: TOOL, input: NEW }, resolvers(store()).r);
  const result = await executeRename(routed, {
    getConversation: s.getConversation, renameConversation: s.renameConversation,
    scope, mkInvocationId: () => 'inv-1',
  });
  assert.equal(result.outcome, 'outcome_unknown_after_dispatch');
  assert.equal(result.provenance.stage, 'outcome_unknown');
  assert.match(result.message!, /could not be confirmed/);
  assert.ok(!/try again/i.test(result.message!) || /check/i.test(result.message!), 'must not simply invite a retry');
  void r;
});

test('an unrecognised error is treated as INDETERMINATE, not as safe', () => {
  // Assuming a mystery failure was safe is how a retry duplicates a side effect.
  assert.equal(isIndeterminate(new Error('something nobody has seen before')), true);
  assert.equal(isIndeterminate(Object.assign(new Error('x'), { code: 'ECONNRESET' })), true);
  // A clear rejection is determinate: the backend answered, and it said no.
  assert.equal(isIndeterminate(new Error('conversation not found')), false);
  assert.equal(isIndeterminate(new Error('validation failed')), false);
});

// ── provenance ─────────────────────────────────────────────────────────────

test('provenance records consent id, stage and final outcome', async () => {
  const s = store();
  const { result, routed } = await run(s, NEW);
  const p = result.provenance;
  assert.equal(p.decisionId, routed.decisionId);
  assert.equal(p.invocationId, 'inv-1');
  assert.equal(p.tool, TOOL);
  assert.equal(p.capability, 'Rename conversation');
  assert.equal(p.consentId, 'ap_1');
  assert.equal(p.normalizedInputHash, routed.inputHash);
  assert.equal(p.stage, 'committed');
  assert.equal(p.outcome, 'success');
  assert.equal(p.idempotencyKey, 'inv-1');
  assert.equal(p.backend, 'conversation-store');
});

test('🚨 approval is not dispatch — the stages stay distinct', async () => {
  /*
   * Consent issuance must never imply the mutation started. Once this framework
   * reaches sends and deletes, "did we ever actually try?" is the difference
   * between a duplicate and a loss.
   */
  const s = store();
  const refused = await run(s, NEW, { consentFor: { state: 'expired', inputHash: 'x' } });
  assert.equal(refused.result.provenance.stage, 'failed_before_commit');
  assert.notEqual(refused.result.provenance.stage, 'dispatch_started');

  const ok = await run(store(), NEW);
  assert.equal(ok.result.provenance.stage, 'committed');
});

test('normalization mirrors the store, so the hash binds what persists', () => {
  // The store truncates to 200. If normalization did not, the user would approve
  // a longer title than the one that gets written.
  const long = 'x'.repeat(260);
  assert.equal(normalizeRename({ conversationId: 'c1', title: long }).title.length, 200);
  assert.deepEqual(normalizeRename({ conversationId: ' c1 ', title: '  a   b  ' }), { conversationId: 'c1', title: 'a b' });
});
