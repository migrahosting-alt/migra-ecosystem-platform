/**
 * EMAIL INTENT ROUTING — and the refusal to open a mailbox because a noun appeared.
 *
 * The expensive mistake is not missing an email request. It is reaching into
 * someone's private correspondence because they said the word "email" while
 * asking about something else. That is a privacy failure and a latency cost
 * paid on every casual sentence, so the negatives get more attention here than
 * the positives.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { planEmail } from '../src/engine/email/plan.js';

const route = (prompt: string, over: { attachments?: string[]; hasOpenThread?: boolean } = {}) =>
  planEmail({ prompt, ...over });

/* ------------------------------------------------------------------ *
 * Positive: an action over the mailbox
 * ------------------------------------------------------------------ */

test('explicit search routes to search_read', () => {
  for (const prompt of [
    'Find the email from Hetzner',
    'Search my emails for the contract',
    'Show me emails with attachments from Hetzner',
    'Check my inbox for anything from the accountant',
  ]) {
    assert.equal(route(prompt).intent, 'search_read', `not routed: ${prompt}`);
  }
});

test('a reference to what someone said routes to search_read', () => {
  for (const prompt of ['What did John say about the contract?', 'the email from James about the proposal']) {
    assert.equal(route(prompt).intent, 'search_read', `not routed: ${prompt}`);
  }
});

test('mailbox state routes to search_read', () => {
  assert.equal(route('Show unread emails from today').intent, 'search_read');
});

test('summarising a thread routes to summarize', () => {
  assert.equal(route('Summarize this email thread').intent, 'summarize');
  assert.equal(route('Summarize this conversation').intent, 'summarize');
});

test('summarising the mailbox routes to summarize', () => {
  assert.equal(route('Summarize my unread emails from today').intent, 'summarize');
});

test('drafting routes to draft, never to send', () => {
  /*
   * A draft has no side effect; a send is irreversible. Collapsing them would
   * put the least reversible action in the product behind the loosest
   * classification in it.
   */
  for (const prompt of ['Draft a reply to John', 'Write a response to this', 'Reply to James', 'Forward this to Maria']) {
    assert.equal(route(prompt).intent, 'draft', `${prompt} did not route to draft`);
  }
});

test('sending routes to send', () => {
  for (const prompt of ['Send it', 'Send this reply', 'Go ahead and send']) {
    assert.equal(route(prompt).intent, 'send', `${prompt} did not route to send`);
  }
});

test('🚨 "reply" alone is NEVER a send', () => {
  // The most dangerous possible confusion in this router.
  assert.notEqual(route('Draft a reply to John').intent, 'send');
  assert.notEqual(route('Reply to that message').intent, 'send');
});

/* ------------------------------------------------------------------ *
 * 🚨 Negative: the word is not the intent
 * ------------------------------------------------------------------ */

test('🚨 a question ABOUT email does not open a mailbox', () => {
  for (const prompt of ['What is email?', 'How does email work?', 'Explain SMTP and email routing']) {
    const result = route(prompt);
    assert.equal(result.intent, 'no_email', `${prompt} opened a mailbox`);
    assert.equal(result.reason, 'general_question');
  }
});

test('🚨 rewriting SUPPLIED text does not open a mailbox', () => {
  /*
   * "Rewrite this email for me" is about the words in the prompt. Opening a
   * mailbox to answer it would be useless and intrusive.
   */
  for (const prompt of [
    'Rewrite this email for me',
    'Make this email shorter',
    'Proofread this email',
    'Reword the following message to be more polite',
  ]) {
    const result = route(prompt);
    assert.equal(result.intent, 'no_email', `${prompt} opened a mailbox`);
    assert.equal(result.reason, 'supplied_text_rewrite');
  }
});

test('🚨 an incidental mention does not open a mailbox', () => {
  for (const prompt of [
    'Email is a slow way to run a company',
    'My inbox is a disaster, anyway — what is the capital of Peru?',
  ]) {
    const result = route(prompt);
    assert.equal(result.intent, 'no_email', `${prompt} opened a mailbox`);
    assert.equal(result.reason, 'incidental_mention');
  }
});

test('🚨 an uploaded-file question does not open a mailbox', () => {
  const result = route('Summarize this', { attachments: ['contract.pdf'] });
  assert.equal(result.intent, 'no_email');
  assert.equal(result.reason, 'grounded_in_attachment');
});

test('a web question does not open a mailbox', () => {
  assert.equal(route('Search the web for the latest GPU prices').intent, 'no_email');
});

test('ordinary conversation does not open a mailbox', () => {
  for (const prompt of ['Explain how a hash map works', 'What is 17 times 23?']) {
    assert.equal(route(prompt).intent, 'no_email', `${prompt} opened a mailbox`);
  }
});

/* ------------------------------------------------------------------ *
 * Ordering
 * ------------------------------------------------------------------ */

test('🚨 a mailbox ACTION beats an attached file', () => {
  /*
   * "Find the email with this invoice attached" is about the mailbox even
   * though a file is present. An absolute attachment rule would get this
   * backwards.
   */
  const result = route('Find the email that had this invoice attached', { attachments: ['invoice.pdf'] });
  assert.equal(result.intent, 'search_read');
});

test('an open thread makes "summarize this" about the thread', () => {
  assert.equal(route('Summarize this', { hasOpenThread: true }).intent, 'summarize');
});

test('an attached file with no open thread makes "summarize this" about the file', () => {
  const result = route('Summarize this', { attachments: ['deck.pdf'] });
  assert.equal(result.intent, 'no_email');
});

test('every decision carries a reason code and an explanation', () => {
  for (const prompt of ['Find the email from John', 'Send it', 'What is email?', 'Draft a reply', '2+2']) {
    const result = route(prompt);
    assert.ok(result.reason.length > 0, `no reason for: ${prompt}`);
    assert.ok(result.explanation.length > 0, `no explanation for: ${prompt}`);
  }
});

test('the five intents are genuinely distinct outcomes', () => {
  // Driven through the real router, not asserted as a literal set.
  const seen = new Set([
    route('Find the email from John').intent,
    route('Summarize this email thread').intent,
    route('Draft a reply to John').intent,
    route('Send it').intent,
    route('Explain how a hash map works').intent,
  ]);
  assert.equal(seen.size, 5, `the router collapsed intents: ${[...seen].join(', ')}`);
});
