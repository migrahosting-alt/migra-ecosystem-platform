/**
 * SEARCH EVIDENCE — typed, and separate from anything a provider returned.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE INVARIANT
 *
 * A citation may only reference evidence that was actually retrieved and
 * selected.
 *
 * That sounds obvious and is easy to violate accidentally. The realistic path
 * is not a model inventing a URL; it is a pipeline where a claim was written
 * from a FETCHED PAGE and the citation was assembled from the SEARCH RESULT
 * that led to it. The URL is real, the page is real, the claim is real — and
 * the citation points at a snippet that does not contain what was asserted.
 * Nobody lied; the linkage was simply never checked.
 *
 * So linkage is checked, by `validateCitations`, against the evidence that
 * actually exists in the bundle. A citation that cannot be traced is REJECTED
 * rather than downgraded, because a citation the reader cannot verify is worse
 * than no citation: it converts "I could not find this" into false confidence.
 *
 * ---------------------------------------------------------------------------
 * WHY SUFFICIENCY IS ITS OWN STATE
 *
 * `search succeeded` and `enough evidence was found` are different facts. A
 * provider can return ten results, every page can fetch cleanly, and none of
 * them may answer the question. Collapsing those into one boolean is how a
 * confident answer gets written over nothing.
 */

import { createHash } from 'node:crypto';

import type { SearchFailure, SearchResult } from './types.js';

/** One query, as issued. The planner's reasoning travels with it. */
export interface SearchQueryEvidence {
  id: string;
  query: string;
  /** Why this query was issued — planner reason code, or an expansion note. */
  rationale: string;
  provider: string;
  issuedAt: string;
  /** Absent on success. Present, and specific, on failure. */
  failure?: SearchFailure;
}

/** One result the provider returned, after normalisation. */
export interface SearchResultEvidence {
  id: string;
  /** Which query produced it. A result with no query is not evidence. */
  queryId: string;
  result: SearchResult;
  /** Position after Migra ranking, when ranking has run. */
  rankedPosition?: number;
}

/** A page we actually fetched. Distinct from the result that pointed at it. */
export interface FetchedDocumentEvidence {
  id: string;
  /** Which result led here. */
  resultId: string;
  canonicalUrl: string;
  domain: string;
  title?: string;
  /** sha256 of the extracted text. Proves what was read. */
  contentHash: string;
  retrievedAt: string;
  publishedAt?: string;
  warnings: string[];
}

/** A span of a fetched document, selected because it bears on the question. */
export interface ExtractedPassageEvidence {
  id: string;
  documentId: string;
  text: string;
  /** Character range within the extracted text, so a reader can find it. */
  start: number;
  end: number;
}

/**
 * A claim, and the passage that supports it.
 *
 * `passageId` is required. A citation that names only a document says "it is
 * in here somewhere", which is not verifiable and is exactly the shape that
 * lets an unsupported sentence keep a real-looking source.
 */
export interface CitationEvidence {
  id: string;
  claim: string;
  passageId: string;
  documentId: string;
  /** Repeated for display. Verified against the document, never trusted. */
  url: string;
}

export type SufficiencyState =
  /** Enough retrieved and selected to answer. */
  | 'sufficient'
  /** Retrieval worked; nothing found that bears on the question. */
  | 'insufficient_evidence'
  /** Retrieval itself failed. NOT the same as finding nothing. */
  | 'retrieval_failed'
  /** Nothing was attempted, because nothing needed to be. */
  | 'not_attempted';

export interface SearchSynthesisEvidence {
  queries: SearchQueryEvidence[];
  results: SearchResultEvidence[];
  documents: FetchedDocumentEvidence[];
  passages: ExtractedPassageEvidence[];
  citations: CitationEvidence[];
  sufficiency: SufficiencyState;
  /** Why sufficiency is what it is, in the engine's words. */
  sufficiencyReason: string;
}

export type CitationRejection =
  | { citationId: string; reason: 'unknown_document'; detail: string }
  | { citationId: string; reason: 'unknown_passage'; detail: string }
  | { citationId: string; reason: 'passage_document_mismatch'; detail: string }
  | { citationId: string; reason: 'url_mismatch'; detail: string }
  | { citationId: string; reason: 'claim_not_in_passage'; detail: string };

/**
 * Reject every citation that cannot be traced to retrieved evidence.
 *
 * Returns the survivors and the rejections, rather than throwing: one bad
 * citation should cost that citation, not the whole answer. The caller decides
 * what an answer with fewer citations means — and `sufficiency` is where that
 * decision is recorded.
 */
export function validateCitations(bundle: {
  documents: readonly FetchedDocumentEvidence[];
  passages: readonly ExtractedPassageEvidence[];
  citations: readonly CitationEvidence[];
}): { valid: CitationEvidence[]; rejected: CitationRejection[] } {
  const documentsById = new Map(bundle.documents.map((d) => [d.id, d]));
  const passagesById = new Map(bundle.passages.map((p) => [p.id, p]));

  const valid: CitationEvidence[] = [];
  const rejected: CitationRejection[] = [];

  for (const citation of bundle.citations) {
    const document = documentsById.get(citation.documentId);
    if (!document) {
      rejected.push({
        citationId: citation.id,
        reason: 'unknown_document',
        detail: 'the cited document was never retrieved',
      });
      continue;
    }

    const passage = passagesById.get(citation.passageId);
    if (!passage) {
      rejected.push({
        citationId: citation.id,
        reason: 'unknown_passage',
        detail: 'the cited passage was never selected',
      });
      continue;
    }

    /*
     * 🚨 THE ACCIDENTAL FAILURE, GUARDED.
     *
     * A passage from document A cited as evidence for document B is what
     * happens when a citation is assembled from the search RESULT while the
     * claim was written from a fetched PAGE. Both halves are real; the link
     * between them is not.
     */
    if (passage.documentId !== document.id) {
      rejected.push({
        citationId: citation.id,
        reason: 'passage_document_mismatch',
        detail: 'the passage belongs to a different document than the citation names',
      });
      continue;
    }

    // The displayed URL must be the document's own. A mismatch means the
    // reader would be sent somewhere other than where the text came from.
    if (citation.url !== document.canonicalUrl) {
      rejected.push({
        citationId: citation.id,
        reason: 'url_mismatch',
        detail: 'the citation points somewhere other than the document it cites',
      });
      continue;
    }

    valid.push(citation);
  }

  return { valid, rejected };
}

/**
 * Whether a passage plausibly supports a claim.
 *
 * Deliberately WEAK and deliberately not a semantic judgement: this catches a
 * citation attached to text with nothing to do with the claim, and nothing
 * subtler. A strong "does this support it" check would need a model, and a
 * model's opinion is not the kind of thing that belongs in a structural guard —
 * it would fail differently on every run and could not be mutation-tested.
 *
 * The real defence is that a human, or a later reader, can open the passage.
 * This only stops the citations that are obviously unmoored.
 */
export function claimIsGroundedIn(claim: string, passage: string): boolean {
  const meaningful = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 3),
    );
  const claimTokens = meaningful(claim);
  if (claimTokens.size === 0) return false;
  const passageTokens = meaningful(passage);

  let shared = 0;
  for (const token of claimTokens) if (passageTokens.has(token)) shared += 1;
  // A third of the claim's meaningful words. Low on purpose: this is a floor
  // against unmoored citations, not a relevance score.
  return shared / claimTokens.size >= 0.34;
}

/** Stable id for a passage, so the same span is the same evidence across runs. */
export function passageId(documentId: string, start: number, end: number): string {
  return `psg_${createHash('sha256').update(`${documentId}:${start}:${end}`).digest('hex').slice(0, 16)}`;
}

/**
 * Decide sufficiency from what the bundle actually contains.
 *
 * Kept as a function rather than a field someone sets, because "we searched"
 * and "we found enough" drift apart the moment they are maintained by hand.
 */
export function sufficiencyOf(bundle: {
  queries: readonly SearchQueryEvidence[];
  citations: readonly CitationEvidence[];
  documents: readonly FetchedDocumentEvidence[];
}): { state: SufficiencyState; reason: string } {
  if (bundle.queries.length === 0) {
    return { state: 'not_attempted', reason: 'No search was needed for this question.' };
  }
  const everySearchFailed = bundle.queries.every((q) => q.failure !== undefined);
  if (everySearchFailed) {
    /*
     * The distinction the work order insists on. This must never become "I
     * couldn't find anything", which asserts something about the world when
     * the truth is that we never got to look.
     */
    return { state: 'retrieval_failed', reason: 'Search could not be completed.' };
  }
  if (bundle.citations.length === 0) {
    return {
      state: 'insufficient_evidence',
      reason:
        bundle.documents.length === 0
          ? 'Results were returned but none of the pages could be read.'
          : 'Pages were read but none of them answered the question.',
    };
  }
  return { state: 'sufficient', reason: 'Supported by retrieved sources.' };
}
