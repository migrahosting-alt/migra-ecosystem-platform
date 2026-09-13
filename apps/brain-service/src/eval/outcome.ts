/**
 * WHAT THE HARNESS DID, AND WHAT THE MODEL SAID, ARE TWO DIFFERENT FACTS.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY THIS IS A TYPE AND NOT A CONVENTION
 *
 * In a single afternoon the 2026-09-13 candidate audit collapsed these three
 * times, each differently, and each time the harness blamed a model for its own
 * limits:
 *
 *   truncation   `num_predict` capped at 900; reasoning models spent it inside
 *                <think> and never reached the answer. Scored FAIL.
 *   formatting   two models answered correctly as `\boxed{36} \text{ minutes}`
 *                and a substring scorer marked both FAIL.
 *   timeout      a request hit the 780s ceiling and returned nothing. Scored
 *                UNCLEAR, as though the MODEL had been unclear.
 *
 * Owner ruling: *"A timeout may be hugely relevant to product economics, but it
 * is not automatically a wrong model answer. That distinction should be
 * impossible for future scorers to collapse accidentally."*
 *
 * So it is impossible here by construction: `score()` is the only way to build
 * a result, it REFUSES to attach a pass/fail to any outcome other than
 * `completed`, and a verdict cannot be constructed without an outcome beside
 * it. A future scorer that forgets the distinction will not compile.
 */

/** What happened to the REQUEST. Nothing here is a judgement about the model. */
export type HarnessOutcome =
  /** The model produced a complete response. Only this may carry a verdict. */
  | 'completed'
  /** The token budget ran out before the answer. The harness's limit, not the model's. */
  | 'truncated'
  /** The harness stopped waiting. Decisive about COST, silent about correctness. */
  | 'timeout'
  /** A complete response containing nothing. */
  | 'empty'
  /** The request never reached the model, or its reply never got back. */
  | 'transport_error'
  /** A reply arrived and could not be read. */
  | 'parse_error';

/** What the model SAID, judged only when it actually said something. */
export type ModelVerdict =
  | 'pass'
  | 'fail'
  /** It answered, and the answer does not decide the question either way. */
  | 'unclear'
  /** There was nothing to judge. The ONLY verdict a non-completed run may carry. */
  | 'not_scored';

export interface ItemResult {
  readonly outcome: HarnessOutcome;
  readonly verdict: ModelVerdict;
  /** Milliseconds of wall clock, whatever the outcome. Always meaningful. */
  readonly ms: number;
  /** Why, in one phrase — for a human reading a failure without the transcript. */
  readonly note?: string;
}

/**
 * The only constructor.
 *
 * 🚨 A NON-COMPLETED RUN CANNOT BE SCORED. Passing a verdict alongside a
 * truncation or a timeout is not merely discouraged, it throws: the mistake
 * this module exists to prevent is silent, so its guard must not be.
 */
export function score(
  outcome: HarnessOutcome,
  ms: number,
  verdict: ModelVerdict,
  note?: string,
): ItemResult {
  if (outcome !== 'completed' && verdict !== 'not_scored') {
    throw new Error(
      `a '${outcome}' run cannot carry the verdict '${verdict}' — the harness did not obtain ` +
      `an answer to judge. Use 'not_scored'.`,
    );
  }
  return { outcome, verdict, ms, ...(note ? { note } : {}) };
}

/** A run that produced no answer. The verdict is fixed, so it cannot be got wrong. */
export function noResult(outcome: Exclude<HarnessOutcome, 'completed'>, ms: number, note?: string): ItemResult {
  return score(outcome, ms, 'not_scored', note);
}

/**
 * Does this result count toward a dimension's score?
 *
 * 🚨 NOT-SCORED ITEMS ARE EXCLUDED FROM THE DENOMINATOR, NOT COUNTED AS FAILURES.
 * Counting them against the model would reintroduce the whole defect: a slow
 * model would score badly for being slow, twice, once in latency and once in
 * quality. Their cost is reported separately and prominently.
 */
export function isScored(r: ItemResult): boolean {
  return r.outcome === 'completed' && r.verdict !== 'not_scored';
}

export interface Tally {
  passed: number;
  /** Items that produced a judgeable answer. The denominator. */
  scored: number;
  /** Items where the harness obtained nothing. Never in the denominator. */
  notScored: number;
  byOutcome: Record<HarnessOutcome, number>;
  /** Pass rate over SCORED items, or null when nothing was scorable. */
  rate: number | null;
}

export function tally(results: readonly ItemResult[]): Tally {
  const byOutcome = {
    completed: 0, truncated: 0, timeout: 0, empty: 0, transport_error: 0, parse_error: 0,
  } as Record<HarnessOutcome, number>;
  let passed = 0, scored = 0, notScored = 0;
  for (const r of results) {
    byOutcome[r.outcome] += 1;
    if (isScored(r)) {
      scored += 1;
      if (r.verdict === 'pass') passed += 1;
    } else {
      notScored += 1;
    }
  }
  return { passed, scored, notScored, byOutcome, rate: scored === 0 ? null : passed / scored };
}

/**
 * 🚨 A RUN THAT MOSTLY FAILED TO MEASURE IS NOT A RUN.
 *
 * A candidate that times out on nine items in ten and passes the tenth would
 * otherwise post a perfect 1.0 over its single scored item. The rate is honest
 * and the sample is not, so coverage is a floor of its own and the suite is
 * invalid below it — deliberately separate from the model's score, because the
 * failure is the measurement's.
 */
export const MINIMUM_COVERAGE = 0.8;

export function coverage(t: Tally): number {
  const total = t.scored + t.notScored;
  return total === 0 ? 0 : t.scored / total;
}
