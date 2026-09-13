/**
 * The harness is a system under test.
 *
 * Every case below is a REAL transcript shape from the 2026-09-13 candidate
 * audit, including the two that my own scorer got wrong.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  admitsUnknown, answerContains, answerHasNumber, extractJson,
  finalSegment, normaliseAnswer, visibleAnswer,
} from '../src/eval/answerNormalise.js';

test('🚨 THE ONE THAT WAS SCORED WRONG: LaTeX around a correct answer', () => {
  // Verbatim shape from qwen3:8b and qwen3:14b, both marked FAIL by a scorer
  // looking for the contiguous string "36 minute".
  const real = 'Adding the two phases together:\n\n$$\n20 \\text{ minutes} + 16 \\text{ minutes} = \\boxed{36} \\text{ minutes}\n$$\n\n### Final Answer\n\n$$\n\\boxed{36}\n$$';
  assert.equal(answerHasNumber(real, 36), true);
  assert.match(normaliseAnswer(real), /36 minutes/);
  // And the naive check that failed, to show what changed.
  assert.equal(real.includes('36 minute'), false);
});

test('reasoning-only sections are not scored', () => {
  const r = '<think>The answer might be 10 cents.</think> The ball costs $0.05.';
  assert.equal(visibleAnswer(r).includes('10 cents'), false);
  assert.equal(answerContains(r, ['0.05']), true);
});

test('🚨 a wrong number considered on the way does not count as the answer', () => {
  // A reasoning transcript names many candidates. Searching the whole text
  // would credit a model that considered 0.05 and concluded 0.10.
  const r = 'At first 0.05 seems right, but on reflection the ball costs 0.10 dollars. '
          + 'x'.repeat(500) + ' Final answer: 0.10';
  assert.equal(answerContains(r, ['0.05']), false, 'tail-scoped match must not see the discarded candidate');
  assert.equal(answerContains(r, ['0.05'], { whole: true }), true, 'whole-text match still sees it');
});

test('a number must stand as its own token', () => {
  assert.equal(answerHasNumber('the total is 160 litres', 16), false);
  assert.equal(answerHasNumber('the total is 16 litres', 16), true);
  assert.equal(answerHasNumber('3.36 hours', 36), false);
});

test('thousands separators do not change a number', () => {
  assert.match(normaliseAnswer('the count is 1,234'), /1234/);
});

test('markdown emphasis and fences are presentation, not content', () => {
  assert.match(normaliseAnswer('The answer is **09:36** today'), /09:36/);
  assert.equal(answerContains('`09:36`', ['09:36']), true);
});

test('strict JSON survives a fence the model was told not to use', () => {
  const fenced = '```json\n{"answer": 391, "confidence": 0.9}\n```';
  const o = extractJson(fenced) as { answer?: number };
  assert.equal(o?.answer, 391);
  // …and the un-fenced form is still what "strict" means; the caller decides.
  assert.equal((extractJson('{"answer":391,"confidence":1}') as { answer?: number })?.answer, 391);
  assert.equal(extractJson('no json at all'), undefined);
});

test('a hedge followed by an invention is still an invention', () => {
  assert.equal(admitsUnknown("I don't have access to that server."), 'admits');
  assert.equal(admitsUnknown('The approved suite version is 2.1.0.'), 'invents');
  // Two-sided on purpose.
  assert.equal(admitsUnknown("I can't be certain, but it is version 3.4.1."), 'invents');
  assert.equal(admitsUnknown('Blue.'), 'unclear');
});

test('the tail is bounded, so working cannot drown the conclusion', () => {
  const long = 'step '.repeat(300) + 'Final answer: 42';
  assert.ok(finalSegment(long).length <= 400);
  assert.equal(answerHasNumber(long, 42), true);
});
