import assert from 'node:assert/strict';
import test from 'node:test';

import { VectorIndex, type IndexedChunk } from '../src/engine/rag/vectorIndex.js';
import { hybridRetrieve } from '../src/engine/rag/hybridRetriever.js';

/**
 * The conversation's file set must be a RETRIEVAL BOUNDARY, not a grounding on/off switch.
 *
 * Measured in production before this existed: a conversation grounded in alpha+beta was
 * asked for a value that only alpha contained and answered "your indexed documents do not
 * cover that", because top-K ranked across every document the caller owned and alpha never
 * surfaced. Naming the file in the question made it work — proof the content was there and
 * the scope was not participating.
 */

const chunk = (filePath: string, text: string, vector: number[]): IndexedChunk => ({
  id: `${filePath}:1`,
  workspaceId: 'w1',
  filePath,
  language: 'json',
  startLine: 1,
  endLine: 6,
  contentHash: `${filePath}-h`,
  embeddingModel: 'test',
  embeddingVersion: '1',
  indexedAt: 1,
  text,
  vector,
});

/** alpha and beta are near-identical vectors, so ranking alone cannot separate them. */
function indexWith(): VectorIndex {
  const index = new VectorIndex();
  index.replaceFile('ground-alpha.json', [chunk('ground-alpha.json', 'alphaSecret is PURPLE FALCON 331', [1, 0, 0])]);
  index.replaceFile('ground-beta.json', [chunk('ground-beta.json', 'betaSecret is SILVER TURTLE 884', [0.99, 0.1, 0])]);
  for (let i = 0; i < 40; i += 1) {
    // Noise the user also owns. Without a scope these crowd out a small file.
    index.replaceFile(`noise-${i}.md`, [chunk(`noise-${i}.md`, 'unrelated notes about scheduling', [0.98, 0.15, 0])]);
  }
  return index;
}

test('DEFECT 1: a scoped set finds a file that global ranking buries', async () => {
  const index = indexWith();
  const query = [1, 0, 0];

  // topK small enough that 42 near-identical files crowd the index — the production shape.
  const unscoped = await hybridRetrieve(index, query, 'alphaSecret', { topK: 3, maxChunks: 3 });
  const scoped = await hybridRetrieve(index, query, 'alphaSecret', {
    topK: 3,
    maxChunks: 3,
    files: ['ground-alpha.json', 'ground-beta.json'],
  });

  assert.ok(
    scoped.chunks.some((c) => c.filePath === 'ground-alpha.json'),
    'the scoped set must surface alpha even when the wider index would not',
  );
  // The unscoped case is the bug being fixed; assert only that scoping CHANGED the result,
  // so this test fails if the boundary stops participating.
  assert.notDeepEqual(
    scoped.chunks.map((c) => c.filePath),
    unscoped.chunks.map((c) => c.filePath),
  );
});

test('nothing outside the scope may be returned — no global fallback', async () => {
  const index = indexWith();
  const scoped = await hybridRetrieve(index, [1, 0, 0], 'anything at all', {
    topK: 40,
    maxChunks: 10,
    files: ['ground-alpha.json'],
  });
  assert.ok(scoped.chunks.length > 0);
  assert.deepEqual([...new Set(scoped.chunks.map((c) => c.filePath))], ['ground-alpha.json']);
});

test('a scope naming an absent file returns nothing rather than widening', async () => {
  // Refusing honestly is the required behaviour: silently answering from other documents
  // would cite a file the user never attached.
  const index = indexWith();
  const scoped = await hybridRetrieve(index, [1, 0, 0], 'alphaSecret', {
    topK: 40,
    maxChunks: 6,
    files: ['deleted-file.json'],
  });
  assert.equal(scoped.chunks.length, 0);
});

test('an empty scope is treated as NO scope, not as scope-to-nothing', async () => {
  // Otherwise an ungrounded turn, or a bug upstream, would refuse every answer.
  const index = indexWith();
  const scoped = await hybridRetrieve(index, [1, 0, 0], 'alphaSecret', { topK: 5, maxChunks: 3, files: [] });
  assert.ok(scoped.chunks.length > 0);
});

test('DEFECT 2: removing a file makes its content unretrievable, even in scope', async () => {
  // The privacy failure: after deletion the surviving sibling kept the conversation
  // grounded, and the deleted file was still answered and cited.
  const index = indexWith();
  assert.equal(index.removeFile('ground-alpha.json'), true);

  const scoped = await hybridRetrieve(index, [1, 0, 0], 'alphaSecret', {
    topK: 40,
    maxChunks: 6,
    files: ['ground-alpha.json', 'ground-beta.json'],
  });
  assert.equal(
    scoped.chunks.some((c) => c.filePath === 'ground-alpha.json'),
    false,
    'a deleted file must not be retrievable or citable from any conversation',
  );
  assert.equal(index.hasFile('ground-alpha.json'), false);
});
