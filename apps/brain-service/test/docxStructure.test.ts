import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import { extractDocx } from '../src/engine/rag/docxText.js';

/**
 * DOCX structural completeness.
 *
 * 🚨 THE PRODUCTION FAILURE. A reference document gave up DOCX-BRAVO-8842,
 * November and teal but not "sensors = 12". It cited the right file, so this was
 * never stale grounding — the value was in a TABLE, and mammoth flattens a table
 * into one paragraph per cell. Every value was technically present while the
 * relationship between them was gone: "sensors" and "12" arrived as two
 * unrelated lines, and chunking can put them in different chunks entirely.
 *
 * Probing that also exposed a second, larger gap: text boxes were dropped with
 * no error at all.
 */

async function docx(bodyXml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('_rels/.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:mc="http://schemas.microsoft.com/office/mc" xmlns:wps="http://schemas.microsoft.com/office/wps">` +
    `<w:body>${bodyXml}</w:body></w:document>`);
  return new Uint8Array(await zip.generateAsync({ type: 'nodebuffer' }));
}

const para = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const cell = (t: string) => `<w:tc>${para(t)}</w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;

test('🚨 a table ROW survives as one retrievable line', async () => {
  const bytes = await docx(
    para('Reference code: DOCX-BRAVO-8842') +
    `<w:tbl>${row('component', 'count')}${row('sensors', '12')}</w:tbl>`,
  );
  const { text } = await extractDocx(bytes);

  // The exact production miss: the VALUE and its LABEL on one line.
  assert.match(text, /sensors \| 12/,
    'a flattened table loses the relationship even when both values are present');
  assert.match(text, /component \| count/, 'the header row too');
  assert.match(text, /DOCX-BRAVO-8842/, 'and prose is unaffected');
});

test('🚨 text boxes and callouts are recovered, not silently dropped', async () => {
  const bytes = await docx(
    para('Body text') +
    `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx>` +
    `<w:txbxContent>${para('Callout value: BOXED-9931')}</w:txbxContent>` +
    `</wps:txbx></w:drawing></mc:Choice></mc:AlternateContent></w:r></w:p>`,
  );
  const { text, hasAuxiliaryText } = await extractDocx(bytes);
  assert.match(text, /BOXED-9931/, 'a value in a callout was absent with no error anywhere');
  assert.equal(hasAuxiliaryText, true, 'and the document is marked as carrying non-body text');
});

test('a multi-paragraph cell stays ONE cell', async () => {
  // Otherwise a cell holding two sentences becomes two rows and the columns
  // stop lining up from that point down.
  const bytes = await docx(
    `<w:tbl><w:tr><w:tc>${para('first line')}${para('second line')}</w:tc>${cell('42')}</w:tr></w:tbl>`,
  );
  const { text } = await extractDocx(bytes);
  assert.match(text, /first line second line \| 42/);
});

test('a document with no table or text box is unchanged', async () => {
  const { text } = await extractDocx(await docx(para('Just prose here.')));
  assert.match(text, /Just prose here\./);
  assert.doesNotMatch(text, /Tables in this document/);
  assert.doesNotMatch(text, /Text boxes/);
});

test('an empty table contributes no empty section', async () => {
  const { text } = await extractDocx(await docx(para('Prose') + '<w:tbl><w:tr><w:tc></w:tc></w:tr></w:tbl>'));
  assert.doesNotMatch(text, /Tables in this document/);
});

test('a NESTED table keeps its values, flattened into the parent row', async () => {
  /*
   * 🚨 STATED AS A LIMIT, NOT IMPLIED AS FULL SUPPORT. A table inside a cell has
   * its values recovered and kept on the parent row — `subsystem | firmware | v4`
   * — so nothing is silently lost, which is the failure that matters. The
   * nesting STRUCTURE is not preserved: a reader cannot tell from the output
   * that firmware/v4 were a sub-table rather than two more columns.
   *
   * Recorded because "nested tables work" and "nested table values are not
   * dropped" are different claims, and only the second one is true.
   */
  const inner = `<w:tbl><w:tr><w:tc>${para('firmware')}</w:tc><w:tc>${para('v4')}</w:tc></w:tr></w:tbl>`;
  const bytes = await docx(
    `<w:tbl>${row('component', 'count')}` +
    `<w:tr><w:tc>${para('subsystem')}</w:tc><w:tc>${inner}</w:tc></w:tr></w:tbl>`,
  );
  const { text } = await extractDocx(bytes);
  assert.match(text, /firmware/, 'a nested value must not be silently dropped');
  assert.match(text, /v4/);
  assert.match(text, /subsystem \| firmware \| v4/, 'flattened onto the parent row');
});
