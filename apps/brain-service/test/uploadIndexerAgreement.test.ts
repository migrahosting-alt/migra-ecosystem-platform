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
import { DEFAULT_MAX_INDEX_FILE_BYTES } from '../src/engine/rag/fsFileSource.js';

/*
 * cwd-based like the original, because `npm test` runs the COMPILED tests from
 * dist/test — a path relative to the module resolves differently there and the
 * check silently reads nothing.
 */
const STORAGE = join(
  process.cwd(), '..', 'migrapilot-consumer', 'src', 'server', 'files', 'storage.ts',
);
const CAPABILITY = join(
  process.cwd(), '..', 'migrapilot-consumer', 'src', 'features', 'attachments', 'capability.ts',
);

/*
 * Reads the consumer's CANONICAL attachment definition. The allowlist used to be
 * written out inside storage.ts beside a separately hand-written picker list;
 * they drifted until the product offered 48 types and accepted 27. Both now come
 * from capability.ts, and this parses that one file.
 */
function allowedExtensions(): string[] {
  const source = readFileSync(CAPABILITY, 'utf8');
  /*
   * The DOCUMENT pipeline only. Images are selectable too, but they go to the
   * image library and are read by vision — the indexer excludes them as binary
   * and is right to. Comparing every selectable type against the INDEXER would
   * report a disagreement that does not exist.
   */
  const indexed = [...source.matchAll(/\{\s*ext:\s*'([a-z0-9]+)'[^}]*pipeline:\s*'document',\s*support:\s*'indexed'/g)]
    .map((m) => m[1]!);
  assert.ok(indexed.length > 10, 'could not parse the canonical attachment list — has it moved?');
  return indexed;
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

test('both sides agree on the EXTRACTION ceiling, which is not the storage limit', () => {
  /*
   * THE GAP THIS TEST EXISTS TO CLOSE.
   *
   * The agreement test above compares EXTENSIONS, so it could never see that the
   * indexer skipped anything over 200KB while the consumer happily stored up to
   * 2MB. A 500KB PDF passed every check, landed in the library, and contributed
   * nothing to any answer — accepted and silently dropped, which is the exact
   * failure this file was written to prevent, hiding behind a different axis.
   *
   * Read from the consumer's source rather than duplicated here, for the same
   * reason the extension list is: a copy would drift and agree with nothing.
   */
  const source = readFileSync(STORAGE, 'utf8');
  const extractDefault = /MIGRAPILOT_MAX_EXTRACT_MB,\s*(\d+)\s*\)/.exec(source);
  assert.ok(extractDefault, 'could not find the consumer extraction ceiling — has it moved?');
  const consumerExtractBytes = Number(extractDefault[1]) * 1024 * 1024;

  assert.equal(
    DEFAULT_MAX_INDEX_FILE_BYTES,
    consumerExtractBytes,
    'the two sides must parse to exactly the same ceiling, or one will skip what the other promised',
  );

  /*
   * The STORAGE limit is deliberately larger, and that is not the same defect.
   *
   * The original bug was a SILENT disagreement: uploads accepted 2MB while the
   * indexer skipped everything over 200KB, so files were stored and quietly
   * never indexed. The fix is not "make every number equal" — it is that a file
   * which cannot be parsed must be KNOWN to be unparsed rather than presumed
   * ready. Storage above the extraction ceiling is therefore expected, and the
   * ceilings above are what must never diverge.
   */
  const storageDefault = /MIGRAPILOT_MAX_FILE_MB,\s*(\d+)\s*\)/.exec(source);
  assert.ok(storageDefault, 'could not find the consumer storage limit');
  assert.ok(
    Number(storageDefault[1]) * 1024 * 1024 >= consumerExtractBytes,
    'storage must be at least the extraction ceiling, or parseable files could be refused outright',
  );
});
