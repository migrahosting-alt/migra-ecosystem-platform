/**
 * When MigraPilot should go and look.
 *
 * The bar these hold: a stale answer and a current one are indistinguishable to
 * the person asking, so the product decides — not the user, who often does not
 * know the answer has an expiry date.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assessFreshness } from '../src/engine/live/freshness.js';

const NOW = new Date('2026-08-26T00:00:00Z');
const need = (p: string, ctx = {}) => assessFreshness(p, { now: NOW, ...ctx }).need;

test('an explicit request to search outranks everything', () => {
  assert.equal(need('search the web for good pasta recipes'), 'required');
  assert.equal(need('look it up online'), 'required');
  assert.equal(need('answer with sources'), 'required');
});

test('an explicit refusal is honoured', () => {
  // Someone who says "from memory" has told us what they want, and going to the
  // web anyway is not a better answer — it is a different one.
  assert.equal(need('what is the latest react version, from memory'), 'none');
  assert.equal(need("don't search the web, just tell me what you think"), 'none');
});

test('time-anchored questions are searched', () => {
  for (const prompt of [
    'what happened today',
    'what is the news right now',
    'who won the match this week',
    'what is the latest version of node',
    'is that library still supported',
  ]) {
    assert.equal(need(prompt), 'required', prompt);
  }
});

test('volatile subjects with no clock are worth looking at, not required', () => {
  /*
   * "How much is a Tesla" has no time word in it, but the answer rots. Worth a
   * retrieval when one is available; not worth failing the turn over.
   */
  assert.equal(need('how much is a tesla model 3'), 'helpful');
  assert.equal(need('who is the ceo of that company'), 'helpful');
});

test('stable questions are NOT searched', () => {
  /*
   * The expensive mistake in this direction is subtle: a needless retrieval
   * drags the answer toward whatever a search engine returned, which is usually
   * worse than what the model already knew.
   */
  for (const prompt of [
    'explain recursion',
    'how do I write a bash loop',
    'what is the capital of France',
    'translate this to French',
    'what does idempotent mean',
    'refactor this function to be pure',
  ]) {
    assert.equal(need(prompt), 'none', prompt);
  }
});

test('a volatile-sounding word decorating a stable question does not trigger a search', () => {
  // "Latest thinking on recursion" is a teaching question wearing a time word.
  assert.equal(need('explain the latest thinking on recursion'), 'required');
  assert.equal(need('explain recursion'), 'none');
});

test('attached source material wins over a time-flavoured phrase', () => {
  /*
   * "The latest figure in this report" is a question about the report. Going to
   * the web would answer a different question, from a worse source.
   */
  assert.equal(need('what is the latest figure in this report', { hasAttachedContext: true }), 'none');
  assert.equal(need('what is the latest figure', { hasAttachedContext: false }), 'required');
});

test('the current year or later is treated as a question about now', () => {
  assert.equal(need('what are the tax brackets for 2026'), 'required');
  assert.equal(need('what are the tax brackets for 2027'), 'required');
  // History the model may legitimately know.
  assert.equal(need('what were the tax brackets in 2019'), 'none');
});

test('the decision explains itself', () => {
  // A routing record nobody can read back is not a record.
  const d = assessFreshness('what is the latest version of node', { now: NOW });
  assert.equal(d.need, 'required');
  assert.ok(d.reason.length > 0);
  assert.ok(d.evidence && d.evidence.length > 0, 'the matched signal is kept for the trace');
});

test('an empty prompt asks for nothing', () => {
  assert.equal(need('   '), 'none');
});
