/**
 * SEARCH ROUTING — conservative, deterministic, and explainable.
 *
 * The expensive mistake is not failing to search. It is searching when the
 * user already supplied the material: someone who uploads a spreadsheet and
 * asks about a column is not asking about the internet, and answering them
 * from a web page they never chose produces something that looks authoritative
 * and is about the wrong thing.
 *
 * That asymmetry is why the default is not to search, and why these tests
 * spend more effort on the negatives than the positives.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { planSearch } from '../src/engine/search/plan.js';

const decide = (prompt: string, attachments?: string[]) =>
  planSearch({ prompt, ...(attachments ? { attachments } : {}) });

/* ------------------------------------------------------------------ *
 * Positive: the web is genuinely needed
 * ------------------------------------------------------------------ */

test('an explicit instruction to search is honoured', () => {
  for (const prompt of [
    'Search the web for the latest RTX 5090 prices',
    'search online for OpenAI news',
    'Can you google it for me?',
    'Do a web search on self-hosted vector databases',
  ]) {
    const plan = decide(prompt);
    assert.equal(plan.decision, 'search_required', `not routed: ${prompt}`);
    assert.equal(plan.reason, 'explicit_request');
  }
});

test('freshness language requires the web', () => {
  // A model's training data cannot be current by construction.
  for (const prompt of [
    'What is the latest version of Node?',
    'What are the most recent changes to the tax rules?',
    'What is happening in Haiti right now',
  ]) {
    assert.equal(decide(prompt).decision, 'search_required', `not routed: ${prompt}`);
  }
});

test('current prices and availability require the web', () => {
  for (const prompt of ['How much is an RTX 5090?', 'Is the RTX 5090 in stock anywhere?', 'What is the price of a Framework laptop']) {
    assert.equal(decide(prompt).decision, 'search_required', `not routed: ${prompt}`);
  }
});

test('news intent requires the web', () => {
  assert.equal(decide('What did OpenAI announce this week').decision, 'search_required');
});

/* ------------------------------------------------------------------ *
 * 🚨 Negative: the expensive mistakes
 * ------------------------------------------------------------------ */

test('🚨 an uploaded-file question is NEVER routed to the web', () => {
  /*
   * The case that matters most. The user chose the source; answering from a
   * web page instead answers a question nobody asked, with authority.
   */
  const plan = decide('What is the total Revenue in this file?', ['matrix_sales.xlsx']);
  assert.equal(plan.decision, 'search_not_needed');
  assert.equal(plan.reason, 'grounded_in_attachment');
});

test('🚨 attachments beat freshness LANGUAGE', () => {
  /*
   * "What is the latest figure in this spreadsheet" contains the strongest
   * positive signal there is and is emphatically not a web question. Checking
   * topical signals before attachments would get this exactly backwards.
   */
  const plan = decide('What is the latest revenue figure in this spreadsheet?', ['q3.xlsx']);
  assert.equal(plan.decision, 'search_not_needed');
  assert.equal(plan.reason, 'grounded_in_attachment');
});

test('🚨 arithmetic never searches', () => {
  for (const prompt of ['17 * 23', 'What is 17 × 23?', '(45 + 5) / 2', 'calculate 1200 * 0.15']) {
    const plan = decide(prompt);
    assert.equal(plan.decision, 'search_not_needed', `routed to the web: ${prompt}`);
    assert.equal(plan.reason, 'arithmetic');
  }
});

test('🚨 rewriting the user’s own text never searches', () => {
  for (const prompt of [
    'Rewrite this paragraph to be shorter',
    'Summarise the following email for me',
    'Translate this to French',
    'Proofread my cover letter',
  ]) {
    const plan = decide(prompt);
    assert.equal(plan.decision, 'search_not_needed', `routed to the web: ${prompt}`);
    assert.equal(plan.reason, 'text_transformation');
  }
});

test('ordinary conversation never searches', () => {
  for (const prompt of ['hi', 'thanks!', 'ok got it']) {
    assert.equal(decide(prompt).decision, 'search_not_needed', `routed: ${prompt}`);
  }
});

test('a question with no freshness need does not search', () => {
  const plan = decide('Explain how a hash map works');
  assert.equal(plan.decision, 'search_not_needed');
  assert.equal(plan.reason, 'no_freshness_need');
});

test('an empty prompt does not search', () => {
  assert.equal(decide('   ').decision, 'search_not_needed');
});

/* ------------------------------------------------------------------ *
 * The middle
 * ------------------------------------------------------------------ */

test('official documentation is OPTIONAL, not required', () => {
  /*
   * Answerable from memory, answered better from the source. Marking it
   * required would spend a provider request on every question that happens to
   * mention documentation.
   */
  const plan = decide('Where are the official docs for the Stripe API?');
  assert.equal(plan.decision, 'search_optional');
  assert.equal(plan.reason, 'official_source_lookup');
});

test('comparative research is OPTIONAL', () => {
  const plan = decide('Compare self-hosted vector databases for enterprise use');
  assert.equal(plan.decision, 'search_optional');
  assert.equal(plan.reason, 'comparative_research');
});

test('the three decisions are genuinely distinct outcomes', () => {
  // Driven through the real planner, not asserted as a literal set.
  const outcomes = new Set([
    decide('Search the web for X').decision,
    decide('Compare A versus B').decision,
    decide('Explain how a hash map works').decision,
  ]);
  assert.equal(outcomes.size, 3, `the planner collapsed decisions: ${[...outcomes].join(', ')}`);
});

/* ------------------------------------------------------------------ *
 * Explainability
 * ------------------------------------------------------------------ */

test('every decision carries a reason code and an explanation', () => {
  for (const prompt of ['Search the web for X', '2+2', 'Rewrite this', 'What is the latest news', 'hi']) {
    const plan = decide(prompt);
    assert.ok(plan.reason.length > 0, `no reason code for: ${prompt}`);
    assert.ok(plan.explanation.length > 0, `no explanation for: ${prompt}`);
  }
});

test('an explicit request still wins when attachments are present', () => {
  /*
   * The one case where attachments do NOT win. A user who says "search the
   * web" while a file is attached has settled the question themselves, and
   * overriding them would be the product deciding it knows better.
   */
  const plan = decide('Search the web for the current market price of these items', ['items.csv']);
  assert.equal(plan.decision, 'search_required');
  assert.equal(plan.reason, 'explicit_request');
});
