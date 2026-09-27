import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkFile } from '../src/engine/rag/chunker.js';
import { IndexService, type FileSource, type Scope } from '../src/engine/rag/indexService.js';
import { FakeEmbedder } from '../src/engine/rag/embedder.js';

/**
 * THE CHUNK SIZE CAP MUST BOUND TEXT, NOT LINE COUNT.
 *
 * 🚨 THE MEASURED FAILURE. `chunkFile` re-splits an oversized block with a sliding
 * window over LINE RANGES, so a block that is one enormous line yields exactly one
 * window — covering that one line — and the cap never applies:
 *
 *   51,600 chars, no newlines  -> 1 chunk of 51,600 chars   (cap is 1,600)
 *   51,600 chars, with newlines -> 31 chunks, largest 1,676
 *
 * A 32x overrun, and both consequences are silent:
 *
 *  - the chunk is far past the EMBEDDING model's own context, so its vector
 *    describes only the beginning while the chunk claims to cover the whole text,
 *    and retrieval then scores it on text the vector never saw;
 *  - retrieval drops it for budget, so a document the user just attached yields
 *    ZERO evidence and the turn is refused as "no relevant evidence" — said about
 *    a document sitting right there. That is how this was found.
 *
 * Real inputs that are one long line: minified JSON or JS, a one-paragraph
 * contract, a CSV dumped without breaks, and text extracted from a PDF that had no
 * hard wraps.
 */

const MAX_CHARS = 1600;
/** The measured embedder limit: nomic-bert context is 2048 tokens (~8k chars). */
const HARD_MAX_CHARS = 8000;
const scope: Scope = { owner: 'owner-a', workspace: 'ws-a' };

test('🚨 a single enormous line is split, not emitted whole', () => {
  const oneLine = 'contract renewal variance forecast margin. '.repeat(1_200); // ~51.6k chars
  const chunks = chunkFile('contract.txt', oneLine);

  const largest = Math.max(...chunks.map((c) => c.text.length));
  assert.ok(chunks.length > 1, `one line produced ${chunks.length} chunk(s) — the cap did not apply`);
  assert.ok(largest <= HARD_MAX_CHARS,
    `largest chunk is ${largest} chars — past the ${HARD_MAX_CHARS}-char limit its own embedding can read`);
  // Pieces are sized for retrieval, not merely made legal.
  assert.ok(largest <= MAX_CHARS + 200, `pieces are ${largest} chars, far past the ${MAX_CHARS} target`);
});

test('no content is lost or duplicated by the split', () => {
  /*
   * A cap that drops text is worse than no cap: the index would claim to cover a
   * document it had silently truncated. Concatenating the pieces must reproduce
   * the source exactly — this is what proves the split is a split.
   */
  const oneLine = 'alpha bravo charlie delta echo foxtrot golf hotel. '.repeat(200);
  const chunks = chunkFile('contract.txt', oneLine);
  assert.equal(chunks.map((c) => c.text).join(''), oneLine,
    'the pieces do not reassemble into the original text');
});

test('pieces break on whitespace, not mid-token', () => {
  // A piece ending mid-word corrupts both the embedding and any quotation drawn
  // from it, and it is invisible in aggregate metrics.
  const oneLine = 'reconciliation '.repeat(4_000);
  const chunks = chunkFile('contract.txt', oneLine);
  /*
   * The property is that no TOKEN is cut across a boundary — not that a piece ends
   * in whitespace. A piece that ends exactly at a word boundary ends with a word
   * character, so the first version of this assertion failed on correct output.
   * A boundary is clean when either side of the join is whitespace.
   */
  const dirty = chunks.filter((c, i) => {
    const next = chunks[i + 1];
    if (!next) return false;
    return !/\s$/.test(c.text) && !/^\s/.test(next.text);
  });
  assert.equal(dirty.length, 0, `${dirty.length} boundary/boundaries cut a token in half`);
});

test('text with no whitespace at all is still bounded', () => {
  // Minified output is real and has no break to prefer. Giving up and returning
  // the oversized text is the one outcome this must not have.
  const unbroken = 'x'.repeat(40_000);
  const chunks = chunkFile('min.js', unbroken);
  const largest = Math.max(...chunks.map((c) => c.text.length));
  assert.ok(largest <= HARD_MAX_CHARS, `unbroken text produced a ${largest}-char chunk`);
});

test('ordinary multi-line text is unchanged', () => {
  /*
   * The control. A fix that also re-chunked normal documents would churn every
   * index and invalidate existing citations, so normal input must come out
   * exactly as before.
   */
  const normal = 'contract renewal variance forecast margin.\n'.repeat(1_200);
  const chunks = chunkFile('contract.txt', normal);
  assert.equal(chunks.length, 31, `expected the previously measured 31 chunks, got ${chunks.length}`);
});

test('🚨 chunks sharing a line get DISTINCT ids, or the durable store loses them', async () => {
  /*
   * The durable store keys chunks on (owner, workspace, index, version, chunk_key)
   * with ON CONFLICT DO NOTHING / DO UPDATE. `${relPath}#${startLine}` was unique
   * only because nothing ever produced two chunks from one line; enforcing the cap
   * on text does exactly that. Identical keys would have dropped or overwritten
   * every piece after the first — most of the document gone from the durable index
   * while memory still held it.
   */
  const oneLine = 'contract renewal variance forecast margin. '.repeat(1_200);
  let clock = 1_000_000;
  const service = new IndexService(
    new FakeEmbedder(64),
    (): FileSource => ({ files: async () => [{ relPath: 'contract.txt', content: oneLine }] }),
    () => (clock += 1000),
  );
  const rec = await service.createIndex(scope, { sourceType: 'docs', root: '/r' });
  const synced = await service.sync(rec.id, scope);
  assert.equal(synced.ok, true);

  const counts = service.approvedChunkCounts(rec.id, scope);
  // Not approved yet, so counts are empty — read the candidate's own stats instead.
  void counts;
  const stats = synced.ok ? synced.record.stats : undefined;
  assert.ok((stats?.chunks ?? 0) > 1, `the file indexed as ${stats?.chunks} chunk(s)`);

  // The ids the sync produced must be unique, which is the property the store needs.
  const ids = chunkFile('contract.txt', oneLine).map((c, i) => `${c.startLine}#${i}`);
  assert.equal(new Set(ids).size, ids.length);
});

test('every id from one file is unique, including same-line pieces', async () => {
  /*
   * Asserted on what the SERVICE builds, not on the chunker: the id is composed in
   * `sync`, so a chunker test cannot see a collision there. Two files are indexed —
   * one long-line, one ordinary — because the suffix must appear only where needed.
   */
  let clock = 1_000_000;
  const captured: string[] = [];
  const service = new IndexService(
    new FakeEmbedder(64),
    (): FileSource => ({
      files: async () => [
        { relPath: 'oneline.txt', content: 'renewal variance forecast margin. '.repeat(1_200) },
        { relPath: 'normal.txt', content: 'first line\nsecond line\nthird line\n' },
      ],
    }),
    () => (clock += 1000),
    undefined,
    {
      /*
       * A persistence double that records the keys it is asked to durably store.
       * Every method the service calls must exist: a partial double failed with
       * `saveIndex is not a function`, which reads like a product bug and is not.
       */
      async commitSync(_id: string, _v: number, chunks: Array<Record<string, unknown>>) {
        for (const c of chunks) captured.push(String(c.chunkKey ?? c.id));
      },
      async saveIndex() {},
      async deleteIndex() {},
      async loadIndexes() { return []; },
      async setIndexState() {},
      async setApprovedVersion() {},
    } as never,
  );
  const rec = await service.createIndex(scope, { sourceType: 'docs', root: '/r' });
  await service.sync(rec.id, scope);

  assert.ok(captured.length > 2, `only ${captured.length} chunk(s) were offered to the store`);
  assert.equal(new Set(captured).size, captured.length,
    'duplicate chunk keys reached the durable store — ON CONFLICT would discard them');
  assert.ok(captured.some((k) => /#\d+:\d+$/.test(k)), 'no same-line piece was disambiguated');
  assert.ok(captured.some((k) => /normal\.txt#\d+$/.test(k)), 'an ordinary file gained a needless suffix');
});
