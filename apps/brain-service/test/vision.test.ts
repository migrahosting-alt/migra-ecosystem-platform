import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoreFixture, ocrExactPass, qualifyVision, VISION_THRESHOLD } from '../src/engine/vision/visionScoring.js';

test('scoreFixture: synonym groups are any-match and case-insensitive', () => {
  const criteria = [['sign in', 'login'], ['email'], ['password'], ['forgot']];
  // A UI answer hitting 3 of 4 groups (misses "forgot").
  const r = scoreFixture('This is a LOGIN screen with Email and Password fields.', criteria);
  assert.deepEqual(r.groups, [true, true, true, false]);
  assert.equal(r.score, 0.75);
  // Empty answer scores 0.
  assert.equal(scoreFixture('', criteria).score, 0);
  // Any synonym in a group satisfies it.
  assert.equal(scoreFixture('sign in / password / email / forgot password?', criteria).score, 1);
});

test('ocrExactPass: every exact string must appear verbatim (case-insensitive)', () => {
  assert.equal(ocrExactPass('Invoice MG-4471, amount due $1,284.50', ['MG-4471', '1,284.50']), true);
  assert.equal(ocrExactPass('Invoice MG-4471 only', ['MG-4471', '1,284.50']), false, 'a missing exact string fails the gate');
});

test('qualifyVision: a load failure is fail-closed regardless of any scores', () => {
  const r = qualifyVision({ fixtureScores: [1, 1, 1, 1, 1, 1], loadFailed: true, ocrExactPassed: true });
  assert.equal(r.passes, false);
  assert.match(r.reason, /load/i);
});

test('qualifyVision: OCR gate failure blocks qualification even above the score bar', () => {
  const r = qualifyVision({ fixtureScores: [1, 1, 1, 1, 1, 1], loadFailed: false, ocrExactPassed: false });
  assert.equal(r.passes, false);
  assert.match(r.reason, /ocr/i);
  assert.equal(r.overall, 1, 'the averaged score is still reported for transparency');
});

test('qualifyVision: below the production bar fails; at/above passes (bar not lowered)', () => {
  const below = qualifyVision({ fixtureScores: [0.5, 0.5, 0.6, 0.7, 0.6, 0.5], loadFailed: false, ocrExactPassed: true });
  assert.ok(below.overall < VISION_THRESHOLD);
  assert.equal(below.passes, false);

  const at = qualifyVision({ fixtureScores: [0.75, 0.75, 0.75, 0.75, 0.75, 0.75], loadFailed: false, ocrExactPassed: true });
  assert.equal(at.overall, VISION_THRESHOLD);
  assert.equal(at.passes, true, 'exactly at the bar qualifies');

  const strong = qualifyVision({ fixtureScores: [1, 1, 0.67, 1, 1, 1], loadFailed: false, ocrExactPassed: true });
  assert.ok(strong.overall >= VISION_THRESHOLD);
  assert.equal(strong.passes, true);
});
