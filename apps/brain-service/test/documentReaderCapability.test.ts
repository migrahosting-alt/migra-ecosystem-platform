/**
 * What this host can read is MEASURED, never declared.
 *
 * The staging defect: the product said "Reading documents you attach — yes.
 * PDF, …" on a host with no pdfinfo, pdftoppm or tesseract, where a scanned PDF
 * could not be read at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { binaryOnPath, documentReaderCapability } from '../src/engine/rag/documentReaderCapability.js';

const withOnly = (...present: string[]) => (b: string) => present.includes(b);

test('a host with every binary reports every sub-capability available', () => {
  const cap = documentReaderCapability(withOnly('pdfinfo', 'pdftoppm', 'tesseract'));
  assert.deepEqual(cap.subCapabilities, {
    pdf_text_extraction: 'available',
    pdf_page_rendering: 'available',
    pdf_ocr: 'available',
  });
  assert.deepEqual(cap.dependencies.filter((d) => !d.present), []);
});

test('🚨 staging: no binaries at all — text extraction survives, the rest does not', () => {
  const cap = documentReaderCapability(withOnly());
  // unpdf is in-process, so a text-layer PDF still reads. That is why the
  // answer is "partly" and not "no".
  assert.equal(cap.subCapabilities.pdf_text_extraction, 'available');
  assert.equal(cap.subCapabilities.pdf_page_rendering, 'unavailable');
  assert.equal(cap.subCapabilities.pdf_ocr, 'unavailable');
  assert.deepEqual(cap.dependencies.filter((d) => !d.present).map((d) => d.binary).sort(),
    ['pdfinfo', 'pdftoppm', 'tesseract']);
});

test('🚨 pdfinfo alone gates rendering, which is not obvious', () => {
  // probePdfTextLayer calls pdfPageCount -> pdfinfo as its FIRST step, so
  // without it every PDF fails before its content is examined. It is the gate
  // in front of the escalation route, not merely a page counter.
  const cap = documentReaderCapability(withOnly('pdftoppm', 'tesseract'));
  assert.equal(cap.subCapabilities.pdf_page_rendering, 'unavailable');
});

test('🚨 OCR without rendering is not OCR', () => {
  // tesseract reads IMAGES, and the images come from pdftoppm. Reporting
  // pdf_ocr available on a host that cannot rasterise advertises a path that
  // cannot be entered.
  const cap = documentReaderCapability(withOnly('tesseract'));
  assert.equal(cap.subCapabilities.pdf_ocr, 'unavailable');
});

test('a missing recogniser leaves rendering intact', () => {
  const cap = documentReaderCapability(withOnly('pdfinfo', 'pdftoppm'));
  assert.equal(cap.subCapabilities.pdf_page_rendering, 'available');
  assert.equal(cap.subCapabilities.pdf_ocr, 'unavailable');
});

test('every dependency says which sub-capability it gates', () => {
  for (const d of documentReaderCapability(withOnly()).dependencies) {
    assert.ok(d.required_by.length > 0, `${d.binary} gates nothing`);
  }
});

test('binaryOnPath looks on PATH and does not spawn anything', () => {
  // `sh` is on PATH on every host this runs on; a made-up name is not.
  assert.equal(binaryOnPath('sh'), true);
  assert.equal(binaryOnPath('definitely-not-a-real-binary-9f3c'), false);
  // An empty or broken PATH is answered honestly rather than throwing.
  assert.equal(binaryOnPath('sh', ''), false);
  assert.equal(binaryOnPath('sh', '/nonexistent::/also-nonexistent'), false);
});
