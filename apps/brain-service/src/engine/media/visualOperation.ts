import type { ModelCapability } from '../persistence/postgres/modelQualificationRepo.js';

/**
 * Which visual operation a turn is asking for, and therefore which capability
 * must be qualified to serve it.
 *
 * WHY THIS EXISTS. "Vision-capable" is one label over two very different
 * reliability envelopes. Qwen2.5-VL reads invoices, screenshots and charts
 * correctly on every run, and answers 6 for an unambiguous picture of 7 circles
 * — every run, with no hedge. Treating both as one capability means the second
 * kind of question gets a confident wrong number from a model nobody qualified
 * to produce it.
 *
 * THIS IS A LEXICAL HEURISTIC, NOT COMPREHENSION. It matches how people phrase a
 * request for a count. It cannot know that "is it three or four?" wants a tally
 * while "what are the three tallest bars?" does not, and pretending otherwise
 * would be the same overclaim it exists to prevent. What it buys is that the
 * obvious phrasings — the ones a user actually types — stop reaching a model
 * that cannot answer them.
 *
 * THE RESIDUAL RISK IS FALSE NEGATIVES, and it is stated rather than papered
 * over: a counting question phrased unusually still routes as general and still
 * gets a confident wrong answer. The mitigation is not a longer word list; it is
 * a qualified counting capability (detection/segmentation) to route to, at which
 * point this classifier chooses a tool instead of choosing a refusal.
 *
 * FALSE POSITIVES ARE THE CHEAP DIRECTION. A general question misread as
 * counting produces an honest "exact counting is not reliable" instead of an
 * answer. That is a worse experience and a truthful one, which is the trade this
 * takes deliberately.
 */

export type VisualOperation = 'general' | 'object_counting';

/**
 * Phrasings that ask for a quantity.
 *
 * Deliberately anchored: `\bcount\b` and not `count` so "countertop", "country"
 * and "discount" do not trigger a refusal. Each entry is a way people actually
 * ask, not a synonym harvested for coverage.
 */
const COUNTING_PATTERNS: readonly RegExp[] = [
  /\bhow many\b/i,
  /\bhow much\b.*\b(are|is)\s+there\b/i,
  /\bcount\b/i,
  /\bcounting\b/i,
  /\bnumber of\b/i,
  /\btally\b/i,
  /\btotal number\b/i,
  /\bhow many times\b/i,
  /\bare there (more|fewer|less) than\b/i,
  /\bexactly how many\b/i,
];

export interface VisualOperationDecision {
  operation: VisualOperation;
  /** The capability that must be approved for this turn to be served. */
  capability: ModelCapability;
  /** The pattern that decided it, for audit — never a claim of understanding. */
  matched: string | null;
}

export function classifyVisualOperation(prompt: string | undefined | null): VisualOperationDecision {
  const text = typeof prompt === 'string' ? prompt : '';
  for (const pattern of COUNTING_PATTERNS) {
    if (pattern.test(text)) {
      return {
        operation: 'object_counting',
        capability: 'vision.object_counting',
        matched: pattern.source,
      };
    }
  }
  return { operation: 'general', capability: 'vision.general', matched: null };
}

/**
 * What to tell someone whose question needs a capability nothing is qualified for.
 *
 * It says what is not reliable and why, and does not offer a number anyway. A
 * message that ended "but it looks like about seven" would undo the refusal.
 */
export function unqualifiedOperationMessage(operation: VisualOperation): string {
  if (operation === 'object_counting') {
    return (
      'I can look at this image, but I am not able to give you an exact count. ' +
      'The vision model running here was measured on counting and is not reliable at it — ' +
      'it miscounts without any sign that it has, so a number from it would look ' +
      'confident and be wrong. Ask me what is in the image and I can answer that.'
    );
  }
  return 'No vision model is currently qualified to answer questions about images.';
}
