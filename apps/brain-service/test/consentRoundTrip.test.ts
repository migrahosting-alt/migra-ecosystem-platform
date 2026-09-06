import assert from 'node:assert/strict';
import test from 'node:test';

import { ToolApprovalStore } from '../src/engine/tools/toolApprovalStore.js';
import { approveAndPrepare, decline, propose } from '../src/engine/tools/consentRoundTrip.js';
import {
  executeRename,
  normalizeRename,
  preflightRename,
  type RenameConversationInput,
} from '../src/engine/tools/renameConversationTool.js';
import type { Conversation, Scope } from '../src/engine/memory/conversationStore.js';
import type { CapabilityState, RouterResolvers } from '../src/engine/tools/toolRouter.js';

/**
 * THE APPROVAL ROUND-TRIP, end to end, on the reference mutation.
 *
 * Until now consent was a resolver contract with no caller: the router could ask
 * whether an approval existed, and nothing minted one. This is the product side
 * — propose, decline or approve, dispatch exactly once — and the matrix is built
 * around the ways a single-use approval stops being single-use.
 */

const scope: Scope = { owner: 'owner-a', workspace: 'ws-a' };
const TOOL = 'conversations.rename';

function store(initial = 'Old title') {
  const conv = {
    id: 'c1', ownerScope: scope.owner, workspaceScope: scope.workspace,
    title: initial, memoryMode: 'durable', createdAt: 1, updatedAt: 1,
  } as Conversation;
  let dispatches = 0;
  return {
    conv,
    get dispatches() { return dispatches; },
    getConversation: (id: string, s: Scope) => (id === conv.id && s.owner === scope.owner ? conv : undefined),
    async renameConversation(id: string, s: Scope, title: string) {
      if (id !== conv.id || s.owner !== scope.owner) return undefined;
      dispatches += 1;
      conv.title = title.slice(0, 200);
      return conv;
    },
  };
}

const baseResolvers = (
  s: ReturnType<typeof store>,
  over: { capability?: CapabilityState; authorized?: boolean } = {},
): Omit<RouterResolvers<RenameConversationInput>, 'consent'> => ({
  capabilityState: () => over.capability ?? 'available',
  connectionState: () => ({ state: 'not_required' }),
  authorization: () => ({ authorized: over.authorized ?? true, basis: 'conversation-owner' }),
  normalize: normalizeRename,
  preflight: (i) => preflightRename(i, { getConversation: s.getConversation, scope }),
});

const deps = (s: ReturnType<typeof store>, approvals: ToolApprovalStore, over = {}) => ({
  approvals,
  resolvers: baseResolvers(s, over),
  previewOf: (n: RenameConversationInput) => {
    const c = s.getConversation(n.conversationId, scope);
    return `Rename this conversation from “${c?.title}” to “${n.title}”`;
  },
});

const REQ = { toolId: TOOL, input: { conversationId: 'c1', title: 'New title' } };

const runExecute = async (
  s: ReturnType<typeof store>,
  approvals: ToolApprovalStore,
  approvalId: string,
  request = REQ,
) => {
  const attempt = await approveAndPrepare(approvalId, request, deps(s, approvals));
  if (!attempt.routed || attempt.refusal) return { attempt, result: null };
  const result = await executeRename(attempt.routed, {
    getConversation: s.getConversation,
    renameConversation: s.renameConversation,
    scope,
    mkInvocationId: () => 'inv-1',
  });
  return { attempt, result };
};

// ── propose ────────────────────────────────────────────────────────────────

test('propose shows the EXACT normalized title that will be applied', async () => {
  const s = store();
  const p = await propose({ toolId: TOOL, input: { conversationId: 'c1', title: '  New   title  ' } }, deps(s, new ToolApprovalStore()));
  assert.equal(p.kind, 'needs_approval');
  assert.equal(p.preview, 'Rename this conversation from “Old title” to “New title”');
  assert.equal(p.routed.normalizedInput!.title, 'New title', 'the preview must describe what runs');
  assert.equal(s.conv.title, 'Old title', 'proposing must not mutate anything');
});

test('proposing mints exactly one approval and records approval_minted', async () => {
  const s = store();
  const approvals = new ToolApprovalStore();
  const p = await propose(REQ, deps(s, approvals));
  assert.ok(p.approvalId);
  assert.equal(approvals.get(p.approvalId!)!.state, 'PENDING');
  assert.deepEqual(p.events.map((e) => e.stage), ['approval_minted']);
});

test('🚨 a blocked action never prompts for approval', async () => {
  const s = store();
  const approvals = new ToolApprovalStore();
  for (const over of [{ capability: 'ungranted' as CapabilityState }, { authorized: false }]) {
    const p = await propose(REQ, { ...deps(s, approvals), resolvers: baseResolvers(s, over) });
    assert.equal(p.kind, 'blocked');
    assert.equal(p.approvalId, undefined, 'an approval was minted for an action that cannot run');
    assert.deepEqual(p.events, []);
  }
});

test('a preflight failure blocks without prompting', async () => {
  const s = store('Same');
  const approvals = new ToolApprovalStore();
  const p = await propose({ toolId: TOOL, input: { conversationId: 'c1', title: 'Same' } }, deps(s, approvals));
  assert.equal(p.kind, 'blocked');
  assert.equal(p.approvalId, undefined);
  assert.match(p.message!, /already/);
});

test('a read-only tool needs no approval at all', async () => {
  const s = store();
  const p = await propose({ toolId: 'documents.search', input: { conversationId: 'c1', title: 'x' } as never }, deps(s, new ToolApprovalStore()));
  assert.notEqual(p.kind, 'needs_approval');
});

// ── decline ────────────────────────────────────────────────────────────────

test('🚨 decline produces no mutation, and the token cannot then be used', async () => {
  const s = store();
  const approvals = new ToolApprovalStore();
  const p = await propose(REQ, deps(s, approvals));
  const events = decline(p.approvalId!, REQ, p.routed.normalizedInput!, { approvals });
  assert.deepEqual(events.map((e) => e.stage), ['declined']);
  assert.equal(approvals.get(p.approvalId!)!.state, 'REJECTED');

  const { attempt, result } = await runExecute(s, approvals, p.approvalId!);
  assert.equal(result, null);
  assert.match(attempt.refusal!.message, /declined/);
  assert.equal(s.dispatches, 0, 'a declined action was dispatched');
  assert.equal(s.conv.title, 'Old title');
});

// ── approve and dispatch ───────────────────────────────────────────────────

test('the full happy path dispatches once and persists', async () => {
  const s = store();
  const approvals = new ToolApprovalStore();
  const p = await propose(REQ, deps(s, approvals));
  const { attempt, result } = await runExecute(s, approvals, p.approvalId!);
  assert.deepEqual(attempt.events.map((e) => e.stage), ['approval_consumed', 'dispatch_started']);
  assert.equal(result!.outcome, 'success');
  assert.equal(result!.conversation!.title, 'New title');
  assert.equal(s.dispatches, 1);
});

test('🚨 the provenance trail is minted → consumed → dispatched → committed', async () => {
  const s = store();
  const approvals = new ToolApprovalStore();
  const p = await propose(REQ, deps(s, approvals));
  const { attempt, result } = await runExecute(s, approvals, p.approvalId!);
  const trail = [...p.events, ...attempt.events].map((e) => e.stage);
  assert.deepEqual(trail, ['approval_minted', 'approval_consumed', 'dispatch_started']);
  assert.equal(result!.provenance.stage, 'committed');
  assert.equal(result!.provenance.consentId, p.approvalId);
});

test('🚨 approval is single-use — a replay dispatches nothing', async () => {
  const s = store();
  const approvals = new ToolApprovalStore();
  const p = await propose(REQ, deps(s, approvals));
  const first = await runExecute(s, approvals, p.approvalId!);
  assert.equal(first.result!.outcome, 'success');
  assert.equal(s.dispatches, 1);

  const replay = await runExecute(s, approvals, p.approvalId!);
  assert.equal(replay.result, null);
  assert.match(replay.attempt.refusal!.message, /already used/);
  assert.equal(s.dispatches, 1, '🚨 a replay caused a second dispatch');
});

test('🚨 refresh/replay cannot silently re-execute — the token is spent BEFORE dispatch', async () => {
  /*
   * Consuming after a successful dispatch would leave a live approval during the
   * exact window a refresh or double-click happens. Asserted by dispatching a
   * tool that FAILS: the token must still be spent, so the retry is refused
   * rather than silently repeated.
   */
  const s = store();
  const approvals = new ToolApprovalStore();
  const p = await propose(REQ, deps(s, approvals));
  const failing = {
    ...s,
    renameConversation: async () => { throw new Error('conversation not found'); },
  };
  const attempt = await approveAndPrepare(p.approvalId!, REQ, deps(s, approvals));
  await executeRename(attempt.routed!, {
    getConversation: s.getConversation, renameConversation: failing.renameConversation,
    scope, mkInvocationId: () => 'inv-1',
  });
  assert.equal(approvals.get(p.approvalId!)!.state, 'CONSUMED', 'the token survived a failed dispatch');
  const retry = await runExecute(s, approvals, p.approvalId!);
  assert.equal(retry.result, null, 'a spent approval was reusable after a failure');
});

// ── binding ────────────────────────────────────────────────────────────────

test('🚨 changing the title invalidates the approval', async () => {
  const s = store();
  const approvals = new ToolApprovalStore();
  const p = await propose(REQ, deps(s, approvals));
  const { attempt, result } = await runExecute(s, approvals, p.approvalId!, {
    toolId: TOOL, input: { conversationId: 'c1', title: 'Something else entirely' },
  });
  assert.equal(result, null);
  assert.match(attempt.refusal!.message, /changed since you approved/);
  assert.equal(s.dispatches, 0);
  assert.equal(s.conv.title, 'Old title');
});

test('🚨 changing the conversation invalidates the approval', async () => {
  const s = store();
  const approvals = new ToolApprovalStore();
  const p = await propose(REQ, deps(s, approvals));
  const { attempt, result } = await runExecute(s, approvals, p.approvalId!, {
    toolId: TOOL, input: { conversationId: 'c2', title: 'New title' },
  });
  assert.equal(result, null);
  assert.ok(attempt.refusal);
  assert.equal(s.dispatches, 0);
});

test('🚨 an approval for one tool cannot be spent on another', async () => {
  const s = store();
  const approvals = new ToolApprovalStore();
  const p = await propose(REQ, deps(s, approvals));
  const attempt = await approveAndPrepare(p.approvalId!, { toolId: 'documents.search', input: REQ.input }, deps(s, approvals));
  assert.ok(attempt.refusal, 'a rename approval was spent on a different tool');
  assert.equal(approvals.get(p.approvalId!)!.state, 'PENDING', 'the wrong-tool attempt must not spend it');
});

test('an expired approval produces no mutation', async () => {
  const s = store();
  let clock = 1_000_000;
  // The constructor takes the clock POSITIONALLY. Passing an options object
  // silently produced a store with a real clock, and the expiry test passed for
  // the wrong reason until the assertion tightened.
  const approvals = new ToolApprovalStore(() => clock);
  const p = await propose(REQ, deps(s, approvals));
  clock += 10 * 60_000; // past the store's TTL
  const { attempt, result } = await runExecute(s, approvals, p.approvalId!);
  assert.equal(result, null);
  assert.match(attempt.refusal!.message, /expired/, 'expiry must be named, not collapsed into "not found"');
  assert.equal(s.dispatches, 0);
});

test('🚨 dispatch begins only after an approval exists', async () => {
  // Executing with an id that was never minted must not reach the tool.
  const s = store();
  const approvals = new ToolApprovalStore();
  const { attempt, result } = await runExecute(s, approvals, 'ap_never_minted');
  assert.equal(result, null);
  assert.deepEqual(attempt.events.map((e) => e.stage), ['failed_before_commit']);
  assert.equal(s.dispatches, 0);
});

test('🚨 a gate that fails between approval and dispatch still blocks', async () => {
  /*
   * Approval is not a bypass for the layers above it. The user approved, then
   * their access was revoked; the consumed token must not carry the action
   * through.
   */
  const s = store();
  const approvals = new ToolApprovalStore();
  const p = await propose(REQ, deps(s, approvals));
  const revoked = { ...deps(s, approvals), resolvers: baseResolvers(s, { authorized: false }) };
  const attempt = await approveAndPrepare(p.approvalId!, REQ, revoked);
  assert.ok(attempt.refusal, 'a revoked user executed on an old approval');
  assert.equal(attempt.routed!.decision.blockedAt, 'authorization:denied');
  assert.equal(s.dispatches, 0);
});

test('an unknown-outcome dispatch still reconciles by read-back', async () => {
  // The reconciliation proven earlier must survive the round-trip wiring.
  const s = store();
  const approvals = new ToolApprovalStore();
  const p = await propose(REQ, deps(s, approvals));
  const attempt = await approveAndPrepare(p.approvalId!, REQ, deps(s, approvals));
  const result = await executeRename(attempt.routed!, {
    getConversation: s.getConversation,
    async renameConversation(id, sc, title) {
      await s.renameConversation(id, sc, title); // it DID commit
      throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    },
    scope,
    mkInvocationId: () => 'inv-1',
  });
  assert.equal(result.outcome, 'success', 'observation should have resolved the uncertainty');
  assert.equal(result.conversation!.title, 'New title');
});
