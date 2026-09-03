/**
 * A question is a list of things that must be found, not one thing to search for.
 *
 * 🚨 THE DEFECT. "Give me the reference code, the review month, the accent colour
 * and the sensor count" was answered with three of the four, and "Accent colour:
 * Not mentioned in the provided context." Asked on its own seconds later, the
 * same document answered "teal". The fact was indexed, retrievable and present —
 * it simply lost a competition for a fixed number of candidate slots against
 * three chunks that were also relevant.
 *
 * One embedding over a four-part question produces one point in vector space
 * that is near everything and nearest to nothing. The parts then share a budget,
 * and the least semantically dominant one falls off the end.
 *
 * So the question is split into OBLIGATIONS and each obligation is retrieved for
 * with its own budget. The guarantee is coverage of what was asked, not a
 * particular ranking algorithm.
 *
 * DELIBERATELY DETERMINISTIC. No model call: decomposition must be fast, free,
 * and identical on every run. A model that occasionally splits differently would
 * make retrieval coverage non-reproducible, which is worse than the defect.
 */

/** Words that never constitute a fact request on their own. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'for', 'from', 'to', 'is', 'are',
  'was', 'were', 'be', 'it', 'this', 'that', 'these', 'those', 'there', 'their',
  'what', 'which', 'who', 'how', 'many', 'much', 'me', 'my', 'give', 'tell', 'list',
  'show', 'find', 'get', 'please', 'also', 'document', 'file', 'said', 'says',
])

/**
 * How many obligations are worth splitting into.
 *
 * Beyond this the question is a bulk extraction request and per-obligation
 * retrieval stops paying for itself — the budget per obligation gets too small
 * to hold useful context. The cap is stated rather than silent so a very long
 * question degrades predictably instead of quietly retrieving one chunk each.
 */
const MAX_OBLIGATIONS = 8

/** Split points: list separators and coordinating conjunctions. */
const SPLIT = /\s*(?:,|;|\band\b|\balso\b|\bplus\b|\bas well as\b)\s*/i

function meaningful(fragment: string): boolean {
  const words = fragment.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? []
  // At least one word that is not a stopword — "and the" and "how many" alone
  // are grammar, not a fact request.
  return words.some((w) => !STOPWORDS.has(w))
}

export interface FactObligations {
  /** One retrieval target per requested fact. Always at least one. */
  obligations: string[]
  /** True when the question genuinely asks for several distinct facts. */
  multiFact: boolean
  /** Fragments dropped as grammar-only, for the trace. */
  discarded: string[]
}

/**
 * Break a question into the facts it requires.
 *
 * A single-fact question returns itself unchanged — decomposition must never
 * make the common case worse, and splitting "what is the total revenue?" would
 * produce fragments that individually retrieve nothing useful.
 */
export function factObligations(question: string): FactObligations {
  const cleaned = question.trim().replace(/\s+/g, ' ')
  const parts = cleaned.split(SPLIT).map((p) => p.trim()).filter((p) => p !== '')

  const kept: string[] = []
  const discarded: string[] = []
  for (const part of parts) {
    if (meaningful(part)) kept.push(part)
    else discarded.push(part)
  }

  /*
   * Fewer than two real fragments means this was never a list. Return the whole
   * question so retrieval behaves exactly as it did before — the fix must be
   * invisible to single-fact questions, which are most of them.
   */
  if (kept.length < 2) {
    return { obligations: [cleaned], multiFact: false, discarded }
  }

  /*
   * 🚨 THE WHOLE QUESTION IS RETRIEVED FOR TOO, ALWAYS, AND FIRST.
   *
   * The fragments capture the individual facts; the full question captures the
   * relationship between them and anything the split cut in half. Dropping it
   * would trade one coverage failure for another — a question whose meaning
   * lives in its structure would retrieve only its nouns.
   */
  const obligations = [cleaned, ...kept].slice(0, MAX_OBLIGATIONS + 1)

  return { obligations, multiFact: true, discarded }
}
