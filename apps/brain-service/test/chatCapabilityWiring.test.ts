/**
 * CHAT REACHES A CAPABILITY — the wiring, not the shape.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE FAILURE THIS EXISTS TO CATCH
 *
 * Every layer under this one already had tests, and all of them passed while
 * normal chat could not reach a mailbox at all — because nothing called the
 * orchestrator. A slice is complete when the outermost REAL dependency has been
 * exercised, not when every layer above passes against a double.
 *
 * So this drives the binding the server actually installs, with a real registry
 * and the real executor behind it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bindChatCapabilities, capabilityContext, runChatCapabilities,
} from '../src/engine/chat/chatCapabilities.js';
import { MemoryConversationEvidence } from '../src/engine/chat/conversationEvidence.js';
import { CapabilityRegistry, type ReadinessContext } from '../src/engine/models/capabilityRegistry.js';
import { ToolApprovalStore } from '../src/engine/tools/toolApprovalStore.js';
import { ToolAudit } from '../src/engine/tools/toolAudit.js';

const ALICE = { owner: 'user:alice', workspace: 'personal:alice' };

const message = () => ({
  providerMessageId: 'pm-1', providerThreadId: 't-pm-1',
  from: { address: 'billing@hetzner.com' }, to: [], cc: [],
  subject: 'Invoice 2026-09', sentAt: '2026-09-01T10:00:00Z',
  snippet: 'Your September invoice…',
  textBody: 'Your September invoice totals 48273.55.',
  bodyComplete: true, attachmentsKnown: true, attachments: [],
  labels: ['INBOX'], unread: false, retrievedAt: '2026-09-09T00:00:00Z',
});

/** The REAL registry, with only the mailbox's outbound call replaced. */
function install(opts: { connectedFor: string[]; calls: string[] }) {
  class R extends CapabilityRegistry {
    override runnable(id: string) {
      const base = super.runnable(id);
      if (!base || id !== 'migra.email') return base;
      return {
        ...base,
        handler: async (input: unknown) => {
          opts.calls.push(String((input as { op?: string }).op ?? 'search'));
          return { ok: true, messages: [message()] };
        },
      };
    }
  }
  const readinessFor = async (p: { owner: string }): Promise<ReadinessContext> => (
    opts.connectedFor.includes(p.owner)
      ? { mail: { state: 'connected', account: 'qa@x.com', scopes: { read: true, draft: false, send: false }, checkedAt: 'T' } }
      : {}
  );
  bindChatCapabilities({
    toolDeps: { registry: new R(), approvals: new ToolApprovalStore(), audit: new ToolAudit(), readinessFor },
    evidence: new MemoryConversationEvidence(),
  });
}

test('🚨 an unbound engine has no capabilities in chat, and says so by returning null', async () => {
  bindChatCapabilities(null);
  const result = await runChatCapabilities({
    prompt: 'search my inbox for the September invoice',
    scope: ALICE, conversationId: 'c1', turnId: 't1', requestId: 'r1',
  });

  /*
   * Null, not an empty result. "No capabilities are wired" and "capabilities
   * are wired and none applied" are different facts, and the route that reads
   * this is not the only thing that will ever read it.
   */
  assert.equal(result, null);
});

test('🚨 a mailbox request in NORMAL CHAT reaches the capability and returns its evidence', async () => {
  const calls: string[] = [];
  install({ connectedFor: [ALICE.owner], calls });

  const result = await runChatCapabilities({
    prompt: 'search my inbox for the September invoice',
    scope: ALICE, conversationId: 'c1', turnId: 't1', requestId: 'r1',
  });

  assert.ok(result, 'chat produced no capability turn at all');
  assert.deepEqual(calls, ['search'], 'the mailbox was never read');
  assert.equal(result!.turn.ledger.isEmpty(), false, 'nothing was retrieved');

  // 🚨 And the repository is not planned, so the model is not handed source
  // files to answer a mailbox question from instead.
  assert.equal(result!.turn.repoPlanning, false);
});

test('🚨 the evidence reaches the model WITH its own value, quotable exactly', async () => {
  install({ connectedFor: [ALICE.owner], calls: [] });
  const result = await runChatCapabilities({
    prompt: 'search my inbox for the September invoice',
    scope: ALICE, conversationId: 'c1', turnId: 't1', requestId: 'r1',
  });

  const context = capabilityContext(result!);
  assert.match(context, /48273\.55/, 'the retrieved text never reached the context');
  assert.match(context, /billing@hetzner\.com/, 'the attribution was dropped');
  // A search returns previews, and an answer drawn from one has to say so.
  assert.match(context, /NOTE: .*previews/i);
});

test('🚨 a DISCONNECTED principal reaches no mailbox and the model is told, not left to guess', async () => {
  const calls: string[] = [];
  install({ connectedFor: [], calls });

  const result = await runChatCapabilities({
    prompt: 'search my inbox for the September invoice',
    scope: ALICE, conversationId: 'c1', turnId: 't1', requestId: 'r1',
  });

  assert.deepEqual(calls, [], 'a disconnected principal reached the mailbox');
  const context = capabilityContext(result!);
  /*
   * 🚨 SILENCE IS THE DANGEROUS OUTCOME. Told nothing, the model fills the gap
   * from its own knowledge and writes a confident paragraph about an inbox
   * nobody opened.
   */
  assert.notEqual(context, '', 'the model was told nothing about the unavailable source');
  // The ENGINE's own words, from the registry — not a sentence this layer wrote.
  assert.match(context, /Email is not available for this user/);
  assert.match(context, /not set up yet/);
  /*
   * 🚨 AND NO PROVIDER. Infrastructure describing itself to a user is a defect
   * this codebase has shipped once already; "Gmail" is the engine's business,
   * not the user's.
   */
  assert.equal(/gmail|google|oauth|imap/i.test(context), false, 'a provider named itself to the user');
});

test('🚨 an UNIDENTIFIED request is told nothing about anyone\'s accounts', async () => {
  const calls: string[] = [];
  install({ connectedFor: [], calls });

  const result = await runChatCapabilities({
    prompt: 'search my inbox for the September invoice',
    scope: { owner: '', workspace: '' },
    conversationId: 'c1', turnId: 't1', requestId: 'r1',
  });

  /*
   * 🚨 THE SAME REJECTION, A DIFFERENT DISCLOSURE. An identified user learns
   * their mailbox is not connected; an unidentified request must not learn
   * whether one exists — the two rejections are deliberately
   * indistinguishable from the outside, and the visible-state fix above must
   * not undo that.
   */
  assert.deepEqual(result!.unavailable, []);
  assert.equal(capabilityContext(result!), '');
});

test('🚨 a repository question keeps repository planning and touches no mailbox', async () => {
  const calls: string[] = [];
  install({ connectedFor: [ALICE.owner], calls });

  const result = await runChatCapabilities({
    prompt: 'where is the rate limiter implemented in this repo?',
    scope: ALICE, conversationId: 'c1', turnId: 't1', requestId: 'r1',
  });

  assert.deepEqual(calls, []);
  assert.equal(result!.turn.repoPlanning, true, 'a repository question stopped planning repository evidence');
  assert.equal(capabilityContext(result!), '', 'an untouched capability contributed context anyway');
});

test('🚨 an unusable scope executes NOTHING', async () => {
  const calls: string[] = [];
  install({ connectedFor: [ALICE.owner], calls });

  const result = await runChatCapabilities({
    prompt: 'search my inbox for the September invoice',
    scope: { owner: '', workspace: '' },
    conversationId: 'c1', turnId: 't1', requestId: 'r1',
  });

  /*
   * An identity assembled from a blank is not a weaker identity — it is a
   * different principal, and a mailbox read under one is a cross-tenant read
   * with extra steps.
   */
  assert.deepEqual(calls, [], 'a blank scope reached a mailbox');
  assert.deepEqual(result!.turn.executed, []);
});

test('🚨 "that email" in a LATER chat turn resolves against the same conversation', async () => {
  const calls: string[] = [];
  install({ connectedFor: [ALICE.owner], calls });

  await runChatCapabilities({
    prompt: 'search my inbox for the September invoice',
    scope: ALICE, conversationId: 'c-9', turnId: 't1', requestId: 'r1',
  });
  const second = await runChatCapabilities({
    prompt: 'summarize that email',
    scope: ALICE, conversationId: 'c-9', turnId: 't2', requestId: 'r2',
  });

  /*
   * 🚨 RE-EXECUTED, NOT REPLAYED. The stored id says what was shown, never that
   * it may still be seen — so the second turn goes back through the capability.
   * A summary request reaches the capability's own grounded summariser.
   */
  assert.deepEqual(calls, ['search', 'summarize']);
  assert.equal(second!.turn.reference?.kind, 'email');
});

test('🚨 no internal evidence id reaches the context the model reads', async () => {
  /*
   * 🚨 REGRESSION FROM A LIVE ANSWER. Items were labelled `[email_1]` and the
   * model wrote "I've retrieved the message from [email_1]…" to the user. This
   * route has no verifier downstream to rewrite citations out of prose, so
   * anything put in front of the model can appear verbatim in the answer.
   */
  install({ connectedFor: [ALICE.owner], calls: [] });
  const result = await runChatCapabilities({
    prompt: 'search my inbox for the September invoice',
    scope: ALICE, conversationId: 'c1', turnId: 't1', requestId: 'r1',
  });

  const context = capabilityContext(result!);
  const id = result!.turn.ledger.all()[0]!.id;
  assert.ok(id.length > 0);
  assert.equal(context.includes(id), false, `the internal id ${id} was handed to the model`);
  // The citation a reader can actually use is still there.
  assert.match(context, /message "Invoice 2026-09" from billing@hetzner\.com/);
});
