/**
 * MIGRA SEARCH — the authority. The only thing above it is Chat; the only
 * thing below it is a provider.
 *
 * ---------------------------------------------------------------------------
 * THE BOUNDARY, RESTATED BECAUSE IT IS THE POINT
 *
 *   MigraPilot / Brain → Migra Search authority → SearchProvider → SearXNG
 *
 * and never MigraPilot → SearXNG. Nothing above this file may learn which
 * backend is underneath, whether it is healthy, or that it exists. The consumer
 * knows a row exists and whether it can be used; the reason it cannot is a
 * sentence this layer writes.
 *
 * ---------------------------------------------------------------------------
 * 🚨 NO PROVIDER IS A TRUTH STATE, NOT AN ERROR
 *
 * Today there is no provider. `migra-search-core` does not exist, so the
 * authority holds `null` and reports itself NOT CONFIGURED — registered,
 * visible, and honestly unusable. That is deliberate:
 *
 *   · "not configured" and "configured but down" are different facts, and a
 *     user can act on one of them
 *   · a capability that vanishes when its backend is missing teaches people it
 *     was never built
 *   · when a provider is dropped in, nothing above changes
 *
 * ---------------------------------------------------------------------------
 * WHY HEALTH IS CACHED
 *
 * `readiness()` is called to draw a menu. It must be synchronous and free, so
 * it reads a cached snapshot that `refreshHealth()` maintains. A probe that
 * reached the network from a render would put an outbound request behind every
 * keystroke that opened the composer.
 *
 * The staleness that buys is bounded and acceptable: a provider that died two
 * minutes ago shows as available and the search then fails truthfully with
 * `provider_unavailable`. Showing a stale "unavailable" would be worse — it
 * hides a capability that works.
 */

import type { ProviderHealth, SearchOutcome, SearchProvider, SearchRequest } from './types.js';

/** How long a health snapshot is trusted for readiness purposes. */
const HEALTH_TTL_MS = 60_000;

export interface SearchAuthorityDeps {
  /** Absent until a backend exists. Absence is a state, not a failure. */
  provider?: SearchProvider | null;
  now?: () => number;
}

/** User-facing reasons. Engine-owned, and free of infrastructure vocabulary. */
export const SEARCH_NOT_CONFIGURED = 'Web search is not set up yet.';
export const SEARCH_UNAVAILABLE = 'Web search is unavailable right now.';

export class MigraSearch {
  private readonly provider: SearchProvider | null;
  private readonly now: () => number;
  private snapshot: { health: ProviderHealth; at: number } | null = null;

  constructor(deps: SearchAuthorityDeps = {}) {
    this.provider = deps.provider ?? null;
    this.now = deps.now ?? (() => Date.now());
  }

  /** Whether a provider exists at all. Distinct from whether it is healthy. */
  get configured(): boolean {
    return this.provider !== null;
  }

  /**
   * Synchronous readiness for the capability registry.
   *
   * Three states, and they must not collapse:
   *   no provider          → not configured; someone must set it up
   *   provider unhealthy   → unavailable; it exists and is not answering
   *   provider healthy     → ready
   *
   * An unrefreshed or expired snapshot reports READY when a provider exists.
   * Optimism is correct here: the search itself will fail truthfully, whereas
   * a pessimistic default hides a working capability behind a stale reading.
   */
  readiness(): { ready: boolean; reason?: string } {
    if (!this.provider) return { ready: false, reason: SEARCH_NOT_CONFIGURED };
    if (!this.snapshot) return { ready: true };
    if (this.now() - this.snapshot.at > HEALTH_TTL_MS) return { ready: true };
    return this.snapshot.health.ready
      ? { ready: true }
      : { ready: false, reason: this.snapshot.health.reason ?? SEARCH_UNAVAILABLE };
  }

  /** Refresh the cached health snapshot. Called on a schedule, never from a render. */
  async refreshHealth(): Promise<ProviderHealth> {
    if (!this.provider) {
      const health: ProviderHealth = {
        ready: false,
        reason: SEARCH_NOT_CONFIGURED,
        checkedAt: new Date(this.now()).toISOString(),
      };
      this.snapshot = { health, at: this.now() };
      return health;
    }
    try {
      const health = await this.provider.health();
      this.snapshot = { health, at: this.now() };
      return health;
    } catch {
      /*
       * A health probe that THREW is a provider that is not answering. It is
       * reported as unavailable with the engine's own words — never with the
       * exception's message, which would carry a host or a stack into a UI.
       */
      const health: ProviderHealth = {
        ready: false,
        reason: SEARCH_UNAVAILABLE,
        checkedAt: new Date(this.now()).toISOString(),
      };
      this.snapshot = { health, at: this.now() };
      return health;
    }
  }

  /**
   * Run a search, or fail in a way the answer can be honest about.
   *
   * Every failure path returns a DISTINCT kind. This is the layer where "the
   * provider was down" would otherwise become "I couldn't find anything", and
   * the two are opposite claims about the world.
   */
  async search(request: SearchRequest): Promise<SearchOutcome> {
    const started = this.now();
    const tookMs = () => this.now() - started;

    if (!this.provider) {
      return {
        ok: false,
        failure: { kind: 'not_configured', detail: SEARCH_NOT_CONFIGURED },
        provider: 'none',
        tookMs: tookMs(),
      };
    }

    try {
      return await this.provider.search(request);
    } catch (error) {
      // A provider that threw is unavailable. The detail stays internal — the
      // caller renders `SEARCH_UNAVAILABLE`, not an exception message.
      return {
        ok: false,
        failure: {
          kind: 'provider_unavailable',
          detail: error instanceof Error ? error.message : 'provider threw',
        },
        provider: this.provider.id,
        tookMs: tookMs(),
      };
    }
  }
}

/**
 * The process-wide authority.
 *
 * A single instance so the health snapshot is shared: one refresh, one truth,
 * rather than every caller keeping its own opinion about whether search works.
 * It is constructed with no provider, which is the accurate state today.
 */
export const migraSearch = new MigraSearch();
