/**
 * WHEN TO SEARCH THE WEB — decided deterministically, and explainably.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT LEFT TO THE MODEL
 *
 * A model asked "should I search?" says yes far too often. Every yes costs a
 * provider request, seconds of latency, and — worse — invites an answer to be
 * rewritten around whatever the web returned, when the user had already
 * supplied the material. Someone who uploads a spreadsheet and asks about a
 * column is not asking about the internet.
 *
 * So routing is a deterministic floor with an explicit reason code. A model may
 * later be allowed to REQUEST a search within these bounds; it may not decide
 * unilaterally that one is needed, because that decision is unauditable and
 * fails differently on every run.
 *
 * ---------------------------------------------------------------------------
 * CONSERVATIVE ON PURPOSE
 *
 * The default is `search_not_needed`. Being wrong that way costs an answer that
 * could have been fresher; being wrong the other way costs latency, quota, and
 * an answer contaminated by an irrelevant page. Only the second is hard for a
 * user to notice, so the asymmetry decides the default.
 *
 * `search_optional` exists for the middle: a question that WOULD benefit but
 * does not require it. The caller decides what to do with that — the planner's
 * job is to be honest about which of the three it is.
 */

export type SearchDecision = 'search_required' | 'search_optional' | 'search_not_needed';

export type SearchReasonCode =
  | 'explicit_request'
  | 'freshness_language'
  | 'current_pricing_or_availability'
  | 'news_intent'
  | 'official_source_lookup'
  | 'comparative_research'
  | 'arithmetic'
  | 'text_transformation'
  | 'grounded_in_attachment'
  | 'conversational'
  | 'no_freshness_need';

export interface SearchPlan {
  decision: SearchDecision;
  reason: SearchReasonCode;
  /** One sentence, for the trace. Never shown to a user as-is. */
  explanation: string;
}

export interface PlanInput {
  prompt: string;
  /** Files the turn is grounded in. Their presence changes the answer. */
  attachments?: readonly string[];
}

const plan = (decision: SearchDecision, reason: SearchReasonCode, explanation: string): SearchPlan => ({
  decision,
  reason,
  explanation,
});

/** "search the web", "look it up", "google it" — an instruction, not a topic. */
const EXPLICIT = /\b(search (the )?web|search online|look (this |it )?up online|web search|google (it|this)|search for)\b/i;

/** Words that make a question about NOW. */
const FRESHNESS = /\b(latest|newest|most recent|right now|currently|today|this week|this month|as of now|up to date|breaking)\b/i;

const PRICING = /\b(price|prices|pricing|cost|costs|how much (is|are|does)|in stock|availability|available now|msrp)\b/i;

const NEWS = /\b(news|headline|headlines|announced|announcement|released|launch|launched|happening)\b/i;

const OFFICIAL = /\b(official (docs|documentation|site|website|guide)|api (docs|documentation|reference)|documentation for|changelog|release notes)\b/i;

const COMPARATIVE = /\b(compare|comparison|versus|vs\.?|best|top \d+|alternatives to|pros and cons)\b/i;

/** Pure arithmetic, with no words that would make it a research question. */
const ARITHMETIC = /^[\s\d+\-*/×÷^().,%=]+\??$/;
const ARITHMETIC_PHRASED = /\b(what is|what's|calculate|compute)\b[\s\d+\-*/×÷^().,%]+\??$/i;

/** Asking for the user's OWN text to be changed. The material is in the prompt. */
const TRANSFORMATION = /\b(rewrite|reword|rephrase|summari[sz]e (this|the following|my)|translate (this|the following|my)|proofread|fix the grammar|make this (shorter|longer|clearer)|tone)\b/i;

const CONVERSATIONAL = /^\s*(hi|hello|hey|thanks|thank you|ok|okay|got it|cool|nice|sure|yes|no)\b/i;

/**
 * Decide whether this turn needs the web.
 *
 * Order matters and is not arbitrary. An explicit instruction wins over
 * everything, because a user who says "search the web" has settled the
 * question. Attachment grounding is checked early, before topical signals,
 * since "what is the latest figure in this spreadsheet" contains freshness
 * language and is emphatically not a web question.
 */
export function planSearch(input: PlanInput): SearchPlan {
  const prompt = input.prompt.trim();
  const hasAttachments = (input.attachments?.length ?? 0) > 0;

  if (prompt.length === 0) {
    return plan('search_not_needed', 'conversational', 'Nothing was asked.');
  }

  // 1. An explicit instruction settles it, attachments or not.
  if (EXPLICIT.test(prompt)) {
    return plan('search_required', 'explicit_request', 'The user asked for a web search.');
  }

  /*
   * 2. 🚨 ATTACHMENTS WIN OVER TOPICAL SIGNALS.
   *
   * "What is the latest revenue figure in this file" contains freshness
   * language and is a question about the file. Searching would answer a
   * question nobody asked, using a source the user did not choose, and the
   * answer would look authoritative.
   */
  if (hasAttachments) {
    return plan(
      'search_not_needed',
      'grounded_in_attachment',
      'The question is about material the user attached.',
    );
  }

  // 3. Transformation of the user's own text needs no external source.
  if (TRANSFORMATION.test(prompt)) {
    return plan('search_not_needed', 'text_transformation', 'The material is already in the prompt.');
  }

  // 4. Arithmetic. Checked before topical signals so "compare 2+2 vs 3+1"
  //    does not become research.
  if (ARITHMETIC.test(prompt) || ARITHMETIC_PHRASED.test(prompt)) {
    return plan('search_not_needed', 'arithmetic', 'This is a calculation.');
  }

  if (CONVERSATIONAL.test(prompt) && prompt.length < 40) {
    return plan('search_not_needed', 'conversational', 'Ordinary conversation.');
  }

  // 5. Things that are ABOUT the present. Freshness is the strongest signal:
  //    a model's training data cannot be current by construction.
  if (FRESHNESS.test(prompt)) {
    return plan('search_required', 'freshness_language', 'The question asks for current information.');
  }
  if (PRICING.test(prompt)) {
    return plan('search_required', 'current_pricing_or_availability', 'Prices and availability change.');
  }
  if (NEWS.test(prompt)) {
    return plan('search_required', 'news_intent', 'The question is about recent events.');
  }

  /*
   * 6. Genuinely useful, not strictly necessary. Official documentation and
   *    comparisons are answerable from memory and answered BETTER from
   *    sources — but a wrong "required" here spends a request on every
   *    question that mentions "best".
   */
  if (OFFICIAL.test(prompt)) {
    return plan('search_optional', 'official_source_lookup', 'An official source would be more reliable.');
  }
  if (COMPARATIVE.test(prompt)) {
    return plan('search_optional', 'comparative_research', 'Comparisons benefit from current sources.');
  }

  return plan('search_not_needed', 'no_freshness_need', 'Nothing about this question requires current information.');
}
