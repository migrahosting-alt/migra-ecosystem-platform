/*
 * THE ACCEPTANCE BAR FOR `chat.general`.
 *
 * WRITTEN AND COMMITTED BEFORE ANY CANDIDATE WAS RUN. That ordering is the whole
 * point and it is visible in git history: a bar chosen after seeing scores is
 * not a bar, it is a description of whatever the model happened to do. The model
 * must satisfy Migra Core; Migra Core is not weakened to fit the model.
 *
 * If evidence later justifies moving a number, bump THRESHOLD_REVISION and say
 * why. A threshold that changes silently has the same problem as one fitted
 * after the fact.
 *
 * WHY THESE NUMBERS.
 *
 * The overall bar (0.80) is deliberately below perfection: ordinary conversation
 * tolerates an occasional miss, and a suite demanding 100% would qualify nothing
 * and teach us nothing. What it does NOT tolerate is a model that is strong on
 * average while broken in one dimension, so every dimension carries its own
 * floor — an average is exactly the statistic that hides a hole.
 *
 * Three dimensions carry a HIGHER floor because their failures are the expensive
 * ones and are invisible to a casual reader:
 *   hallucination_resistance — a fabricated fact is worse than no answer, and it
 *                              arrives looking exactly like a good answer.
 *   refusal_uncertainty      — inventing what it cannot know is the same defect
 *                              seen from the other side.
 *   structured_output        — malformed output breaks whatever consumes it, and
 *                              breaks it silently.
 *
 * negative_control demands a PERFECT score, alone among the dimensions. Those
 * cases exist to fail degenerate strategies — always refuse, always ask, always
 * elaborate. A single failure there means a headline score may have been earned
 * by one of those strategies, which invalidates the run rather than costing it
 * a few points.
 */

import type { Dimension } from './cases.js';

export const THRESHOLD_REVISION = 'chat-general-threshold/1.0.0';

/** Minimum pass rate for the whole suite. */
export const OVERALL_MINIMUM = 0.8;

/** Floor per dimension. An average must not be able to hide a broken dimension. */
export const DIMENSION_MINIMUMS: Record<Dimension, number> = {
  instruction_following: 0.66,
  factual_discipline: 0.66,
  ambiguity_handling: 0.5,
  multi_turn_coherence: 1.0,
  response_control: 0.5,
  structured_output: 0.75,
  refusal_uncertainty: 0.75,
  basic_reasoning: 0.66,
  tool_selection: 0.5,
  hallucination_resistance: 0.75,
  conversation_continuity: 1.0,
  multilingual: 0.5,
  // Not negotiable — see the header.
  negative_control: 1.0,
};

/*
 * multi_turn_coherence and conversation_continuity sit at 1.0 with only two and
 * one cases respectively. That is intentional: a model that cannot carry a fact
 * or a pronoun across one turn is not a conversational model at all, and this
 * exact failure once shipped — chat had no multi-turn memory, and a follow-up
 * about a code just given was answered with an invented Python function.
 */

/** Replications for stochastic cases; a case passes on a MAJORITY of runs. */
export const REPLICATION_RUNS = 3;

export interface DimensionScore {
  dimension: Dimension;
  passed: number;
  total: number;
  rate: number;
  meetsFloor: boolean;
}

export interface SuiteVerdict {
  overallRate: number;
  meetsOverall: boolean;
  dimensions: DimensionScore[];
  failedDimensions: Dimension[];
  /** The single answer: does this candidate qualify for chat.general? */
  qualifies: boolean;
  thresholdRevision: string;
}

export function verdictFor(dimensions: DimensionScore[], overallRate: number): SuiteVerdict {
  const failed = dimensions.filter((d) => !d.meetsFloor).map((d) => d.dimension);
  return {
    overallRate,
    meetsOverall: overallRate >= OVERALL_MINIMUM,
    dimensions,
    failedDimensions: failed,
    // BOTH conditions. A strong average with a failed floor is not a pass.
    qualifies: overallRate >= OVERALL_MINIMUM && failed.length === 0,
    thresholdRevision: THRESHOLD_REVISION,
  };
}
