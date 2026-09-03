/**
 * A large PDF that was read in the background must actually reach the index.
 *
 * 🚨 THE DEFECT THIS EXISTS FOR, WHICH NOTHING ELSE COULD SEE.
 *
 * The directory walk skipped any file over the extraction ceiling BEFORE it
 * looked for an OCR sidecar. Once oversized PDFs started going to the background
 * reader, that ordering meant:
 *
 *   1. a 36 MB scanned book is enqueued and OCR'd — around two hours of CPU
 *   2. a perfectly good sidecar is written
 *   3. the walk sees 36 MB > 25 MB and skips the file, never reading the sidecar
 *   4. the index holds zero chunks for it
 *   5. the runner's own honesty check fires and reports "the pages were read but
 *      nothing could be indexed from them"
 *
 * The work happened, the text existed on disk, and the user waited two hours to
 * be told it failed. No unit test could catch it, because every piece behaved
 * correctly on its own — only the ORDER of two checks was wrong.
 *
 * The ceiling protects THIS WALK from loading a large file into memory. A
 * sidecar is a different, already-bounded artifact, and its existence is proof
 * the source was read somewhere else.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FsFileSource, DEFAULT_MAX_INDEX_FILE_BYTES } from '../src/engine/rag/fsFileSource.js';
import { OCR_SIDECAR_DIR } from '../src/engine/rag/scannedPdfJob.js';

/** A PDF larger than the ceiling, whose bytes nothing is expected to read. */
async function oversizedPdf(root: string, name: string, bytes: number): Promise<void> {
  const buf = Buffer.alloc(bytes, 0x20);
  Buffer.from('%PDF-1.7\n').copy(buf, 0);
  await writeFile(join(root, name), buf);
}

async function sidecarFor(root: string, name: string, text: string): Promise<void> {
  const dir = join(root, OCR_SIDECAR_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.json`), JSON.stringify({
    fileName: name, text, pageStartLines: [1], pages: [],
  }), 'utf8');
}

test('a PDF over the ceiling IS indexed once its sidecar exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'migrapilot-sidecar-'));
  try {
    const name = 'big-scanned-book.pdf';
    const ceiling = 1024 * 64;
    await oversizedPdf(root, name, ceiling * 4);
    await sidecarFor(root, name, 'Lor ou lan pays blanc, se pa menm bagay la.');

    const files = await new FsFileSource(root, 4000, ceiling).files();
    const found = files.find((f) => f.relPath === name);

    assert.ok(found, 'the background reader did the work; the walk must not discard it');
    assert.match(found!.content, /Lor ou lan pays blanc/,
      'the sidecar text is what gets indexed, not the PDF bytes');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a PDF over the ceiling with NO sidecar is still skipped', async () => {
  /*
   * The other half of the rule. Without a sidecar there is nothing to read but
   * the source itself, and reading a 36 MB PDF inside the walk is exactly what
   * the ceiling exists to prevent. It is left for the background reader.
   */
  const root = await mkdtemp(join(tmpdir(), 'migrapilot-sidecar-'));
  try {
    const ceiling = 1024 * 64;
    await oversizedPdf(root, 'unread.pdf', ceiling * 4);

    const files = await new FsFileSource(root, 4000, ceiling).files();
    assert.equal(files.find((f) => f.relPath === 'unread.pdf'), undefined,
      'nothing may read an oversized source file inside the walk');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the ceiling still applies to every non-sidecar path', async () => {
  /*
   * The restructure moved the size check later, so this pins that it still
   * guards the paths that read source bytes. A large text file has no sidecar
   * mechanism and must not be slurped into memory by the walk.
   */
  const root = await mkdtemp(join(tmpdir(), 'migrapilot-sidecar-'));
  try {
    const ceiling = 1024 * 8;
    await writeFile(join(root, 'huge.txt'), 'x'.repeat(ceiling * 4), 'utf8');
    await writeFile(join(root, 'small.txt'), 'readable', 'utf8');

    const files = await new FsFileSource(root, 4000, ceiling).files();
    assert.equal(files.find((f) => f.relPath === 'huge.txt'), undefined, 'oversized text is skipped');
    assert.ok(files.find((f) => f.relPath === 'small.txt'), 'ordinary text still indexes');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an empty file is skipped before anything else looks at it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'migrapilot-sidecar-'));
  try {
    await writeFile(join(root, 'empty.pdf'), '');
    const files = await new FsFileSource(root, 4000, DEFAULT_MAX_INDEX_FILE_BYTES).files();
    assert.equal(files.find((f) => f.relPath === 'empty.pdf'), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/*
 * 🚨 FOUND LIVE, IN PRODUCTION ACCEPTANCE.
 *
 * A sidecar is named after the FILE, and a filename is not an identity. During
 * the live run: a 245-page book was indexed, deleted, and an ALTERED copy with
 * the same name was uploaded. It went to "Ready" in seconds with no OCR —
 * because the walk found the previous document's sidecar and indexed ITS text
 * under the new file. The answer would have cited a document that no longer
 * existed.
 *
 * Delete now removes the sidecar, and the walk refuses one whose recorded digest
 * does not match the bytes in front of it. Both, because either alone leaves a
 * hole: a sidecar can outlive its source by other routes, and a stale one must
 * never be believed even if it is still on disk.
 */
test('a sidecar from a DIFFERENT document is refused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'migrapilot-sidecar-'));
  try {
    const name = 'report.pdf';
    const ceiling = 1024 * 64;
    await oversizedPdf(root, name, ceiling * 4);

    // A sidecar claiming a digest that is not this file's.
    const dir = join(root, OCR_SIDECAR_DIR);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${name}.json`), JSON.stringify({
      fileName: name,
      sourceSha256: 'f'.repeat(64),
      text: 'text belonging to a completely different document',
      pageStartLines: [1],
    }), 'utf8');

    const files = await new FsFileSource(root, 4000, ceiling).files();
    const found = files.find((f) => f.relPath === name);
    assert.equal(found, undefined,
      'another document\'s text must never be indexed under this file');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a sidecar whose digest MATCHES is used', async () => {
  const root = await mkdtemp(join(tmpdir(), 'migrapilot-sidecar-'));
  try {
    const name = 'report.pdf';
    const ceiling = 1024 * 64;
    await oversizedPdf(root, name, ceiling * 4);

    const { createHash } = await import('node:crypto');
    const { readFile } = await import('node:fs/promises');
    const digest = createHash('sha256').update(await readFile(join(root, name))).digest('hex');

    const dir = join(root, OCR_SIDECAR_DIR);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${name}.json`), JSON.stringify({
      fileName: name, sourceSha256: digest, text: 'the real recovered text', pageStartLines: [1],
    }), 'utf8');

    const files = await new FsFileSource(root, 4000, ceiling).files();
    assert.match(files.find((f) => f.relPath === name)?.content ?? '', /the real recovered text/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a sidecar with NO digest is still trusted', async () => {
  /*
   * Written before the field existed. Refusing these would silently discard
   * hours of completed OCR the moment this shipped — the exception closes itself
   * as sidecars are rewritten, because every new write records a digest.
   */
  const root = await mkdtemp(join(tmpdir(), 'migrapilot-sidecar-'));
  try {
    const name = 'legacy.pdf';
    const ceiling = 1024 * 64;
    await oversizedPdf(root, name, ceiling * 4);
    await sidecarFor(root, name, 'text from before digests were recorded');

    const files = await new FsFileSource(root, 4000, ceiling).files();
    assert.match(files.find((f) => f.relPath === name)?.content ?? '',
      /before digests were recorded/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
})
