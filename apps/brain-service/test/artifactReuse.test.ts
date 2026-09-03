/**
 * Never OCR the same book twice — and never launder its trust on the way past.
 *
 * 🚨 WHAT THIS IS FOR. `liv_kreyol_AI-Training.pdf` is a 245-page scan whose OCR
 * cost hours and was already paid for once, in the Kreyòl PASS 2 run. Uploading
 * it started that work again from zero, because ingestion could not recognise a
 * document it had already read.
 *
 * The reuse is only safe under two rules, and both are asserted here rather than
 * assumed:
 *
 *   1. IDENTITY IS THE DIGEST. A filename is a label; SHA-256 over the bytes is
 *      the only claim strong enough to justify skipping the work. Attaching one
 *      book's text to another book's bytes is far worse than redoing the OCR.
 *   2. REUSE DOES NOT PROMOTE TRUST. Registered pages are `machine_extracted`,
 *      `certified: false`, and they come out that way. Recognising a document is
 *      not verifying it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  findRegisteredArtifact,
  hashFile,
  listRegisteredArtifacts,
  reuseProvenance,
  type RegisteredArtifact,
} from '../src/engine/rag/artifactReuse.js';
import {
  processRegisteredArtifact,
  readinessFromReuse,
} from '../src/engine/rag/reusedArtifactJob.js';

const DIGEST_A = 'a'.repeat(64);

function artifactOf(over: Partial<RegisteredArtifact> = {}): RegisteredArtifact {
  return {
    sha256: DIGEST_A,
    sourceId: 'HC-S009',
    sourceFile: 'liv_kreyol_AI-Training.pdf',
    pages: [
      { page: 1, text: 'Lor ou lan pays blanc, se pa menm bagay la.' },
      { page: 2, text: 'Dezyèm paj la, ak yon lòt fason pou ekri.' },
    ],
    provenance: { engine: 'tesseract', langs: 'hat+fra', dpi: 300, pass: 2, certified: false },
    ...over,
  };
}

async function registry(entries: RegisteredArtifact[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'migrapilot-registry-'));
  for (const e of entries) await writeFile(join(dir, `${e.sha256}.json`), JSON.stringify(e), 'utf8');
  return dir;
}

test('a known artifact is found by the digest of its bytes', async () => {
  const dir = await registry([artifactOf()]);
  try {
    const found = await findRegisteredArtifact(DIGEST_A, dir);
    assert.ok(found);
    assert.equal(found!.sourceId, 'HC-S009');
    assert.equal(found!.pages.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an entry whose recorded digest disagrees with its filename is REFUSED', async () => {
  /*
   * Corrupt or tampered with. Reusing it would attach one document's text to
   * another document's bytes, which is a far worse outcome than doing the OCR —
   * the answer would be confidently wrong and cite a real-looking source.
   */
  const dir = await mkdtemp(join(tmpdir(), 'migrapilot-registry-'));
  try {
    await writeFile(join(dir, `${DIGEST_A}.json`),
      JSON.stringify(artifactOf({ sha256: 'b'.repeat(64) })), 'utf8');
    assert.equal(await findRegisteredArtifact(DIGEST_A, dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('malformed, empty and unknown entries fall through to real ingestion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'migrapilot-registry-'));
  try {
    await writeFile(join(dir, `${'c'.repeat(64)}.json`), 'not json at all', 'utf8');
    await writeFile(join(dir, `${'d'.repeat(64)}.json`),
      JSON.stringify(artifactOf({ sha256: 'd'.repeat(64), pages: [] })), 'utf8');

    // Reuse is an OPTIMISATION. Every failure here must return null so the
    // document is really read, never fail the document.
    assert.equal(await findRegisteredArtifact('c'.repeat(64), dir), null, 'malformed');
    assert.equal(await findRegisteredArtifact('d'.repeat(64), dir), null, 'no pages');
    assert.equal(await findRegisteredArtifact('e'.repeat(64), dir), null, 'unknown digest');
    assert.equal(await findRegisteredArtifact('not-a-digest', dir), null, 'not a digest');
    assert.equal(await findRegisteredArtifact(DIGEST_A, '/nonexistent'), null, 'absent registry');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the digest is computed over the file, streamed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'migrapilot-hash-'));
  try {
    const path = join(dir, 'doc.pdf');
    const bytes = Buffer.from('%PDF-1.7\nsome bytes\n');
    await writeFile(path, bytes);
    assert.equal(await hashFile(path), createHash('sha256').update(bytes).digest('hex'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('🚨 reuse never raises certified, and says where the text came from', async () => {
  const artifact = artifactOf();
  const result = await processRegisteredArtifact(artifact, 'book.pdf', { report: async () => {} });

  assert.equal(result.map.pages.length, 2);
  for (const page of result.map.pages) {
    // The evidence string is what a later reader has. It must say the text was
    // REUSED and that it is uncertified — "OCR" alone would be true and useless.
    assert.match(page.evidence, /reused from HC-S009/);
    assert.match(page.evidence, /certified false/);
    assert.ok(page.confidence < 1, 'inherited text must not claim the certainty of a stated order');
  }
  assert.match(reuseProvenance(artifact), /engine tesseract/);
  assert.match(reuseProvenance(artifact), /langs hat\+fra/);
  assert.match(reuseProvenance(artifact), /certified false/);
});

test('the transcript is carried through exactly, never normalised', async () => {
  /*
   * This corpus mixes older French-influenced Creole with the modern
   * orthography. Rewriting either would destroy what the page says, and the
   * whole reason PASS 2 kept `source_transcription` untouched.
   */
  const original = 'Lor ou lan pays blanc, se pa menm bagay la.';
  const result = await processRegisteredArtifact(artifactOf(), 'book.pdf', { report: async () => {} });
  assert.equal(result.map.pages[0]!.sourceText, original);
  assert.notEqual(result.map.pages[0]!.searchText, original, 'the search form is separate and derived');
});

test('pages are ordered, and empty ones are dropped but still counted', async () => {
  const artifact = artifactOf({
    pages: [
      { page: 3, text: 'third' },
      { page: 1, text: 'first' },
      { page: 2, text: '   ' },
    ],
  });
  const result = await processRegisteredArtifact(artifact, 'book.pdf', { report: async () => {} });

  assert.deepEqual(result.map.pages.map((p) => p.canonicalIndex), [1, 3], 'sorted, blanks dropped');
  assert.equal(result.pageCount, 3, 'the blank page is still counted');

  const terminal = readinessFromReuse('book.pdf', result, 1);
  assert.equal(terminal.state, 'ready');
  assert.equal(terminal.sequenceComplete, false, 'a dropped page means the sequence is incomplete');
});

test('a registered artifact with nothing readable fails visibly', async () => {
  const result = await processRegisteredArtifact(
    artifactOf({ pages: [{ page: 1, text: '  ' }] }), 'book.pdf', { report: async () => {} });
  const terminal = readinessFromReuse('book.pdf', result, 1);
  // A broken registry ENTRY, not a broken document. Reported rather than
  // silently producing an empty book; the next upload runs real ingestion.
  assert.equal(terminal.state, 'ocr_failed');
  assert.match(terminal.failureReason!, /stored extraction for HC-S009 contained no readable pages/);
});

test('progress is reported before the reuse, with the real page total', async () => {
  const seen: { state: string; stage?: string; pagesTotal?: number }[] = [];
  await processRegisteredArtifact(artifactOf(), 'book.pdf', {
    report: async (r) => { seen.push({ state: r.state, stage: r.stage, pagesTotal: r.pagesTotal }); },
  });
  assert.equal(seen[0]?.stage, 'matching_known_source');
  assert.equal(seen[0]?.pagesTotal, 2);
});

test('the registry can be listed without being used to decide a reuse', async () => {
  const dir = await registry([artifactOf()]);
  try {
    assert.deepEqual(await listRegisteredArtifacts(dir), [DIGEST_A]);
    assert.deepEqual(await listRegisteredArtifacts('/nonexistent'), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
