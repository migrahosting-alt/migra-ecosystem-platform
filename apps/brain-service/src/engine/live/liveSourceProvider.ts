/**
 * MigraAI Engine — Live Source Intelligence, the provider contract.
 *
 * WHY A CONTRACT BEFORE A VENDOR. Web retrieval is a market of services that
 * differ in kind, not just quality: some return links and leave you to fetch the
 * page, some return extracted text, some return a written answer with citations
 * already attached. Building the capability around whichever was picked first
 * would bake that shape into the product, and swapping later would mean
 * rewriting the answer path rather than changing a setting.
 *
 * So nothing above this file knows which service ran. A provider declares what
 * it can do; the router picks one that satisfies the turn; the answer path reads
 * the same `LiveSource[]` regardless. That is what makes "route between
 * providers by task, and fall back" a configuration decision instead of a
 * rebuild.
 *
 * THE SAME SHAPE AS THE MODEL REGISTRY beside it, deliberately: declared
 * capabilities, hard filters, a transparent choice, and qualification gating —
 * one pattern to learn rather than two.
 */

/** How current the caller needs the material to be. */
export type FreshnessWindow = 'day' | 'week' | 'month' | 'year' | 'any'

export interface LiveSourceQuery {
  query: string
  /** Hard requirement when set: older material is not useful for this turn. */
  freshness?: FreshnessWindow
  maxResults?: number
  /** The turn's correlation id, so a retrieval can be traced with the answer. */
  requestId?: string
  signal?: AbortSignal
}

/**
 * One retrieved source.
 *
 * `url` and `title` are the citation. `content` is what the answer may actually
 * quote from — absent when the provider only returned a link, which is precisely
 * the difference the router has to know about.
 */
export interface LiveSource {
  url: string
  title: string
  /** The provider's own summary line. Never a substitute for `content`. */
  snippet?: string
  /** Extracted page text, when the provider supplies it. */
  content?: string
  /** ISO date, when the provider knows it. Absent is honest; guessing is not. */
  publishedAt?: string
  /** Which provider returned it, so a citation can be audited to its origin. */
  provider: string
  /** Position in that provider's own ranking, preserved rather than re-sorted. */
  rank: number
}

export interface LiveSourceResult {
  sources: LiveSource[]
  provider: string
  latencyMs: number
  /**
   * The provider answered, but not fully — rate limited, partial, or degraded.
   * Distinct from a failure: the sources present are still usable, and the turn
   * should say it looked rather than pretend it did not.
   */
  degraded?: string
}

/**
 * What a provider can actually do.
 *
 * Declared, not inferred. A router that guessed would eventually send a turn
 * needing quotable text to a service that returns nothing but links, and the
 * answer would be synthesised from snippets while claiming to cite pages.
 */
export interface LiveSourceCapabilities {
  /** Returns extracted page text, not only links and snippets. */
  returnsExtractedContent: boolean
  /** Reports publication dates, so freshness can be verified rather than hoped. */
  returnsPublishDates: boolean
  /** Can restrict results to a time window at the source. */
  supportsFreshnessFilter: boolean
  /**
   * Licensed for commercial use in a product like this.
   *
   * A hard gate, not a preference: serving users from a source whose terms
   * forbid it is a legal exposure, and it is not the kind of thing to discover
   * after launch.
   */
  commercialUseCleared: boolean
}

export interface LiveSourceDescriptor {
  id: string
  /** Shown in operational records, never to the user. */
  label: string
  capabilities: LiveSourceCapabilities
  /**
   * Qualification state, mirroring the model registry: only `approved`
   * providers serve production traffic, `rejected` never serves, and
   * `unqualified` serves only in evaluation mode.
   */
  qualification: 'approved' | 'unqualified' | 'rejected'
  /** Rough cost per query in cents, for routing and for the record. 0 = self-hosted. */
  costPerQueryCents: number
}

export interface LiveSourceProvider {
  readonly descriptor: LiveSourceDescriptor
  search(query: LiveSourceQuery): Promise<LiveSourceResult>
}

/** A provider that failed in a way worth distinguishing from "no results". */
export class LiveSourceUnavailable extends Error {
  constructor(
    readonly providerId: string,
    readonly code: 'timeout' | 'rate_limited' | 'auth' | 'transport' | 'unknown',
    message: string,
  ) {
    super(message)
    this.name = 'LiveSourceUnavailable'
  }
}
