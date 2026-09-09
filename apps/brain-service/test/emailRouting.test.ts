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

test('🚨 drafting and sending are UNSUPPORTED, not silently answered as chat', () => {
  /*
   * The user asked for something real. Routing it to a capability that must
   * refuse, or letting it fall through to ordinary chat, both end with them
   * believing something happened.
   */
  for (const prompt of ['reply to that email and tell them yes', 'go ahead and send it']) {
    const route = routeEmail({ prompt });
    assert.equal(route.kind, 'unsupported', `"${prompt}" was not refused plainly`);
    if (route.kind === 'unsupported') {
      assert.match(route.reason, /cannot write or send/i);
      assert.ok(!/google|gmail|oauth|scope/i.test(route.reason), 'machinery leaked into a refusal');
    }
  }
});

test('a refusal is distinct from "not about email"', () => {
  // One says "I will not do that yet", the other says "that was not a mail
  // request at all". Collapsing them loses the user's actual question.
  const write = routeEmail({ prompt: 'Draft a reply to John' });
  const chat = routeEmail({ prompt: 'what is the capital of Peru?' });
  assert.notEqual(write.kind, chat.kind);
});

test('every route carries the plan that produced it', () => {
  // The trace has to be able to say WHY a turn opened a mailbox — or did not.
  for (const prompt of ['search my email for x', 'what is 2 + 2', 'go ahead and send it']) {
    const route = routeEmail({ prompt });
    assert.ok(route.plan.reason, `a route carried no reason: ${prompt}`);
    assert.ok(route.plan.explanation, `a route carried no explanation: ${prompt}`);
  }
});

/* ------------------------------------------------------------------ *
 * 🚨 Known planner gaps — recorded, not silently "fixed"
 * ------------------------------------------------------------------ */

test('🚨 two natural phrasings are NOT recognised, and both fail closed', () => {
  /*
   * 🚨 FOUND BY PROBING THE PLANNER RATHER THAN ASSUMING IT.
   *
   * My first fixtures for this file used these phrasings and failed, because
   * the planner classifies both as `no_email`:
   *
   *   "summarise the emails about the invoice"  — SUMMARIZE matches, but the
   *     summarise branch also requires a thread, a mailbox-state word or a
   *     search verb to qualify, and "the emails about X" has none.
   *
   *   "send an email to billing@hetzner.com"    — the SEND pattern matches
   *     "send it" / "send the email", deliberately narrow, and "send AN email"
   *     falls outside it.
   *
   * Both fail CLOSED: no mailbox is opened and nothing is sent — the turn is
   * answered as ordinary chat. That is the safe direction, so the behaviour is
   * pinned here rather than changed. Widening either pattern is a product
   * decision about what a prompt is allowed to trigger, not a routing bug to
   * quietly repair while wiring something else.
   */
  assert.equal(routeEmail({ prompt: 'summarise the emails about the invoice' }).kind, 'not_email');
  assert.equal(routeEmail({ prompt: 'send an email to billing@hetzner.com' }).kind, 'not_email');
});
