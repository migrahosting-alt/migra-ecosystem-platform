import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DOCUMENT_TOKEN_BUDGET,
  estimateDocumentTokens,
  remainingPassageBudget,
  selectWholeDocuments,
} from '../src/engine/grounding/documentBudget.js';
import { IndexService, type FileSource, type Scope } from '../src/engine/rag/indexService.js';
import { FakeEmbedder } from '../src/engine/rag/embedder.js';

/**
 * A DOCUMENT THAT FITS MUST BE READ, NOT SAMPLED — AND A SAMPLE MUST SAY SO.
 *
 * 🚨 THE MEASURED FAILURE, staging 2026-09-26. A 31-slide deck was attached in
 * chat and asked about. The deck is 74 chunks; the answer was built from 6 of
 * them — 8% — while its entire extracted text is 21,944 characters. The answer
 * then said it "couldn't find any content for slides before 11 or after 29".
 * Every one of the 31 slides had been extracted and indexed.
 *
 * 🚨 IT WAS NEVER A MODEL LIMIT, and that was measured rather than assumed. A
 * marker placed at the START of a prompt — where a truncating window drops it —
 * was recalled at 8,099, 8,977 and 15,728 prompt tokens against the same endpoint
 * the Brain uses, and the model reports a 32,768 context. The product was
 * sampling to 8% of a document while using about 5k of a proven 15.7k window.
 *
 * Two independent defects are pinned here:
 *
 *   1. there was no whole-document path at all for a chat attachment; and
 *   2. the truncation was never disclosed, so the model — which had no way to
 *      know it held a sample — described its own sample as the document.
 *
 * The property under test is NOT "a document is included". It is that READ WHOLE
 * and SAMPLED stay distinguishable, in the selection and in the prompt, because
 * the whole defect was a sample presenting itself as the document.
 */

const scope: Scope = { owner: 'owner-a', workspace: 'ws-a' };

const doc = (path: string, chars: number, complete = true) => ({
  path,
  text: 'x'.repeat(chars),
  complete,
  ...(complete ? {} : { incompleteReason: 'This deck contains charts, which cannot be read as text.' }),
});

test('🚨 a document that fits is read whole, not sampled', () => {
  // The real deck: 21,944 chars ≈ 5,486 tokens, under the 6,000 per-document limit.
  const picked = selectWholeDocuments([doc('quarterly_operating_review.pptx', 21_944)]);
  assert.equal(picked.whole.length, 1, 'a 22KB deck was sampled instead of read');
  assert.equal(picked.sampled.length, 0);
  assert.ok(picked.tokensUsed > 5_000 && picked.tokensUsed < 6_000, `unexpected cost ${picked.tokensUsed}`);
});

test('a document too large to read is SAMPLED, never silently dropped', () => {
  const big = doc('liv_kreyol_AI-Training.pdf', DOCUMENT_TOKEN_BUDGET * 4 + 400);
  const picked = selectWholeDocuments([big]);
  assert.equal(picked.whole.length, 0);
  assert.deepEqual(picked.sampled, ['liv_kreyol_AI-Training.pdf'],
    'an oversized document vanished instead of moving to the sampled set');
});

test('🚨 the order given is honoured — the document the question is about is the one read', () => {
  /*
   * Smallest-first would fit more documents and answer the wrong question: it
   * would read two incidental files whole and sample the large one the user
   * actually asked about. The caller's order is the user's order.
   */
  const first = doc('the-one-asked-about.pptx', 5_600 * 4);   // ~5,600 tokens
  const second = doc('incidental.txt', 400);
  const picked = selectWholeDocuments([first, second]);
  assert.equal(picked.whole[0]?.path, 'the-one-asked-about.pptx');
  // Budget 8,000; the first took ~5,600, so the small one still fits.
  assert.equal(picked.whole.length, 2);

  /*
   * Now make the first one consume nearly the whole allowance. The second must be
   * SAMPLED rather than promoted ahead of it — smallest-first would have read the
   * incidental file whole and sampled the one the question is about.
   */
  const nearlyAll = doc('the-one-asked-about.pptx', (DOCUMENT_TOKEN_BUDGET - 50) * 4);
  const crowded = selectWholeDocuments([nearlyAll, second]);
  assert.deepEqual(crowded.whole.map((d) => d.path), ['the-one-asked-about.pptx']);
  assert.deepEqual(crowded.sampled, ['incidental.txt']);
});

test('an empty extraction is never reported as read whole', () => {
  // Nothing was read, so claiming completeness would be a false completeness
  // claim about a file that produced no text.
  const picked = selectWholeDocuments([{ path: 'blank.txt', text: '   \n  ', complete: true }]);
  assert.equal(picked.whole.length, 0);
  assert.deepEqual(picked.sampled, ['blank.txt']);
});

test('incompleteness survives selection — a charted deck is not "read whole" silently', () => {
  const picked = selectWholeDocuments([doc('deck.pptx', 4_000, false)]);
  assert.equal(picked.whole.length, 1);
  assert.equal(picked.whole[0]?.complete, false, 'the unread-charts fact was lost in selection');
  assert.match(String(picked.whole[0]?.incompleteReason), /charts/i);
});

test('the two paths cannot sum past the document allowance', () => {
  const used = DOCUMENT_TOKEN_BUDGET - 500;
  assert.equal(remainingPassageBudget(used), 500, 'passages could overshoot the shared budget');
  assert.equal(remainingPassageBudget(DOCUMENT_TOKEN_BUDGET + 1_000), 0, 'a negative budget was produced');
});

test('the estimator agrees with the context builder', async () => {
  const { estimateTokens } = await import('../src/engine/memory/contextBuilder.js');
  const sample = 'Yon fraz an kreyòl, ak kèk mo anplis pou mezire.';
  assert.equal(estimateDocumentTokens(sample), estimateTokens(sample),
    'two estimators would let a budget be enforced against a different number than it was planned with');
});

// ─────────────────────────────────────────────────────────────────────────────
// Reading the document out of the index, scope-checked
// ─────────────────────────────────────────────────────────────────────────────

function serviceOver(files: Array<{ relPath: string; content: string; complete?: boolean; incompleteReason?: string }>) {
  let clock = 1_000_000;
  return new IndexService(
    new FakeEmbedder(64),
    (): FileSource => ({ files: async () => files }),
    () => (clock += 1000),
  );
}

test('🚨 readDocuments returns the FULL text, in the order asked for', async () => {
  const service = serviceOver([
    { relPath: 'a.txt', content: 'AAA content' },
    { relPath: 'deck.pptx', content: 'Slide 1 ---\nreal content', complete: false, incompleteReason: 'charts' },
  ]);
  const rec = await service.createIndex(scope, { sourceType: 'docs', root: '/r' });

  const got = await service.readDocuments(rec.id, scope, ['deck.pptx', 'a.txt']);
  assert.deepEqual(got.map((d) => d.path), ['deck.pptx', 'a.txt'], 'the caller order was not preserved');
  assert.equal(got[0]?.text, 'Slide 1 ---\nreal content');
  assert.equal(got[0]?.complete, false, 'the index path dropped completeness again');
  assert.equal(got[1]?.complete, true, 'absent completeness must mean "nothing known unread", not incomplete');
});

test('🚨 another scope cannot read a document by naming its path', async () => {
  const service = serviceOver([{ relPath: 'private.txt', content: 'SECRET' }]);
  const rec = await service.createIndex(scope, { sourceType: 'docs', root: '/r' });

  const intruder: Scope = { owner: 'owner-b', workspace: 'ws-b' };
  const got = await service.readDocuments(rec.id, intruder, ['private.txt']);
  assert.deepEqual(got, [], 'a whole-document read bypassed the scope check');
});

test('a path that is not in the workspace yields nothing, not an empty document', async () => {
  const service = serviceOver([{ relPath: 'a.txt', content: 'AAA' }]);
  const rec = await service.createIndex(scope, { sourceType: 'docs', root: '/r' });
  const got = await service.readDocuments(rec.id, scope, ['absent.txt']);
  assert.deepEqual(got, [], 'a missing file produced a document with empty text');
});

test('a LONE document may use the whole budget — no phantom per-document cap', () => {
  /*
   * A per-document cap beneath the budget used to sample a lone 7,000-token
   * document that the budget could hold, and made a second tiny attachment
   * change whether the first was read. Both are gone; this pins that.
   */
  const lone = doc('big-but-fits.pptx', 7_000 * 4);
  const picked = selectWholeDocuments([lone]);
  assert.equal(picked.whole.length, 1, 'a document within budget was sampled anyway');
  assert.equal(picked.sampled.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// The regression that reading documents whole introduced
// ─────────────────────────────────────────────────────────────────────────────

test('🚨 a turn holding only whole documents is NOT refused for lack of evidence', async () => {
  /*
   * MEASURED ON STAGING, and it was my own regression. Reading attached documents
   * whole leaves nothing to retrieve, so the retriever hands back zero chunks —
   * and the relevance gate read zero chunks as "no evidence" and refused the turn
   * with `insufficient-relevance`. Attaching a SMALL document therefore BROKE the
   * answer while a large one still worked, which is the exact opposite of the
   * feature's purpose.
   *
   * Evidence is evidence whatever shape it arrives in: a whole document is more
   * of it than six passages, not less.
   */
  const { decideGrounding } = await import('../src/engine/grounding/groundingDecision.js');

  const decision = await decideGrounding(
    {
      mode: 'approved',
      query: 'what is on slide 12',
      scopedFiles: ['deck.pptx'],
      wholeDocumentsRead: 1,
    },
    {
      approvedIndexId: () => 'idx_test',
      // Nothing left to retrieve: the document was already supplied in full.
      retrieveApproved: async () => [],
      indexIdentity: () => ({ version: 1 }),
      minScore: 0.53,
    },
  );

  assert.equal(decision.allowed, true,
    `a turn holding a whole document was refused (${'reason' in decision ? decision.reason : ''})`);
});

test('a turn with NO evidence of any kind is still refused', async () => {
  // The control in the other direction: the gate must still close when the turn
  // genuinely holds nothing, or the fix above would disable it entirely.
  const { decideGrounding } = await import('../src/engine/grounding/groundingDecision.js');

  const decision = await decideGrounding(
    { mode: 'approved', query: 'what is on slide 12', scopedFiles: ['deck.pptx'] },
    {
      approvedIndexId: () => 'idx_test',
      retrieveApproved: async () => [],
      indexIdentity: () => ({ version: 1 }),
      minScore: 0.53,
    },
  );

  assert.equal(decision.allowed, false, 'an empty turn was allowed through as grounded');
  assert.equal('reason' in decision ? decision.reason : '', 'insufficient-relevance');
});
