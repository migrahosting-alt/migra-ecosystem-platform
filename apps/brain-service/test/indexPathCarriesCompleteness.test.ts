/**
 * THE INDEX PATH MUST CARRY "I COULD NOT READ ALL OF THIS".
 *
 * 🚨 THIS TEST EXISTS BECAUSE A NEGATIVE CONTROL DID NOT BITE.
 *
 * `extractPptx` reports `hasUnreadCharts`, and it was wired to a completeness
 * flag in `fileText.ts` — the email/whole-file path — and reported as done. But
 * `fsFileSource.ts`, the INDEX path behind every chat attachment, discarded it on
 * the line that pushes the text:
 *
 *     if (extracted.text) out.push({ relPath: childRel, content: extracted.text });
 *
 * So the path a user actually reaches stayed silent, and when someone asked in
 * plain words whether the whole deck had been read, the one concrete limitation
 * the product knew about was unavailable to answer with.
 *
 * When that regression was re-injected as a control, EVERY TEST STILL PASSED —
 * because the tests around it all supply `complete` through a fake `FileSource`
 * and never run the real extraction. A fix with no test over the real path is how
 * the same flag gets dropped a third time. This runs `FsFileSource` against an
 * actual deck on disk.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';

import { FsFileSource } from '../src/engine/rag/fsFileSource.js';

const para = (text: string): string => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`;
const shape = (body: string): string =>
  `<p:sp><p:nvSpPr><p:nvPr></p:nvPr></p:nvSpPr><p:txBody>${body}</p:txBody></p:sp>`;
const slide = (inner: string): string =>
  `<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>${inner}</p:spTree></p:cSld></p:sld>`;

/** A one-slide deck, optionally carrying a chart part. */
async function deck(opts: { withChart: boolean }): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0"?><p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>` +
      `<p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>`,
  );
  zip.file('ppt/slides/slide1.xml', slide(shape(para('Revenue recovered in the second half.'))));
  if (opts.withChart) zip.file('ppt/charts/chart1.xml', '<c:chart/>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function sourceOverDeck(opts: { withChart: boolean }): Promise<
  Array<{ relPath: string; content: string; complete?: boolean; incompleteReason?: string }>
> {
  const root = await mkdtemp(join(tmpdir(), 'migra-index-completeness-'));
  await writeFile(join(root, 'quarterly.pptx'), await deck(opts));
  return new FsFileSource(root).files();
}

test('🚨 a deck with charts is NOT reported as read whole by the index path', async () => {
  const files = await sourceOverDeck({ withChart: true });
  const deckFile = files.find((f) => f.relPath === 'quarterly.pptx');

  assert.ok(deckFile, 'the deck was not indexed at all');
  assert.match(deckFile.content, /Revenue recovered/, 'the text did not survive');
  assert.equal(deckFile.complete, false,
    'the index path claimed a charted deck was read whole — the flag was dropped again');
  assert.match(String(deckFile.incompleteReason), /charts/i,
    'nothing said WHY it is incomplete, so no answer can tell the user');
});

test('a deck with no charts is not falsely marked incomplete', async () => {
  /*
   * The control in the other direction. A flag that is always `false` would
   * "pass" the test above while making every deck look partially unread — which
   * is its own dishonesty, and would teach answers to hedge about documents that
   * were in fact read completely.
   */
  const files = await sourceOverDeck({ withChart: false });
  const deckFile = files.find((f) => f.relPath === 'quarterly.pptx');

  assert.ok(deckFile, 'the deck was not indexed at all');
  assert.notEqual(deckFile.complete, false,
    'a chartless deck was reported as not fully read');
});

test('a plain text file leaves completeness unstated rather than guessing', async () => {
  // Absent means "nothing KNOWN to be unread", never "verified whole". A format
  // with no completeness signal must not claim one in either direction.
  const root = await mkdtemp(join(tmpdir(), 'migra-index-plain-'));
  await writeFile(join(root, 'notes.txt'), 'Yon fraz an kreyòl.\n');
  const files = await new FsFileSource(root).files();
  const txt = files.find((f) => f.relPath === 'notes.txt');

  assert.ok(txt, 'the text file was not indexed');
  assert.notEqual(txt.complete, false, 'a plain text file was marked incomplete');
});
