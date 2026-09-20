// mp-0005 — reading a PowerPoint deck. © MigraTeck LLC.
//
// The three traps this covers were not invented. Slide order and notes pairing
// are both cases where a naive reader produces CONFIDENT, WRONG provenance —
// the deck's equivalent of citing the wrong page — and the master-furniture
// case was found by running the extractor against genuine PowerPoint files
// rather than against a fixture, where it emitted `Speaker notes: 1` for decks
// that had no notes at all.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { extractPptx, PptxExtractionError } from '../src/engine/rag/pptxText.js';

/** One drawing-ML paragraph. */
const para = (text: string): string =>
  `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`;

/** A shape holding paragraphs. */
const shape = (body: string, placeholder?: string): string =>
  `<p:sp><p:nvSpPr><p:nvPr>${
    placeholder ? `<p:ph type="${placeholder}"/>` : ''
  }</p:nvPr></p:nvSpPr><p:txBody>${body}</p:txBody></p:sp>`;

const slide = (inner: string): string =>
  `<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>${inner}</p:spTree></p:cSld></p:sld>`;

/**
 * A deck whose PRESENTATION order is the reverse of its filename order, which
 * is exactly what PowerPoint produces after a user drags a slide.
 */
async function buildDeck(): Promise<Buffer> {
  const zip = new JSZip();

  // sldIdLst names slide2 FIRST. Filenames say otherwise, deliberately.
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0"?><p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>` +
      `<p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/><p:sldId id="258" r:id="rId3"/>` +
      `</p:sldIdLst></p:presentation>`,
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0"?><Relationships>` +
      `<Relationship Id="rId1" Target="slides/slide1.xml"/>` +
      `<Relationship Id="rId2" Target="slides/slide2.xml"/>` +
      `<Relationship Id="rId3" Target="slides/slide3.xml"/>` +
      `</Relationships>`,
  );

  // slide1: prose, plus master furniture that must NOT survive.
  zip.file(
    'ppt/slides/slide1.xml',
    slide(shape(para('Revenue recovered in the second half.')) + shape(para('7'), 'sldNum')),
  );

  // slide2: a table. Rows must stay rows.
  zip.file(
    'ppt/slides/slide2.xml',
    slide(
      shape(para('Regional split')) +
        `<a:tbl>` +
        `<a:tr><a:tc>${para('Region')}</a:tc><a:tc>${para('Units')}</a:tc></a:tr>` +
        `<a:tr><a:tc>${para('North')}</a:tc><a:tc>${para('1200')}</a:tc></a:tr>` +
        `</a:tbl>`,
    ),
  );

  // slide3: no text at all. Still a slide a user can refer to by number.
  zip.file('ppt/slides/slide3.xml', slide(''));

  // 🚨 The notes part is notesSlide1, and it belongs to slide2 — NOT slide 1.
  // Pairing by number would attach it to the wrong slide and read as evidence.
  zip.file(
    'ppt/slides/_rels/slide2.xml.rels',
    `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="../notesSlides/notesSlide1.xml"/></Relationships>`,
  );
  zip.file(
    'ppt/notesSlides/notesSlide1.xml',
    slide(shape(para('North is inflated by a one-off order.')) + shape(para('2'), 'sldNum')),
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}

test('slides are read in PRESENTATION order, not filename order', async () => {
  // The whole point: a user who reordered slides must not get reordered answers.
  const out = await extractPptx(await buildDeck());
  assert.equal(out.slideCount, 3);
  const table = out.text.indexOf('Regional split');
  const prose = out.text.indexOf('Revenue recovered');
  assert.ok(table < prose, 'slide2 must come first — sldIdLst names it first');
  assert.match(out.text, /--- Slide 1 ---\s*\nRegional split/);
});

test('a table survives as rows, not as a list of cells', async () => {
  // The .docx lesson: every value present with the relationship destroyed is
  // an unanswerable document.
  const out = await extractPptx(await buildDeck());
  assert.ok(out.text.includes('Region | Units'), 'header row was flattened');
  assert.ok(out.text.includes('North | 1200'), 'data row was flattened');
});

test('speaker notes attach to the slide that OWNS them', async () => {
  const out = await extractPptx(await buildDeck());
  assert.equal(out.hasNotes, true);
  // notesSlide1 belongs to slide2, which is slide 1 in presentation order.
  const slide1 = out.text.slice(
    out.text.indexOf('--- Slide 1 ---'),
    out.text.indexOf('--- Slide 2 ---'),
  );
  const slide2 = out.text.slice(
    out.text.indexOf('--- Slide 2 ---'),
    out.text.indexOf('--- Slide 3 ---'),
  );
  assert.ok(slide1.includes('Speaker notes: North is inflated by a one-off order.'),
    'the notes landed on the wrong slide');
  /*
   * 🚨 THE ASSERTION THAT ACTUALLY CATCHES MIS-PAIRING, and it was missing.
   * Checking only that the right slide HAS the notes passes even when a broken
   * reader also staples them to slides that do not own them — proven by a
   * negative control that paired notesSlideN to slideN and still went green.
   * Exactly one slide owns this note.
   */
  assert.ok(!slide2.includes('Speaker notes'), 'notes were stapled to a slide that does not own them');
  assert.equal(out.text.match(/Speaker notes:/g)?.length, 1, 'the note was duplicated across slides');
});

test('master furniture is dropped from slides and from notes', async () => {
  // Found on three real PowerPoint decks, which all emitted `Speaker notes: 1`.
  const out = await extractPptx(await buildDeck());
  assert.ok(!/Speaker notes: 2\b/.test(out.text), 'a slide-number placeholder reached the notes');
  assert.ok(!/^7$/m.test(out.text), 'a slide-number placeholder reached the body');
});

test('an empty slide is still numbered', async () => {
  // Skipping it would silently renumber every slide after it, so "slide 3"
  // would name different content depending on whether a slide had text.
  const out = await extractPptx(await buildDeck());
  assert.ok(out.text.includes('--- Slide 3 ---'), 'the empty slide was dropped');
});

test('charts and embedded workbooks are REPORTED, never silently dropped', async () => {
  const zip = await JSZip.loadAsync(await buildDeck());
  zip.file('ppt/charts/chart1.xml', '<c:chart/>');
  const out = await extractPptx(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.equal(out.hasUnreadCharts, true, 'a deck with a chart claimed to be read whole');
});

test('a deck with no slides fails loudly rather than indexing as empty', async () => {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', '<p:presentation/>');
  await assert.rejects(
    () => extractPptx(zip.generateAsync({ type: 'nodebuffer' }) as unknown as Buffer),
    (e: unknown) => e instanceof PptxExtractionError || e instanceof Error,
  );
});

test('a file that is not a PowerPoint package is refused, not guessed at', async () => {
  await assert.rejects(
    () => extractPptx(Buffer.from('this is plainly not a deck')),
    (e: unknown) => e instanceof PptxExtractionError,
  );
});
