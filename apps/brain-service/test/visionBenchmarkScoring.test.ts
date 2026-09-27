import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contentWords, scoreTranscription, parseCount,
  transcriptionPassed, countingPassed,
} from '../src/engine/vision/visionBenchmark.js';

/**
 * THE SCORER DECIDES WHETHER A MODEL SERVES REAL USERS, SO IT IS TESTED.
 *
 * A vision benchmark is easy to write so that it measures nothing: render a cat,
 * ask "is there a cat?", grep for "cat" — the word is in the question. These pin
 * the properties that stop this one from being that.
 */

test('🚨 dropping Haitian Creole diacritics COSTS recall', () => {
  /*
   * The property that makes this corpus worth running for THIS product. Creole
   * orthography carries meaning in its accents, and a reader that flattens them
   * looks fluent while being wrong — the owner's own words for an earlier failure
   * were "bad creole". "sistem" must not satisfy "sistèm".
   */
  const truth = 'Chak dosye nan sistèm nan dwe gen yon non ki klè anvan rapò a.';
  const flattened = scoreTranscription({ expected: truth, answer: truth.replace(/è/g, 'e').replace(/ò/g, 'o') });
  const faithful = scoreTranscription({ expected: truth, answer: truth });

  assert.equal(faithful.recall, 1, 'an exact transcription did not score 1.0');
  assert.ok(flattened.recall < faithful.recall,
    `flattening diacritics scored ${flattened.recall}, the same as a faithful reading`);
  assert.ok(flattened.missed.some((w) => /[èò]/.test(w)), 'the accented words were not reported as missed');
});

test('recall and precision are both reported, because either alone is gameable', () => {
  const truth = 'alpha bravo charlie delta echo';
  // A model that returns one correct word: perfect precision, terrible recall.
  const stingy = scoreTranscription({ expected: truth, answer: 'alpha' });
  assert.equal(stingy.precision, 1);
  assert.ok(stingy.recall < 0.3);
  /*
   * A model that dumps everything: perfect recall, terrible precision.
   *
   * The noise words must be DISTINCT. The first version repeated one word 40 times
   * and precision stayed at 0.83, because the scorer compares SETS — repetition
   * cannot inflate the denominator. My test was wrong, not the scorer, and the
   * set comparison is deliberate: a model should not be punished for saying a word
   * twice.
   */
  const distinctNoise = Array.from({ length: 40 }, (_, i) => `noiseword${i}`).join(' ');
  const firehose = scoreTranscription({ expected: truth, answer: `${truth} ${distinctNoise}` });
  assert.equal(firehose.recall, 1);
  assert.ok(firehose.precision < 0.3, `precision was ${firehose.precision}`);
});

test('🚨 an empty ground truth scores ZERO, never 1.0', () => {
  // A broken fixture must fail the fixture, not pass the model. Returning a
  // perfect score for "nothing expected" is how an empty page qualifies a model.
  const s = scoreTranscription({ expected: '   ', answer: 'anything at all' });
  assert.equal(s.recall, 0);
  assert.equal(s.precision, 0);
});

test('short words are ignored, so fluent noise cannot inflate the score', () => {
  // "a", "of", "to" appear in any English text; counting them would reward a model
  // that produced grammatical filler.
  assert.deepEqual(contentWords('a of to the and reconciliation'), ['reconciliation']);
});

test('🚨 the LAST number is the answer, not the first', () => {
  /*
   * Replies restate the question — "in the image with 5 shapes, I count 7 circles"
   * — so taking the first match grades the question instead of the answer.
   */
  assert.equal(parseCount('In the image with 5 shapes, I count 7 circles.'), 7);
  assert.equal(parseCount('There are four dark circles.'), 4);
  assert.equal(parseCount('7'), 7);
});

test('🚨 "I cannot tell" is null, never zero', () => {
  // Scoring a refusal as 0 would credit a model for accidentally matching an
  // empty image, and llava returns exactly this on most counting prompts.
  assert.equal(parseCount('I am unable to determine that from the image.'), null);
  assert.notEqual(parseCount('zero'), null, '"zero" is a real answer and must parse');
  assert.equal(parseCount('zero'), 0);
});

test('🚨 no evidence is not a pass, in either suite', () => {
  // An empty run must never read as success — that is how a model that failed to
  // execute gets approved.
  assert.equal(transcriptionPassed([]), false);
  assert.equal(countingPassed([]), false);
});

test('every page must clear the bars, not the average', () => {
  /*
   * Averaging would let a perfect English page hide an unreadable Creole one,
   * which is the exact failure this corpus was widened to expose.
   */
  const good = { recall: 1, precision: 1, missed: [], invented: [] };
  const bad = { recall: 0.2, precision: 0.9, missed: [], invented: [] };
  assert.equal(transcriptionPassed([good, good]), true);
  assert.equal(transcriptionPassed([good, bad]), false, 'a failing page was averaged away');
});

test('counting demands EXACT matches — off by one is wrong', () => {
  const near = [1, 2, 3, 4, 5].map((n) => ({ expected: n, got: n + 1 }));
  assert.equal(countingPassed(near), false, 'consistently off-by-one counted as passing');
  const exact = [1, 2, 3, 4, 5].map((n) => ({ expected: n, got: n }));
  assert.equal(countingPassed(exact), true);
});
