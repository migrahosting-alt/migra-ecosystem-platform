/**
 * MIGRA-OWNED RANKING — the first place our judgement replaces the provider's.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PROVIDER'S ORDER IS NOT THE ANSWER
 *
 * A federated backend orders by its own blend of upstream engine scores. That
 * ordering optimises for a general web search, not for "answer this person's
 * question from sources worth citing". It has no opinion about whether the
 * third result is the fourth one syndicated, whether an official reference
 * outranks a tutorial that copied it, or whether a 2019 page belongs at the top
 * of a question that said "latest".
 *
 * Provider rank is kept as ONE INPUT — it encodes real relevance signal we
 * cannot cheaply reproduce — and it stops being the final authority.
 *
 * ---------------------------------------------------------------------------
 * 🚨 NO FAVOURITE-DOMAIN LIST
 *
 * The obvious way to make "official docs beat a scraped tutorial" work is a
 * list of blessed domains. It is also the wrong way, and it fails in a
 * specific direction: a static list encodes today's web, silently demotes
 * every source nobody thought of, and turns an editorial judgement into
 * infrastructure that no test can meaningfully cover.
 *
 * So directness is derived FROM THE QUERY. A question naming Stripe's API
 * makes `stripe.com` direct because the subject appears in the host, not
 * because someone wrote it down. The same code ranks a vendor nobody has heard
 * of correctly on the day they launch.
 *
 * ---------------------------------------------------------------------------
 * EXPLAINABLE BY CONSTRUCTION
 *
 * Every component returns a score AND a reason, and both are kept on the
 * result. "Why is this third?" must be answerable from the data rather than by
 * re-reading the weights, because an unexplainable ranker cannot be debugged
 * when it is subtly wrong — which is the state a ranker spends most of its
 * life in.
 */

import { nearlyIdentical } from './normalize.js';
import type { SearchResult } from './types.js';

/**
 * Component weights, PER QUESTION — not one fixed table.
 *
 * 🚨 A FIXED TABLE WAS THE FIRST DESIGN, AND THE FIXTURES KILLED IT.
 *
 * With `providerRank` at 0.30 and `freshness` at 0.05, a 2019 page beat a
 * week-old one on a query that literally said "latest": the freshness term
 * could not overcome a two-place provider gap. The same table let an SEO
 * tutorial outrank a vendor's own documentation, because directness at 0.15
 * was worth less than first place.
 *
 * Both are the same mistake — treating "what this question is for" as a
 * constant. A weight table that cannot express "the user asked for recency" is
 * a table that makes provider rank the final authority in every case where it
 * matters, which is precisely what this module exists to stop.
 *
 * So the profile is chosen from the request. The weights are still named,
 * still sum to one, and are still asserted by DIRECTION rather than by exact
 * totals — a test pinning a score to three decimals would break on every
 * tuning change while proving nothing.
 */
export const WEIGHTS = {
  providerRank: 0.25,
  relevance: 0.25,
  intent: 0.15,
  directness: 0.20,
  originality: 0.10,
  freshness: 0.05,
} as const;

export type WeightProfile = Record<keyof typeof WEIGHTS, number>;

/**
 * The weights this particular question deserves.
 *
 * Recency profile: the user said "latest". Freshness becomes a primary term
 * and provider rank yields, because the provider's ordering has no idea the
 * question was time-sensitive.
 *
 * Official-source profile: the user asked for the reference. Directness and
 * intent carry it, because "who published this" is the question.
 */
export function weightsFor(input: Pick<RankInput, 'freshness' | 'intent'>): WeightProfile {
  if (input.freshness !== 'any') {
    return {
      providerRank: 0.15,
      relevance: 0.20,
      intent: 0.10,
      directness: 0.10,
      originality: 0.10,
      // The dominant term, because it is what was actually asked for.
      freshness: 0.35,
    };
  }
  if (input.intent === 'official_source_lookup') {
    return {
      providerRank: 0.15,
      relevance: 0.20,
      intent: 0.20,
      directness: 0.35,
      originality: 0.10,
      freshness: 0,
    };
  }
  return { ...WEIGHTS };
}

export interface RankedResult {
  result: SearchResult;
  score: number;
  /** Component scores and why. Kept for the trace, never shown to a user. */
  components: { name: string; score: number; reason: string }[];
}

export interface RankInput {
  query: string;
  results: readonly SearchResult[];
  freshness: 'any' | 'recent' | 'latest';
  /** Intent from the planner. Shapes what "a good result" means. */
  intent?: 'official_source_lookup' | 'news_intent' | 'comparative_research' | 'general';
  /** Extraction quality per canonical URL, when pages have been fetched. */
  extractionQuality?: ReadonlyMap<string, number>;
  /**
   * `<link rel="canonical">` per fetched URL, when pages have been read.
   *
   * Available only AFTER fetching, which is why originality has a provider-rank
   * fallback: at ranking time we may have nothing but the provider's order.
   */
  canonicalLinks?: ReadonlyMap<string, string>;
  now?: () => number;
}

/**
 * Does a canonical link count as EVIDENCE that this page is a copy?
 *
 * 🚨 A CANONICAL TAG IS A CLAIM BY WHOEVER SERVED THE PAGE, NOT A FACT.
 *
 * Trusting it across unrelated domains is an attack: any site can declare
 * itself canonical for a competitor's article and inherit its standing, or
 * declare a rival a copy of itself. So a cross-domain canonical is accepted
 * ONLY as self-demotion — a page saying "the original is elsewhere" is
 * evidence against ITSELF, which nobody has an incentive to fake.
 *
 * A page declaring itself canonical tells us nothing, and a page pointing at
 * another domain as a copy OF it is ignored entirely.
 */
function canonicalVerdict(
  result: SearchResult,
  canonicalLinks: ReadonlyMap<string, string> | undefined,
): { kind: 'self' | 'points_elsewhere' | 'unknown'; target?: string } {
  const declared = canonicalLinks?.get(result.canonicalUrl);
  if (!declared) return { kind: 'unknown' };
  let target: URL;
  try {
    target = new URL(declared, result.canonicalUrl);
  } catch {
    return { kind: 'unknown' };
  }
  const targetHost = target.hostname.replace(/^www\./, '').toLowerCase();
  if (targetHost === result.domain.toLowerCase() && target.pathname === new URL(result.canonicalUrl).pathname) {
    return { kind: 'self' };
  }
  // Self-demotion: this page says the original is somewhere else.
  return { kind: 'points_elsewhere', target: target.toString() };
}

const meaningfulTerms = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'what', 'which', 'how', 'why', 'who', 'when',
  'with', 'from', 'this', 'that', 'these', 'those', 'their', 'there', 'about', 'into', 'best',
  'find', 'show', 'get', 'latest', 'current', 'new', 'official', 'docs', 'documentation',
]);

/** Fraction of the query's meaningful terms present in the result's own text. */
function relevanceOf(query: string, result: SearchResult): { score: number; reason: string } {
  const terms = meaningfulTerms(query);
  if (terms.length === 0) return { score: 0.5, reason: 'query had no distinctive terms' };
  const haystack = `${result.title} ${result.snippet}`.toLowerCase();
  const matched = terms.filter((t) => haystack.includes(t));
  const score = matched.length / terms.length;
  return { score, reason: `${matched.length}/${terms.length} query terms present` };
}

/**
 * Is this the subject's own source?
 *
 * Derived, never listed. A query term appearing in the HOST means the result is
 * published by the thing being asked about — `stripe.com` for a Stripe
 * question. A path segment counts for less: `example.com/blog/stripe-guide` is
 * about Stripe, not by them.
 */
function directnessOf(query: string, result: SearchResult): { score: number; reason: string } {
  const terms = meaningfulTerms(query);
  if (terms.length === 0) return { score: 0.5, reason: 'no terms to match against the source' };

  const host = result.domain.toLowerCase();
  const inHost = terms.filter((t) => host.includes(t));
  if (inHost.length > 0) {
    return { score: 1, reason: `published by the subject (${inHost.join(', ')} in host)` };
  }

  let path = '';
  try {
    path = new URL(result.canonicalUrl).pathname.toLowerCase();
  } catch {
    path = '';
  }
  const inPath = terms.filter((t) => path.includes(t));
  if (inPath.length > 0) return { score: 0.5, reason: 'about the subject, not by it' };
  return { score: 0.25, reason: 'no direct relationship to the subject' };
}

/**
 * Does the result TYPE match what was asked for.
 *
 * Shape-based, from URL and title, and deliberately coarse: a docs question
 * favouring a `/docs/` path is a real signal; anything finer would be guessing.
 */
function intentOf(input: RankInput, result: SearchResult): { score: number; reason: string } {
  const intent = input.intent ?? 'general';
  const url = result.canonicalUrl.toLowerCase();
  const title = result.title.toLowerCase();

  if (intent === 'official_source_lookup') {
    if (/\/(docs|documentation|reference|api|developers?|guide)\b/.test(url)) {
      return { score: 1, reason: 'a documentation path' };
    }
    if (/\b(tutorial|how to|blog|medium\.com|dev\.to)\b/.test(`${url} ${title}`)) {
      // Not worthless — often excellent — but not what was asked for.
      return { score: 0.3, reason: 'a tutorial or blog post, not the reference' };
    }
    return { score: 0.6, reason: 'no clear documentation signal' };
  }

  if (intent === 'news_intent') {
    if (/\/(news|article|story|\d{4}\/\d{2})\b/.test(url)) return { score: 1, reason: 'a news article path' };
    return { score: 0.6, reason: 'no clear news signal' };
  }

  return { score: 0.6, reason: 'no specific intent to match' };
}

/**
 * Original, or a copy?
 *
 * Dedup already collapsed exact and mirror duplicates. What survives here is
 * SYNDICATION: the same body republished under a different headline on a
 * different host, which URL comparison cannot see. Being one of several
 * near-identical bodies is the signal, and the one with the best provider rank
 * keeps originality — it is the closest thing to a source we can identify
 * without another fetch.
 */
function originalityOf(
  result: SearchResult,
  all: readonly SearchResult[],
  canonicalLinks?: ReadonlyMap<string, string>,
): { score: number; reason: string } {
  const twins = all.filter((other) => other !== result && nearlyIdentical(other.snippet, result.snippet));
  if (twins.length === 0) return { score: 1, reason: 'no near-identical copies' };

  /*
   * CANONICAL EVIDENCE FIRST, when we have it.
   *
   * This resolves the limitation recorded when originality shipped: provider
   * rank was the only signal, so a third-ranked original lost to a first-ranked
   * syndication. A page that DECLARES the original is elsewhere has told us
   * something provider rank cannot.
   */
  const verdict = canonicalVerdict(result, canonicalLinks);
  if (verdict.kind === 'points_elsewhere') {
    return { score: 0.15, reason: 'the page itself names a different canonical source' };
  }

  /*
   * If any TWIN self-demotes toward this result, this is the original — and
   * that is stronger than being first in the provider's list, because it is
   * the copy's own admission.
   */
  const admittedBy = twins.filter((twin) => {
    const twinVerdict = canonicalVerdict(twin, canonicalLinks);
    if (twinVerdict.kind !== 'points_elsewhere' || !twinVerdict.target) return false;
    try {
      const target = new URL(twinVerdict.target);
      const here = new URL(result.canonicalUrl);
      return target.hostname.replace(/^www\./, '') === here.hostname.replace(/^www\./, '')
        && target.pathname === here.pathname;
    } catch {
      return false;
    }
  });
  if (admittedBy.length > 0) {
    return { score: 1, reason: `${admittedBy.length} copy(ies) name this page as canonical` };
  }

  /*
   * FALLBACK: provider rank, and it is explicitly a guess. Kept because at
   * ranking time pages may not have been fetched at all, and a guess that
   * usually holds beats no ordering.
   */
  const bestRank = Math.min(...twins.map((t) => t.providerRank), result.providerRank);
  if (result.providerRank === bestRank) {
    return { score: 0.9, reason: `likely the original of ${twins.length} near-identical copies (by provider rank)` };
  }
  return { score: 0.2, reason: `appears to be a syndicated copy (${twins.length} near-identical, by provider rank)` };
}

/**
 * Freshness — ONLY when it was asked for.
 *
 * 🚨 An evergreen question must not be reordered by date. "How does a hash map
 * work" has a best answer that may be fifteen years old, and letting recency
 * intrude there actively degrades the result. So this returns a NEUTRAL score
 * for `freshness: 'any'`, and an unknown date is neutral too rather than
 * penalised — a page that did not state a date is not thereby old.
 */
function freshnessOf(input: RankInput, result: SearchResult): { score: number; reason: string } {
  if (input.freshness === 'any') return { score: 0.5, reason: 'freshness not requested' };
  if (!result.publishedAt) {
    return { score: 0.5, reason: 'no publication date — not penalised for being unknown' };
  }
  const now = (input.now ?? (() => Date.now()))();
  const ageDays = (now - Date.parse(result.publishedAt)) / 86_400_000;
  if (Number.isNaN(ageDays)) return { score: 0.5, reason: 'unparseable date' };

  const horizon = input.freshness === 'latest' ? 30 : 365;
  if (ageDays <= 0) return { score: 1, reason: 'published now' };
  const score = Math.max(0, Math.min(1, 1 - ageDays / horizon));
  return { score, reason: `${Math.round(ageDays)} days old against a ${horizon}-day horizon` };
}

/** Provider rank, normalised so first place scores 1 and it decays smoothly. */
function providerRankOf(result: SearchResult): { score: number; reason: string } {
  const score = 1 / (1 + Math.max(0, result.providerRank) * 0.25);
  return { score, reason: `provider placed this at ${result.providerRank}` };
}

/**
 * Rank results by Migra's judgement.
 *
 * Ties break on provider rank, so an ordering is always deterministic — two
 * results with identical component scores must not swap between runs, or a
 * benchmark measures noise.
 */
export function rankResults(input: RankInput): RankedResult[] {
  const weights = weightsFor(input);
  const ranked = input.results.map((result) => {
    const components = [
      { name: 'providerRank', ...providerRankOf(result) },
      { name: 'relevance', ...relevanceOf(input.query, result) },
      { name: 'intent', ...intentOf(input, result) },
      { name: 'directness', ...directnessOf(input.query, result) },
      { name: 'originality', ...originalityOf(result, input.results, input.canonicalLinks) },
      { name: 'freshness', ...freshnessOf(input, result) },
    ];

    let score = 0;
    for (const component of components) {
      score += component.score * (weights[component.name as keyof typeof WEIGHTS] ?? 0);
    }

    /*
     * Extraction quality is a MULTIPLIER, not another weighted term. A page we
     * fetched and could not read should fall regardless of how well it scored
     * on every other axis — an unreadable page cannot support a citation, so
     * its other virtues are irrelevant.
     */
    const quality = input.extractionQuality?.get(result.canonicalUrl);
    if (quality !== undefined) {
      score *= quality;
      components.push({
        name: 'extractionQuality',
        score: quality,
        reason: quality < 0.5 ? 'little readable content was extracted' : 'page read cleanly',
      });
    }

    return { result, score, components };
  });

  return ranked.sort((a, b) => b.score - a.score || a.result.providerRank - b.result.providerRank);
}
