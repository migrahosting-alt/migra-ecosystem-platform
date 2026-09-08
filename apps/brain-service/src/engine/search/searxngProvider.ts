/**
 * THE SEARXNG ADAPTER — the only file in this codebase that knows SearXNG exists.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS FOR
 *
 * Translating between the Migra contract and one backend. Everything SearXNG-
 * shaped stops here: its query parameters, its JSON, its engine names, its
 * error strings, its host. Above this file the system knows only
 * `SearchProvider`, and that is what makes SearXNG replaceable — by our own
 * index, by a different backend, or by several routed together — without
 * touching Chat, the registry, or the ranker.
 *
 * The test of whether that boundary holds is simple: deleting this file and
 * writing a different adapter should require no change anywhere else.
 *
 * ---------------------------------------------------------------------------
 * 🚨 NO EXCEPTION BECOMES "NOTHING FOUND"
 *
 * The single most damaging thing an adapter can do is collapse a transport
 * failure into an empty result set. "The backend refused the connection" and
 * "the web contains nothing about this" are opposite claims, and only one of
 * them is something we learned. Every catch here maps to a specific failure
 * kind, and `no_results` is returned ONLY when SearXNG answered normally with
 * an empty list.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FETCH IS INJECTED
 *
 * So the whole translation can be tested against recorded payloads with no
 * backend running — which is the state this was written in, and the state it
 * must keep working in when the backend is down.
 */

import { canonicalizeUrl, domainOf } from './normalize.js';
import type {
  ProviderHealth,
  SearchOutcome,
  SearchProvider,
  SearchRequest,
  SearchResult,
} from './types.js';

/** Exactly the shape SearXNG's JSON API returns. Not exported: it stops here. */
interface SearxngResponse {
  query?: string;
  number_of_results?: number;
  results?: Array<{
    url?: string;
    title?: string;
    content?: string;
    engine?: string;
    publishedDate?: string | null;
    score?: number;
  }>;
}

export interface SearxngConfig {
  /**
   * Internal base URL. Never leaves this module, never reaches a user, and
   * never appears in a failure message — a refusal that names the host is a
   * network-mapping oracle and the beginning of infrastructure describing
   * itself to someone who asked about restaurants.
   */
  baseUrl: string;
  /**
   * Engines to query, explicitly. SearXNG's default set includes engines that
   * rate-limit, break, or return low-quality results, and enabling everything
   * to inflate result counts buys duplicates and latency rather than coverage.
   */
  engines: readonly string[];
  /** Ceiling on how long a search may take, independent of the caller's. */
  maxTimeoutMs: number;
}

type FetchLike = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Migra freshness intent → SearXNG's `time_range`. */
function timeRangeFor(freshness: SearchRequest['freshness']): string | undefined {
  // SearXNG accepts day/week/month/year. `latest` maps to a week rather than a
  // day because a one-day window returns almost nothing for most subjects, and
  // an empty result set reads to a user as "there is no news".
  if (freshness === 'latest') return 'week';
  if (freshness === 'recent') return 'year';
  return undefined;
}

const SAFE_SEARCH = { off: '0', moderate: '1', strict: '2' } as const;

export class SearxngProvider implements SearchProvider {
  readonly id = 'searxng';

  constructor(
    private readonly config: SearxngConfig,
    private readonly fetchImpl: FetchLike,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Health, WITHOUT performing a search.
   *
   * Separate from `search()` because the capability registry calls readiness to
   * draw a menu. A probe that ran a real query would spend the backend's
   * capacity every time someone opened the composer.
   */
  async health(): Promise<ProviderHealth> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      // `/healthz` is SearXNG's own liveness endpoint and returns no results.
      const response = await this.fetchImpl(`${this.config.baseUrl}/healthz`, {
        signal: controller.signal,
        headers: { accept: 'text/plain' },
      });
      return response.ok
        ? { ready: true, checkedAt: new Date(this.now()).toISOString() }
        : {
            ready: false,
            // The engine's own words. Never the status line, never the host.
            reason: 'Web search is unavailable right now.',
            checkedAt: new Date(this.now()).toISOString(),
          };
    } catch {
      return {
        ready: false,
        reason: 'Web search is unavailable right now.',
        checkedAt: new Date(this.now()).toISOString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async search(request: SearchRequest): Promise<SearchOutcome> {
    const started = this.now();
    const tookMs = () => this.now() - started;
    const budget = Math.min(request.timeoutMs, this.config.maxTimeoutMs);

    const params = new URLSearchParams({
      q: request.query,
      format: 'json',
      safesearch: SAFE_SEARCH[request.safeSearch],
      engines: this.config.engines.join(','),
    });
    const timeRange = timeRangeFor(request.freshness);
    if (timeRange) params.set('time_range', timeRange);
    if (request.language) params.set('language', request.language);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budget);

    let payload: unknown;
    try {
      const response = await this.fetchImpl(`${this.config.baseUrl}/search?${params.toString()}`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        /*
         * A non-2xx is the backend REFUSING, not an empty web. SearXNG returns
         * 429 when it is rate-limited by upstreams — reporting that as "no
         * results" would tell the user the world is empty because we asked too
         * fast.
         */
        return {
          ok: false,
          failure: { kind: 'provider_unavailable', detail: `status ${response.status}` },
          provider: this.id,
          tookMs: tookMs(),
        };
      }
      payload = await response.json();
    } catch (error) {
      const aborted = error instanceof Error && (error.name === 'AbortError' || /abort/i.test(error.message));
      return {
        ok: false,
        failure: aborted
          ? { kind: 'provider_timeout', waitedMs: tookMs() }
          : { kind: 'provider_unavailable', detail: error instanceof Error ? error.message : 'transport error' },
        provider: this.id,
        tookMs: tookMs(),
      };
    } finally {
      clearTimeout(timer);
    }

    const parsed = payload as SearxngResponse;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.results)) {
      /*
       * A 200 that is not the shape we expect is a BROKEN backend, not an empty
       * result set. Treating unparseable output as "nothing found" would hide a
       * misconfiguration behind a plausible answer.
       */
      return {
        ok: false,
        failure: { kind: 'provider_unavailable', detail: 'unrecognised response shape' },
        provider: this.id,
        tookMs: tookMs(),
      };
    }

    const results = this.toCanonical(parsed.results, request.limit);
    // Reached only when the backend answered normally. THIS is `no_results`.
    return { ok: true, results, provider: this.id, tookMs: tookMs() };
  }

  /** SearXNG rows → the Migra contract. Unknown fields stay unknown. */
  private toCanonical(rows: NonNullable<SearxngResponse['results']>, limit: number): SearchResult[] {
    const retrievedAt = new Date(this.now()).toISOString();
    const out: SearchResult[] = [];

    for (const [index, row] of rows.entries()) {
      if (out.length >= limit) break;
      const url = typeof row.url === 'string' ? row.url : '';
      if (!url) continue;

      /*
       * `publishedDate` is often absent, and occasionally present and wrong.
       * An unparseable value becomes ABSENT rather than a guess — a fabricated
       * date silently changes how a freshness-sensitive answer ranks, which is
       * the failure this whole pipeline is built to avoid.
       */
      let publishedAt: string | undefined;
      if (typeof row.publishedDate === 'string' && row.publishedDate) {
        const parsed = Date.parse(row.publishedDate);
        if (!Number.isNaN(parsed)) publishedAt = new Date(parsed).toISOString();
      }

      out.push({
        title: typeof row.title === 'string' ? row.title : '',
        url,
        canonicalUrl: canonicalizeUrl(url),
        snippet: typeof row.content === 'string' ? row.content : '',
        domain: domainOf(url),
        ...(publishedAt ? { publishedAt } : {}),
        /*
         * The ROW'S POSITION, not SearXNG's `score`. The score is a blend of
         * upstream engine weights whose scale is not stable across queries or
         * versions, so ordering it produces is meaningful and its magnitude is
         * not. Migra ranking wants a position.
         */
        providerRank: index,
        provider: this.id,
        retrievedAt,
      });
    }
    return out;
  }
}

/**
 * The engines we query, and why this list is short.
 *
 * Enabling everything SearXNG supports is tempting and wrong: the long tail
 * rate-limits, breaks quietly, and returns the same syndicated pages the
 * shorter list already found — so result COUNT rises while result QUALITY
 * falls and latency rises with it. Each entry here earns its place.
 *
 * Recorded as configuration rather than buried in a container file so the set
 * is reviewable, and so a change to it is a change someone can see.
 */
export const DEFAULT_ENGINES: readonly string[] = Object.freeze([
  'duckduckgo',
  'bing',
  'brave',
  'wikipedia',
  'stackexchange',
]);
