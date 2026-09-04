// A withheld image attachment must be NAMED to the model, never silently dropped.
//
// Moved out of the GPU-capacity suite, where it had nothing to do with capacity —
// it lived there only because that file happened to exist. Its subject is the
// provider's handling of attachments when no vision model is configured.

import { test } from 'node:test';
import assert from 'node:assert/strict';

test('a withheld image is named to the model, never silently dropped', async () => {
  /*
   * FOUND BY ATTACHING A SCREENSHOT AND BEING TOLD NONE WAS ATTACHED.
   *
   * When no vision model is configured the pictures cannot be analysed, and that
   * refusal is deliberate: governance names the approved vision model, an env var
   * must not. The provider option comment already promised the consequence —
   * image attachments "are described textually instead of analyzed" — but nothing
   * described them. They were filtered out and the prompt went on alone, so the
   * model was never told a picture existed and confidently said so to someone
   * looking at the thumbnail they had just attached.
   *
   * This pins the honest half. It asserts the file is NAMED and that the model is
   * instructed not to deny the attachment — not that a description is invented,
   * because the name and type are all that is actually known here.
   */
  const { OpenAiCompatProvider } = await import('../src/providers/openAiCompatProvider.js');

  const captured: { body?: string } = {};
  const originalFetch = globalThis.fetch;
  // The provider calls the GLOBAL fetch — there is no injection point — so the
  // double goes here and is restored in a finally.
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    captured.body = init?.body;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const provider = new OpenAiCompatProvider({
      profile: 'balanced' as never,
      baseUrl: 'http://127.0.0.1:1',
      model: 'text-only-model',
      visionModel: undefined,          // the profile path — no qualified vision model
    } as never);

    await provider.complete({
      userPrompt: 'What colour is this?',
      context: { attachments: [{ name: 'shot.png', mimeType: 'image/png', dataBase64: 'AAAA' }] },
    } as never);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const sent = captured.body ?? '';
  assert.ok(sent.includes('shot.png'), 'the withheld file must be named to the model');
  assert.ok(/cannot see them/i.test(sent), 'the model must be told it cannot see them');
  assert.ok(/not state or imply that nothing was attached/i.test(sent), 'and told not to deny the attachment');
  assert.ok(!sent.includes('AAAA'), 'the bytes must NOT be sent to a model with no vision capability');
});
