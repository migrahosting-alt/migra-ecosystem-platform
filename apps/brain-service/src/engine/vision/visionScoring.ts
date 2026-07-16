/**
 * MigraAI Engine — vision qualification scoring.
 *
 * The deterministic scoring behind the Vision Registry. A vision model is only
 * qualified against KNOWN ground truth (see scripts/gen-vision-fixtures.mjs):
 *
 *  - each fixture carries criteria as synonym GROUPS; a group is satisfied if ANY
 *    of its substrings appears (case-insensitive) in the model's answer, and the
 *    fixture score is the fraction of groups satisfied;
 *  - OCR fixtures add an `exactText` HARD GATE — a model that cannot read the exact
 *    strings off an image cannot be trusted with UI/code/screenshot work, so a
 *    miss fails qualification regardless of the reasoning score;
 *  - a model that fails to LOAD/RUN is fail-closed (never qualified — the same
 *    posture that retired llama3.2-vision).
 *
 * The production bar is the same discipline as the other registries — nothing here
 * lowers it. Extracted from the harness so it is unit-tested without a GPU.
 */

/** Fraction of criteria groups satisfied by an answer (any-match, case-insensitive). */
export function scoreFixture(answer: string, criteria: string[][]): { score: number; groups: boolean[] } {
  const t = (answer ?? '').toLowerCase();
  const groups = criteria.map((group) => group.some((s) => t.includes(s.toLowerCase())));
  const satisfied = groups.filter(Boolean).length;
  return { score: criteria.length ? satisfied / criteria.length : 0, groups };
}

/** OCR hard gate: every exact string must appear verbatim (case-insensitive). */
export function ocrExactPass(answer: string, exactText: string[]): boolean {
  const t = (answer ?? '').toLowerCase();
  return exactText.every((s) => t.includes(s.toLowerCase()));
}

export interface VisionQualInput {
  /** Per-fixture scores in [0,1]. */
  fixtureScores: number[];
  /** The model failed to load/run at least once (fail-closed). */
  loadFailed: boolean;
  /** Every OCR exact-text gate passed. */
  ocrExactPassed: boolean;
}

export interface VisionQualResult {
  overall: number;
  passes: boolean;
  reason: string;
}

/** Production qualification bar — aligned with the other registries' 7/9 ≈ 0.78;
 * a vision model must clear this AND the hard gates below. */
export const VISION_THRESHOLD = 0.75;

/**
 * Decide whether a vision model qualifies. Hard gates (load, OCR) are checked
 * before the averaged score so a model can never be promoted on reasoning alone
 * while being unable to actually read an image.
 */
export function qualifyVision(input: VisionQualInput): VisionQualResult {
  if (input.loadFailed) {
    return { overall: 0, passes: false, reason: 'model failed to load or run (fail-closed, not qualified)' };
  }
  const overall = input.fixtureScores.length
    ? input.fixtureScores.reduce((a, b) => a + b, 0) / input.fixtureScores.length
    : 0;
  if (!input.ocrExactPassed) {
    return { overall, passes: false, reason: 'OCR exact-text gate failed — cannot read UI/code/screens reliably' };
  }
  return {
    overall,
    passes: overall >= VISION_THRESHOLD,
    reason: overall >= VISION_THRESHOLD ? 'meets the production bar' : `below the ${VISION_THRESHOLD} production bar`,
  };
}
