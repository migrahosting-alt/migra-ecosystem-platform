/**
 * Does this question depend on the document's ORDER?
 *
 * The distinction decides whether unplaced pages matter at all. "What vocabulary
 * appears here" is answerable from any readable page and is unaffected by pages
 * nobody could place; "what comes after section 33" is not, and answering it
 * from an incomplete ordered set would be ordering presented as fact.
 *
 * So the note is attached ONLY where ordering is actually load-bearing. Warning
 * on every question would train the user to ignore the warning, and would make a
 * fully usable document sound unreliable when only one capability is limited.
 */

/** Asking where something sits, or what follows what. */
const SEQUENCE_PATTERNS: readonly RegExp[] = [
  /\b(next|previous|preceding|following|after|before)\s+(lesson|section|chapter|page|part|unit)\b/i,
  /\bwhat\s+(comes|follows)\b/i,
  /\b(in|the)\s+order\b/i,
  /\bsequentially\b/i,
  /\bstep[- ]by[- ]step\b/i,
  /\b(first|last)\s+(lesson|section|chapter|page)\b/i,
  /\bteach\s+me\s+the\s+next\b/i,
  /\bsummari[sz]e\s+.*\b(chapter|book|part)\b.*\b(sequentially|in order)\b/i,
  /\bwhich\s+(lesson|section|chapter)\s+(comes|is)\s+(next|first|last)\b/i,
  /\bcurriculum\b/i,
  /\blesson\s+plan\b/i,
];

/**
 * Content questions, which must keep working regardless of placement.
 *
 * Checked first and deliberately: several of these mention a chapter or a page
 * while asking nothing about order — "what does chapter 2 say about food" is a
 * content question that happens to name a chapter, and gating it would make
 * unplaced pages silently reduce what the product can answer.
 */
const CONTENT_PATTERNS: readonly RegExp[] = [
  /\bwhat\s+does\s+.*\bsay\b/i,
  /\bfind\b.*\b(example|phrase|word|term|spelling)/i,
  /\bwhat\s+vocabulary\b/i,
  /\bhow\s+is\s+.*\b(used|written|spelled|spelt)\b/i,
  /\bdefine\b|\bmeaning\s+of\b|\btranslate\b/i,
];

export interface SequenceSensitivity {
  sensitive: boolean;
  reason: string;
}

export function classifySequenceSensitivity(question: string): SequenceSensitivity {
  const text = question.trim();
  if (!text) return { sensitive: false, reason: 'empty question' };

  const orderMatch = SEQUENCE_PATTERNS.find((re) => re.test(text));
  if (!orderMatch) return { sensitive: false, reason: 'no ordering language' };

  /*
   * Ordering language wins when BOTH appear. "Find the next example" is asking
   * for a position, and treating it as a content question would answer it from
   * an incomplete order without saying so — the failure this exists to prevent.
   */
  const contentMatch = CONTENT_PATTERNS.find((re) => re.test(text));
  return {
    sensitive: true,
    reason: contentMatch
      ? 'asks about order as well as content'
      : `asks about order (${String(orderMatch).slice(0, 40)})`,
  };
}

/**
 * Whether an answer must carry the unplaced-pages note.
 *
 * Both conditions are required. A complete sequence needs no note however the
 * question is phrased, and an incomplete one needs none for a content question —
 * which is most of what a language book is used for.
 */
export function needsSequenceNote(question: string, sequenceComplete: boolean | undefined): boolean {
  if (sequenceComplete !== false) return false;
  return classifySequenceSensitivity(question).sensitive;
}
