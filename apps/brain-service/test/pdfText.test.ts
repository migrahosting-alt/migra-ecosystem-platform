/**
 * PDF extraction must distinguish "read it" from every way of failing to.
 *
 * The failure that matters is not a crash — it is a scanned or damaged PDF that
 * indexes as empty and then answers confidently from nothing. Each case below
 * pins a DIFFERENT outcome, because collapsing them into "could not read" would
 * send the user to the wrong remedy: a password, a re-scan, and a re-upload are
 * three different actions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { extractPdf, PdfExtractionError, pageForLine } from '../src/engine/rag/pdfText.js';

/*
 * Resolved from THIS MODULE, never from cwd. The compiled test runs out of
 * dist/test while the fixtures stay in test/fixtures, and cwd differs between
 * the app's own test command and an ad-hoc `node --test` invocation — so a
 * cwd-relative path passes in one and fails in the other for no real reason.
 */
const FIXTURES = fileURLToPath(new URL('../../test/fixtures/', import.meta.url));
const load = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name)));

test('a text PDF extracts its content and its page count', async () => {
  const out = await extractPdf(load('sample-text.pdf'));
  assert.equal(out.totalPages, 1);
  assert.equal(out.pages.length, 1);
  // The anchor is split by the PDF's own line wrap, exactly as a reader would
  // see it. Rejoining the hyphen is the caller's job, so the raw text keeps it.
  assert.match(out.text, /ANCHOR-TEXT-ALPHA/);
  assert.match(out.text.replace(/-\s*\n\s*/g, '-'), /ANCHOR-TEXT-OMEGA/);
});

test('page provenance survives extraction', async () => {
  const out = await extractPdf(load('sample-text.pdf'));
  assert.equal(out.pageStartLines.length, out.totalPages);
  assert.equal(pageForLine(out.pageStartLines, 1), 1, 'the first line is on page 1');
  // Page mapping must be monotonic — a later line can never resolve to an
  // earlier page, or a citation would point somewhere the text is not.
  let previous = 0;
  for (let line = 1; line <= 40; line += 1) {
    const page = pageForLine(out.pageStartLines, line);
    assert.ok(page >= previous, `line ${line} resolved backwards to page ${page}`);
    previous = page;
  }
});

test('a SCANNED pdf is reported as having no text layer, not as empty', async () => {
  // The whole point: this file is perfectly valid and holds zero extractable
  // characters. Returning "" would index it as a readable document with no
  // content, and the user would be told their scan says nothing.
  await assert.rejects(
    () => extractPdf(load('sample-scanned.pdf')),
    (error: unknown) => {
      assert.ok(error instanceof PdfExtractionError);
      assert.equal(error.failure.kind, 'no_text_layer');
      assert.match(error.message, /no readable text layer/i);
      return true;
    },
  );
});

test('an ENCRYPTED pdf is refused as password-protected', async () => {
  await assert.rejects(
    () => extractPdf(load('sample-encrypted.pdf')),
    (error: unknown) => {
      assert.ok(error instanceof PdfExtractionError);
      assert.equal(error.failure.kind, 'encrypted');
      assert.match(error.message, /password-protected/i);
      return true;
    },
  );
});

test('a MALFORMED pdf is refused as damaged, not as password-protected', async () => {
  // Truncated at a third, destroying the xref. Derived from the valid fixture so
  // the only difference between this case and the passing one is the damage.
  const whole = readFileSync(join(FIXTURES, 'sample-text.pdf'));
  const truncated = new Uint8Array(whole.subarray(0, Math.floor(whole.length / 3)));
  await assert.rejects(
    () => extractPdf(truncated),
    (error: unknown) => {
      assert.ok(error instanceof PdfExtractionError);
      assert.equal(error.failure.kind, 'corrupt');
      assert.match(error.message, /damaged/i);
      return true;
    },
  );
});

test('every failure carries a message a user can act on', async () => {
  // No stack traces, no parser jargon, and never the same sentence for two
  // different remedies.
  const messages = new Set<string>();
  for (const fixture of ['sample-scanned.pdf', 'sample-encrypted.pdf']) {
    await extractPdf(load(fixture)).catch((error: unknown) => {
      const message = (error as Error).message;
      assert.doesNotMatch(message, /at \w+ \(|Error:|undefined/, 'must not leak internals');
      messages.add(message);
    });
  }
  assert.equal(messages.size, 2, 'a scan and a locked file must not read identically');
});
