/**
 * Reading a large PDF without exhausting the Brain.
 *
 * 🚨 THE DEFECT. A 35.5 MB PDF uploaded fine, was stored, and was then reported
 * as "too large for MigraPilot to read" — a dead object in the user's library.
 * The synchronous parser's 25 MB ceiling protects THIS PROCESS from loading a
 * whole document into memory; it was never a claim that the document is
 * unreadable. The fix is to read it a page at a time, in the background.
 *
 * These run against real PDFs and real poppler, not mocks. The routing decision
 * — text layer or OCR — is the expensive one to get wrong in either direction,
 * so it is proven against a digital PDF and a scanned one rather than asserted.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import {
  extractPdfPageText,
  extractPdfTextPages,
  pdfPageCount,
  probePdfTextLayer,
} from '../src/engine/rag/pdfTextLayer.js';
import {
  processTextLayerPdf,
  readinessFromTextExtraction,
} from '../src/engine/rag/textLayerPdfJob.js';

/** Resolves from source and from the compiled `dist/test` the suite actually runs. */
const fixture = (name: string) => fileURLToPath(new URL(`../../test/fixtures/${name}`, import.meta.url));

const TEXT_PDF = fixture('sample-text.pdf');
const SCANNED_PDF = fixture('sample-scanned.pdf');

test('a digital PDF is recognised as having a text layer', async () => {
  const probe = await probePdfTextLayer(TEXT_PDF);
  assert.equal(probe.hasTextLayer, true, probe.reason);
  assert.ok(probe.pages >= 1);
  assert.ok(probe.sampledCharsPerPage > 0, 'the decision must cite measured characters');
});

test('a scanned PDF is NOT sent down the text path', async () => {
  /*
   * The expensive mistake in the other direction. A scan often carries a thin
   * text layer — scanner headers, a few artefacts — and treating that as
   * readable would skip OCR and index almost nothing, leaving a book that looks
   * processed and answers nothing.
   */
  const probe = await probePdfTextLayer(SCANNED_PDF);
  assert.equal(probe.hasTextLayer, false, probe.reason);
  // The reason must cite MEASURED evidence, not merely assert a verdict —
  // asserting the exact prose instead was what broke this test when the probe
  // learned to report its best page as well as its mean.
  assert.match(probe.reason, /\d+ characters/);
  assert.equal(probe.sampledCharsPerPage, 0, 'a scan has no extractable text at all');
});

test('page count comes from poppler, not from parsing bytes ourselves', async () => {
  assert.ok((await pdfPageCount(TEXT_PDF)) >= 1);
});

test('one page is extracted per call, so peak memory is a page', async () => {
  const text = await extractPdfPageText(TEXT_PDF, 1);
  assert.ok(text.trim().length > 50, 'real text must come back');
});

test('every page is read, in order, and empty pages are reported', async () => {
  const pages = await pdfPageCount(TEXT_PDF);
  const seen: number[] = [];
  const result = await extractPdfTextPages(TEXT_PDF, pages, {
    onPage: async (page) => { seen.push(page); },
  });

  assert.deepEqual(seen, Array.from({ length: pages }, (_, i) => i + 1),
    'progress is reported for every page, in order');
  assert.equal(result.pages.length + result.emptyPages.length, pages,
    'every page is accounted for as either read or empty');
  assert.ok(result.totalCharacters > 0);
});

test('progress is reported BEFORE each page, so a crash names the page it died on', async () => {
  /*
   * Ordering, not decoration. Reporting after the work means a job that dies on
   * page 40 leaves "page 39 done" behind, and a resume starts from the wrong
   * place. The scanned job made the same promise; this holds the text path to it.
   */
  const order: string[] = [];
  await extractPdfTextPages(TEXT_PDF, 1, {
    onPage: async (page) => { order.push(`report:${page}`); },
  });
  assert.equal(order[0], 'report:1');
});

test('the job produces pages placed by the FILE\'s order, not an inferred one', async () => {
  const stages: string[] = [];
  const result = await processTextLayerPdf(TEXT_PDF, 'sample-text.pdf', {
    report: async (r) => { stages.push(`${r.state}:${r.stage ?? ''}`); },
  });

  assert.ok(result.map.pages.length > 0);
  for (const [i, page] of result.map.pages.entries()) {
    assert.equal(page.canonicalIndex, page.scanIndex, 'the file states the order; nothing is inferred');
    assert.equal(page.basis, 'file_page_order');
    assert.equal(page.indexAction, 'index');
    assert.equal(page.confidence, 1, 'nothing was estimated, so nothing is discounted');
    if (i > 0) {
      assert.ok(page.canonicalIndex! > result.map.pages[i - 1]!.canonicalIndex!, 'strictly ascending');
    }
  }
  assert.ok(stages.some((s) => s.startsWith('processing:')), 'stages are reported while it runs');
});

test('the transcript is exact, and the search form is separate', async () => {
  /*
   * The same rule the OCR path follows, and for the same reason: a document may
   * mix orthographies, and normalising the transcript destroys what it says.
   * Two fields, never one.
   */
  const result = await processTextLayerPdf(TEXT_PDF, 'sample-text.pdf', { report: async () => {} });
  const page = result.map.pages[0]!;
  assert.ok(page.sourceText.length > 0);
  assert.ok(page.searchText.length > 0);
  assert.notEqual(page.sourceText, page.searchText, 'the derived form is derived, not the same string');
});

test('a scanned PDF refuses the text path in the shape the runner understands', async () => {
  /*
   * `failure.kind === 'no_text_layer'` is what `classifyFailure` reads and what
   * the runner catches to fall back to OCR. A plain Error would be classified as
   * an OCR failure and the document would be abandoned instead of escalated.
   */
  await assert.rejects(
    () => processTextLayerPdf(SCANNED_PDF, 'sample-scanned.pdf', { report: async () => {} }),
    (error: unknown) => (error as { failure?: { kind?: string } })?.failure?.kind === 'no_text_layer',
  );
});

test('a document that yielded nothing is never called ready', () => {
  const empty = readinessFromTextExtraction('x.pdf', {
    map: { pages: [], declaredRanges: [], validationFailures: [], missingFolios: [],
           summary: { confirmed: 0, probable: 0, uncertain: 0, duplicates: 0 } },
    pageCount: 10, emptyPages: [1,2,3,4,5,6,7,8,9,10], totalCharacters: 0,
  }, 1);
  assert.equal(empty.state, 'no_text_layer');
  assert.match(empty.failureReason!, /no page yielded any text/);
});

test('some empty pages are normal and do not make a document unreadable', () => {
  const partial = readinessFromTextExtraction('x.pdf', {
    map: { pages: [{ scanIndex: 1 } as never], declaredRanges: [], validationFailures: [],
           missingFolios: [], summary: { confirmed: 1, probable: 0, uncertain: 0, duplicates: 0 } },
    pageCount: 3, emptyPages: [2, 3], totalCharacters: 500,
  }, 1);
  // Blank versos and image plates are ordinary. The document is READY; the
  // sequence simply is not complete, and that is recorded rather than hidden.
  assert.equal(partial.state, 'ready');
  assert.equal(partial.sequenceComplete, false);
});

/*
 * 🚨 REPRODUCES THE PRODUCTION FAILURE: a 40 MB digital PDF was classified as
 * having no text layer, sent to OCR, and reported as "the pages were rendered
 * but no readable text was recovered" — a readable document declared unreadable.
 *
 * The cause was averaging. A PDF is large because it embeds images, so exactly
 * the documents most likely to be big are the ones where a title page, a
 * full-page image and one dense page average below the bar.
 */
test('a mostly-image PDF with real prose on some pages HAS a text layer', async () => {
  const probe = await probePdfTextLayer(TEXT_PDF);
  assert.equal(probe.hasTextLayer, true, probe.reason);
  // The verdict cites its evidence, including the best page — the signal that
  // rescues a sparse document the mean would have failed.
  assert.match(probe.reason, /best page \d+/);
});

test('the probe spreads its sample across the whole document', async () => {
  /*
   * Front matter is unrepresentative in BOTH directions: a scan's cover is
   * blank and a report's title page is often its only text. Clustering the
   * sample at the front or the middle judges the document by its least typical
   * pages.
   */
  const src = readFileSync(
    fileURLToPath(new URL('../../src/engine/rag/pdfTextLayer.ts', import.meta.url)), 'utf8');
  assert.match(src, /const step = Math\.max\(1, Math\.floor\(pages \/ PROBE_PAGES\)\)/);
  assert.match(src, /strongest >= STRONG_PAGE_CHARS/, 'either signal must be enough');
});

test('empty OCR falls back to the text layer before reporting failure', () => {
  /*
   * A probe is a SAMPLE and will be wrong on some document. "OCR found nothing"
   * and "there is nothing to find" are different claims, so the cheap path is
   * checked before the user is told their readable file is unreadable.
   */
  const jobs = readFileSync(
    fileURLToPath(new URL('../../src/engine/rag/documentJobs.ts', import.meta.url)), 'utf8');
  assert.match(jobs, /if \(map\.pages\.length === 0\)/, 'empty OCR must be detected');
  assert.match(jobs, /OCR recovered nothing; checking for a text layer/);
})

/*
 * ---------------------------------------------------------------------------
 * A HOST WITH NO POPPLER.
 *
 * 🚨 THE DEFECT THESE PIN. Staging had no poppler at all. `probePdfTextLayer`
 * calls `pdfPageCount` — `pdfinfo` — as its FIRST step, so every PDF threw
 * before its content was examined, the runner read that as "no text layer", and
 * the document fell through to the scanned pipeline, which failed on the
 * missing rasteriser. A 5 KB five-page digital contract was reported in Files as
 * "This document could not be read: the page renderer is not available on this
 * server" while chat answered six questions from it correctly, because the
 * in-process reader had read it perfectly.
 *
 * PATH is emptied rather than mocked: the binaries are found by the OS at spawn
 * time, so removing them from PATH reproduces the deploy target exactly, which a
 * stubbed `execFile` would not.
 */
const withoutPoppler = async <T>(run: () => Promise<T>): Promise<T> => {
  const path = process.env.PATH;
  process.env.PATH = '/nonexistent';
  try {
    return await run();
  } finally {
    process.env.PATH = path;
  }
};

test('a text-layer PDF is still read when poppler is not installed', async () => {
  const { probe, extraction } = await withoutPoppler(async () => {
    const probe = await probePdfTextLayer(TEXT_PDF);
    return { probe, extraction: await extractPdfTextPages(TEXT_PDF, probe.pages, {}) };
  });

  assert.equal(probe.hasTextLayer, true, probe.reason);
  assert.ok(probe.pages >= 1, 'the page count must survive the missing pdfinfo');
  assert.equal(extraction.pages.length, probe.pages);
  assert.ok(extraction.totalCharacters > 0, 'the text must actually come back');
});

test('a scan still escalates to OCR when poppler is not installed', async () => {
  /*
   * The fallback must not rescue a document it cannot read. An image-only PDF
   * still HAS pages — so the count answers — but no text on them, so the probe
   * says so on the evidence and the runner sends it to OCR deliberately rather
   * than by swallowing an error.
   */
  const { pages, probe } = await withoutPoppler(async () => ({
    pages: await pdfPageCount(SCANNED_PDF),
    probe: await probePdfTextLayer(SCANNED_PDF),
  }));

  assert.ok(pages >= 1, 'a scan has pages even with no text on them');
  assert.equal(probe.hasTextLayer, false, probe.reason);
});

test('a single page still reads by number when poppler is not installed', async () => {
  const [viaFallback, viaPoppler] = [
    await withoutPoppler(() => extractPdfPageText(TEXT_PDF, 1)),
    await extractPdfPageText(TEXT_PDF, 1),
  ];
  // Different readers, so the exact whitespace differs; the words must not.
  const words = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 60);
  assert.ok(words(viaFallback).length > 0, 'the fallback must return page 1');
  assert.equal(words(viaFallback), words(viaPoppler));
});

test('above the in-process ceiling the truthful poppler failure survives', () => {
  /*
   * In-process parsing holds the whole document in the heap — the cost
   * `pdftotext` was chosen to avoid — so the fallback stops at the same ceiling
   * the synchronous extractor uses. Above it the ORIGINAL error is rethrown,
   * because `reader_unavailable` is then simply TRUE: this host really cannot
   * read that document.
   *
   * Asserted on the source: the ceiling is read at module load, so exercising it
   * would need a whole child process for one branch.
   */
  const src = readFileSync(
    fileURLToPath(new URL('../../src/engine/rag/pdfTextLayer.ts', import.meta.url)), 'utf8');
  assert.match(src, /if \(info\.size > DEFAULT_MAX_INDEX_FILE_BYTES\) throw popplerError;/);
  assert.match(src, /if \(!binaryMissing\(error, POPPLER_TEXT\)\) throw error;/,
    'a poppler that RAN and failed is telling us about the document, and must not be overruled');
});
