/**
 * Scoring for vision qualification. Pure functions, so the judgement is testable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 WHY THIS IS NOT "ASK IT AND EYEBALL THE ANSWER"
 *
 * Four vision models are installed on the provider and none is approved, so image
 * input is honestly disabled. Approving one is a governed decision that binds to
 * an exact model digest, and the evidence behind it has to be a measurement
 * somebody else could repeat and disagree with.
 *
 * The obvious harness is the wrong one. Rendering a picture of a cat, asking
 * "is there a cat?" and grepping the reply for "cat" measures almost nothing: the
 * word appears in the question, so a model that always answers "yes, a cat"
 * scores perfectly. A keyword search standing in for a semantic claim is a defect
 * this programme has already made three times.
 *
 * So the two suites here are built the other way round:
 *
 * TRANSCRIPTION uses a real PDF page rasterised to an image, and scores the reply
 * against THAT PDF'S OWN TEXT LAYER, extracted independently. The ground truth is
 * not written by me and not visible to the model — it comes out of the file. The
 * metric is recall over the page's content words, plus precision, because a model
 * that transcribes ten words correctly and invents two hundred is not a model that
 * read the page.
 *
 * COUNTING renders N shapes and asks for N. The answer is an integer and the
 * comparison is exact. It is scored SEPARATELY on purpose: the governance splits
 * `vision.general` from `vision.object_counting` precisely so a model that can
 * read a page cannot quietly inherit an approval to count things, which is the
 * harder task and the one that fails first.
 */

/** A single graded attempt. */
export interface VisionAttempt {
  /** What the image actually contained. */
  expected: string;
  /** What the model said, verbatim. */
  answer: string;
}

export interface TranscriptionScore {
  /** Share of the page's content words that appear in the answer. 0..1 */
  recall: number;
  /** Share of the answer's content words that are actually on the page. 0..1 */
  precision: number;
  /** Ground-truth words the model missed, capped for readability. */
  missed: string[];
  /** Words the model produced that are not on the page, capped. */
  invented: string[];
}

/**
 * Words that carry content, lowercased.
 *
 * Punctuation and case are dropped because a transcription that differs only in
 * them has still read the page. Very short tokens are dropped because "a", "of"
 * and "to" appear in any English text and would inflate both metrics towards a
 * model that produced fluent noise.
 */
export function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4);
}

/**
 * Score a transcription against ground truth taken from the document itself.
 *
 * 🚨 BOTH DIRECTIONS, ALWAYS. Recall alone rewards a model that dumps every word
 * it can imagine; precision alone rewards one that returns a single correct word.
 * A qualification decision needs to see both, so neither is returned without the
 * other.
 *
 * Compared as SETS, not as sequences. A page rasterised and re-read will not
 * reproduce reading order reliably — multi-column layouts alone break it — and
 * failing a model for ordering would reject one that read every word correctly.
 * Ordering is a separate question from whether the text was read.
 */
export function scoreTranscription(attempt: VisionAttempt): TranscriptionScore {
  const truth = new Set(contentWords(attempt.expected));
  const got = new Set(contentWords(attempt.answer));
  if (truth.size === 0) {
    // No ground truth means the fixture is broken, not that the model scored 1.0.
    // Returning a perfect score here is how an empty page passes a benchmark.
    return { recall: 0, precision: 0, missed: [], invented: [...got].slice(0, 20) };
  }
  const hit = [...truth].filter((w) => got.has(w));
  const missed = [...truth].filter((w) => !got.has(w));
  const invented = [...got].filter((w) => !truth.has(w));
  return {
    recall: hit.length / truth.size,
    precision: got.size === 0 ? 0 : hit.length / got.size,
    missed: missed.slice(0, 20),
    invented: invented.slice(0, 20),
  };
}

/**
 * The integer a model meant, or null if it did not give one.
 *
 * 🚨 THE FIRST NUMBER IS NOT THE ANSWER. Replies routinely open with a restatement
 * — "In the image with 5 shapes, I count 7 circles" — and taking the first match
 * grades the question instead of the answer. The LAST integer is taken, which is
 * where a conclusion lands in every phrasing observed, and words for small
 * numbers are accepted because models write "there are four".
 *
 * null is a real outcome and must not collapse to 0: "I cannot tell" and "zero"
 * are different answers, and scoring a refusal as the number zero would credit a
 * model for accidentally matching an empty image.
 */
export function parseCount(answer: string): number | null {
  const words: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  };
  const found: number[] = [];
  for (const m of answer.toLowerCase().matchAll(/\d+|[a-z]+/g)) {
    const t = m[0];
    if (/^\d+$/.test(t)) found.push(Number(t));
    else if (t in words) found.push(words[t]!);
  }
  return found.length ? found[found.length - 1]! : null;
}

export interface SuiteResult {
  suite: string;
  modelId: string;
  attempts: number;
  /** Attempts that met the bar for their suite. */
  correct: number;
  accuracy: number;
  detail: unknown[];
}

/**
 * Does a measured suite clear the bar for serving real users?
 *
 * 🚨 THE BAR IS STATED HERE AND NOT NEGOTIATED AT REPORTING TIME. A threshold
 * chosen after seeing the numbers is not a threshold. These are deliberately
 * demanding because the alternative to an approved vision model is an honest
 * refusal, and a refusal beats a confident misreading of someone's document:
 *
 *  - transcription: recall >= 0.80 AND precision >= 0.60 on every page. Recall is
 *    the higher bar because missing text is what makes an answer wrong; precision
 *    is lower because a rasterised page legitimately picks up furniture (headers,
 *    page numbers) that the text layer orders differently.
 *  - counting: EXACT on at least 0.80 of images. Off-by-one is wrong — "how many
 *    invoices are overdue" has no partial credit.
 */
/**
 * 🚨 ONE RUN IS NOT A VERDICT, AND A SCORE THAT SITS ON A BAR IS NOT A RESULT.
 *
 * Measured 2026-09-27 over THREE runs of this suite against the same provider,
 * same fixtures, same prompts, `temperature: 0`:
 *
 *   qwen2.5vl:7b    all four pages 1.00/1.00, counting 11/14 — IDENTICAL in 3/3
 *   minicpm-v:8b    page-ht-figures  run 1: 0.78   runs 2 and 3: 0.83
 *                   page-ht-prose    run 1: 0.91   runs 2 and 3: 0.86
 *
 * The 0.80 bar sits between 0.78 and 0.83, so minicpm-v's PASS/FAIL flipped
 * between runs. Its counting was 7/14 in all three.
 *
 * ⚠️ WHAT THIS DOES *NOT* ESTABLISH. Run 1 was not a clean replicate: stale
 * fixtures were removed after it and it also hit a missing-file error, so the
 * difference cannot be attributed to provider non-determinism rather than to the
 * changed fixture set. Runs 2 and 3 were byte-identical, which is evidence AGAINST
 * broad randomness. The honest conclusion is narrower than "the provider is
 * non-deterministic", and stating the wider version would be the kind of
 * conclusion-past-the-evidence this module exists to avoid.
 *
 * WHAT IT DOES ESTABLISH. `minicpm-v:8b` scores WITHIN NOISE OF THE BAR on Creole
 * pages, and at least one observation put it on the failing side. `qwen2.5vl:7b`
 * is nowhere near its bar and did not move. A model that can land on either side
 * of a threshold is neither passed nor failed — it is UNQUALIFIABLE on this
 * evidence, and an unqualifiable capability stays unavailable, because a user
 * meets one run and not a distribution.
 *
 * HOW TO APPLY: at least three runs, judged on the WORST observed page — never the
 * average, which would let a perfect English page hide a failing Creole one.
 */
export const MINIMUM_QUALIFYING_RUNS = 3;

export const TRANSCRIPTION_RECALL_BAR = 0.8;
export const TRANSCRIPTION_PRECISION_BAR = 0.6;
export const COUNTING_ACCURACY_BAR = 0.8;

export function transcriptionPassed(scores: readonly TranscriptionScore[]): boolean {
  if (scores.length === 0) return false; // no evidence is not a pass
  return scores.every(
    (s) => s.recall >= TRANSCRIPTION_RECALL_BAR && s.precision >= TRANSCRIPTION_PRECISION_BAR,
  );
}

export function countingPassed(results: readonly { expected: number; got: number | null }[]): boolean {
  if (results.length === 0) return false;
  const exact = results.filter((r) => r.got !== null && r.got === r.expected).length;
  return exact / results.length >= COUNTING_ACCURACY_BAR;
}
