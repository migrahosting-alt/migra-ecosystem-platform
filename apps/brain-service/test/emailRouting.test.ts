/**
 * ROUTING A SENTENCE TO A CAPABILITY — never to a provider.
 *
 * The shortcut is always tempting because it is shorter: read the mail here,
 * skip the capability. It is also how a mailbox gets read by code that never
 * asked whose it was — bypassing the availability gate, the scope check and the
 * per-caller resolution in one step.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EMAIL_CAPABILITY, routeEmail } from '../src/engine/email/emailRouting.js';

/* ------------------------------------------------------------------ *
 * 🚨 It cannot read mail
 * ------------------------------------------------------------------ */

test('🚨 the router cannot reach a provider, a store or a principal', async () => {
  /*
   * Asserted against the SOURCE because the guarantee is the absence of a
   * capability, and absence has no runtime behaviour to observe. Comments are
   * stripped first — a guard that matches its own documentation has caught
   * itself in this codebase before.
   */
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const source = readFileSync(join(process.cwd(), 'src/engine/email/emailRouting.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  for (const forbidden of [
    'mailProviderFor', 'executeEmail', 'GmailProvider', 'MailConnectionStore',
    'resolveForCaller', 'principal', 'accessToken',
  ]) {
    assert.ok(!code.includes(forbidden), `the router can reach a mailbox directly: ${forbidden}`);
  }
});

test('🚨 an invocation carries NO identity', () => {
  /*
   * The principal is attached by the executor from the request's own identity.
   * A routing decision that could name a mailbox would let a prompt choose one.
   */
  const route = routeEmail({ prompt: 'find the email from Hetzner about the server' });
  assert.equal(route.kind, 'capability');
  if (route.kind !== 'capability') return;

  const keys = Object.keys(route.input);
  for (const forbidden of ['owner', 'workspace', 'principal', 'account', 'providerAccountId', 'accessToken']) {
    assert.ok(!keys.includes(forbidden), `a routed invocation named ${forbidden}`);
  }
  assert.equal(route.tool, EMAIL_CAPABILITY);
});

/* ------------------------------------------------------------------ *
 * What routes, and what does not
 * ------------------------------------------------------------------ */

test('🚨 a bare mention of a mailbox is NOT an intent', () => {
  /*
   * The exact prompt that once routed into a mailbox search: a noun was
   * present, no action was requested, and the router opened someone's mail to
   * answer a geography question.
   */
  const route = routeEmail({ prompt: 'My inbox is a disaster, anyway — what is the capital of Peru?' });
  assert.equal(route.kind, 'not_email', 'a geography question opened a mailbox');
});

test('an explicit search routes to the capability', () => {
  const route = routeEmail({ prompt: 'search my email for the Hetzner invoice' });
  assert.equal(route.kind, 'capability');
  if (route.kind === 'capability') {
    assert.equal(route.input.op, 'search');
    assert.equal(route.tool, EMAIL_CAPABILITY);
  }
});

test('🚨 the prompt is NOT parsed into structured criteria', () => {
  /*
   * A router that guessed `from:` out of prose would quietly narrow a search
   * and then report "no messages" for mail that exists. The provider's own
   * query language is a better guesser than a regex here.
   */
  const route = routeEmail({ prompt: 'find emails from hetzner about the server last week' });
  assert.equal(route.kind, 'capability');
  if (route.kind === 'capability') {
    assert.equal(route.input.from, undefined, 'the router invented a sender filter');
    assert.equal(route.input.after, undefined, 'the router invented a date filter');
    assert.equal(route.input.keywords, 'find emails from hetzner about the server last week');
  }
});

test('🚨 summarising WITH a thread open reads that thread', () => {
  const route = routeEmail({ prompt: 'summarise this thread', hasOpenThread: true, openThreadId: 'thread-9' });
  assert.equal(route.kind, 'capability');
  if (route.kind === 'capability') {
    assert.equal(route.input.op, 'readThread');
    assert.equal(route.input.threadId, 'thread-9');
  }
});

test('🚨 summarising with NO thread open does not invent one', () => {
  /*
   * Picking a plausible candidate would summarise a message the user never
   * named — and they would have no way to tell which.
   */
  const route = routeEmail({ prompt: 'Summarize my unread emails from today' });
  assert.equal(route.kind, 'capability');
  if (route.kind === 'capability') {
    assert.equal(route.input.op, 'search', 'a thread was invented for a summary');
    assert.equal(route.input.threadId, undefined);
  }
});

/* ------------------------------------------------------------------ *
 * 🚨 Writing is not routed
 * ------------------------------------------------------------------ */

test('🚨 writing routes as MAIL and needs an authority — it is not reclassified', () => {
  /*
   * Calling this `no_email` would be a wrong classification that happens to be
   * safe: the user asked to send mail, and answering as ordinary chat leaves
   * them believing the product did not understand them rather than that
   * sending is not authorised. Different facts; only one is true.
   */
  for (const [prompt, needed] of [
    ['reply to that email and tell them yes', 'draft'],
    ['go ahead and send it', 'send'],
    ['send an email to billing@hetzner.com', 'send'],
    ['Send an email to the team about the outage', 'send'],
  ] as const) {
    const route = routeEmail({ prompt });
    assert.equal(route.kind, 'requires_scope', `"${prompt}" was not routed as a mail request`);
    if (route.kind === 'requires_scope') {
      assert.equal(route.needed, needed, `"${prompt}" asked for the wrong authority`);
      assert.equal(route.tool, EMAIL_CAPABILITY);
    }
  }
});

test('a scope-needing route is distinct from "not about email"', () => {
  // One says "that needs an authority you do not hold", the other says "that
  // was not a mail request at all". Collapsing them loses the user's question.
  const write = routeEmail({ prompt: 'Draft a reply to John' });
  const chat = routeEmail({ prompt: 'what is the capital of Peru?' });
  assert.notEqual(write.kind, chat.kind);
});

test('every route carries the plan that produced it', () => {
  // The trace has to be able to say WHY a turn opened a mailbox — or did not.
  for (const prompt of ['search my email for x', 'what is 2 + 2', 'send an email to a@b.com']) {
    const route = routeEmail({ prompt });
    assert.ok(route.plan.reason, `a route carried no reason: ${prompt}`);
    assert.ok(route.plan.explanation, `a route carried no explanation: ${prompt}`);
  }
});

/* ------------------------------------------------------------------ *
 * 🚨 The two gaps that were pinned as known — now CLOSED
 * ------------------------------------------------------------------ */

test('🚨 "summarise the emails about X" now routes to the mailbox', () => {
  /*
   * Previously `no_email`: the summarise branch required a thread, a
   * mailbox-state word or a search verb, and "the emails about X" had none. It
   * failed closed, which was safe and still wrong — the user pointed at their
   * mailbox and was answered as if they had not.
   */
  const route = routeEmail({ prompt: 'summarise the emails about the invoice' });
  assert.equal(route.kind, 'capability');
  if (route.kind === 'capability') assert.equal(route.input.op, 'search');
});

test('🚨 "send an email to X" now routes as mail needing send authority', () => {
  const route = routeEmail({ prompt: 'send an email to billing@hetzner.com' });
  assert.equal(route.kind, 'requires_scope');
  if (route.kind === 'requires_scope') assert.equal(route.needed, 'send');
});

test('🚨 THE NEGATIVE CONTROLS SURVIVED THE WIDENING', () => {
  /*
   * The whole risk of widening a router is that it starts opening mail on
   * sentences that merely CONTAIN the words. These are the cases that must
   * still not reach a mailbox — including the one that produced the original
   * defect.
   */
  const mustNotOpenMail = [
    'My inbox is a disaster, anyway — what is the capital of Peru?',
    // Contains "email" as a topic word, with no mailbox being pointed at.
    'Summarize what you know about email marketing',
    'Rewrite this email to be shorter',
    'What is email?',
    'Explain how a hash map works',
  ];
  for (const prompt of mustNotOpenMail) {
    assert.equal(routeEmail({ prompt }).kind, 'not_email', `"${prompt}" opened a mailbox`);
  }
});

test('🚨 the determiner is what separates pointing at a mailbox from naming one', () => {
  /*
   * "the emails" points at a mailbox; "email marketing" merely contains the
   * noun. A bare noun list cannot tell them apart, and that is precisely the
   * over-match this codebase was burned by before.
   */
  assert.equal(routeEmail({ prompt: 'summarise the emails about the invoice' }).kind, 'capability');
  assert.equal(routeEmail({ prompt: 'summarise email best practices' }).kind, 'not_email');
});

/* ------------------------------------------------------------------ *
 * 🚨 Refusing on authority, not on a sentence
 * ------------------------------------------------------------------ */

const connection = (over: Partial<import('../src/engine/email/types.js').EmailConnection> = {}) => ({
  state: 'connected' as const,
  account: 'qa@example.com',
  scopes: { read: true, draft: false, send: false },
  checkedAt: '2026-09-09T00:00:00Z',
  ...over,
});

test('🚨 the send refusal DISAPPEARS the moment send scope is held', async () => {
  /*
   * 🚨 THE POINT OF DERIVING IT. A constant saying "sending is not available
   * yet" is a claim about the product that silently becomes false the day the
   * scope is granted — and nothing would fail to tell anyone. Reading the
   * authorization state means the refusal removes itself.
   */
  const { scopeRefusal } = await import('../src/engine/email/emailRouting.js');

  const readOnly = scopeRefusal('send', connection());
  assert.equal(readOnly.permitted, false);
  if (!readOnly.permitted) assert.match(readOnly.reason, /not authorised to send/i);

  const withSend = scopeRefusal('send', connection({ scopes: { read: true, draft: false, send: true } }));
  assert.equal(withSend.permitted, true, 'a granted scope was still refused by a hardcoded sentence');
});

test('🚨 an UNCONNECTED mailbox is not a missing scope', async () => {
  /*
   * Telling someone "not authorised to send" when they have not connected
   * anything sends them looking for a permission screen that does not apply to
   * them. Connect first, scope second — the order is the message.
   */
  const { scopeRefusal } = await import('../src/engine/email/emailRouting.js');
  const verdict = scopeRefusal('send', connection({ state: 'not_connected' }));
  assert.equal(verdict.permitted, false);
  if (!verdict.permitted) {
    assert.doesNotMatch(verdict.reason, /not authorised to send/i, 'a scope message was shown to an unconnected user');
    assert.equal(verdict.remedy, 'connect-account');
  }
});

test('an expired grant asks to reconnect, not to widen scope', async () => {
  const { scopeRefusal } = await import('../src/engine/email/emailRouting.js');
  const verdict = scopeRefusal('send', connection({ state: 'authorization_expired' }));
  assert.equal(verdict.permitted, false);
  if (!verdict.permitted) assert.equal(verdict.remedy, 'reconnect-account');
});

test('an unconfigured deployment offers no remedy for a scope either', async () => {
  const { scopeRefusal } = await import('../src/engine/email/emailRouting.js');
  const verdict = scopeRefusal('send', null);
  assert.equal(verdict.permitted, false);
  if (!verdict.permitted) assert.equal(verdict.remedy, undefined, 'an operator fault offered the user a button');
});

test('draft and send are refused with DIFFERENT words', async () => {
  // They are different authorities. One message for both would tell a user
  // their draft failed because sending is unavailable.
  const { scopeRefusal } = await import('../src/engine/email/emailRouting.js');
  const send = scopeRefusal('send', connection());
  const draft = scopeRefusal('draft', connection());
  assert.equal(send.permitted, false);
  assert.equal(draft.permitted, false);
  if (!send.permitted && !draft.permitted) assert.notEqual(send.reason, draft.reason);
});

test('🚨 no refusal names a provider or an OAuth concept', async () => {
  const { scopeRefusal } = await import('../src/engine/email/emailRouting.js');
  for (const state of ['connected', 'not_connected', 'authorization_expired', 'provider_unavailable'] as const) {
    const verdict = scopeRefusal('send', connection({ state }));
    if (!verdict.permitted) {
      assert.ok(!/google|gmail|oauth|token|gmail\.send/i.test(verdict.reason),
        `machinery leaked into a refusal: ${verdict.reason}`);
    }
  }
});
