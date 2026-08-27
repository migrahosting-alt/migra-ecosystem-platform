/**
 * The ROUTING decisions, tested without invoking Tesseract.
 *
 * These are the choices that decide whether a scanned book is readable at all,
 * and they are pure functions precisely so they can be pinned here rather than
 * only observed in an expensive end-to-end run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { preferredPsm, passSatisfiesLayout, PSM_AUTO, PSM_BLOCK } from '../src/engine/rag/scannedOcr.js';

test('only column layouts prefer the block segmentation mode', () => {
  assert.equal(preferredPsm('vocabulary_columns'), PSM_BLOCK);
  // Everything else keeps psm 3, which is what recovers folios and section numbers.
  for (const layout of ['prose', 'chapter_title', 'uncertain', 'blank'] as const) {
    assert.equal(preferredPsm(layout), PSM_AUTO, `${layout} must not take the block mode`);
  }
});

test('a wall of words does NOT satisfy a vocabulary page', () => {
  /*
   * The check that would have hidden the whole segmentation problem. Both modes
   * return plenty of words on this page; only one keeps the French and Creole on
   * the same row, and that is the entire reason the page took psm 6.
   */
  const wordyButUnpaired = {
    folioCandidates: [39],
    sectionCandidates: ['30-'],
    chapterMarkers: [],
    columnPairs: 0,
    text: 'l\'absinthe\nl\'alcool\nle bifteck\nle boudin\n'.repeat(20),
  };
  assert.equal(passSatisfiesLayout('vocabulary_columns', wordyButUnpaired), false);

  const paired = { ...wordyButUnpaired, columnPairs: 29 };
  assert.equal(passSatisfiesLayout('vocabulary_columns', paired), true);
});

test('a prose page needs a placement signal, but not every placement signal', () => {
  const withFolio = { folioCandidates: [33], sectionCandidates: [], chapterMarkers: [], columnPairs: 0, text: 'x'.repeat(80) };
  const withSection = { folioCandidates: [], sectionCandidates: ['18-'], chapterMarkers: [], columnPairs: 0, text: 'x'.repeat(80) };
  assert.equal(passSatisfiesLayout('prose', withFolio), true);
  /*
   * Sections alone must pass. The binding curl physically truncates a page in
   * this scan and such a page can lose its printed folio entirely — demanding
   * both signals would reject a page that is honestly readable.
   */
  assert.equal(passSatisfiesLayout('prose', withSection), true);

  const neither = { folioCandidates: [], sectionCandidates: [], chapterMarkers: [], columnPairs: 0, text: 'x'.repeat(80) };
  assert.equal(passSatisfiesLayout('prose', neither), false, 'no placement signal means escalate');
});

test('a chapter title passes on its marker OR on having real text', () => {
  const marker = { folioCandidates: [], sectionCandidates: [], chapterMarkers: ['CHAPIT 2'], columnPairs: 0, text: 'short' };
  assert.equal(passSatisfiesLayout('chapter_title', marker), true);

  const sparseButReal = { folioCandidates: [], sectionCandidates: [], chapterMarkers: [], columnPairs: 0, text: 'Vokabile kreyol la ak lis mo yo' };
  assert.equal(passSatisfiesLayout('chapter_title', sparseButReal), true);

  const empty = { folioCandidates: [], sectionCandidates: [], chapterMarkers: [], columnPairs: 0, text: '   ' };
  assert.equal(passSatisfiesLayout('chapter_title', empty), false);
});
