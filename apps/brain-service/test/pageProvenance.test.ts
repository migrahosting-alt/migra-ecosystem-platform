// mp-0006 — a page citation must name a page that exists. © MigraTeck LLC.
//
// 🚨 FOUND ON THE LIVE PRODUCT, NOT IN A REVIEW. A markdown file with no pages
// at all was cited as "vendor_terms.md · page 2026", because its heading read
// "# Northwind Vendor Terms 2026".
//
// The cause is an OVERLOADED FIELD. A chunk's `symbol` carries a page label for
// a paged document, a code symbol for source, and a HEADING for prose — and the
// page extractor scraped every digit run out of it, then expanded first..last
// into a range. So a heading containing a year became a page, and a heading
// reading "Section 3 to 9" would have produced SEVEN fabricated page citations.
//
// Provenance is the one thing that must never be invented: it is what a reader
// uses to check the answer. Under-reporting is the correct direction to be wrong.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pagesFromChunks } from '../src/engine/chat/aiRoutes.js';

const chunk = (path: string, location?: string): { path: string; location?: string } =>
  (location === undefined ? { path } : { path, location });

test('🚨 a prose heading containing a number is NOT a page', () => {
  // The exact shape that produced "page 2026" in the product.
  const pages = pagesFromChunks([chunk('vendor_terms.md', 'Northwind Vendor Terms 2026')]);
  assert.deepEqual(pages, {}, 'a markdown heading was reported as a page');
});

test('🚨 a heading that looks like a span fabricates nothing', () => {
  // The worse half: digit-scraping plus range expansion turned one heading into
  // a run of pages nobody retrieved.
  const pages = pagesFromChunks([chunk('notes.md', 'Section 3 to 9')]);
  assert.deepEqual(pages, {}, 'a heading was expanded into a page range');
});

test('a code symbol is not a page either', () => {
  const pages = pagesFromChunks([chunk('server.ts', 'handleRequest2')]);
  assert.deepEqual(pages, {}, 'a code symbol was reported as a page');
});

test('a real page label still cites its page', () => {
  // The capability must survive the fix: PDFs are why this exists.
  const pages = pagesFromChunks([chunk('report.pdf', 'page 7')]);
  assert.deepEqual(pages, { 'report.pdf': [7] });
});

test('a chunk spanning a page break cites both, and only both', () => {
  const pages = pagesFromChunks([chunk('report.pdf', 'pages 7-8')]);
  assert.deepEqual(pages, { 'report.pdf': [7, 8] });
});

test('pages from several chunks merge, deduplicated and sorted', () => {
  const pages = pagesFromChunks([
    chunk('report.pdf', 'page 9'),
    chunk('report.pdf', 'page 2'),
    chunk('report.pdf', 'page 9'),
  ]);
  assert.deepEqual(pages, { 'report.pdf': [2, 9] }, 'scattered pages must not collapse into a span');
});

test('a chunk with no location contributes no page', () => {
  assert.deepEqual(pagesFromChunks([chunk('plain.txt')]), {});
});
