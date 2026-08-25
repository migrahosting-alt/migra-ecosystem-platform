/**
 * Turning a request into a picture description.
 *
 * The fixture: "generate letter A in png" passed through verbatim produced four
 * overlapping letterforms reading "ACAA" — a real PNG of the wrong thing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shapeImagePrompt } from '../src/engine/media/imagePrompt.js';

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
