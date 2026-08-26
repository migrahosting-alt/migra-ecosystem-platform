/**
 * MigraAI Engine — Live Source Router.
 *
 * Chooses which retrieval provider serves a turn, and what happens when it
 * cannot. Deterministic and explainable, like the model router beside it: hard
 * capability filters first, then a transparent score, then a documented order to
 * fall back through.
 *
 * FALLBACK IS THE POINT, not a nicety. Search services rate-limit, degrade and
 * go down, and a product whose "current information" feature dies with one
 * vendor is not offering current information — it is offering a dependency.
 */

import type {
  LiveSourceDescriptor,
  LiveSourceProvider,
  LiveSourceQuery,
  LiveSourceResult,
} from './liveSourceProvider.js'
import { LiveSourceUnavailable } from './liveSourceProvider.js'

export interface LiveRouteSpec {
  /**
   * The answer will QUOTE from the sources, so links alone are not enough.
   * A hard filter: synthesising from snippets while citing pages is how a
   * confident, unsupported sentence gets a footnote.
   */
  needsQuotableContent?: boolean
  /** Freshness must be verifiable, not assumed — the provider must date results. */
  needsPublishDates?: boolean
  /** Restrict at the source rather than filtering afterwards. */
  needsFreshnessFilter?: boolean
  /** `production` serves approved providers only; `evaluation` also allows
   *  unqualified ones, for running the qualification suite through the engine. */
  mode?: 'production' | 'evaluation'
}

export interface LiveRouteDecision {
  provider: LiveSourceProvider
  reason: string
  /** Everything else that qualified, in the order it would be tried. */
  fallbacks: LiveSourceProvider[]
  /** Providers excluded, and why — the half of a routing record that explains
   *  an empty result set. */
  excluded: { id: string; reason: string }[]
}

export class NoLiveSourceProvider extends Error {
  constructor(readonly excluded: { id: string; reason: string }[]) {
    super('No retrieval provider satisfies this turn.')
    this.name = 'NoLiveSourceProvider'
  }
}

const eligible = (
  descriptor: LiveSourceDescriptor,
  spec: LiveRouteSpec,
): string | null => {
  // Commercial licensing is a hard gate in BOTH modes. An evaluation is not a
  // licence, and a provider we may not ship must not be one query away from
  // serving a user by a mode flag being wrong.
  if (!descriptor.capabilities.commercialUseCleared) return 'commercial use not cleared'
  if (descriptor.qualification === 'rejected') return 'rejected by qualification'
  if (descriptor.qualification !== 'approved' && (spec.mode ?? 'production') === 'production') {
    return 'not approved for production'
  }
  if (spec.needsQuotableContent && !descriptor.capabilities.returnsExtractedContent) {
    return 'returns no quotable content'
  }
  if (spec.needsPublishDates && !descriptor.capabilities.returnsPublishDates) {
    return 'reports no publication dates'
  }
  if (spec.needsFreshnessFilter && !descriptor.capabilities.supportsFreshnessFilter) {
    return 'cannot filter by recency at the source'
  }
  return null
}

/**
 * Rank the survivors.
 *
 * Capability first, then cost. Cost is a tie-break rather than a driver: the
 * cheapest provider that cannot do the job is not cheap, it is a wasted round
 * trip followed by a worse answer.
 */
const score = (descriptor: LiveSourceDescriptor): number => {
  let points = 0
  if (descriptor.capabilities.returnsExtractedContent) points += 4
  if (descriptor.capabilities.returnsPublishDates) points += 2
  if (descriptor.capabilities.supportsFreshnessFilter) points += 2
  // A self-hosted provider at zero marginal cost is worth a nudge, not a veto.
  if (descriptor.costPerQueryCents === 0) points += 1
  return points
}

export function routeLiveSource(
  providers: readonly LiveSourceProvider[],
  spec: LiveRouteSpec = {},
): LiveRouteDecision {
  const excluded: { id: string; reason: string }[] = []
  const survivors: LiveSourceProvider[] = []

  for (const provider of providers) {
    const why = eligible(provider.descriptor, spec)
    if (why) excluded.push({ id: provider.descriptor.id, reason: why })
    else survivors.push(provider)
  }

  if (survivors.length === 0) throw new NoLiveSourceProvider(excluded)

  const ranked = [...survivors].sort((a, b) => {
    const byScore = score(b.descriptor) - score(a.descriptor)
    if (byScore !== 0) return byScore
    const byCost = a.descriptor.costPerQueryCents - b.descriptor.costPerQueryCents
    if (byCost !== 0) return byCost
    // Stable and explainable rather than incidental.
    return a.descriptor.id.localeCompare(b.descriptor.id)
  })

  const [chosen, ...rest] = ranked
  return {
    provider: chosen!,
    reason: `${chosen!.descriptor.id} scored ${score(chosen!.descriptor)} of the eligible providers`,
    fallbacks: rest,
    excluded,
  }
}

export interface LiveSearchOutcome extends LiveSourceResult {
  /** Providers that were tried and failed before this one answered. */
  attempted: { id: string; code: string }[]
}

/**
 * Search, falling through the ranked providers until one answers.
 *
 * A provider that throws is TRIED PAST; a provider that returns zero results is
 * NOT — an empty result set is an answer ("nothing was found"), and treating it
 * as a failure would send the same query to every vendor in turn and present
 * whichever one hallucinated something.
 */
export async function searchWithFallback(
  providers: readonly LiveSourceProvider[],
  query: LiveSourceQuery,
  spec: LiveRouteSpec = {},
): Promise<LiveSearchOutcome> {
  const decision = routeLiveSource(providers, spec)
  const order = [decision.provider, ...decision.fallbacks]
  const attempted: { id: string; code: string }[] = []

  let lastError: unknown = null
  for (const provider of order) {
    try {
      const result = await provider.search(query)
      return { ...result, attempted }
    } catch (error) {
      const code =
        error instanceof LiveSourceUnavailable ? error.code : 'unknown'
      attempted.push({ id: provider.descriptor.id, code })
      lastError = error
    }
  }

  throw lastError ?? new NoLiveSourceProvider(decision.excluded)
}
