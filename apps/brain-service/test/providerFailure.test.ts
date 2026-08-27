import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyProviderFailure } from '../src/engine/providerFailure.js';

/*
 * The exact string Ollama returned when handed a 133-byte PNG, wrapped the way
 * OpenAiCompatProvider wraps it. This is the case that cost real debugging time,
 * so it is asserted verbatim rather than paraphrased.
 */
const OLLAMA_LIVE =
  'Model provider http://100.86.143.93:11434/v1 stream HTTP 400: '
  + '{"error":{"message":"Failed to load image or audio file","type":"invalid_request_error"}}';

test('the live Ollama image rejection is named as an unreadable image', () => {
  const f = classifyProviderFailure(OLLAMA_LIVE);
  assert.equal(f.kind, 'unreadable_image');
  assert.equal(f.code, 'IMAGE_UNREADABLE');
  assert.match(f.message, /could not be read/i);
  // The user is told what to DO, not merely that something failed.
  assert.match(f.message, /PNG or JPEG/);
});

test('the other image-rejection wordings are covered', () => {
  for (const text of [
    'unable to decode image',
    'unable to load the image',
    'invalid image data supplied',
    'cannot identify image file',
    'unsupported image format: image/heic',
    'image decode failed',
    'corrupted image payload',
  ]) {
    assert.equal(classifyProviderFailure(text).kind, 'unreadable_image', text);
  }
});

/*
 * The half that matters more.
 *
 * A confident wrong cause is worse than an honest vague one: it sends the user
 * off re-encoding a good file while the real fault — a saturated GPU, a dead
 * upstream — goes unmentioned. Each of these failed on a turn that could well
 * have carried an image, and none of them says the image was the problem.
 */
test('failures that are NOT about the image keep the generic sentence', () => {
  for (const text of [
    'Model provider http://host/v1 stream HTTP 500 ',
    'Model provider http://host/v1 returned HTTP 503 Service Unavailable',
    'fetch failed',
    'The operation was aborted due to timeout',
    'Model provider http://host/v1 returned no completion content.',
    'model "qwen2.5vl:7b" not found, try pulling it first',
    'context length exceeded',
    'CUDA out of memory',
  ]) {
    const f = classifyProviderFailure(text);
    assert.equal(f.kind, 'unknown', text);
    assert.equal(f.code, 'COMPLETION_FAILED');
    assert.equal(f.message, 'The engine could not complete the request.');
  }
});

test('no error text at all is unknown, not an image fault', () => {
  assert.equal(classifyProviderFailure(undefined).kind, 'unknown');
  assert.equal(classifyProviderFailure('').kind, 'unknown');
});

/*
 * A transport failure on an image turn must not be blamed on the image. "image"
 * appears in the URL here, which is exactly the near-miss a looser matcher would
 * get wrong.
 */
test('the word "image" appearing incidentally does not trigger the diagnosis', () => {
  assert.equal(
    classifyProviderFailure('Model provider http://host/v1/image-models stream HTTP 502').kind,
    'unknown',
  );
});
