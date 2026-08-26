/**
 * Create vs transform vs understand, when an image is already in the turn.
 *
 * WHY. Generation was gated on `!hasImage`, so ANY attachment disabled creation.
 * "generate letter C in png", sent in a conversation that already contained an
 * upload, was answered as a question about that upload — the user's verb lost to
 * a picture that merely happened to be in scope.
 *
 * The rule these assert: an explicit request to CREATE outranks residual image
 * context; the attached image only wins when the prompt points at it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyImageTurn } from '../src/engine/media/generationIntent.js';

const withImage = (p: string) => classifyImageTurn(p, true);
const withoutImage = (p: string) => classifyImageTurn(p, false);

test('THE REGRESSION: explicit creation wins over an attached image', () => {
  assert.equal(withImage('generate letter C in png'), 'create');
  assert.equal(withImage('generate an image of a lighthouse'), 'create');
  assert.equal(withImage('draw me a cat'), 'create');
  assert.equal(withImage('create a poster for the launch'), 'create');
});

test('the same prompts still create when nothing is attached', () => {
  assert.equal(withoutImage('generate letter C in png'), 'create');
  assert.equal(withoutImage('draw me a cat'), 'create');
});

test('pointing at the attached image asks to TRANSFORM it', () => {
  for (const prompt of [
    'edit this image',
    'crop this photo',
    'make this one blue',
    'remove the background from this picture',
    'rotate the image above',
    'make it brighter',
  ]) {
    assert.equal(withImage(prompt), 'transform', prompt);
  }
});

test('asking about the attached image is UNDERSTAND', () => {
  for (const prompt of [
    'what do you see in this image?',
    'describe this picture',
    'how many people are in it',
    'read the text in this screenshot',
    'what colours do you see in this image?',
  ]) {
    assert.equal(withImage(prompt), 'understand', prompt);
  }
});

test('an attached image with an ambiguous prompt stays about the image', () => {
  /*
   * The safe direction. Guessing "create" here would spend GPU answering a
   * question the user did not ask, while treating it as vision merely describes
   * something they are already looking at.
   */
  assert.equal(withImage('thoughts?'), 'understand');
  assert.equal(withImage('and now'), 'understand');
});

test('plain conversation is still plain conversation', () => {
  assert.equal(withoutImage('what is the capital of France'), 'text');
  assert.equal(withoutImage('summarise this document'), 'text');
});

test('asking HOW to make an image is instructions, not a picture', () => {
  // Preserved from the original classifier: handing someone a picture when they
  // asked how to make one answers a different question.
  assert.equal(withoutImage('how do I generate a png in python'), 'text');
  assert.equal(withImage('how do I generate a png in python'), 'understand');
});

/*
 * THE REFUSAL CONTRACT. Classification without an executable capability is half
 * a job: asked to "make this one blue", a text model answered "Sure! Here's the
 * text in blue: blue" — an invented edit result for an edit that never
 * happened. These lock the three-way contract that replaced it.
 *
 *   create    → generation
 *   understand→ vision
 *   transform → a real editor, or a truthful refusal
 */

test('every transform phrasing is classified as transform, never as create', () => {
  // A transform misread as `create` is the dangerous direction: it would spend
  // GPU producing an unrelated new picture instead of refusing honestly.
  for (const prompt of [
    'edit this image',
    'change the background of this photo',
    'remove the person on the left',
    'crop this to a square',
    'resize this image to 512px',
    'rotate the picture above',
    'make it brighter',
    'make this one blue',
    'add a hat to this picture',
    'replace the sky in this image',
    'blur the background of this photo',
    'upscale this image',
  ]) {
    assert.equal(classifyImageTurn(prompt, true), 'transform', prompt);
  }
});

test('a transform phrasing with NO image attached is not a transform turn', () => {
  /*
   * There is nothing to edit. "remove the background" with no attachment is a
   * question about how to do it, and refusing an edit nobody can perform on an
   * image that does not exist would be a non sequitur.
   */
  assert.equal(classifyImageTurn('remove the background', false), 'text');
  assert.equal(classifyImageTurn('crop this to a square', false), 'text');
});

test('creation is never swallowed by the transform branch', () => {
  // The refusal must not become a trap that catches ordinary generation.
  assert.equal(classifyImageTurn('generate letter C in png', true), 'create');
  assert.equal(classifyImageTurn('create an image of a blue car', true), 'create');
  // "make ... a picture" reads as creation even though `make` is also a
  // transform verb, because it names the artefact rather than pointing at one.
  assert.equal(classifyImageTurn('make a picture of a blue car', true), 'create');
});
