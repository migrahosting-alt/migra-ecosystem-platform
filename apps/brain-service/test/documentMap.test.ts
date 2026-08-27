/**
 * Reconstruction must place pages from EVIDENCE and stay silent where it has none.
 *
 * Every case here is drawn from the Haitian Creole scan, because each was a real
 * wrong answer before it was a test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reconstructDocument, parseDeclaredRanges, toSearchText } from '../src/engine/rag/documentMap.js';
import type { ScannedPageRecord } from '../src/engine/rag/scannedOcr.js';

const page = (over: Partial<ScannedPageRecord> = {}): ScannedPageRecord => ({
  scanIndex: 1, physicalPosition: 'right', layout: 'prose', layoutReason: '',
  passes: [], selectedPsm: '3', selectionReason: '', selectedText: 'text of the page',
  folioCandidates: [], sectionCandidates: [], chapterMarkers: [], columnPairs: 0, confidence: 90,
  ...over,
});

test('order comes from folios, NOT from scan order', () => {
  // The scan really does carry a later page first; trusting upload order is the
  // defect this whole module exists to prevent.
  const map = reconstructDocument([
    page({ scanIndex: 22, folioCandidates: [33], selectedText: 'later page' }),
    page({ scanIndex: 2, folioCandidates: [7], selectedText: 'earlier page' }),
  ]);
  assert.deepEqual(map.pages.map((p) => p.folio), [7, 33]);
  assert.equal(map.pages[0]!.scanIndex, 2, 'the page printed 7 leads, though it was scanned second');
});

test('a page with no placement evidence is marked uncertain, never guessed', () => {
  const map = reconstructDocument([page({ scanIndex: 4, selectedText: 'prose with no folio or section' })]);
  assert.equal(map.pages[0]!.state, 'sequence_uncertain');
  assert.equal(map.pages[0]!.canonicalIndex, undefined, 'no position may be invented');
});

test('two pages claiming the same folio: the second is a duplicate', () => {
  const map = reconstructDocument([
    page({ scanIndex: 12, folioCandidates: [33], selectedText: 'first capture' }),
    page({ scanIndex: 23, folioCandidates: [33], selectedText: 'second capture, different OCR noise' }),
  ]);
  assert.equal(map.summary.duplicates, 1);
  assert.equal(map.pages.find((p) => p.scanIndex === 23)!.state, 'duplicate');
});

test('an ambiguous folio is discarded rather than picked', () => {
  // Two standalone numbers means one is a section, a year or a table cell.
  const map = reconstructDocument([page({ folioCandidates: [33, 18], sectionCandidates: ['18-'] })]);
  assert.equal(map.pages[0]!.folio, undefined);
  assert.equal(map.pages[0]!.state, 'probable', 'sections still place it approximately');
});

test('a one-page gap is the book rhythm, not a missing page', () => {
  // Only rectos were photographed, so folios step by two. The first run reported
  // the entire book as damaged by treating that stride as a hole.
  const map = reconstructDocument([17, 19, 21, 23].map((f, i) =>
    page({ scanIndex: i + 5, folioCandidates: [f] })));
  assert.deepEqual(map.missingFolios, []);
  assert.equal(map.summary.confirmed, 4);
});

test("the chapter's own declaration anchors it BEFORE its content", () => {
  const map = reconstructDocument([
    page({ scanIndex: 10, folioCandidates: [29], sectionCandidates: ['30-'] }),
    page({ scanIndex: 13, chapterMarkers: ['CHAPIT 2'], selectedText: 'CHAPIT 2 Vokabile kreyol - Mo ki soti nan franse # 29 rive # 40' }),
  ]);
  assert.equal(map.validationFailures.length, 0, 'the opening must not land after its own sections');
  const opening = map.pages.findIndex((p) => p.chapterMarkers.includes('CHAPIT 2'));
  const content = map.pages.findIndex((p) => p.folio === 29);
  assert.ok(opening < content, 'chapter opening precedes the section it declares');
});

test('declared ranges are parsed from the book itself', () => {
  const ranges = parseDeclaredRanges('- Mo ki soti nan franse # 29 rive # 40\n- ... # 68 ak 70', 'CHAPIT 2');
  assert.deepEqual(ranges.map((r) => [r.from, r.to]), [[29, 40], [68, 70]]);
});

test('the source transcript is never normalised', () => {
  const historical = "Lor ou lan pays blanc, ou pas ouè mango";
  const map = reconstructDocument([page({ folioCandidates: [17], selectedText: historical })]);
  assert.equal(map.pages[0]!.sourceText, historical, 'older orthography must survive exactly');
  assert.notEqual(map.pages[0]!.searchText, historical, 'the derived field is separate');
  assert.match(toSearchText(historical), /oue mango/, 'search text folds diacritics for matching only');
});
