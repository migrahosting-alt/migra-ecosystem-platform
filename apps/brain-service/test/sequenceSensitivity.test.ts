/**
 * The note goes only where ordering actually matters.
 *
 * Warning on every question would train the user to ignore the warning, and
 * would make a fully usable document sound unreliable when only one capability
 * is limited.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifySequenceSensitivity, needsSequenceNote } from '../src/engine/rag/sequenceSensitivity.js';

test('content questions are NOT sequence-sensitive', () => {
  // Bonex's "safe" list — these must keep working from any readable page.
  for (const q of [
    'What does the book say about food vocabulary?',
    'Find examples of this phrase.',
    'What vocabulary appears here?',
    'How is this older spelling used?',
    'Translate "kakawo a".',
    'What does chapter 2 say about words borrowed from French?',
  ]) {
    assert.equal(classifySequenceSensitivity(q).sensitive, false, `should be safe: ${q}`);
  }
});

test('ordering questions ARE sequence-sensitive', () => {
  // Bonex's "needs caution" list.
  for (const q of [
    'What comes immediately after section 33?',
    'Teach me the next lesson in order.',
    'Summarize chapter 2 sequentially.',
    'Which section comes first?',
    'Walk me through the book step-by-step.',
    'Build a curriculum from this book.',
  ]) {
    assert.equal(classifySequenceSensitivity(q).sensitive, true, `should be gated: ${q}`);
  }
});

test('ordering language wins when a question asks for both', () => {
  // "Find the next example" asks for a POSITION. Treating it as content would
  // answer from an incomplete order without saying so.
  const mixed = classifySequenceSensitivity('Find the next example after section 30');
  assert.equal(mixed.sensitive, true);
  assert.match(mixed.reason, /order as well as content/);
});

test('a COMPLETE sequence never carries the note, however the question is phrased', () => {
  assert.equal(needsSequenceNote('What comes after section 33?', true), false);
  assert.equal(needsSequenceNote('Teach me the next lesson.', true), false);
});

test('an incomplete sequence notes ONLY the ordering questions', () => {
  assert.equal(needsSequenceNote('What comes after section 33?', false), true);
  assert.equal(needsSequenceNote('What vocabulary appears here?', false), false,
    'content questions must not be dressed in a warning about ordering');
});

test('unknown completeness is not treated as incomplete', () => {
  // A document with no recorded sequence state — a plain text file, say — must
  // not inherit a caveat that only applies to reconstructed scans.
  assert.equal(needsSequenceNote('What comes after section 33?', undefined), false);
});
