import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decideGrounding,
  DEFAULT_MIN_APPROVED_SCORE,
  type GroundingChunk,
  type GroundingDeps,
} from '../src/engine/grounding/groundingDecision.js';

/**
 * An explicit user scope replaces the relevance floor.
 *
 * Once the user has attached the files, relevance selection has already happened at the
 * USER-INTENT layer. The floor exists to stop unrelated documents surfacing from a global
 * pool; applying it inside an explicit scope is a second gate for a different problem, and
 * it overrides the user's own selection.
 *
 * Measured on production: a conversation grounded in two attached files answered "your
 * indexed documents do not cover that" for a value sitting in one of them, because the chunk
 * scored under 0.53 — the floor refusing to READ a file the user had explicitly attached.
 */

/** Below the floor on purpose: this is the alpha chunk that was being refused. */
const LOW = DEFAULT_MIN_APPROVED_SCORE - 0.2;

const lowScoringChunk: GroundingChunk = {
  path: 'ground-alpha.json',
  startLine: 1,
  endLine: 6,
  snippet: '{"alphaSecret":"PURPLE FALCON 331"}',
  score: LOW,
};

const depsWith = (chunks: GroundingChunk[]): GroundingDeps => ({
  approvedIndexId: () => 'ix1',
  retrieveApproved: async () => chunks,
  indexIdentity: () => ({ version: 1, indexedBranch: 'main' }),
  minScore: DEFAULT_MIN_APPROVED_SCORE,
});

test('SCOPED: a low-scoring chunk from an attached file is still admitted', async () => {
  const decision = await decideGrounding(
    { mode: 'approved', query: 'And what is the alphaSecret?', scopedFiles: ['ground-alpha.json'] },
    depsWith([lowScoringChunk]),
  );
  assert.equal(decision.allowed, true, 'the user attached this file; the floor must not veto it');
  assert.equal(decision.mode, 'approved-index');
  assert.equal(decision.mode === 'approved-index' && decision.allowed ? decision.chunks.length : -1, 1);
});

test('UNSCOPED: the same low-scoring chunk is still blocked by the floor', async () => {
  // The floor keeps doing its job where it was designed to: a global pool.
  const decision = await decideGrounding(
    { mode: 'approved', query: 'And what is the alphaSecret?' },
    depsWith([lowScoringChunk]),
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'insufficient-relevance');
});

test('an EMPTY scope keeps unscoped behaviour, not scope-to-nothing', async () => {
  const decision = await decideGrounding(
    { mode: 'approved', query: 'anything', scopedFiles: [] },
    depsWith([lowScoringChunk]),
  );
  assert.equal(decision.allowed, false, 'an empty array is no scope at all');
});

test('a scoped IRRELEVANT file is admitted rather than silently widening', async () => {
  /*
   * The model may then say the information is absent — which is honest, and different from
   * refusing to look. What must NOT happen is retrieval reaching outside the scope for
   * something better; that would cite a file the user never attached.
   */
  const irrelevant: GroundingChunk = { ...lowScoringChunk, path: 'shopping-list.md', score: 0.01, snippet: 'milk, eggs' };
  const decision = await decideGrounding(
    { mode: 'approved', query: 'what is the alphaSecret?', scopedFiles: ['shopping-list.md'] },
    depsWith([irrelevant]),
  );
  assert.equal(decision.allowed, true);
  assert.deepEqual(
    decision.mode === 'approved-index' && decision.allowed ? decision.chunks.map((c) => c.path) : [],
    ['shopping-list.md'],
  );
});

test('scoped multi-file: ranking still orders what the caller returned', async () => {
  // Dropping the floor changes WHICH evidence is admitted, never HOW MUCH — the retriever's
  // maxChunks/tokenBudget still bound it, and order is preserved for the model.
  const beta: GroundingChunk = { ...lowScoringChunk, path: 'ground-beta.json', score: 0.9, snippet: 'betaSecret' };
  const decision = await decideGrounding(
    { mode: 'approved', query: 'secrets', scopedFiles: ['ground-beta.json', 'ground-alpha.json'] },
    depsWith([beta, lowScoringChunk]),
  );
  assert.equal(decision.allowed, true);
  assert.deepEqual(
    decision.mode === 'approved-index' && decision.allowed ? decision.chunks.map((c) => c.path) : [],
    ['ground-beta.json', 'ground-alpha.json'],
  );
});

test('scope does not rescue a genuine retrieval failure', async () => {
  // Fail-closed still means fail-closed: an explicit scope is not a licence to answer when
  // the index could not be read at all.
  const decision = await decideGrounding(
    { mode: 'approved', query: 'x', scopedFiles: ['ground-alpha.json'] },
    { ...depsWith([]), retrieveApproved: async () => { throw new Error('BOOM'); } },
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'retrieval-failed');
});
