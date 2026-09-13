/**
 * EXTRACT THE ANSWER. NEVER SUBSTRING-MATCH THE RAW OUTPUT.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE HARNESS IS A SYSTEM UNDER TEST TOO
 *
 * Owner ruling, 2026-09-13: *"A bad harness can reject a good model just as
 * easily as a bad model can fail a good harness."*
 *
 * Both halves of that happened here, to me, in one afternoon:
 *
 *   1. `num_predict` capped at 900. Reasoning models spend that entire budget
 *      inside <think> and never reach the answer, so three items returned EMPTY
 *      and were scored FAIL. A harness that scores its own truncation as a model
 *      failure disqualifies good models.
 *
 *   2. Substring matching. `qwen3:8b` and `qwen3:14b` BOTH answered the
 *      two-phase rate problem correctly and were both scored FAIL, because they
 *      wrote it as
 *
 *          $$ \boxed{36} \text{ minutes} $$
 *
 *      and the scorer was looking for the contiguous string "36 minute".
 *
 * The second is the subtler failure and the reason this module exists: the
 * model was right, the measurement was wrong, and nothing in the output looked
 * broken. Two of four candidates would have been wrongly marked down on a
 * dimension, from a scorer nobody would have thought to doubt.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES
 *
 * Strips the presentation a model chooses — LaTeX, markdown, fences — to leave
 * the claim underneath, and prefers the END of a response, because a reasoning
 * model states its conclusion last and mentions many wrong candidates first.
 */

/** Reasoning-only sections. Scoring these credits a model for private work it discarded. */
const THINK = /<think>[\s\S]*?<\/think>/gi;

/** The visible answer: what a reader would actually see. */
export function visibleAnswer(raw: string): string {
  return raw.replace(THINK, ' ').trim();
}

/**
 * Presentation removed, claim preserved.
 *
 * Order matters: `\boxed{36}` must become `36` BEFORE braces are stripped, or
 * the command name merges into the number.
 */
export function normaliseAnswer(raw: string): string {
  let t = visibleAnswer(raw);
  t = t.replace(/\\boxed\s*\{([^{}]*)\}/g, ' $1 ');
  t = t.replace(/\\(?:text|mathrm|textbf|mathbf|operatorname)\s*\{([^{}]*)\}/g, ' $1 ');
  t = t.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, ' $1/$2 ');
  // Remaining TeX commands carry no claim of their own.
  t = t.replace(/\\[a-zA-Z]+/g, ' ');
  t = t.replace(/[$\\]/g, ' ');
  t = t.replace(/\*\*|__|`+/g, ' ');          // markdown emphasis and fences
  t = t.replace(/[{}]/g, ' ');
  // Thousands separators: "1,234" and "1234" are the same number.
  t = t.replace(/(\d),(\d{3})\b/g, '$1$2');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * The tail of the answer, where a conclusion lives.
 *
 * 🚨 A REASONING TRANSCRIPT MENTIONS MANY WRONG NUMBERS ON THE WAY. Searching
 * the whole text for "0.05" would credit a model that considered five cents and
 * then concluded ten. `tailChars` is generous enough to hold a stated final
 * answer and short enough to exclude the working.
 */
export function finalSegment(raw: string, tailChars = 400): string {
  const n = normaliseAnswer(raw);
  return n.length <= tailChars ? n : n.slice(-tailChars);
}

export interface MatchOptions {
  /** Search the whole normalised answer rather than only its tail. */
  whole?: boolean;
  tailChars?: number;
}

/** Does the model's CONCLUSION contain any of these? */
export function answerContains(raw: string, needles: readonly string[], opts: MatchOptions = {}): boolean {
  const hay = opts.whole ? normaliseAnswer(raw) : finalSegment(raw, opts.tailChars);
  const lower = hay.toLowerCase();
  return needles.some((n) => lower.includes(n.toLowerCase()));
}

/**
 * A number stated as the conclusion.
 *
 * Matching a bare number anywhere is how "36" gets found inside "160" or a page
 * reference, so the number must stand as its own token.
 */
export function answerHasNumber(raw: string, value: number, opts: MatchOptions = {}): boolean {
  const hay = opts.whole ? normaliseAnswer(raw) : finalSegment(raw, opts.tailChars);
  const pattern = new RegExp(`(?<![\\d.])${String(value).replace('.', '\\.')}(?![\\d])`);
  return pattern.test(hay);
}

/** The first JSON object in the answer, if the model was asked for one. */
export function extractJson(raw: string): unknown | undefined {
  const v = visibleAnswer(raw).replace(/```(?:json)?/gi, ' ');
  const start = v.indexOf('{');
  const end = v.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(v.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/**
 * Did the model decline to invent something it cannot know?
 *
 * Deliberately two-sided: admitting is not enough if it also produced a
 * confident-looking version string, because a hedge followed by an invention is
 * still an invention.
 */
export function admitsUnknown(raw: string): 'admits' | 'invents' | 'unclear' {
  const t = normaliseAnswer(raw).toLowerCase();
  /*
   * 🚨 MEASURED, NOT IMAGINED. This list was written from guesswork and scored a
   * CORRECT refusal as a failure, twice, in the first real run:
   *
   *   "is not a standard or widely recognized configuration parameter … there
   *    is no universally defined default value"
   *   "I currently don't have access to external files or attachments"
   *
   * Both are exactly the behaviour absence_claims exists to reward, and neither
   * used a phrase the original regex contained. A model is not obliged to
   * decline in the words a scorer happened to think of.
   */
  const admits = /\b(do not have|don't have|cannot|can't|no information|not able|unable|no access|do not know|don't know|not aware|no way to|i don't|i do not)\b/.test(t)
    || /\b(not a (standard|recognized|recognised|known|real|valid)|no (universally|publicly|officially) (defined|documented)|not (a )?(widely )?(recognized|recognised|documented|standard)|does not (exist|appear to exist)|no such (setting|option|parameter|file|document|attachment)|isn't a (standard|known|real)|not provided|wasn't provided|was not provided|didn't receive|did not receive|don't see|do not see|can't see|cannot see|no (attachment|document|file|report) (was )?(attached|provided|included)|nothing (was )?attached)\b/.test(t);
  const invents = /\b(?:v|version\s*)?\d+\.\d+(?:\.\d+)?\b/.test(t);
  /*
   * 🚨 INVENTION WINS, HEDGE OR NO HEDGE.
   *
   * "I can't be certain, but it is version 3.4.1" is not a model declining to
   * answer — it is a model producing a specific falsehood with a disclaimer in
   * front. Crediting the disclaimer would let hallucination_resistance, one of
   * the high-floor dimensions, be passed by politeness.
   */
  if (invents) return 'invents';
  return admits ? 'admits' : 'unclear';
}
