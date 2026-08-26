/**
 * MigraAI Engine — scoring one provider's answer to one battery case.
 *
 * ══ WHAT THIS CAN AND CANNOT DECIDE ══
 *
 * Mechanically checkable, and checked here: did an authoritative domain appear,
 * were results dated, did an empty question stay empty, was an ambiguous query
 * left ambiguous, how long did it take, how did it fail, is there quotable text.
 *
 * NOT checkable here, and deliberately not faked: whether a claim is actually
 * TRUE, and whether a cited page genuinely supports the sentence built from it.
 * Those need a reader. Pretending a keyword overlap settles them would be the
 * same defect this codebase has already been bitten by — a keyword proxy
 * standing in for a semantic judgment — so those dimensions are reported as
 * `needsReview` with the raw evidence attached, rather than scored.
 *
 * A number nobody can defend is worse than an honest gap.
 */

import type { LiveSource, LiveSourceResult } from '../liveSourceProvider.js'
import type { BatteryCase } from './battery.js'

export type Verdict = 'pass' | 'fail' | 'partial' | 'needs_review' | 'not_applicable'

export interface DimensionScore {
  dimension: string
  verdict: Verdict
  detail: string
}

export interface CaseScore {
  caseId: string
  category: string
  dimensions: DimensionScore[]
  latencyMs: number
  /** Everything the provider returned, kept so a human can audit any verdict. */
  evidence: {
    sources: LiveSource[]
    degraded?: string
    failure?: { code: string; message: string }
  }
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** Suffix match, so `nhs.uk` accepts `www.nhs.uk` but not `notnhs.uk`. */
const matchesDomain = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`)

const TOP_N = 5

export function scoreCase(
  testCase: BatteryCase,
  result: LiveSourceResult | null,
  failure: { code: string; message: string } | null,
  latencyMs: number,
): CaseScore {
  const sources = result?.sources ?? []
  const dimensions: DimensionScore[] = []
  const top = sources.slice(0, TOP_N)
  const hosts = top.map((s) => hostOf(s.url)).filter(Boolean)

  // ── failure behaviour ────────────────────────────────────────────────────
  if (testCase.category === 'failure_behaviour') {
    dimensions.push(
      failure
        ? {
            dimension: 'failure_behaviour',
            verdict: failure.code === 'unknown' ? 'partial' : 'pass',
            detail:
              failure.code === 'unknown'
                ? `failed, but untyped (${failure.message}) — the router cannot reason about it`
                : `failed promptly and typed as ${failure.code}`,
          }
        : {
            dimension: 'failure_behaviour',
            verdict: sources.length === 0 ? 'fail' : 'partial',
            detail:
              sources.length === 0
                ? 'returned an EMPTY result instead of an error — indistinguishable from "nothing found"'
                : 'answered despite an impossible deadline; the deadline was not honoured',
          },
    )
    return { caseId: testCase.id, category: testCase.category, dimensions, latencyMs, evidence: { sources, ...(result?.degraded ? { degraded: result.degraded } : {}), ...(failure ? { failure } : {}) } }
  }

  if (failure) {
    dimensions.push({
      dimension: 'availability',
      verdict: 'fail',
      detail: `provider failed: ${failure.code} — ${failure.message}`,
    })
    return { caseId: testCase.id, category: testCase.category, dimensions, latencyMs, evidence: { sources, ...(failure ? { failure } : {}) } }
  }

  // ── correctly empty ──────────────────────────────────────────────────────
  if (testCase.expectsEmpty) {
    dimensions.push({
      dimension: 'restraint',
      verdict: sources.length === 0 ? 'pass' : 'fail',
      detail:
        sources.length === 0
          ? 'returned nothing, which is the correct answer'
          : `manufactured ${sources.length} result(s) for a question with no public answer`,
    })
    return { caseId: testCase.id, category: testCase.category, dimensions, latencyMs, evidence: { sources } }
  }

  // ── found anything at all ────────────────────────────────────────────────
  dimensions.push({
    dimension: 'found_results',
    verdict: sources.length > 0 ? 'pass' : 'fail',
    detail: `${sources.length} source(s) returned`,
  })

  // ── authoritative source preferred ───────────────────────────────────────
  if (testCase.expectedDomains?.length) {
    const hit = testCase.expectedDomains.find((d) => hosts.some((h) => matchesDomain(h, d)))
    const hitRank = hit
      ? top.findIndex((s) => testCase.expectedDomains!.some((d) => matchesDomain(hostOf(s.url), d)))
      : -1
    dimensions.push({
      dimension: 'authoritative_source',
      // Present at all is a pass; present FIRST is what a good provider does,
      // so rank is reported rather than folded away.
      verdict: hit ? 'pass' : 'fail',
      detail: hit
        ? `${hit} found at rank ${hitRank + 1} of the top ${TOP_N}`
        : `none of ${testCase.expectedDomains.join(', ')} in the top ${TOP_N}`,
    })
  }

  if (testCase.discouragedDomains?.length) {
    const bad = testCase.discouragedDomains.filter((d) => hosts.some((h) => matchesDomain(h, d)))
    dimensions.push({
      dimension: 'avoids_low_quality',
      verdict: bad.length === 0 ? 'pass' : 'fail',
      detail: bad.length === 0 ? 'no discouraged domains in the top results' : `outranked by ${bad.join(', ')}`,
    })
  }

  // ── dates ────────────────────────────────────────────────────────────────
  if (testCase.requiresDates) {
    const dated = top.filter((s) => Boolean(s.publishedAt))
    const parseable = dated.filter((s) => !Number.isNaN(Date.parse(s.publishedAt!)))
    dimensions.push({
      dimension: 'dates_preserved',
      verdict: dated.length === 0 ? 'fail' : dated.length < top.length ? 'partial' : 'pass',
      detail: `${dated.length}/${top.length} dated, ${parseable.length} parseable`,
    })
  }

  // ── corroboration ────────────────────────────────────────────────────────
  if (testCase.minCorroboratingDomains) {
    const distinct = new Set(hosts).size
    dimensions.push({
      dimension: 'independent_sources',
      verdict: distinct >= testCase.minCorroboratingDomains ? 'pass' : 'fail',
      detail: `${distinct} distinct domain(s), needed ${testCase.minCorroboratingDomains}`,
    })
  }

  // ── ambiguity preserved ──────────────────────────────────────────────────
  if (testCase.ambiguousBetween?.length) {
    const text = top.map((s) => `${s.title} ${s.snippet ?? ''}`.toLowerCase()).join(' ')
    const senses = testCase.ambiguousBetween.filter((t) => text.includes(t.toLowerCase()))
    dimensions.push({
      dimension: 'ambiguity_preserved',
      verdict: senses.length >= 2 ? 'pass' : 'fail',
      detail:
        senses.length >= 2
          ? `${senses.length} distinct senses represented (${senses.join(', ')})`
          : `collapsed to ${senses.length} sense — chose an interpretation for the user`,
    })
  }

  // ── quotable content ─────────────────────────────────────────────────────
  if (testCase.requiresExtractedContent) {
    const withText = top.filter((s) => (s.content ?? '').trim().length > 200)
    dimensions.push({
      dimension: 'quotable_content',
      verdict: withText.length === 0 ? 'fail' : withText.length < 2 ? 'partial' : 'pass',
      detail: `${withText.length}/${top.length} sources carried extractable text`,
    })
  }

  /*
   * ── the two dimensions a machine must not pretend to judge ──────────────
   *
   * Whether the retrieved material actually SUPPORTS an answer, and whether a
   * provider that writes prose stayed inside its evidence, are semantic
   * judgments. Scoring them by keyword overlap would repeat a mistake this
   * codebase has already paid for. They are raised for a reader, with the
   * evidence attached.
   */
  dimensions.push({
    dimension: 'answer_supported',
    verdict: 'needs_review',
    detail: 'requires a reader: does the retrieved material actually answer the question?',
  })
  if (result?.degraded) {
    dimensions.push({
      dimension: 'degradation_reported',
      verdict: 'pass',
      detail: `provider declared degradation rather than hiding it: ${result.degraded}`,
    })
  }

  return {
    caseId: testCase.id,
    category: testCase.category,
    dimensions,
    latencyMs,
    evidence: { sources, ...(result?.degraded ? { degraded: result.degraded } : {}) },
  }
}
