/**
 * THE CITATION INVARIANT: a citation may only reference evidence that was
 * actually retrieved and selected.
 *
 * The realistic violation is not a model inventing a URL. It is a pipeline
 * where the CLAIM was written from a fetched page and the CITATION was
 * assembled from the search result that led to it. Every part is real; the
 * link between them was never checked. These tests check it.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  claimIsGroundedIn,
  passageId,
  sufficiencyOf,
  validateCitations,
  type CitationEvidence,
  type FetchedDocumentEvidence,
  type ExtractedPassageEvidence,
  type SearchQueryEvidence,
} from '../src/engine/search/evidence.js';

const doc = (id: string, url: string): FetchedDocumentEvidence => ({
  id,
  resultId: `res_${id}`,
  canonicalUrl: url,
  domain: new URL(url).hostname,
  contentHash: 'h',
  retrievedAt: '2026-09-08T12:00:00.000Z',
  warnings: [],
});

const passage = (id: string, documentId: string, text: string): ExtractedPassageEvidence => ({
  id,
  documentId,
  text,
  start: 0,
  end: text.length,
});

const cite = (over: Partial<CitationEvidence>): CitationEvidence => ({
  id: 'cit_1',
  claim: 'The council approved the transit plan',
  passageId: 'psg_1',
  documentId: 'doc_1',
  url: 'https://example.com/a',
  ...over,
});

const DOCS = [doc('doc_1', 'https://example.com/a'), doc('doc_2', 'https://other.com/b')];
const PASSAGES = [
  passage('psg_1', 'doc_1', 'The council approved the transit plan after consultation.'),
  passage('psg_2', 'doc_2', 'Unrelated coverage of a different municipal matter entirely.'),
];

/* ------------------------------------------------------------------ *
 * The invariant
 * ------------------------------------------------------------------ */

test('a well-formed citation survives', () => {
  const { valid, rejected } = validateCitations({ documents: DOCS, passages: PASSAGES, citations: [cite({})] });
  assert.equal(valid.length, 1);
  assert.deepEqual(rejected, []);
});

test('🚨 a citation to a document that was never retrieved is rejected', () => {
  const { valid, rejected } = validateCitations({
    documents: DOCS,
    passages: PASSAGES,
    citations: [cite({ documentId: 'doc_never_fetched' })],
  });
  assert.equal(valid.length, 0);
  assert.equal(rejected[0]!.reason, 'unknown_document');
});

test('🚨 a citation to a passage that was never selected is rejected', () => {
  const { valid, rejected } = validateCitations({
    documents: DOCS,
    passages: PASSAGES,
    citations: [cite({ passageId: 'psg_invented' })],
  });
  assert.equal(valid.length, 0);
  assert.equal(rejected[0]!.reason, 'unknown_passage');
});

test('🚨 a passage from a DIFFERENT document is rejected', () => {
  /*
   * The accidental failure this whole module exists for. The claim came from
   * doc_1; the citation names doc_1 but points at doc_2's passage. Both are
   * real evidence. The linkage is fiction.
   */
  const { valid, rejected } = validateCitations({
    documents: DOCS,
    passages: PASSAGES,
    citations: [cite({ documentId: 'doc_1', passageId: 'psg_2' })],
  });
  assert.equal(valid.length, 0);
  assert.equal(rejected[0]!.reason, 'passage_document_mismatch');
});

test('🚨 a citation whose URL is not the document’s is rejected', () => {
  // The reader would be sent somewhere other than where the text came from —
  // which is indistinguishable, to them, from a fabricated source.
  const { valid, rejected } = validateCitations({
    documents: DOCS,
    passages: PASSAGES,
    citations: [cite({ url: 'https://somewhere-else.com/x' })],
  });
  assert.equal(valid.length, 0);
  assert.equal(rejected[0]!.reason, 'url_mismatch');
});

test('one bad citation costs that citation, not the whole answer', () => {
  const { valid, rejected } = validateCitations({
    documents: DOCS,
    passages: PASSAGES,
    citations: [
      cite({ id: 'good' }),
      cite({ id: 'bad', documentId: 'doc_missing' }),
      cite({ id: 'good2', documentId: 'doc_2', passageId: 'psg_2', url: 'https://other.com/b' }),
    ],
  });
  assert.deepEqual(valid.map((c) => c.id), ['good', 'good2']);
  assert.equal(rejected.length, 1);
});

test('a rejection names WHICH citation failed and why', () => {
  // A validator that says "some citation was wrong" cannot be acted on.
  const { rejected } = validateCitations({
    documents: DOCS,
    passages: PASSAGES,
    citations: [cite({ id: 'cit_x', passageId: 'nope' })],
  });
  assert.equal(rejected[0]!.citationId, 'cit_x');
  assert.ok(rejected[0]!.detail.length > 0);
});

/* ------------------------------------------------------------------ *
 * Grounding floor
 * ------------------------------------------------------------------ */

test('a claim sharing nothing with its passage is not grounded', () => {
  assert.equal(
    claimIsGroundedIn('Quarterly revenue rose by twelve percent', 'The volcano erupted overnight near the coast'),
    false,
  );
});

test('a claim restated from its passage is grounded', () => {
  assert.equal(
    claimIsGroundedIn(
      'The council approved the transit plan',
      'After consultation, the council approved the transit plan in March.',
    ),
    true,
  );
});

test('an empty claim is never grounded', () => {
  assert.equal(claimIsGroundedIn('', 'anything at all here'), false);
  assert.equal(claimIsGroundedIn('   ', 'anything at all here'), false);
});

/* ------------------------------------------------------------------ *
 * Sufficiency — the states that must never collapse
 * ------------------------------------------------------------------ */

const query = (over: Partial<SearchQueryEvidence> = {}): SearchQueryEvidence => ({
  id: 'q1',
  query: 'transit plan',
  rationale: 'explicit request',
  provider: 'p',
  issuedAt: '2026-09-08T12:00:00.000Z',
  ...over,
});

test('no search attempted is its own state', () => {
  const { state } = sufficiencyOf({ queries: [], citations: [], documents: [] });
  assert.equal(state, 'not_attempted');
});

test('🚨 retrieval failure is NOT "nothing found"', () => {
  /*
   * The distinction the whole failure enumeration exists for. "The provider
   * was down" and "there is nothing to find" are opposite claims about the
   * world, and only one of them is something we actually learned.
   */
  const { state, reason } = sufficiencyOf({
    queries: [query({ failure: { kind: 'provider_unavailable', detail: 'x' } })],
    citations: [],
    documents: [],
  });
  assert.equal(state, 'retrieval_failed');
  assert.ok(!/found/i.test(reason), `the reason implies a finding: "${reason}"`);
});

test('results found but unreadable is distinct from nothing found', () => {
  const { state, reason } = sufficiencyOf({ queries: [query()], citations: [], documents: [] });
  assert.equal(state, 'insufficient_evidence');
  assert.match(reason, /none of the pages could be read/);
});

test('pages read but none answering is its own reason', () => {
  const { state, reason } = sufficiencyOf({ queries: [query()], citations: [], documents: DOCS });
  assert.equal(state, 'insufficient_evidence');
  assert.match(reason, /none of them answered/);
});

test('citations present means sufficient', () => {
  const { state } = sufficiencyOf({ queries: [query()], citations: [cite({})], documents: DOCS });
  assert.equal(state, 'sufficient');
});

test('sufficiency is DERIVED, so it cannot drift from the bundle', () => {
  // If this were a field someone set, "we searched" and "we found enough"
  // would diverge the first time a branch forgot to update it.
  const withCitation = sufficiencyOf({ queries: [query()], citations: [cite({})], documents: DOCS });
  const withoutCitation = sufficiencyOf({ queries: [query()], citations: [], documents: DOCS });
  assert.notEqual(withCitation.state, withoutCitation.state);
});

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

test('a passage id is stable for the same span and different across spans', () => {
  assert.equal(passageId('doc_1', 0, 100), passageId('doc_1', 0, 100));
  assert.notEqual(passageId('doc_1', 0, 100), passageId('doc_1', 0, 101));
  assert.notEqual(passageId('doc_1', 0, 100), passageId('doc_2', 0, 100));
});
