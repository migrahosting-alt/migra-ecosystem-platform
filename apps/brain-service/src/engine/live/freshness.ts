/**
 * Does this turn need LIVE sources, or does the model already know?
 *
 * WHY THIS EXISTS. A model answers "who is the CEO of X" or "what version is Y"
 * from training data that stopped months ago, in the same confident voice it
 * uses for arithmetic. The user cannot tell the difference, which is the whole
 * problem: a stale answer is indistinguishable from a current one until it
 * matters. So the decision to go and look must be made by the product, not left
 * to the user to remember to ask for.
 *
 * AUTO-TRIGGERED, NOT A MODE. Requiring someone to tick "search the web" means
 * the people most likely to be misled — the ones who do not know the answer is
 * time-sensitive — are exactly the ones who will not tick it.
 *
 * LEXICAL, WITH A STATED LIMIT, like the other classifiers beside it. It reads
 * how people actually phrase time-sensitive questions. It cannot know that
 * "what is the capital of France" is stable while "what is the capital of the
 * caliphate" might not be, so a phrasing outside these lists falls through to
 * NOT searching — the cheaper mistake, since a needless retrieval spends latency
 * and can drag an answer toward whatever a search engine happened to return.
 *
 * PROVIDER-INDEPENDENT ON PURPOSE. Nothing here knows which retrieval service
 * exists, or whether one exists at all. That belongs to the router; this module
 * answers one question — does this turn need something newer than the model.
 */

export type FreshnessNeed = 'required' | 'helpful' | 'none'

export interface FreshnessDecision {
  need: FreshnessNeed
  /** The signal that decided it, so a routing record can be read back. */
  reason: string
  /** Matched text, for the trace. Never shown to the user. */
  evidence?: string
}

/** The user said to go and look. Nothing outranks this. */
const EXPLICIT_REQUEST: readonly RegExp[] = [
  /\b(search|look\s?up|google|check)\s+(the\s+)?(web|online|internet)\b/i,
  /\b(search|look)\s+(it|this|that)\s+up\b/i,
  /\bweb\s?search\b/i,
  /\bfind\s+(me\s+)?(some\s+)?(sources|links|articles|references)\b/i,
  /\bwith\s+(sources|citations)\b/i,
]

/** The user asked to NOT go and look. Also outranks the heuristics. */
const EXPLICIT_REFUSAL: readonly RegExp[] = [
  /\b(do\s?n[o']?t|no\s+need\s+to|without)\s+(search|look\s?ing?\s?up|browsing?|the\s+web)\b/i,
  /\bfrom\s+(memory|what\s+you\s+know)\b/i,
  /\bno\s+web\b/i,
]

/** Words that only make sense against a clock. */
const TIME_ANCHORED: readonly RegExp[] = [
  /\b(today|tonight|right\s+now|currently|at\s+the\s+moment|as\s+of\s+(now|today))\b/i,
  /\b(this|last|next)\s+(week|month|quarter|year|season)\b/i,
  /\b(recent|recently|lately|so\s+far)\b/i,
  /\b(latest|newest|most\s+recent|up[-\s]?to[-\s]?date|current)\b/i,
  /\b(still|yet)\s+(available|open|running|supported|working)\b/i,
  /\bnews\b/i,
  /\bbreaking\b/i,
  /\bwhat('s| is)\s+new\b/i,
]

/**
 * Things whose answer changes without warning.
 *
 * A model's confidence about these is unrelated to whether it is right, because
 * the fact moved after training and nothing told it.
 */
const VOLATILE_SUBJECT: readonly RegExp[] = [
  /\b(price|cost|pricing|how\s+much\s+(is|does|are))\b/i,
  /\b(stock|share\s+price|market\s+cap|exchange\s+rate|interest\s+rate)\b/i,
  /\bweather|forecast|temperature\b/i,
  /\b(score|standings|fixtures|who\s+won|results)\b/i,
  /\b(election|poll|votes?)\b/i,
  /\b(released?|release\s+date|launch(ed|es)?|available|out\s+yet|shipping)\b/i,
  /\b(version|latest\s+version|changelog|deprecated|end\s+of\s+life)\b/i,
  /\b(ceo|president|prime\s+minister|leader|owner)\s+of\b/i,
  /\bwho\s+(is|are)\s+the\s+(ceo|president|current)\b/i,
  /\b(status|outage|down)\s+(of|for)\b/i,
  /\bhow\s+old\s+is\b/i,
]

/** A year that is plausibly "now or later" rather than history. */
const RECENT_YEAR = /\b(20[2-9]\d)\b/

/**
 * Questions that are stable no matter when they are asked.
 *
 * Checked first among the heuristics, because "what is the latest thinking on
 * recursion" should not trigger a web search: the volatile word is decoration
 * on a stable question.
 */
const STABLE_SUBJECT: readonly RegExp[] = [
  /\b(explain|teach|how\s+do\s+i|how\s+to|what\s+does\s+.*\s+mean|difference\s+between)\b/i,
  /\b(write|refactor|debug|fix|implement|generate)\s+(a\s+|an\s+|the\s+|some\s+)?(code|function|script|test|class|component)\b/i,
  /\b(translate|summari[sz]e|rewrite|proofread)\b/i,
  /\b(definition|meaning|formula|theorem|syntax)\b/i,
]

const firstMatch = (patterns: readonly RegExp[], text: string): string | null => {
  for (const re of patterns) {
    const m = re.exec(text)
    if (m) return m[0]
  }
  return null
}

export interface FreshnessContext {
  /** The turn already has documents or images to answer FROM. */
  hasAttachedContext?: boolean
  /** Today, so a year reference can be judged. Injected rather than read, so
   *  this stays deterministic under test. */
  now?: Date
}

export function assessFreshness(prompt: string, context: FreshnessContext = {}): FreshnessDecision {
  const text = prompt.trim()
  if (!text) return { need: 'none', reason: 'empty prompt' }

  /*
   * REFUSAL IS CHECKED FIRST, because a refusal CONTAINS a request. "don't
   * search the web" matches the request pattern too, and reading the request
   * first turned an explicit no into an explicit yes — the exact opposite of
   * what the user said.
   */
  const refused = firstMatch(EXPLICIT_REFUSAL, text)
  if (refused) return { need: 'none', reason: 'the user asked not to search', evidence: refused }

  const asked = firstMatch(EXPLICIT_REQUEST, text)
  if (asked) return { need: 'required', reason: 'the user asked for a web search', evidence: asked }

  /*
   * ATTACHED CONTEXT WINS over a merely time-flavoured phrase. "What is the
   * latest figure in this report" is a question about the report; going to the
   * web would answer a different question with a worse source.
   */
  if (context.hasAttachedContext) {
    return { need: 'none', reason: 'the turn has its own source material' }
  }

  const stable = firstMatch(STABLE_SUBJECT, text)
  const timeWord = firstMatch(TIME_ANCHORED, text)
  const volatile = firstMatch(VOLATILE_SUBJECT, text)

  if (stable && !timeWord) {
    return { need: 'none', reason: 'a stable question', evidence: stable }
  }

  if (timeWord && volatile) {
    return {
      need: 'required',
      reason: 'a time-anchored question about something that changes',
      evidence: `${timeWord} + ${volatile}`,
    }
  }

  if (timeWord) {
    return { need: 'required', reason: 'the question is anchored to now', evidence: timeWord }
  }

  if (volatile) {
    // Volatile alone is weaker: "what is the price of a Tesla" has no clock in
    // it, but the answer still rots. Worth looking, not worth failing over.
    return { need: 'helpful', reason: 'the subject changes over time', evidence: volatile }
  }

  const year = RECENT_YEAR.exec(text)
  if (year) {
    const named = Number(year[1])
    const currentYear = (context.now ?? new Date()).getUTCFullYear()
    // A year at or after the present is a question about the present; an older
    // one is history the model may legitimately know.
    if (named >= currentYear) {
      return { need: 'required', reason: 'asks about the current year or later', evidence: year[0] }
    }
  }

  return { need: 'none', reason: 'nothing time-sensitive detected' }
}
