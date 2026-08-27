/**
 * The consumer must not accept a file the indexer will silently drop.
 *
 * WHY THIS EXISTS. Two lists in two different services decide whether an
 * uploaded document ever becomes answerable: the consumer's allowed extensions,
 * and this engine's exclusion rules. Nothing connected them, and they disagreed
 * — `.sql` is accepted at upload and then excluded here as a database dump, so a
 * user could upload `schema.sql`, watch it land in their library, and get
 * answers that had never read a line of it.
 *
 * The consumer's own storage module states the rule it was breaking: accepting a
 * format the indexer cannot read "would put a file in the user's library that
 * silently contributes nothing to an answer — the storage-layer equivalent of
 * fabricating a capability."
 *
 * This reads the consumer's real source rather than a copy, because a duplicated
 * list is exactly how the two drifted apart in the first place.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Exclusions } from '../src/engine/rag/exclusions.js';
import { extractPdf } from '../src/engine/rag/pdfText.js';

const STORAGE = join(
  process.cwd(), '..', 'migrapilot-consumer', 'src', 'server', 'files', 'storage.ts',
);

/** The extensions the consumer actually accepts today, read from its source. */
function allowedExtensions(): string[] {
  const source = readFileSync(STORAGE, 'utf8');
  const block = /const ALLOWED = new Set\(\[([\s\S]*?)\]\)/.exec(source);
  assert.ok(block, 'could not find the consumer ALLOWED set — has it moved?');
  return [...block[1]!.matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]!);
}

test('the consumer accepts nothing the indexer will silently drop', () => {
  const exclusions = new Exclusions();
  const accepted = allowedExtensions();
  assert.ok(accepted.length > 10, 'sanity: the allowed list was parsed');

  const dropped = accepted
    .map((ext) => ({ ext, reason: exclusions.reason(`user-document.${ext}`) }))
    .filter((r) => r.reason !== null);

  assert.deepEqual(
    dropped,
    [],
    `these upload types are accepted but never indexed: ${dropped
      .map((d) => `.${d.ext} (${d.reason})`)
      .join(', ')}`,
  );
});

test('a bare dotfile the consumer allows is still indexable', () => {
  /*
   * `.env` is the awkward case: `prod.env` indexes fine while a bare `.env` is
   * excluded as a secret. Same extension, opposite outcome, decided by whether
   * the user happened to give the file a stem.
   */
  const exclusions = new Exclusions();
  const accepted = allowedExtensions();
  const inconsistent = accepted.filter(
    (ext) => exclusions.reason(`.${ext}`) !== exclusions.reason(`document.${ext}`),
  );
  assert.deepEqual(
    inconsistent,
    [],
    `these types index differently as a bare dotfile than as a named file: ${inconsistent.join(', ')}`,
  );
});

test('PDF is accepted AND actually readable, not merely un-excluded', async () => {
  /*
   * The third gate, and the reason it exists.
   *
   * Removing `pdf` from the binary exclusion list is enough to make the
   * agreement test above pass, and would have been enough to ship a format the
   * pipeline could not read — the exact failure `sql` and `env` already caused,
   * where a file was accepted, indexed as nothing, and answered about anyway.
   * Being allowed and being readable are different claims, so both are asserted.
   */
  assert.ok(allowedExtensions().includes('pdf'), 'the consumer must accept .pdf');
  assert.equal(new Exclusions().reason('user-document.pdf'), null, 'the indexer must not drop .pdf');

  const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL('../../test/fixtures/sample-text.pdf', import.meta.url))));
  const extracted = await extractPdf(bytes);
  assert.ok(extracted.text.trim().length > 50, 'acceptance requires real extracted text');
  assert.ok(extracted.totalPages >= 1);
});
