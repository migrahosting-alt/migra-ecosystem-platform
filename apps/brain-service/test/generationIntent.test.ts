/**
 * Telling "make me a picture" from "tell me about pictures".
 *
 * The fixture this exists for: "generate letter A in png" returned a tutorial
 * listing Photoshop, Canva and Pillow.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyGenerationIntent } from '../src/engine/media/generationIntent.js';

test('the regression fixture routes to generation', () => {
  assert.equal(classifyGenerationIntent('generate letter A in png'), 'image_generation');
});

test('the ways people actually ask for a picture', () => {
  for (const prompt of [
    'generate an image of a lighthouse at night',
    'create a picture of a red bicycle',
    'make me a logo for a coffee shop',
    'draw a cat wearing a hat',
    'paint a watercolour of the Haitian coastline',
    'design an icon for a settings menu',
    'a picture of Port-au-Prince at sunrise',
    'render an illustration of a volcano',
    'produce a poster for a jazz night',
    'generate a png of the letter B',
  ]) {
    assert.equal(classifyGenerationIntent(prompt), 'image_generation', prompt);
  }
});

test('asking HOW to make one is a question, not a request for an artefact', () => {
  /*
   * The expensive direction. Answering these with a 30-second GPU render instead
   * of an explanation is worse than the tutorial bug it replaces.
   */
  for (const prompt of [
    'how do I generate a png in python',
    'how to create an image with Pillow',
    'explain how image generation works',
    'write code to draw a logo using SVG',
    'what is the best way to make an icon',
    'show me an example of generating images in javascript',
    'describe the picture I sent you',
  ]) {
    assert.equal(classifyGenerationIntent(prompt), 'text', prompt);
  }
});

test('ordinary text turns are never mistaken for a picture request', () => {
  for (const prompt of [
    'generate a summary of this document',
    'create a list of three ideas',
    'make a plan for the migration',
    'the png is broken, what happened',
    'what is the capital of Haiti?',
    'draw up a contract outline',
    '',
    '   ',
  ]) {
    assert.equal(classifyGenerationIntent(prompt), 'text', JSON.stringify(prompt));
  }
});

test('a verb alone or a noun alone is not enough', () => {
  // Both halves are required precisely so "generate a summary" and "the image
  // above" stay text.
  assert.equal(classifyGenerationIntent('generate something interesting'), 'text');
  assert.equal(classifyGenerationIntent('the image above is blurry'), 'text');
});
