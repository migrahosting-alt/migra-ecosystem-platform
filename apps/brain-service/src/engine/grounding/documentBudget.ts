/**
 * How much of a document an answer is allowed to see — and why those numbers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 THE DEFECT THIS EXISTS FOR: A DOCUMENT WAS NEVER READ, ONLY SAMPLED.
 *
 * Measured on staging 2026-09-26 with a 31-slide deck attached in chat:
 *
 *   slides                             31
 *   extracted text                     21,944 chars
 *   chunks in the index                74
 *   chunks one answer could see         6   (maxChunks 6, tokenBudget 2000)
 *   share of the document one answer saw  ~8%
 *
 * Asked "what's on slide 12, and did you manage to read the whole deck?", the
 * product answered slide 12 correctly and then said it "couldn't find any content
 * for slides before 11 or after 29". Every one of the 31 slides had been
 * extracted and indexed. Nothing was missing from the deck.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 AND IT WAS NEVER A MODEL LIMIT. THAT WAS MEASURED, NOT ASSUMED.
 *
 * The obvious explanation — "the window is too small" — is false. Probed against
 * the exact endpoint the Brain uses, with a marker placed at the START of the
 * prompt so a truncating window would drop it:
 *
 *   prompt_tokens =  8,099  -> marker recalled
 *   prompt_tokens =  8,977  -> marker recalled
 *   prompt_tokens = 15,728  -> marker recalled
 *
 * and `qwen2.context_length` reports 32,768. So the product was using roughly 5k
 * of a window proven to hold at least 15.7k, and sampling documents to 8% for no
 * reason that existed in the runtime.
 *
 * Budgets below are therefore derived from a MEASUREMENT with headroom, not from
 * a guess. If the model or provider changes, re-run that probe before changing
 * these numbers — a bigger constant chosen by optimism is how a prompt starts
 * silently truncating again, and a truncated prompt is exactly the failure that
 * produced the false statement above.
 */

/**
 * The smallest prompt window this code may assume, in tokens.
 *
 * The PROVEN figure, not the advertised one. 32,768 is what the model reports;
 * 15,728 is what was actually demonstrated to survive round-trip. Building on the
 * advertised number would put 17k tokens of unverified headroom underneath every
 * answer.
 */
export const PROVEN_CONTEXT_TOKENS = 15_728;

/**
 * Total tokens all document evidence may occupy in one turn.
 *
 * Shared between whole documents and retrieved passages, deliberately: they are
 * two ways of spending the same space, and two independent budgets would let a
 * turn carrying both overshoot while each looked compliant.
 */
export const DOCUMENT_TOKEN_BUDGET = 8_000;

/**
 * 🚨 THERE IS DELIBERATELY NO SEPARATE PER-DOCUMENT LIMIT.
 *
 * A first version capped each document at 6,000 tokens beneath the 8,000 total,
 * reasoning that one large file should not crowd out a second. Writing the test
 * for it showed the reasoning produced worse behaviour than it prevented:
 *
 *   - a LONE 7,000-token document was sampled, although the budget could hold it
 *     and there was nothing for it to crowd out; and
 *   - attaching a second, tiny file changed whether the FIRST one was read whole,
 *     which is behaviour no user could predict.
 *
 * The budget alone does the job, filled in the caller's order: the document the
 * question is about is first, so it wins the space, and anything that no longer
 * fits is sampled and disclosed. One concept instead of two, and no interaction.
 */

/**
 * Passage budget when a document must be sampled.
 *
 * Raised from the original 2,000 / 6 chunks, which were sized for a window
 * nobody had measured. Still bounded: a sampled document is by definition one
 * too large to read, so spending the whole allowance on it would starve history.
 */
export const SAMPLED_PASSAGE_TOKEN_BUDGET = 6_000;
export const SAMPLED_PASSAGE_LIMIT = 12;

/** The same estimator the context builder uses, so the two cannot disagree. */
export function estimateDocumentTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface DocumentCandidate {
  path: string;
  text: string;
  /** False when extraction could not read part of it — e.g. charts in a deck. */
  complete: boolean;
  /** Plain words for why it is incomplete. Shown to a user, so no jargon. */
  incompleteReason?: string;
}

export interface WholeDocumentSelection {
  /** Documents that fit and will be sent in full. */
  whole: DocumentCandidate[];
  /** Documents too large to send whole; these must be sampled AND disclosed. */
  sampled: string[];
  /** Tokens the whole documents consumed, so a caller can spend the remainder. */
  tokensUsed: number;
}

/**
 * Decide which attached documents are read whole.
 *
 * 🚨 IN THE ORDER GIVEN, NOT SMALLEST-FIRST. Smallest-first fits more documents
 * and is the wrong answer: it would read two incidental files whole and sample
 * the large one the user actually asked about. The caller's order is the user's
 * order — this turn's attachments, or the file they named — so honouring it
 * means the document a question is about is the one that gets read.
 *
 * A document that does not fit is NOT dropped. It moves to `sampled`, and the
 * caller owes the model a statement that it received part of it. Silently
 * sampling is the original defect.
 */
export function selectWholeDocuments(
  candidates: readonly DocumentCandidate[],
  budget: number = DOCUMENT_TOKEN_BUDGET,
): WholeDocumentSelection {
  const whole: DocumentCandidate[] = [];
  const sampled: string[] = [];
  let tokensUsed = 0;

  for (const candidate of candidates) {
    const cost = estimateDocumentTokens(candidate.text);
    // Empty extraction is not a document that "fits" — there is nothing to read,
    // and claiming it was read whole would be a false completeness claim.
    if (!candidate.text.trim()) {
      sampled.push(candidate.path);
      continue;
    }
    if (tokensUsed + cost > budget) {
      sampled.push(candidate.path);
      continue;
    }
    whole.push(candidate);
    tokensUsed += cost;
  }

  return { whole, sampled, tokensUsed };
}

/**
 * Tokens still available for retrieved passages after whole documents.
 *
 * Never negative, and never more than the sampled-passage budget: the point is
 * to stop the two paths from summing past the document allowance.
 */
export function remainingPassageBudget(tokensUsedByWholeDocuments: number): number {
  const left = DOCUMENT_TOKEN_BUDGET - tokensUsedByWholeDocuments;
  return Math.max(0, Math.min(SAMPLED_PASSAGE_TOKEN_BUDGET, left));
}
