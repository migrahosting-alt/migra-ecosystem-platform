import { test } from 'node:test';
import assert from 'node:assert/strict';

import { factObligations } from '../src/engine/rag/factObligations.js';

/**
 * Multi-fact retrieval coverage.
 *
 * 🚨 THE PRODUCTION FAILURE, found while proving the DOCX fix. Asked for four
 * controlled values in one question, MigraPilot returned three and said
 * "Accent colour: Not mentioned in the provided context." Asked on its own
 * seconds later, the same document answered "teal". The fact was indexed and
 * individually retrievable; it lost a competition for a fixed candidate budget
 * against three chunks that were also relevant.
 */

test('🚨 the production question decomposes into its four facts', () => {
  const { obligations, multiFact } = factObligations(
    'What are the reference code, review month, accent colour, and number of sensors?',
  );
  assert.equal(multiFact, true);
  // The whole question FIRST, then each fact.
  assert.equal(obligations[0], 'What are the reference code, review month, accent colour, and number of sensors?');
  const rest = obligations.slice(1).join(' | ').toLowerCase();
  for (const fact of ['reference code', 'review month', 'accent colour', 'sensors']) {
    assert.ok(rest.includes(fact), `${fact} must become its own retrieval obligation`);
  }
});

test('a single-fact question is left completely alone', () => {
  /*
   * The fix must be invisible to the common case. Splitting "what is the total
   * revenue?" would produce fragments that individually retrieve nothing useful.
   */
  const { obligations, multiFact } = factObligations('What is the total revenue?');
  assert.equal(multiFact, false);
  assert.deepEqual(obligations, ['What is the total revenue?']);
});

test('two facts split; grammar-only fragments are discarded', () => {
  const { obligations, multiFact, discarded } = factObligations('Give me the code and the month');
  assert.equal(multiFact, true);
  assert.ok(obligations.length >= 3, 'whole question plus both facts');
  assert.ok(discarded.every((d) => !/code|month/.test(d)));
});

test('eight facts are all preserved as obligations', () => {
  const q = 'List the code, month, colour, sensors, owner, version, region, and status';
  const { obligations } = factObligations(q);
  const rest = obligations.slice(1).join(' | ').toLowerCase();
  for (const f of ['code', 'month', 'colour', 'sensors', 'owner', 'version', 'region', 'status']) {
    assert.ok(rest.includes(f), f);
  }
});

test('the obligation count is bounded, and bounds predictably', () => {
  // A bulk extraction request degrades to a stated cap rather than shrinking
  // each obligation's budget until none of them retrieve anything useful.
  const q = 'give me ' + Array.from({ length: 30 }, (_, i) => `field${i}`).join(', ');
  const { obligations } = factObligations(q);
  assert.ok(obligations.length <= 9, `capped, got ${obligations.length}`);
});

test('the whole question is always retrieved for as well', () => {
  /*
   * The fragments capture the individual facts; the full question captures the
   * relationship between them and anything the split cut in half. Dropping it
   * would trade one coverage failure for another.
   */
  const q = 'How does the sensor count compare with the version, and which is newer?';
  assert.equal(factObligations(q).obligations[0], q);
});

test('punctuation-only and empty input never produce empty obligations', () => {
  for (const q of ['', '   ', ',,,', 'and']) {
    const { obligations } = factObligations(q);
    assert.equal(obligations.length, 1, `${JSON.stringify(q)} must still yield one target`);
  }
});

test('retrieval gives each obligation its own budget', async () => {
  /*
   * 🚨 NOT SOLVED BY A BIGGER topK. Enlarging the candidate pool adds noise,
   * context and latency to EVERY question to fix a few, and eventually makes
   * grounding worse. The guarantee here is that each requested fact has its own
   * slots, so it cannot be crowded out.
   */
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(
    fileURLToPath(new URL('../../src/engine/rag/indexService.ts', import.meta.url)), 'utf8');

  assert.match(src, /const perObligation = Math\.max\(2, Math\.ceil\(totalCap \/ obligations\.length\)\)/,
    'a floor of two chunks per fact');
  assert.match(src, /if \(!multiFact\)/, 'single-fact questions keep the original path exactly');
  assert.match(src, /if \(!existing \|\| chunk\.score > existing\.score\) merged\.set/,
    'the same span found twice is one piece of evidence');
});
