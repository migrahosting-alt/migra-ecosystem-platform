/**
 * Migra Engineer — conversation-quality evaluation contract.
 *
 * WHY THIS EXISTS. MigraPilot passed every technical acceptance test it had
 * while telling a French speaker it was "un assistant de codage" and answering
 * Haitian Creole in Indonesian. API tests cannot see that. A human typing
 * `sak pase?` saw it immediately.
 *
 * So this suite is a PRODUCT gate, not an infrastructure one, and it runs
 * against a candidate before that candidate may serve a capability.
 *
 * THE HONESTY RULE THAT SHAPES EVERYTHING BELOW. A check is automated only
 * where a machine can genuinely decide it. Whether a reply is in French is
 * decidable. Whether Haitian Creole is *grammatical and natural* is not — not
 * by string matching, and not by asking the same family of model that failed.
 * Those cases are collected and marked for human review rather than scored, and
 * the report says so. An eval that guesses is worse than no eval: it manufactures
 * confidence about the exact capability we are trying to measure.
 */

/** Capability under test. Mirrors the routing vocabulary Brain will select on. */
export type Capability =
  | 'general_chat'
  | 'identity'
  | 'writing'
  | 'learning'
  | 'brainstorming'
  | 'general_knowledge'
  | 'ambiguous_turn'
  | 'french'
  | 'haitian_creole'
  | 'language_switching'
  | 'software_engineering'
  | 'document_retrieval'
  | 'refusal_integrity'

/** A machine-decidable expectation. */
export interface Assertion {
  /** Human-readable statement of what must hold. Printed on failure. */
  describe: string
  /** True when the reply satisfies it. */
  check: (reply: string, context: EvalContext) => boolean
}

export interface EvalContext {
  /** Files the caller genuinely has, for grounded cases. */
  ownedFiles: string[]
}

export interface EvalCase {
  id: string
  capability: Capability
  /** What the user types. Written the way a person actually types. */
  prompt: string
  /** Prior turns, for follow-up and language-switching cases. */
  history?: { role: 'user' | 'assistant'; content: string }[]
  /** Answer only from the caller's documents, or refuse. */
  grounded?: boolean
  /** Machine-decidable expectations. All must hold to pass. */
  assertions: Assertion[]
  /**
   * What a human must judge that a machine cannot.
   *
   * Present means the case is NEVER reported as passed on automation alone —
   * it is reported as `needs-human`, with the reply attached.
   */
  humanReview?: string
  /** Why this case exists. Regression cases name the incident. */
  note?: string
}

export type Outcome = 'pass' | 'fail' | 'needs-human' | 'error'

export interface CaseResult {
  id: string
  capability: Capability
  outcome: Outcome
  prompt: string
  reply: string
  latencyMs: number
  /** Assertions that did not hold. Empty on pass. */
  failed: string[]
  humanReview?: string
}

export interface SuiteResult {
  suiteVersion: string
  target: string
  model: string
  startedAt: string
  results: CaseResult[]
  totals: Record<Outcome, number>
  byCapability: Record<string, { pass: number; fail: number; needsHuman: number; error: number }>
}

/** A model under evaluation. Any endpoint that can answer a prompt. */
export interface EvalTarget {
  name: string
  /** Identity of what actually answered, for the promotion record. */
  model(): Promise<string>
  ask(input: { prompt: string; history?: EvalCase['history']; grounded?: boolean }): Promise<string>
}
