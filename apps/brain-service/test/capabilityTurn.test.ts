/**
 * CASE 10, WIRED — a turn persists evidence, the next turn resolves it.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE INVARIANT WITH TEETH
 *
 * A persisted evidence reference is a POINTER, never a PERMISSION. It says what
 * the user was previously shown; it does not say they may still see it.
 *
 * So resolving "that email" must NOT serve the stored text back. It re-executes
 * the read through the capability under the CURRENT identity and CURRENT
 * readiness — which is the only reason a disconnect takes effect between turns.
 * The tempting optimisation ("we already have the body, skip the round trip")
 * silently turns the pointer into a token, and a revoked mailbox keeps
 * answering.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { runCapabilityTurn } from '../src/engine/chat/capabilityTurn.js';
import { MemoryConversationEvidence } from '../src/engine/chat/conversationEvidence.js';
import { executionIdentityFrom } from '../src/engine/identity/executionIdentity.js';
import { CapabilityRegistry, type ReadinessContext } from '../src/engine/models/capabilityRegistry.js';
import { ToolApprovalStore } from '../src/engine/tools/toolApprovalStore.js';
import { ToolAudit } from '../src/engine/tools/toolAudit.js';

const ALICE = { owner: 'user:alice', workspace: 'personal:alice' };
const BOB = { owner: 'user:bob', workspace: 'personal:bob' };
/*
 * 🚨 THE NOUNS BELONG TO THE CAPABILITY, NOT TO CHAT.
 *
 * "summarize the thread" failed to select anything until `thread` was declared
 * here — and the fix belongs in the capability's own vocabulary rather than in
 * the selector, which must stay generic. When this is wired to the real
 * registry, CapabilityDescriptor needs a `nouns` field carrying exactly this.
 */
const MAIL = {
  id: 'migra.email',
  nouns: ['email', 'mail', 'message', 'inbox', 'thread'],
  available: true,
};

const message = (id: string) => ({
  providerMessageId: id, providerThreadId: `t-${id}`,
  from: { address: 'billing@hetzner.com' }, to: [], cc: [],
  subject: `Invoice ${id}`, sentAt: '2026-09-01T10:00:00Z',
  snippet: 'Your September invoice…',
  textBody: `Full body of ${id} totalling 48273.55.`,
  bodyComplete: true, attachmentsKnown: true, attachments: [],
  labels: ['INBOX'], unread: false, retrievedAt: '2026-09-09T00:00:00Z',
});

/** A registry whose email capability records every call it receives. */
function registryFor(opts: { connectedFor: string[]; calls: Array<{ op: string; principal?: string; keywords?: string }> }) {
  class R extends CapabilityRegistry {
    override runnable(id: string) {
      const base = super.runnable(id);
      if (!base || id !== 'migra.email') return base;
      return {
        ...base,
        handler: async (input: unknown, ctx?: { principal?: { owner: string } }) => {
          const req = input as { op?: string; keywords?: string };
          const op = String(req.op ?? 'search');
          opts.calls.push({ op, principal: ctx?.principal?.owner, keywords: req.keywords });
          if (op === 'readMessage') return { ok: true, message: message('pm-1') };
          if (op === 'readThread') {
            return { ok: true, thread: { providerThreadId: 't-pm-1', subject: 'Invoice', messages: [message('pm-1')] } };
          }
          return { ok: true, messages: [message('pm-1')] };
        },
      };
    }
  }
  const readinessFor = async (p: { owner: string }): Promise<ReadinessContext> => (
    opts.connectedFor.includes(p.owner)
      ? { mail: { state: 'connected', account: `${p.owner}@x.com`, scopes: { read: true, draft: false, send: false }, checkedAt: 'T' } }
      : {}
  );
  return {
    toolDeps: { registry: new R(), approvals: new ToolApprovalStore(), audit: new ToolAudit(), readinessFor },
  };
}

const deps = (o: { connectedFor: string[]; calls: Array<{ op: string; principal?: string; keywords?: string }>; store?: MemoryConversationEvidence }) => ({
  ...registryFor(o),
  capabilities: [MAIL],
  evidence: o.store ?? new MemoryConversationEvidence(),
});

/* ------------------------------------------------------------------ *
 * 🚨 A turn persists scoped evidence
 * ------------------------------------------------------------------ */

test('🚨 10a. a real turn retrieves evidence and PERSISTS it, scoped', async () => {
  const calls: Array<{ op: string; principal?: string }> = [];
  const store = new MemoryConversationEvidence();
  const d = deps({ connectedFor: [ALICE.owner], calls, store });

  const result = await runCapabilityTurn({
    prompt: 'find the email containing MIGRA_EMAIL_SENTINEL_0909',
    identity: executionIdentityFrom(ALICE),
    conversationId: 'c1', turnId: 'turn-1', requestId: 'r1',
  }, d);

  assert.equal(result.plan.selected.length, 1, 'the mailbox capability was not selected');
  assert.equal(result.repoPlanning, false, 'repository planning ran for a mailbox request');
  assert.equal(result.ledger.isEmpty(), false, 'no evidence was produced');
  /*
   * 🚨 THE FIRST CALL IS THE SEARCH, and every call runs as Alice. The exact
   * sequence is deliberately NOT pinned here: this prompt names a term the
   * fixture message does not contain, so the provider-match bridge correctly
   * reads further to find out where it is. That behaviour has its own suite;
   * pinning it here would make this test fail for a reason it is not about.
   */
  assert.equal(calls[0]!.op, 'search');
  assert.ok(calls.every((c) => c.principal === ALICE.owner), 'a capability ran as someone else');

  // Persisted for the NEXT turn, under Alice's scope.
  assert.equal((await store.recent('c1', { principalId: ALICE.owner, workspaceId: ALICE.workspace }, 10)).length, 1);
});

/* ------------------------------------------------------------------ *
 * 🚨 The next turn resolves the reference — by RE-EXECUTING
 * ------------------------------------------------------------------ */

test('🚨 10b. "summarize that email" resolves the antecedent and RE-READS it', async () => {
  const calls: Array<{ op: string; principal?: string }> = [];
  const store = new MemoryConversationEvidence();
  const d = deps({ connectedFor: [ALICE.owner], calls, store });
  const identity = executionIdentityFrom(ALICE);

  await runCapabilityTurn({ prompt: 'find the email about invoice pm-1', identity, conversationId: 'c1', turnId: 't1', requestId: 'r1' }, d);
  const second = await runCapabilityTurn({ prompt: 'summarize that email', identity, conversationId: 'c1', turnId: 't2', requestId: 'r2' }, d);

  assert.ok(second.reference, 'the antecedent did not resolve');
  assert.equal(second.reference!.item.locator.providerMessageId, 'pm-1');

  /*
   * 🚨 THE POINT. The second turn issued a readMessage — it did not serve the
   * stored body. A pointer is not a permission.
   */
  assert.deepEqual(calls.map((c) => c.op), ['search', 'readMessage']);
});

test('"summarize the thread" re-reads the THREAD, not the message', async () => {
  const calls: Array<{ op: string; principal?: string }> = [];
  const store = new MemoryConversationEvidence();
  const d = deps({ connectedFor: [ALICE.owner], calls, store });
  const identity = executionIdentityFrom(ALICE);

  await runCapabilityTurn({ prompt: 'find the email about invoice pm-1', identity, conversationId: 'c1', turnId: 't1', requestId: 'r1' }, d);
  await runCapabilityTurn({ prompt: 'summarize the thread', identity, conversationId: 'c1', turnId: 't2', requestId: 'r2' }, d);
  assert.deepEqual(calls.map((c) => c.op), ['search', 'readThread']);
});

/* ------------------------------------------------------------------ *
 * 🚨 Disconnect BETWEEN turns invalidates access
 * ------------------------------------------------------------------ */

test('🚨 10c. a disconnect between turns makes the reference FAIL, not replay', async () => {
  /*
   * The stored evidence still exists and still names a real message. If the
   * turn served that text back, a revoked mailbox would keep answering — which
   * is exactly what disconnecting is for.
   */
  const calls: Array<{ op: string; principal?: string }> = [];
  const store = new MemoryConversationEvidence();
  const identity = executionIdentityFrom(ALICE);

  const connected = deps({ connectedFor: [ALICE.owner], calls, store });
  const first = await runCapabilityTurn({ prompt: 'find the email about invoice pm-1', identity, conversationId: 'c1', turnId: 't1', requestId: 'r1' }, connected);
  assert.equal(first.ledger.isEmpty(), false);

  // Same conversation, same stored evidence — but the mailbox is now gone.
  const disconnected = deps({ connectedFor: [], calls, store });
  const second = await runCapabilityTurn({ prompt: 'summarize that email', identity, conversationId: 'c1', turnId: 't2', requestId: 'r2' }, disconnected);

  assert.ok(second.reference, 'the antecedent should still resolve — it is a pointer');
  assert.equal(second.ledger.isEmpty(), true, 'a disconnected mailbox still produced evidence');
  assert.equal(second.executed[0]?.ok, false, 'the re-read was not refused');
  assert.ok(!JSON.stringify(second.ledger.all()).includes('48273.55'), 'stored body text was served after disconnect');
});

/* ------------------------------------------------------------------ *
 * 🚨 Another principal cannot resolve the antecedent
 * ------------------------------------------------------------------ */

test('🚨 10d. another principal in the same conversation resolves NOTHING', async () => {
  const calls: Array<{ op: string; principal?: string }> = [];
  const store = new MemoryConversationEvidence();
  const d = deps({ connectedFor: [ALICE.owner, BOB.owner], calls, store });

  await runCapabilityTurn({
    prompt: 'find the email about invoice pm-1', identity: executionIdentityFrom(ALICE),
    conversationId: 'c1', turnId: 't1', requestId: 'r1',
  }, d);

  const bob = await runCapabilityTurn({
    prompt: 'summarize that email', identity: executionIdentityFrom(BOB),
    conversationId: 'c1', turnId: 't2', requestId: 'r2',
  }, d);

  assert.equal(bob.reference, null, 'another principal resolved someone else\'s antecedent');

  /*
   * 🚨 AND IT DOES NOT BECOME A SEARCH.
   *
   * "Could not reuse prior evidence" and "you asked me to search your mailbox"
   * are different answers. Letting the first fall through to the second means a
   * failed cross-scope resolution quietly authorises reading a DIFFERENT
   * mailbox — which is not what Bob asked for and not what Alice's turn implied.
   */
  assert.equal(calls.length, 1, 'a failed cross-scope reference triggered a mailbox search');
  assert.equal(calls[0]!.principal, ALICE.owner, 'only Alice\'s original turn should have executed');
  assert.deepEqual(bob.executed, []);
  assert.equal(bob.unresolvedReference?.phrase, 'that email');
  /*
   * 🚨 AND HE IS TOLD NOTHING ABOUT WHY. The store scopes its reads, so this
   * layer never sees Alice's turns at all — reporting "belongs to someone else"
   * would tell Bob that Alice has evidence in a conversation they share. Not
   * knowing is the correct amount to know.
   */
  assert.deepEqual(Object.keys(bob.unresolvedReference!), ['phrase']);
});

test('🚨 a backward reference with NO history at all also refuses to search', () => {
  // Same rule, different cause: the user believes we are already looking at
  // something. Searching would answer a question they did not ask.
  return (async () => {
    const calls: Array<{ op: string; principal?: string }> = [];
    const d = deps({ connectedFor: [ALICE.owner], calls });
    const result = await runCapabilityTurn({
      prompt: 'summarize that email', identity: executionIdentityFrom(ALICE),
      conversationId: 'fresh', turnId: 't1', requestId: 'r1',
    }, d);

    assert.equal(calls.length, 0, 'an unresolvable reference searched the mailbox');
    assert.equal(result.unresolvedReference?.phrase, 'that email');
    assert.equal(result.ledger.isEmpty(), true);
  })();
});

/* ------------------------------------------------------------------ *
 * 🚨 Fail closed, and stay capability-generic
 * ------------------------------------------------------------------ */

test('🚨 an unidentified turn executes NOTHING and persists nothing', async () => {
  const calls: Array<{ op: string; principal?: string }> = [];
  const store = new MemoryConversationEvidence();
  const d = deps({ connectedFor: [ALICE.owner], calls, store });

  const result = await runCapabilityTurn({
    prompt: 'find the email containing MIGRA_EMAIL_SENTINEL_0909',
    identity: null, conversationId: 'c1', turnId: 't1', requestId: 'r1',
  }, d);

  assert.equal(result.executed.length, 0);
  assert.equal(calls.length, 0, 'a capability ran without an identity');
  assert.equal(result.ledger.isEmpty(), true);
  assert.equal((await store.recent('c1', { principalId: 'user:alice', workspaceId: 'personal:alice' }, 10)).length, 0);
});

test('🚨 a repository question does not touch the mailbox and keeps repo planning', async () => {
  const calls: Array<{ op: string; principal?: string }> = [];
  const d = deps({ connectedFor: [ALICE.owner], calls });
  const result = await runCapabilityTurn({
    prompt: 'where is the email validator implemented?',
    identity: executionIdentityFrom(ALICE), conversationId: 'c1', turnId: 't1', requestId: 'r1',
  }, d);

  assert.equal(result.plan.selected.length, 0, 'a code question opened the mailbox');
  assert.equal(calls.length, 0);
  assert.equal(result.repoPlanning, true);
});

test('🚨 the orchestrator names no capability', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const source = readFileSync(join(process.cwd(), 'src/engine/chat/capabilityTurn.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const named of ['migra.email', 'gmail', 'Gmail']) {
    assert.ok(!code.includes(named), `the orchestrator hardcodes ${named}`);
  }
});

/* ------------------------------------------------------------------ *
 * 🚨 The query is the request, not the sentence
 * ------------------------------------------------------------------ */

test('🚨 the search terms drop the ASKING and keep the SUBJECT', async () => {
  /*
   * 🚨 REGRESSION FROM A LIVE FAILURE. The first version sent `prompt` straight
   * through. Against the real mailbox `"test file"` returned the message and
   * "search my inbox for the message about the test file" returned nothing —
   * a provider ANDs its terms, so every word of the asking became a word the
   * message had to contain.
   *
   * It is invisible from inside: the search succeeds, the count is zero, and
   * "nothing was found" reads exactly like an empty mailbox.
   */
  const calls: Array<{ op: string; principal?: string; keywords?: string }> = [];
  const d = deps({ connectedFor: [ALICE.owner], calls });

  await runCapabilityTurn({
    prompt: 'search my inbox for the message about the test file',
    identity: executionIdentityFrom(ALICE),
    conversationId: 'c1', turnId: 'turn-1', requestId: 'r1',
  }, d);

  assert.equal(calls[0]!.keywords, 'test file',
    'the words of the asking reached the provider as words the mail had to contain');
});

test('a prompt that is ONLY asking still searches for something', async () => {
  // "show me my email" has no subject left after the verbs and the owned
  // nouns are removed. Sending an empty query would list the whole mailbox as
  // though it had been searched for; the prompt goes through unchanged instead.
  const calls: Array<{ op: string; principal?: string; keywords?: string }> = [];
  const d = deps({ connectedFor: [ALICE.owner], calls });

  await runCapabilityTurn({
    prompt: 'show me my email',
    identity: executionIdentityFrom(ALICE),
    conversationId: 'c1', turnId: 'turn-1', requestId: 'r1',
  }, d);

  assert.equal(calls[0]!.keywords, 'show me my email');
});

/* ------------------------------------------------------------------ *
 * 🚨 A bare pronoun points where the sentence points
 * ------------------------------------------------------------------ */

test('🚨 "tell me who sent it" on a FRESH request searches — it does not refuse', async () => {
  /*
   * 🚨 REGRESSION FROM A LIVE FAILURE. `it` was a backward reference outright,
   * so this exact question came back as "please clarify what you mean by it" —
   * for an ordinary request that names its own subject. The trailing pronoun
   * points at what the turn is ABOUT TO FIND.
   */
  const calls: Array<{ op: string; principal?: string; keywords?: string }> = [];
  const d = deps({ connectedFor: [ALICE.owner], calls });

  const result = await runCapabilityTurn({
    prompt: 'search my inbox for the message about the test file and tell me who sent it',
    identity: executionIdentityFrom(ALICE),
    conversationId: 'c1', turnId: 'turn-1', requestId: 'r1',
  }, d);

  assert.equal(result.unresolvedReference, null, 'a fresh request was read as pointing backward');
  // It SEARCHED — which is the point — with the asking stripped out of the query.
  assert.equal(calls[0]!.op, 'search');
  assert.equal(calls[0]!.keywords, 'test file');
});

test('🚨 "summarize it" with NOTHING else in the sentence still points backward', async () => {
  // The pronoun is the only subject there is, so it must mean the last turn's —
  // and with nothing to point at, the turn asks rather than searching.
  const calls: Array<{ op: string; principal?: string; keywords?: string }> = [];
  const d = deps({ connectedFor: [ALICE.owner], calls });

  const result = await runCapabilityTurn({
    prompt: 'summarize it',
    identity: executionIdentityFrom(ALICE),
    conversationId: 'c-empty', turnId: 'turn-1', requestId: 'r1',
  }, d);

  assert.equal(result.unresolvedReference?.phrase, 'it');
  assert.deepEqual(calls, [], 'a failed reference became a mailbox search');
});

test('a subject-only prompt is not mistaken for a prompt with no subject', async () => {
  // "test file" filters down to exactly itself. Deciding "has a subject" by
  // comparing the filtered query to the prompt would call this one subjectless.
  const calls: Array<{ op: string; principal?: string; keywords?: string }> = [];
  const d = deps({ connectedFor: [ALICE.owner], calls });

  await runCapabilityTurn({
    prompt: 'search email for test file',
    identity: executionIdentityFrom(ALICE),
    conversationId: 'c1', turnId: 'turn-1', requestId: 'r1',
  }, d);

  assert.equal(calls[0]!.keywords, 'test file');
});
