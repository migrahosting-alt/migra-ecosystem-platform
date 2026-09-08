/**
 * MIGRA SEARCH — the contract. Not SearXNG's contract. Ours.
 *
 * ---------------------------------------------------------------------------
 * THE GOVERNING RULE
 *
 * We are not building a SearXNG feature. We are building Migra Search, and
 * SearXNG happens to be its first retrieval backend.
 *
 * That distinction is the whole reason this file exists before any adapter
 * does. If SearXNG's response shape, its ranking, its engine list, its URLs or
 * its lifecycle leak upward, then replacing it later — with our own crawler, a
 * different backend, or a specialised vertical — becomes a product change
 * rather than a provider change. Every type here is therefore written from what
 * a SEARCH means to Migra, never from what SearXNG happens to return.
 *
 * Concretely, nothing above this layer may know:
 *   · that SearXNG exists
 *   · which upstream engines it federates
 *   · its host, port, health, or version
 *   · its scoring, or the shape of its JSON
 *
 * ---------------------------------------------------------------------------
 * UNKNOWN STAYS UNKNOWN
 *
 * Every optional field here is optional because a provider may genuinely not
 * know it. A publication date that was not reported must remain absent — never
 * "today", never inferred from the crawl time. This codebase has been bitten
 * repeatedly by a confident default standing in for a missing fact, and a
 * fabricated date is worse than a missing one because it silently changes how
 * a freshness-sensitive answer ranks.
 */

/** What the caller wants, in Migra's vocabulary. */
export interface SearchRequest {
  query: string;
  /** BCP-47 where the caller has a preference. Absent means "no preference". */
  language?: string;
  /** Upper bound on results wanted. The provider may return fewer. */
  limit: number;
  /**
   * How much the caller cares about recency. This is INTENT, not a filter: a
   * provider that cannot express it must not pretend it applied one.
   */
  freshness: 'any' | 'recent' | 'latest';
  safeSearch: 'off' | 'moderate' | 'strict';
  /** Hard deadline in ms. A provider that cannot answer in time must fail, not stall. */
  timeoutMs: number;
  /** Correlates provider calls with the turn that caused them, for provenance. */
  correlationId?: string;
}

/**
 * One result, normalized. `url` is exactly what the provider gave;
 * `canonicalUrl` is what dedup and citation use.
 */
export interface SearchResult {
  title: string;
  url: string;
  /** Tracking parameters stripped, mirrors resolved where identifiable. */
  canonicalUrl: string;
  /** The provider's own summary. NOT fetched page content — see `FetchedDocument`. */
  snippet: string;
  /** Registrable domain, for authority signals and source diversity. */
  domain: string;
  /** Only when the PROVIDER reported it. Never inferred from retrieval time. */
  publishedAt?: string;
  language?: string;
  /** Where this sat in the provider's own ordering, before any Migra ranking. */
  providerRank: number;
  /** Which provider produced it. Provenance, not a routing hint for callers. */
  provider: string;
  /** When we asked. Distinct from `publishedAt`, and never a substitute for it. */
  retrievedAt: string;
}

/**
 * Why a search produced nothing useful — as SEPARATE facts.
 *
 * 🚨 "The provider was down" and "there is nothing to find" are opposite claims
 * about the world, and collapsing them into "I couldn't find anything" is a
 * lie the user cannot detect. Every failure mode here exists because it must
 * reach the answer differently.
 */
export type SearchFailure =
  /** Configured but unreachable, refused, or erroring. */
  | { kind: 'provider_unavailable'; detail: string }
  /** Answered too slowly for the caller's deadline. */
  | { kind: 'provider_timeout'; waitedMs: number }
  /** Answered normally, and the answer was genuinely empty. */
  | { kind: 'no_results' }
  /** Nothing is configured. Distinct from "down": nobody has set it up. */
  | { kind: 'not_configured'; detail: string }
  /** The engine declined before dispatching. */
  | { kind: 'refused'; reason: string };

export type SearchOutcome =
  | { ok: true; results: SearchResult[]; provider: string; tookMs: number }
  | { ok: false; failure: SearchFailure; provider: string; tookMs: number };

/**
 * A retrieval backend. SearXNG will be the first; nothing above depends on that.
 *
 * `health()` is separate from `search()` on purpose. The capability registry
 * needs to answer "can this run right now" WITHOUT performing a query — a
 * readiness probe that costs a real search would either be skipped or would
 * spend the user's provider quota to render a menu.
 */
export interface SearchProvider {
  /** Stable identifier for provenance. Never shown to a user. */
  readonly id: string;
  search(request: SearchRequest): Promise<SearchOutcome>;
  health(): Promise<ProviderHealth>;
}

export interface ProviderHealth {
  /** Whether a search dispatched right now could succeed. */
  ready: boolean;
  /**
   * Why not, in words the ENGINE owns and a user could read.
   *
   * It must not name the backend, its host, or its version. "Search is not
   * configured yet" is the truth a person needs; "SearXNG at 10.10.0.x refused
   * the connection" is infrastructure describing itself, which this codebase
   * already shipped to a user once and will not again.
   */
  reason?: string;
  checkedAt: string;
}
