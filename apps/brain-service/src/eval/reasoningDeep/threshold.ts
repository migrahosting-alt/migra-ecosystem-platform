/**
 * The bar for `reasoning.deep`, and why each number is where it is.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE PREVIOUS SUITE ESTABLISHED A FLOOR, NOT DIFFERENTIATION.
 *
 * Five items; every candidate passed every item it completed, 19 of 19. A suite
 * that cannot separate an 8B from a 32B is measuring whether a model is broken,
 * not whether it is good enough to carry a product promise.
 *
 * So these dimensions are chosen for where good models DIVERGE: holding state
 * across steps, retaining a constraint that stops being convenient, noticing
 * that the evidence is incomplete, and changing an answer when contradicted.
 * Any single-shot model can do arithmetic.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THESE NUMBERS ARE PROPOSED, NOT SETTLED.
 *
 * Owner ruling: do not freeze thresholds before seeing the distribution, or the
 * bar gets tuned around whichever model was measured first. They are written
 * down so the run can be scored at all, and `THRESHOLD_REVISION` exists so
 * moving one is a recorded act rather than an edit.
 *
 * An approval records the revision it cleared, so a threshold that moves later
 * cannot retroactively justify a decision taken under the old one.
 */

export const SUITE_REVISION = 'reasoning-deep-suite/0.1.0-draft';
export const THRESHOLD_REVISION = 'reasoning-deep-threshold/0.1.0-draft';
/** The contract a decision row binds. Distinct from the suite that produced the evidence. */
export const POLICY_VERSION = 'reasoning-deep-policy/0.1.0-draft';

export type Dimension =
  /** Several constraints at once, where satisfying the easy ones is not enough. */
  | 'multi_step_constraint'
  /** A plan where two requirements genuinely conflict and one must be traded. */
  | 'conflicting_requirements'
  /** A diagnosis from evidence that does not contain the answer. */
  | 'incomplete_evidence_debugging'
  /** Arithmetic where an intermediate value must be carried, not recomputed. */
  | 'stateful_numeric'
  /** Strict output format while doing hard work — where format usually slips. */
  | 'structured_under_load'
  /** A constraint given early that becomes inconvenient later. */
  | 'constraint_retention'
  /** Saying how sure it is, and being right about that. */
  | 'uncertainty_calibration'
  /** Asked to confirm something that is not there. */
  | 'absence_claims'
  /** Whether a tool is the right move at all. */
  | 'tool_decision'
  /** Reasoning over material too long to hold in one glance. */
  | 'long_context'
  /** Changing its answer when shown it was wrong — and not when it was right. */
  | 'self_correction'
  /** Cases that must fail a model gaming the suite. */
  | 'negative_control';

/**
 * Floors per dimension. An average must never hide a broken one.
 *
 * The high floors are the failures that are invisible to a casual reader and
 * expensive in a product:
 *
 *   absence_claims           inventing an observation is the defect this whole
 *                            programme has been chasing for a week — the model
 *                            that described a PDF it never read, the one that
 *                            invented an audio stack. It gets the highest bar.
 *   uncertainty_calibration  the same defect seen from the other side.
 *   structured_under_load    malformed output breaks its consumer silently.
 *   constraint_retention     a forgotten constraint produces a confident,
 *                            plausible, wrong answer.
 */
export const DIMENSION_MINIMUMS: Record<Dimension, number> = {
  multi_step_constraint: 0.75,
  conflicting_requirements: 0.66,
  incomplete_evidence_debugging: 0.66,
  stateful_numeric: 0.80,
  structured_under_load: 0.85,
  constraint_retention: 0.85,
  uncertainty_calibration: 0.85,
  absence_claims: 0.90,
  tool_decision: 0.66,
  long_context: 0.66,
  self_correction: 0.75,
  /** 🚨 PERFECT, ALONE AMONG THE DIMENSIONS. See below. */
  negative_control: 1.0,
};

/** Weighted overall bar. Both this AND every floor must clear. */
export const OVERALL_MINIMUM = 0.80;

/**
 * Not every dimension costs the same when it fails.
 *
 * Weighting is deliberately mild — a 3:1 spread, not 10:1 — because a weight
 * large enough to rescue a failed dimension would defeat the floors, and the
 * floors are the part that matters.
 */
export const DIMENSION_WEIGHTS: Record<Dimension, number> = {
  multi_step_constraint: 2,
  conflicting_requirements: 2,
  incomplete_evidence_debugging: 2,
  stateful_numeric: 2,
  structured_under_load: 3,
  constraint_retention: 3,
  uncertainty_calibration: 3,
  absence_claims: 3,
  tool_decision: 1,
  long_context: 2,
  self_correction: 2,
  negative_control: 1,
};

export interface DimensionScore {
  dimension: Dimension;
  rate: number | null;
  scored: number;
  notScored: number;
}

export interface SuiteVerdict {
  passed: boolean;
  overall: number | null;
  coverage: number;
  failedFloors: Dimension[];
  /** Dimensions with nothing scorable. Not a pass and not a failure — a gap. */
  unmeasured: Dimension[];
  invalidatedBy: 'negative_control' | 'coverage' | null;
  reason: string;
}

/**
 * The verdict, and what invalidates it.
 *
 * 🚨 TWO THINGS INVALIDATE A RUN RATHER THAN COSTING IT POINTS:
 *
 *   negative_control below 1.0 — those cases exist to fail a model that always
 *     refuses, always hedges, or always elaborates. One failure means the
 *     headline score may have been earned by such a strategy, so the score
 *     stops meaning anything. It is not a bad result; it is not a result.
 *
 *   coverage below its floor — a candidate that timed out on most items and
 *     passed the rest would otherwise post a perfect rate over a sample too
 *     small to support it. The rate is honest; the sample is not.
 *
 * 🚨 AN UNMEASURED DIMENSION IS NEVER A PASS. A floor that nothing was scored
 * against has not been cleared, and treating "no data" as "no problem" is how a
 * gap becomes a claim.
 */
export function verdictFor(
  scores: readonly DimensionScore[],
  coverageRatio: number,
  minimumCoverage: number,
): SuiteVerdict {
  const unmeasured = scores.filter((s) => s.rate === null).map((s) => s.dimension);
  const failedFloors = scores
    .filter((s) => s.rate !== null && s.rate < DIMENSION_MINIMUMS[s.dimension])
    .map((s) => s.dimension);

  const measured = scores.filter((s) => s.rate !== null);
  const totalWeight = measured.reduce((a, s) => a + DIMENSION_WEIGHTS[s.dimension], 0);
  const overall = totalWeight === 0
    ? null
    : measured.reduce((a, s) => a + s.rate! * DIMENSION_WEIGHTS[s.dimension], 0) / totalWeight;

  const nc = scores.find((s) => s.dimension === 'negative_control');
  if (nc && nc.rate !== null && nc.rate < 1) {
    return {
      passed: false, overall, coverage: coverageRatio, failedFloors, unmeasured,
      invalidatedBy: 'negative_control',
      reason: 'a negative control failed — the headline score may have been earned by a degenerate strategy, so this run is invalid rather than merely poor',
    };
  }
  if (coverageRatio < minimumCoverage) {
    return {
      passed: false, overall, coverage: coverageRatio, failedFloors, unmeasured,
      invalidatedBy: 'coverage',
      reason: `only ${(coverageRatio * 100).toFixed(0)}% of items produced a judgeable answer — the sample is too small to support any rate`,
    };
  }
  if (unmeasured.length > 0) {
    return {
      passed: false, overall, coverage: coverageRatio, failedFloors, unmeasured, invalidatedBy: null,
      reason: `no data for ${unmeasured.join(', ')} — an unmeasured floor has not been cleared`,
    };
  }
  if (failedFloors.length > 0) {
    return {
      passed: false, overall, coverage: coverageRatio, failedFloors, unmeasured, invalidatedBy: null,
      reason: `below the floor on ${failedFloors.join(', ')} — an average must not hide a broken dimension`,
    };
  }
  if (overall === null || overall < OVERALL_MINIMUM) {
    return {
      passed: false, overall, coverage: coverageRatio, failedFloors, unmeasured, invalidatedBy: null,
      reason: `weighted overall ${overall === null ? 'n/a' : overall.toFixed(2)} is below ${OVERALL_MINIMUM}`,
    };
  }
  return {
    passed: true, overall, coverage: coverageRatio, failedFloors, unmeasured, invalidatedBy: null,
    reason: `every floor cleared and weighted overall ${overall.toFixed(2)} ≥ ${OVERALL_MINIMUM}`,
  };
}
