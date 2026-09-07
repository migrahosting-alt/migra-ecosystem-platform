import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

import { ConversationStore, type Scope } from '../src/engine/memory/conversationStore.js';
import { ToolApprovalStore } from '../src/engine/tools/toolApprovalStore.js';
import { registerToolConsentRoutes } from '../src/engine/tools/toolConsentRoutes.js';
import type { CapabilityState } from '../src/engine/tools/toolRouter.js';

/**
 * THE APPROVAL ROUND-TRIP OVER HTTP — the product path, not the engine seam.
 *
 * 🚨 THE REGRESSION THIS FILE EXISTS FOR:
 *
 *     propose → approve → REVOKE ACCESS → dispatch
 *
 * A token minted while the user had access must not carry the action through
 * after that access is gone. The approval says "this exact action was consented
 * to", never "this caller may act" — and only one of those is a token's to
 * claim. Everything else here is the distinctions the engine already draws,
 * re-checked at the boundary where a client could blur them.
 */

const scope: Scope = { owner: 'owner-a', workspace: 'ws-a' };

interface Harness {
  app: ReturnType<typeof Fastify>;
  conversations: ConversationStore;
  approvals: ToolApprovalStore;
  conversationId: string;
  /** Flip to revoke the user's access mid-flow. */
  setAuthorized(v: boolean): void;
  setCapability(v: CapabilityState): void;
  renames: () => number;
}

async function harness(opts: { approvalClock?: () => number } = {}): Promise<Harness> {
  const conversations = new ConversationStore();
  const approvals = new ToolApprovalStore(opts.approvalClock);
  const conv = await conversations.createConversation(scope, { title: 'Old title', memoryMode: 'session' });

  let authorized = true;
  let capability: CapabilityState = 'available';
  let renames = 0;

  const app = Fastify({ logger: false });
  registerToolConsentRoutes(app, {
    approvals,
    conversations: {
      getConversation: (id: string, s: Scope) => conversations.getConversation(id, s),
      renameConversation: async (id: string, s: Scope, t: string) => {
        renames += 1;
        return conversations.renameConversation(id, s, t);
      },
    } as unknown as ConversationStore,
    authorize: () => ({ authorized, basis: 'conversation-owner' }),
    capabilityState: () => capability,
    scopeFrom: () => scope,
  });
  await app.ready();

  return {
    app,
    conversations,
    approvals,
    conversationId: conv.id,
    setAuthorized: (v) => { authorized = v; },
    setCapability: (v) => { capability = v; },
    renames: () => renames,
  };
}

const post = async (h: Harness, path: string, body: unknown) => {
  const res = await h.app.inject({ method: 'POST', url: `/api/ai/tools/conversations/rename/${path}`, payload: body });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
};

const titleOf = (h: Harness) => h.conversations.getConversation(h.conversationId, scope)?.title;

// ── the regression that matters most ───────────────────────────────────────

test('🚨 propose → approve → REVOKE ACCESS → dispatch: blocked, no rename', async () => {
  const h = await harness();
  const proposed = await post(h, 'propose', { conversationId: h.conversationId, title: 'New title' });
  assert.equal(proposed.body.status, 'needs_approval');
  const token = proposed.body.approvalToken as string;

  // The user's access disappears between approving and dispatching.
  h.setAuthorized(false);

  const dispatched = await post(h, 'dispatch', {
    approvalToken: token, conversationId: h.conversationId, title: 'New title',
  });
  assert.equal(dispatched.body.status, 'blocked');
  assert.equal(h.renames(), 0, '🚨 a revoked user renamed via an old approval');
  assert.equal(titleOf(h), 'Old title');
  // And the token must not have become a way to try again later.
  h.setAuthorized(true);
  const retry = await post(h, 'dispatch', {
    approvalToken: token, conversationId: h.conversationId, title: 'New title',
  });
  assert.equal(retry.body.status, 'blocked', 'the token survived a blocked dispatch');
  assert.equal(h.renames(), 0);
});

test('🚨 a capability that goes unavailable after approval also blocks', async () => {
  const h = await harness();
  const proposed = await post(h, 'propose', { conversationId: h.conversationId, title: 'New title' });
  h.setCapability('backend_unavailable');
  const dispatched = await post(h, 'dispatch', {
    approvalToken: proposed.body.approvalToken, conversationId: h.conversationId, title: 'New title',
  });
  assert.equal(dispatched.body.status, 'blocked');
  assert.equal(h.renames(), 0);
});

// ── propose ────────────────────────────────────────────────────────────────

test('propose returns the exact normalized action and mutates nothing', async () => {
  const h = await harness();
  const r = await post(h, 'propose', { conversationId: h.conversationId, title: '  New   title  ' });
  assert.equal(r.body.status, 'needs_approval');
  assert.equal(r.body.action, 'Rename this conversation from “Old title” to “New title”');
  assert.ok(r.body.approvalToken);
  assert.equal(titleOf(h), 'Old title');
  assert.equal(h.renames(), 0);
});

test('a blocked proposal returns no token', async () => {
  const h = await harness();
  h.setAuthorized(false);
  const r = await post(h, 'propose', { conversationId: h.conversationId, title: 'New title' });
  assert.equal(r.body.status, 'blocked');
  assert.equal(r.body.approvalToken, undefined, 'a token was minted for an action that cannot run');
});

test('a malformed request is a 400 and mints nothing', async () => {
  const h = await harness();
  const r = await post(h, 'propose', { conversationId: h.conversationId });
  assert.equal(r.status, 400);
  assert.equal(r.body.approvalToken, undefined);
});

// ── decline ────────────────────────────────────────────────────────────────

test('decline performs no side effect, and the token then fails', async () => {
  const h = await harness();
  const p = await post(h, 'propose', { conversationId: h.conversationId, title: 'New title' });
  const d = await post(h, 'decline', {
    approvalToken: p.body.approvalToken, conversationId: h.conversationId, title: 'New title',
  });
  assert.equal(d.body.status, 'declined');
  assert.equal(h.renames(), 0);

  const after = await post(h, 'dispatch', {
    approvalToken: p.body.approvalToken, conversationId: h.conversationId, title: 'New title',
  });
  assert.equal(after.body.status, 'blocked');
  assert.equal(titleOf(h), 'Old title');
});

// ── dispatch ───────────────────────────────────────────────────────────────

test('the happy path renames once and reports the persisted title', async () => {
  const h = await harness();
  const p = await post(h, 'propose', { conversationId: h.conversationId, title: 'New title' });
  const d = await post(h, 'dispatch', {
    approvalToken: p.body.approvalToken, conversationId: h.conversationId, title: 'New title',
  });
  assert.equal(d.status, 200);
  assert.equal(d.body.status, 'done');
  assert.deepEqual(d.body.conversation, { id: h.conversationId, title: 'New title' });
  assert.equal(titleOf(h), 'New title');
  assert.equal(h.renames(), 1);
});

test('🚨 replay dispatches nothing a second time', async () => {
  const h = await harness();
  const p = await post(h, 'propose', { conversationId: h.conversationId, title: 'New title' });
  const body = { approvalToken: p.body.approvalToken, conversationId: h.conversationId, title: 'New title' };
  await post(h, 'dispatch', body);
  assert.equal(h.renames(), 1);
  const replay = await post(h, 'dispatch', body);
  assert.equal(replay.body.status, 'blocked');
  assert.equal(h.renames(), 1, '🚨 a replay renamed twice');
});

test('changed title after approval refuses', async () => {
  const h = await harness();
  const p = await post(h, 'propose', { conversationId: h.conversationId, title: 'Approved title' });
  const d = await post(h, 'dispatch', {
    approvalToken: p.body.approvalToken, conversationId: h.conversationId, title: 'Different title',
  });
  assert.equal(d.body.status, 'blocked');
  assert.equal(h.renames(), 0);
  assert.equal(titleOf(h), 'Old title');
});

test('changed conversation after approval refuses', async () => {
  const h = await harness();
  const other = await h.conversations.createConversation(scope, { title: 'Other', memoryMode: 'session' });
  const p = await post(h, 'propose', { conversationId: h.conversationId, title: 'New title' });
  const d = await post(h, 'dispatch', {
    approvalToken: p.body.approvalToken, conversationId: other.id, title: 'New title',
  });
  assert.equal(d.body.status, 'blocked');
  assert.equal(h.conversations.getConversation(other.id, scope)!.title, 'Other');
});

test('an expired approval refuses', async () => {
  let clock = 1_000_000;
  const h = await harness({ approvalClock: () => clock });
  const p = await post(h, 'propose', { conversationId: h.conversationId, title: 'New title' });
  clock += 10 * 60_000;
  const d = await post(h, 'dispatch', {
    approvalToken: p.body.approvalToken, conversationId: h.conversationId, title: 'New title',
  });
  assert.equal(d.body.status, 'blocked');
  assert.equal(h.renames(), 0);
});

test('a token never minted refuses', async () => {
  const h = await harness();
  const d = await post(h, 'dispatch', {
    approvalToken: 'ap_never_existed', conversationId: h.conversationId, title: 'New title',
  });
  assert.equal(d.body.status, 'blocked');
  assert.equal(h.renames(), 0);
});

test('🚨 a backend failure after consumption requires FRESH approval', async () => {
  /*
   * The token is spent before dispatch, so a failure leaves it spent. The retry
   * must be refused rather than silently repeated — which is the property that
   * matters once this reaches sends and charges.
   */
  const h = await harness();
  const conversations = h.conversations;
  const p = await post(h, 'propose', { conversationId: h.conversationId, title: 'New title' });
  const token = p.body.approvalToken as string;

  // Break the rename for one call.
  const original = conversations.renameConversation.bind(conversations);
  let broken = true;
  (conversations as unknown as { renameConversation: unknown }).renameConversation = async (
    id: string, s: Scope, t: string,
  ) => {
    if (broken) throw new Error('conversation not found');
    return original(id, s, t);
  };

  const failed = await post(h, 'dispatch', { approvalToken: token, conversationId: h.conversationId, title: 'New title' });
  assert.notEqual(failed.body.status, 'done');
  assert.equal(h.approvals.get(token)!.state, 'CONSUMED', 'the token survived a failed dispatch');

  broken = false;
  const retry = await post(h, 'dispatch', { approvalToken: token, conversationId: h.conversationId, title: 'New title' });
  assert.equal(retry.body.status, 'blocked', 'a spent token was reusable after a failure');
  assert.equal(titleOf(h), 'Old title');
});

// ── the state nobody likes ─────────────────────────────────────────────────

test('🚨 outcome_unknown is its own status — not done, not safe-to-retry', async () => {
  const h = await harness();
  const conversations = h.conversations;
  const p = await post(h, 'propose', { conversationId: h.conversationId, title: 'New title' });

  /*
   * The realistic sequence, made deterministic: the store answers normally right
   * up to the write, the write is dispatched, the connection dies, and every
   * read after that fails.
   *
   * My first two attempts guessed at a read COUNT and got a different outcome
   * each time — preflight failing, then the read-back succeeding. Tying the
   * failure to the dispatch itself models what actually happens and cannot drift
   * when the number of reads changes.
   */
  const realGet = conversations.getConversation.bind(conversations);
  let storeIsGone = false;
  (conversations as unknown as { getConversation: unknown }).getConversation = (id: string, s: Scope) => {
    if (storeIsGone) throw new Error('read failed');
    return realGet(id, s);
  };
  (conversations as unknown as { renameConversation: unknown }).renameConversation = async () => {
    storeIsGone = true; // dispatched, and now unobservable
    throw Object.assign(new Error('socket hang up'), { code: 'ETIMEDOUT' });
  };

  const d = await post(h, 'dispatch', {
    approvalToken: p.body.approvalToken, conversationId: h.conversationId, title: 'New title',
  });
  assert.notEqual(d.status, 500, 'a 500 reads as "safe to retry" — the exact ambiguity being removed');
  assert.equal(d.status, 202, '202 says accepted-and-unsettled; 200 reads as done, 500 as safe to retry');
  assert.equal(d.body.status, 'unknown');
  assert.match(String(d.body.message), /could not be confirmed/i);
  assert.match(String(d.body.message), /check/i, 'must tell the user to check, not to retry');
});

// ── what leaks ─────────────────────────────────────────────────────────────

test('🚨 no hashes, tool ids, backend codes or store vocabulary reach the client', async () => {
  const h = await harness();
  const bodies: unknown[] = [];

  bodies.push((await post(h, 'propose', { conversationId: h.conversationId, title: 'New title' })).body);
  const token = (bodies[0] as Record<string, string>).approvalToken;
  h.setAuthorized(false);
  bodies.push((await post(h, 'dispatch', { approvalToken: token, conversationId: h.conversationId, title: 'New title' })).body);
  h.setAuthorized(true);
  h.setCapability('ungranted');
  bodies.push((await post(h, 'propose', { conversationId: h.conversationId, title: 'X' })).body);
  h.setCapability('available');
  bodies.push((await post(h, 'dispatch', { approvalToken: 'ap_nope', conversationId: h.conversationId, title: 'X' })).body);

  for (const body of bodies) {
    const blob = JSON.stringify(body);
    for (const forbidden of [
      /sha256:/i,
      /conversations\.rename/,
      /inputHash/i,
      /NOT_APPROVED|UNKNOWN_CONVERSATION|INVALID_INPUT/,
      /CONSUMED|PENDING|REJECTED/,
      /toolApprovalStore|IndexService|approvedIndex/i,
      /registry:|consent:|preflight:|authorization:/,
    ]) {
      assert.ok(!forbidden.test(blob), `leaked ${forbidden} in ${blob}`);
    }
  }
});

test('every refusal is a readable sentence, not a code', async () => {
  const h = await harness();
  h.setAuthorized(false);
  const r = await post(h, 'propose', { conversationId: h.conversationId, title: 'New title' });
  const message = String(r.body.message);
  assert.ok(message.length > 15, message);
  assert.ok(/^[A-Z]/.test(message), 'a message shown to a person starts like a sentence');
  assert.ok(!/_/.test(message), `looks like a code: ${message}`);
});
