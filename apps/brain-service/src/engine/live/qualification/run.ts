/**
 * MigraAI Engine — running the Live Source qualification battery.
 *
 * Produces a SCORECARD, not a winner.
 *
 * ══ WHY NOT A SINGLE RANKING ══
 *
 * These services are good at different jobs. One returns extracted text ready to
 * quote, another finds documents that share no keywords with the query, another
 * is simply the one that still works when the others rate-limit. Collapsing that
 * into one number would throw away precisely the information the router needs to
 * send semantic discovery somewhere different from a price lookup.
 *
 * So the report ranks PER CATEGORY, and says plainly where a provider was never
 * tested rather than scoring it anyway.
 */

import type { LiveSourceProvider } from '../liveSourceProvider.js'
import { LiveSourceUnavailable } from '../liveSourceProvider.js'
import { BATTERY, CATEGORIES, type BatteryCase } from './battery.js'
import { scoreCase, type CaseScore, type Verdict } from './score.js'

/**
 * Why a provider does or does not have a score.
 *
 * `unevaluated_*` exists so a provider that was never tested cannot be silently
 * ranked. An absent score and a bad score mean different things, and a report
 * that conflated them would recommend whichever vendor happened to have a key
 * lying around.
 */
export type ProviderStatus =
  | 'qualified'
  | 'failed'
  | 'unevaluated_no_credentials'
  | 'unevaluated_not_provisioned'
  | 'commercial_use_unclear'

export interface CommercialReview {
  /**
   * Read from the vendor's own terms. `cleared` is a decision a person makes;
   * this module never infers it from silence.
   */
  status: 'cleared' | 'unclear' | 'forbidden' | 'not_reviewed'
  costModel?: string
  attributionRequired?: boolean
  cachingAllowed?: boolean
  redistributionAllowed?: boolean
  notes?: string
  reviewedOn?: string
}

export interface ProviderScorecard {
  providerId: string
  status: ProviderStatus
  /** Absent whenever the battery did not actually run. */
  cases?: CaseScore[]
  commercial: CommercialReview
  /** Per-category pass rate, which is the part the router can act on. */
  byCategory?: Record<string, { pass: number; total: number; needsReview: number }>
  medianLatencyMs?: number
  /** Why it was not evaluated, in words, for the report. */
  note?: string
}

export interface BatteryOptions {
  /** Cases only; the failure case gets its own tiny deadline. */
  timeoutMs?: number
  /** Restrict the run, e.g. while iterating on one category. */
  only?: readonly string[]
  now?: () => number
}

const FAILURE_CASE_DEADLINE_MS = 1

async function runOne(
  provider: LiveSourceProvider,
  testCase: BatteryCase,
  options: BatteryOptions,
): Promise<CaseScore> {
  const clock = options.now ?? (() => Date.now())
  const started = clock()
  const isFailureProbe = testCase.category === 'failure_behaviour'
  const budget = isFailureProbe ? FAILURE_CASE_DEADLINE_MS : (options.timeoutMs ?? 15_000)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), budget)
  try {
    const result = await provider.search({
      query: testCase.query,
      ...(testCase.freshness ? { freshness: testCase.freshness } : {}),
      maxResults: 10,
      signal: controller.signal,
    })
    return scoreCase(testCase, result, null, clock() - started)
  } catch (error) {
    const failure =
      error instanceof LiveSourceUnavailable
        ? { code: error.code, message: error.message }
        : { code: 'unknown', message: error instanceof Error ? error.message : String(error) }
    return scoreCase(testCase, null, failure, clock() - started)
  } finally {
    clearTimeout(timer)
  }
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
}

const countsFor = (cases: CaseScore[]): ProviderScorecard['byCategory'] => {
  const byCategory: Record<string, { pass: number; total: number; needsReview: number }> = {}
  for (const category of CATEGORIES) byCategory[category] = { pass: 0, total: 0, needsReview: 0 }

  for (const scored of cases) {
    const bucket = byCategory[scored.category]!
    // A case counts once; its verdict is the WORST of its decidable dimensions,
    // because a retrieval that found the right domain and lost every date is not
    // a pass with an asterisk — it failed the job the case was probing.
    const decidable = scored.dimensions.filter((d) => d.verdict !== 'needs_review' && d.verdict !== 'not_applicable')
    const worst: Verdict = decidable.some((d) => d.verdict === 'fail')
      ? 'fail'
      : decidable.some((d) => d.verdict === 'partial')
        ? 'partial'
        : decidable.length > 0
          ? 'pass'
          : 'needs_review'
    bucket.total += 1
    if (worst === 'pass') bucket.pass += 1
    if (scored.dimensions.some((d) => d.verdict === 'needs_review')) bucket.needsReview += 1
  }
  return byCategory
}

/**
 * Run the battery against one provider.
 *
 * A provider is only ever given a score when it actually ran. Missing
 * credentials, missing deployment and unreviewed licensing each produce a
 * distinct status and NO score — because "we could not test this" and "this
 * tested badly" must never look the same in a report someone chooses from.
 */
export async function qualifyProvider(
  provider: LiveSourceProvider | null,
  commercial: CommercialReview,
  options: BatteryOptions & { availability?: 'ready' | 'no_credentials' | 'not_provisioned' } = {},
): Promise<ProviderScorecard> {
  const providerId = provider?.descriptor.id ?? 'unknown'

  if (commercial.status === 'unclear' || commercial.status === 'not_reviewed') {
    return {
      providerId,
      status: 'commercial_use_unclear',
      commercial,
      note:
        'Not run. Commercial terms are unreviewed or ambiguous, and ambiguous language is treated ' +
        'as needing approval rather than as clearance.',
    }
  }
  if (commercial.status === 'forbidden') {
    return { providerId, status: 'failed', commercial, note: 'Commercial use is forbidden by the vendor terms.' }
  }
  if (options.availability === 'no_credentials' || !provider) {
    return { providerId, status: 'unevaluated_no_credentials', commercial, note: 'No API credentials available to test with.' }
  }
  if (options.availability === 'not_provisioned') {
    return { providerId, status: 'unevaluated_not_provisioned', commercial, note: 'Self-hosted provider is not deployed yet.' }
  }

  const chosen = options.only?.length
    ? BATTERY.filter((c) => options.only!.includes(c.id) || options.only!.includes(c.category))
    : BATTERY

  const cases: CaseScore[] = []
  for (const testCase of chosen) {
    cases.push(await runOne(provider, testCase, options))
  }

  const byCategory = countsFor(cases)
  const decidableTotal = Object.values(byCategory!).reduce((n, b) => n + b.total, 0)
  const passed = Object.values(byCategory!).reduce((n, b) => n + b.pass, 0)

  return {
    providerId,
    // A bar, not a vibe: two thirds of the battery's jobs done correctly.
    status: decidableTotal > 0 && passed / decidableTotal >= 0.66 ? 'qualified' : 'failed',
    cases,
    commercial,
    byCategory,
    medianLatencyMs: median(
      cases.filter((c) => c.category !== 'failure_behaviour').map((c) => c.latencyMs),
    ),
  }
}

/**
 * The per-category leaderboard.
 *
 * The output the router is meant to consume: who is best AT WHAT, with
 * untested providers absent rather than ranked last.
 */
export function bestByCategory(
  scorecards: readonly ProviderScorecard[],
): Record<string, { providerId: string; pass: number; total: number }[]> {
  const table: Record<string, { providerId: string; pass: number; total: number }[]> = {}
  for (const category of CATEGORIES) {
    const ranked = scorecards
      .filter((s) => s.byCategory?.[category] && s.byCategory[category]!.total > 0)
      .map((s) => ({
        providerId: s.providerId,
        pass: s.byCategory![category]!.pass,
        total: s.byCategory![category]!.total,
      }))
      .sort((a, b) => b.pass / b.total - a.pass / a.total || a.providerId.localeCompare(b.providerId))
    if (ranked.length > 0) table[category] = ranked
  }
  return table
}
