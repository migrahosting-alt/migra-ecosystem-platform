/**
 * Turning a request into a picture description.
 *
 * The fixture: "generate letter A in png" passed through verbatim produced four
 * overlapping letterforms reading "ACAA" — a real PNG of the wrong thing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { describeImageRequest, shapeImagePrompt } from '../src/engine/media/imagePrompt.js';
import { classifyImageTurn } from '../src/engine/media/generationIntent.js';

test('the regression fixture becomes a description of one letter', () => {
  const shaped = shapeImagePrompt('generate letter A in png');
  assert.match(shaped, /single capital letter 'A'/);
  // Load-bearing: without it the model tiles the glyph across the canvas.
  assert.match(shaped, /one letter only/);
  // The request grammar and the file format are gone.
  assert.doesNotMatch(shaped, /generate/i);
  assert.doesNotMatch(shaped, /\bpng\b/i);
});

test('single-character requests, however they are phrased', () => {
  for (const prompt of [
    'generate letter A in png',
    'draw the capital letter A',
    'create an image of the letter A',
    'make me a picture of letter A',
    'generate A in png',
    'letter A',
  ]) {
    assert.match(shapeImagePrompt(prompt), /single capital letter 'A'/, prompt);
  }
});

test('case and kind are respected rather than flattened', () => {
  assert.match(shapeImagePrompt('draw the lowercase letter g'), /lowercase letter 'g'/);
  assert.match(shapeImagePrompt('generate the digit 7 as a png'), /digit '7'/);
  // An uppercase request for a letter typed in lowercase still capitalises.
  assert.match(shapeImagePrompt('draw the capital letter b'), /capital letter 'B'/);
});

test('a real description is left as the user wrote it', () => {
  /*
   * The expensive failure mode is rewriting someone's picture into a different
   * picture. Only the request grammar comes off.
   */
  assert.equal(
    shapeImagePrompt('generate an image of a lighthouse at night in a storm'),
    'a lighthouse at night in a storm',
  );
  assert.equal(shapeImagePrompt('draw a cat wearing a red hat'), 'a cat wearing a red hat');
  assert.equal(
    shapeImagePrompt('a watercolour of the Haitian coastline at sunrise'),
    'a watercolour of the Haitian coastline at sunrise',
  );
});

test('the format instruction comes off the end, never out of the middle', () => {
  // "image of a cat" must keep its cat.
  assert.equal(shapeImagePrompt('create an image of a cat'), 'a cat');
  assert.equal(shapeImagePrompt('a poster for a jazz night as a png'), 'a poster for a jazz night');
});

test('a prompt that is only request grammar falls back rather than emptying', () => {
  // Better to hand the model the original words than an empty string.
  assert.ok(shapeImagePrompt('generate an image').length > 0);
  assert.ok(shapeImagePrompt('   ').length >= 0);
});

/*
 * ── PHRASING MUST NOT DECIDE THE ENGINE ─────────────────────────────────────
 *
 * A request for one literal character can only sensibly mean the deterministic
 * typeface path, whatever verb it uses. Two layers had to agree and did not:
 * "make me a capital B" carried a creation verb but no artefact noun, and "give
 * me a PNG of C" carried the noun but no creation verb, so BOTH were classified
 * as ordinary text and never reached the renderer at all.
 *
 * Each case asserts the gate AND the request kind, because passing one layer
 * while failing the other is precisely the shape of the original defect.
 */

const GLYPH_PHRASINGS: ReadonlyArray<[string, string]> = [
  ['Generate the letter B', 'B'],
  ['Generate an image of the letter B', 'B'],
  ['Generate an image of the letter B.', 'B'],   // the exact phrase observed failing
  ['Make me a capital B', 'B'],
  ['Create the number 7', '7'],
  ['Draw the letter A', 'A'],
  ['Give me a PNG of C', 'C'],
  ['generate letter A in png', 'A'],
];

for (const [prompt, expected] of GLYPH_PHRASINGS) {
  test(`glyph routing: ${JSON.stringify(prompt)}`, () => {
    assert.equal(classifyImageTurn(prompt, false), 'create', 'must be treated as making a picture');
    const request = describeImageRequest(prompt);
    assert.equal(request.kind, 'glyph', 'must take the deterministic typeface path, not diffusion');
    assert.equal(request.kind === 'glyph' ? request.text : '', expected);
  });
}

/*
 * These ARE picture requests and must keep going to Studio. They must not be
 * "swallowed" as glyphs — widening the glyph rule until a scene matches it would
 * trade a missed fast path for a wrong image, which is the worse failure.
 */
const SCENE_PHRASINGS: readonly string[] = [
  'Generate an image of a blue car',
  'Draw a cat',
  'Create a poster with the words ABC',
  'Draw a capital city skyline',
];

for (const prompt of SCENE_PHRASINGS) {
  test(`scene stays a scene: ${JSON.stringify(prompt)}`, () => {
    assert.equal(classifyImageTurn(prompt, false), 'create');
    assert.equal(describeImageRequest(prompt).kind, 'scene', 'a scene must never take the glyph path');
  });
}

/* Questions and instructions are answered, never drawn. */
const TEXT_PHRASINGS: readonly string[] = [
  'What does the letter B mean?',
  'How do I generate a letter B in Python?',
];

for (const prompt of TEXT_PHRASINGS) {
  test(`stays an explanation: ${JSON.stringify(prompt)}`, () => {
    assert.equal(classifyImageTurn(prompt, false), 'text', 'handing back a picture answers a different question');
  });
}

test('a glyph request wins even when an image is already in the turn', () => {
  // The create-vs-understand invariant: asking for a new letter is not a question
  // about the picture that happens to be in scope.
  assert.equal(classifyImageTurn('Make me a capital B', true), 'create');
  assert.equal(classifyImageTurn('Generate an image of the letter B.', true), 'create');
});
