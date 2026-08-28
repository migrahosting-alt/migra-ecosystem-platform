import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractDocx, DocxExtractionError } from '../src/engine/rag/docxText.js';

/*
 * 🚨 RESOLVED FOR BOTH LOCATIONS, because the suite does not run this file.
 *
 * `npm test` runs the COMPILED tests from dist/test/, so import.meta.url points
 * there while the fixtures live in test/fixtures/. Resolving against the module
 * alone passes when the source is run directly with tsx and fails under the real
 * test command — which is exactly the false green I hit: four green tests from
 * the wrong runner, four failures from the one that counts.
 */
const CANDIDATES = [
  new URL('./fixtures/', import.meta.url),      // running from source
  new URL('../../test/fixtures/', import.meta.url), // running from dist/test
];

async function load(name: string): Promise<Uint8Array> {
  for (const base of CANDIDATES) {
    try {
      return new Uint8Array(await readFile(join(fileURLToPath(base), name)));
    } catch { /* try the next location */ }
  }
  throw new Error(`fixture ${name} not found in ${CANDIDATES.map(String).join(' or ')}`);
}

test('a Word document yields the text a user would ask about', async () => {
  const { text } = await extractDocx(await load('docx-controlled.docx'));

  assert.match(text, /Quarterly Report/, 'heading');
  assert.match(text, /4,271,000/, 'a figure stated in bold');
  assert.match(text, /Port-au-Prince/, 'a list item');
  assert.match(text, /ZANMI-4417/, 'an identifier');
});

/*
 * TABLE CELLS ARE THE POINT OF A REPORT.
 *
 * "Which region earned the most?" is answerable only from the table, and an
 * extractor that drops tables loses precisely the content someone opens a
 * quarterly report to find. Asserted separately from the prose above so a
 * regression here cannot hide behind a passing heading check.
 */
test('table cells survive extraction', async () => {
  const { text } = await extractDocx(await load('docx-controlled.docx'));
  for (const cell of ['1904000', '1203000', '1164000']) {
    assert.ok(text.includes(cell), `table cell ${cell} is missing`);
  }
});

/*
 * 🚨 The gap every candidate had. Mammoth, officeparser and a raw-XML baseline
 * all dropped this footnote silently — and a footnote is where a contract puts
 * the condition that changes the answer.
 */
test('footnotes are recovered, not silently dropped', async () => {
  const { text, hasAuxiliaryText } = await extractDocx(await load('docx-footnote.docx'));

  assert.match(text, /net-45/, 'body text is still there');
  assert.match(text, /KOD-8891/, 'body identifier');
  assert.match(text, /written approval from the finance director/, 'the footnote itself');
  assert.equal(hasAuxiliaryText, true);
  // Labelled rather than blended into the prose, so an answer can attribute it.
  assert.match(text, /\[Footnotes\]/);
});

test('a document with no notes gets no notes section', async () => {
  const { text, hasAuxiliaryText } = await extractDocx(await load('docx-controlled.docx'));
  assert.equal(hasAuxiliaryText, false);
  assert.ok(!text.includes('Document notes, headers and footers'), 'no empty section is appended');
});

test('a file that is not a Word document is refused, not half-read', async () => {
  // A PDF renamed to .docx, and plain bytes. Both must raise rather than return
  // whatever text happens to fall out of the wrong parser.
  await assert.rejects(
    () => extractDocx(new Uint8Array(Buffer.from('%PDF-1.7\nnot a word file'))),
    (e: unknown) => e instanceof DocxExtractionError,
  );
  await assert.rejects(
    () => extractDocx(new Uint8Array([0, 1, 2, 3, 4])),
    (e: unknown) => e instanceof DocxExtractionError,
  );
});

test('a zip that is not a Word document is refused', async () => {
  // A real ZIP with no word/document.xml — the ".doc renamed to .docx" case,
  // which loads as a zip and would otherwise extract to nothing at all.
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('hello.txt', 'not word content');
  const bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));

  await assert.rejects(
    () => extractDocx(bytes),
    (e: unknown) => e instanceof DocxExtractionError && /not a Word document/.test((e as Error).message),
  );
});
