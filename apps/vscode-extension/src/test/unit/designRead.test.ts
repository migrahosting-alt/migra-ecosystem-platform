// The seam that makes an attached image buildable rather than merely describable.
//
// What this pins: the spec reaches the agent as clearly-marked DERIVED text; an
// empty read produces NO spec (a caller entering the agent on an empty read
// would be building blind); and the completeness pass can only ADD what a second
// look found, never replace or discard the first read.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readAttachedDesign,
  isImageAttachment,
  formatDesignSpec,
  mergeCompleteness,
} from '../../chat/designRead.js';
import type { AiChatRequest, AiStreamEvent } from '../../services/migraAiClient.js';

const PNG = { name: 'mockup.png', mimeType: 'image/png', dataBase64: 'AAAA', sizeBytes: 3 };
const PDF = { name: 'spec.pdf', mimeType: 'application/pdf', dataBase64: 'BBBB' };

const tokens = (...parts: string[]): AiStreamEvent[] => parts.map((text) => ({ type: 'token', text }));
const done = (model?: string): AiStreamEvent => ({ type: 'done', requestId: 'r', ...(model ? { model } : {}) });

/**
 * A client double scripted PER CALL: the read is two passes, so a single script
 * would feed the first read's text back as the second read's answer.
 */
function scripted(...calls: AiStreamEvent[][]) {
  const sent: AiChatRequest[] = [];
  return {
    sent,
    client: {
      async *chatStream(body: AiChatRequest): AsyncGenerator<AiStreamEvent> {
        sent.push(body);
        for (const e of calls[sent.length - 1] ?? []) yield e;
      },
    },
  };
}

test('image attachments are recognised, non-images are not', () => {
  assert.equal(isImageAttachment(PNG), true);
  assert.equal(isImageAttachment(PDF), false);
  assert.equal(isImageAttachment({ mimeType: 'IMAGE/JPEG' }), true);
  assert.equal(isImageAttachment({}), false);
});

test('a read returns a spec carrying the model and the file names', async () => {
  const { client } = scripted(
    [...tokens('Header reads MigraPilot. ', 'A Sign up button.'), done('qwen2.5vl:7b')],
    [...tokens('NOTHING MISSING'), done()],
  );
  const out = await readAttachedDesign(client, [PNG, PDF]);
  assert.ok(out, 'expected a spec');
  assert.equal(out.model, 'qwen2.5vl:7b');
  assert.deepEqual(out.fileNames, ['mockup.png']);
  assert.match(out.spec, /Header reads MigraPilot\. A Sign up button\./);
});

test('ONLY images are sent to the vision model, on BOTH passes', async () => {
  const { client, sent } = scripted([...tokens('spec'), done()], [...tokens('NOTHING MISSING'), done()]);
  await readAttachedDesign(client, [PNG, PDF]);
  assert.equal(sent.length, 2, 'the read is two passes');
  for (const req of sent) {
    assert.deepEqual(req.attachments?.map((a) => a.name), ['mockup.png']);
  }
});

test('the second pass sees the image AND the first transcription', async () => {
  const { client, sent } = scripted([...tokens('a purple header'), done()], [...tokens('NOTHING MISSING'), done()]);
  await readAttachedDesign(client, [PNG]);
  assert.match(sent[1]!.prompt!, /a purple header/, 'the second pass must be given what to check');
});

test('a second read that finds nothing leaves the spec untouched', () => {
  assert.equal(mergeCompleteness('base spec', 'NOTHING MISSING'), 'base spec');
  assert.equal(mergeCompleteness('base spec', '  nothing missing.  '), 'base spec');
  assert.equal(mergeCompleteness('base spec', ''), 'base spec');
});

test('a second read ADDS to the first, and never replaces it', () => {
  const merged = mergeCompleteness('base spec', '- a red circle');
  assert.match(merged, /^base spec/, 'the first read must survive intact');
  assert.match(merged, /Additional elements found on a second read/);
  assert.match(merged, /- a red circle/);
});

test('a failing second pass still yields the first read', async () => {
  const sent: AiChatRequest[] = [];
  const client = {
    async *chatStream(body: AiChatRequest): AsyncGenerator<AiStreamEvent> {
      sent.push(body);
      if (sent.length === 2) throw new Error('vision model went away');
      yield { type: 'token', text: 'the first read' };
      yield done('qwen2.5vl:7b');
    },
  };
  const out = await readAttachedDesign(client, [PNG]);
  assert.ok(out, 'a usable first read must not be thrown away by a failed check');
  assert.match(out.spec, /the first read/);
});

test('the spec is framed as derived, so the agent cannot read it as the user typing', () => {
  const framed = formatDesignSpec(['mockup.png'], 'A purple header.');
  assert.match(framed, /derived from the attached image: mockup\.png/);
  assert.match(framed, /not typed by the user/);
  assert.match(framed, /rather than inventing it/);
});

test('an empty read yields NO spec — the caller must not enter the agent blind', async () => {
  const { client, sent } = scripted([...tokens('   '), done()]);
  assert.equal(await readAttachedDesign(client, [PNG]), undefined);
  assert.equal(sent.length, 1, 'an empty first read must not trigger a second pass');
});

test('no images means no vision call at all', async () => {
  const { client, sent } = scripted([...tokens('never'), done()]);
  assert.equal(await readAttachedDesign(client, [PDF]), undefined);
  assert.equal(sent.length, 0, 'a document-only turn must not reach the vision model');
});
