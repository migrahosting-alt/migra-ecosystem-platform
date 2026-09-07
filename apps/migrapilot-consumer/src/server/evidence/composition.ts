/**
 * THE EVIDENCE → RESPONSE SEAM.
 *
 * ---------------------------------------------------------------------------
 * WHAT WENT WRONG, TWICE, IN TWO UNRELATED CAPABILITIES
 *
 * Deterministic evidence is prepended to the model's prompt to CONSTRAIN the
 * answer — measured figures it may not recalculate, a refusal reason it may not
 * substitute. That machinery works. What it also did was supply a voice, and
 * the model sometimes adopted it:
 *
 *   "MigraPilot could not read the connected project: Connect a project to
 *    this conversation, then ask again."
 *
 *   "MigraPilot could not calculate this from eq_roundtrip.xlsx (sheet
 *    "Data"): "ZipCode" identifies rows rather than measuring them…"
 *
 * Both are semantically correct and neither is how a person talks. They are the
 * internal envelope — the transport we use to constrain the model — read aloud.
 *
 * Seen once it is a copy quirk. Seen in the spreadsheet path AND the project
 * path, from code that shares nothing, it is a property of the SEAM. So it is
 * fixed here, once, and both callers build their evidence through this module.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE PRESENTATION BOUNDARY MOVES; THE SEMANTICS DO NOT
 *
 * Nothing here weakens grounding, and that restraint is deliberate — this
 * codebase has already had a wording change quietly weaken a refusal. What is
 * preserved, exactly as before:
 *
 *   · the deterministic evidence itself
 *   · the explicit refusal category and its stated reason
 *   · the anti-rederivation directives
 *   · provenance, including file and sheet names
 *   · the exact capability state
 *
 * The ONLY thing added is an instruction about voice: say the meaning, do not
 * recite the envelope.
 * ---------------------------------------------------------------------------
 */

/**
 * The line that separates constraint from costume.
 *
 * Phrased as a positive instruction with a concrete negative example, because
 * "do not repeat this" alone has a habit of being followed by repeating it. The
 * example is one of the two real observed echoes.
 */
const VOICE = [
  'HOW TO SAY THIS: the bracketed block above is MigraPilot’s internal working note.',
  'Answer the user in your own words, as a normal reply. Do not quote the block, do not',
  'copy its phrasing, and never begin with "MigraPilot could not…" or "Computed directly',
  'from…" — those are internal framing, not something a person says. Every FACT and every',
  'limit above is binding; only the wording is yours.',
]

/** Phrases that are the envelope rather than the meaning. Exported for the guard. */
export const SCAFFOLDING_PHRASES = [
  'MigraPilot could not calculate this from',
  'MigraPilot could not read the connected project',
  'Computed directly from',
  'Read directly from the connected project',
  'Give THAT reason to the user',
  'do not substitute a different one',
  'Use them verbatim',
  'Use these results verbatim',
  'do not recalculate them',
  'an invented figure here is worse than no answer',
  'internal working note',
]

/** Vocabulary that belongs to the machinery and never to a reader. */
export const INTERNAL_VOCABULARY = [
  /\bworkspace\.inspect\b/,
  /\bchangeset\.propose\b/,
  /\bvision\.read\b/,
  /\bengineer\.plan\b/,
  /\bconnected-repo\b/,
  /\bplatform-project\b/,
  /\bws_[a-z0-9]+/i,
  /\bproj_[a-z0-9]+/i,
  /\bappr_[A-Za-z0-9_-]+/,
  /\bsha256:/i,
  /\bnormalizedInputHash\b/,
  /\bidempotencyKey\b/,
  /\bProjectAuthority\b/,
  /\bcanRead\b|\bcanPropose\b|\bcanApply\b/,
  /\boutcome_unknown\b/,
  /\bgroundedFiles\b/,
]

export interface EvidenceBlock {
  /** What is true. Facts and figures, or the reason nothing could be produced. */
  fact: string[]
  /** What the model must not do. Binding, and unchanged by this module. */
  directives: string[]
}

/**
 * Assemble the block that goes in front of the prompt.
 *
 * One shape for every capability: facts, then binding directives, then the
 * voice instruction last — closest to the model's own turn, where a final
 * instruction carries most.
 */
export function composeEvidence(block: EvidenceBlock): string {
  return [...block.fact, ...block.directives, ...VOICE, ''].join('\n')
}

/**
 * Does this answer read like the envelope rather than the meaning?
 *
 * Used by tests rather than at runtime: the model is instructed, not policed,
 * because rewriting its output after the fact would put a second author between
 * the evidence and the user — and that author would be the one place nothing
 * verifies. A guard that FAILS THE BUILD is the honest lever.
 */
export function scaffoldingIn(answer: string): string[] {
  const found = SCAFFOLDING_PHRASES.filter((phrase) => answer.includes(phrase))
  for (const pattern of INTERNAL_VOCABULARY) {
    const match = answer.match(pattern)
    if (match) found.push(match[0])
  }
  return found
}
