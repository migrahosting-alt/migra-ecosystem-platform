/**
 * MigraAI Engine — the Live Source qualification battery.
 *
 * A FIXED set of retrieval jobs, run identically against every candidate
 * provider, so a choice between vendors rests on evidence rather than on
 * whichever was tried first or marketed best.
 *
 * ══ THE CENTRAL DESIGN DECISION ══
 *
 * Expectations describe RETRIEVAL BEHAVIOUR, never specific answers.
 *
 * A battery that asserted "the answer is 4.2.1" would be wrong within weeks and
 * would then fail every provider for being CORRECT. Worse, it would quietly
 * become a test of how stale the battery is. So a case never says what the
 * answer is; it says what a good retrieval looks like — an official domain
 * appears, results carry dates, nothing is returned for a question with no
 * answer, an ambiguous query is not silently narrowed.
 *
 * Those properties stay true as the world moves, which is the only way a fixed
 * battery keeps meaning anything.
 *
 * ══ NO GLOBAL WINNER ══
 *
 * Every case declares a `category`. The report scores per category on purpose:
 * these services are good at different jobs, and collapsing them into one
 * ranking would throw away exactly the information the router needs to send
 * semantic discovery somewhere different from a price lookup.
 */

export type BatteryCategory =
  | 'breaking_event'
  | 'changed_product_fact'
  | 'price_or_availability'
  | 'official_source'
  | 'primary_technical_docs'
  | 'semantic_discovery'
  | 'long_tail_fact'
  | 'multi_source_corroboration'
  | 'correctly_empty'
  | 'ambiguous_query'
  | 'stale_source_trap'
  | 'contradictory_sources'
  | 'date_sensitive'
  | 'extraction_after_discovery'
  | 'failure_behaviour'

export interface BatteryCase {
  id: string
  category: BatteryCategory
  query: string
  /** What this case is actually probing. Read by a human reviewing the report. */
  probes: string
  /**
   * Domains a competent retrieval SHOULD surface. Matched as suffixes, so
   * `nhs.uk` accepts `www.nhs.uk`. Absent when the case is not about authority.
   */
  expectedDomains?: readonly string[]
  /**
   * Domains whose presence near the top is a FAILURE — content farms, scrapers,
   * and mirrors that outrank the primary source they copied.
   */
  discouragedDomains?: readonly string[]
  /** The honest answer is "nothing relevant". Returning confident results fails. */
  expectsEmpty?: boolean
  /** The case turns on knowing WHEN a source was published. */
  requiresDates?: boolean
  /** Distinct domains needed before a claim should be considered corroborated. */
  minCorroboratingDomains?: number
  /**
   * Terms the query is ambiguous BETWEEN. A provider that returns only one
   * interpretation has silently chosen for the user.
   */
  ambiguousBetween?: readonly string[]
  /** The answer must be quotable from page text, not inferred from a snippet. */
  requiresExtractedContent?: boolean
  /** Recency the case genuinely needs. */
  freshness?: 'day' | 'week' | 'month' | 'year' | 'any'
}

/**
 * The battery.
 *
 * Deliberately small and deliberately varied: fifteen jobs that differ in KIND
 * beat fifty that differ in wording, because the thing being measured is which
 * provider suits which job.
 */
export const BATTERY: readonly BatteryCase[] = [
  {
    id: 'breaking-current-event',
    category: 'breaking_event',
    query: 'what major technology news happened this week',
    probes: 'Can it reach material published in the last few days at all?',
    requiresDates: true,
    freshness: 'week',
  },
  {
    id: 'changed-product-fact',
    category: 'changed_product_fact',
    query: 'current long term support release of node.js',
    probes: 'A fact that moves on a schedule, where a stale answer looks identical to a fresh one.',
    expectedDomains: ['nodejs.org', 'github.com'],
    requiresDates: true,
    freshness: 'month',
  },
  {
    id: 'price-availability',
    category: 'price_or_availability',
    query: 'hetzner cloud object storage pricing per terabyte',
    probes: 'A number that only the vendor is authoritative about.',
    expectedDomains: ['hetzner.com'],
    freshness: 'month',
  },
  {
    id: 'official-source',
    category: 'official_source',
    query: 'official uk government guidance on registering a limited company',
    probes: 'Does the primary official source outrank the advice farms that rewrite it?',
    expectedDomains: ['gov.uk'],
    discouragedDomains: ['pinterest.com', 'quora.com'],
  },
  {
    id: 'primary-technical-docs',
    category: 'primary_technical_docs',
    query: 'postgresql documentation for CREATE INDEX CONCURRENTLY',
    probes: 'Primary documentation versus tutorials and copies of it.',
    expectedDomains: ['postgresql.org'],
    discouragedDomains: ['w3schools.com', 'geeksforgeeks.org'],
    requiresExtractedContent: true,
  },
  {
    id: 'semantic-discovery',
    category: 'semantic_discovery',
    query: 'essays arguing that software estimates fail for reasons other than developer optimism',
    probes: 'Meaning, not keywords — the good answers may share almost no words with the query.',
  },
  {
    id: 'long-tail-fact',
    category: 'long_tail_fact',
    query: 'what does the ENOTDIR errno mean on linux and when is it returned',
    probes: 'An obscure fact that is documented somewhere precise and nowhere popular.',
    expectedDomains: ['man7.org', 'kernel.org', 'gnu.org'],
  },
  {
    id: 'multi-source-corroboration',
    category: 'multi_source_corroboration',
    query: 'is minio still open source under agpl',
    probes: 'A contested claim that needs more than one independent source.',
    minCorroboratingDomains: 3,
    requiresDates: true,
  },
  {
    id: 'correctly-empty',
    category: 'correctly_empty',
    query: 'migrapilot brain service internal qualification battery results for cloud-core vm103',
    probes:
      'THE HONEST ANSWER IS NOTHING. This is private internal detail with no public presence. ' +
      'A provider that returns confident results here is manufacturing relevance.',
    expectsEmpty: true,
  },
  {
    id: 'ambiguous-query',
    category: 'ambiguous_query',
    query: 'mercury',
    probes:
      'Planet, element, car marque, Roman god, record label. A provider that returns only one ' +
      'has chosen for the user without telling them.',
    ambiguousBetween: ['planet', 'element', 'god', 'car', 'record'],
  },
  {
    id: 'stale-source-trap',
    category: 'stale_source_trap',
    query: 'how to install node.js on ubuntu',
    probes:
      'A question whose top results are dominated by years-old tutorials that still rank. ' +
      'Dates and current official instructions are what separate a good provider here.',
    expectedDomains: ['nodejs.org', 'ubuntu.com'],
    requiresDates: true,
  },
  {
    id: 'contradictory-sources',
    category: 'contradictory_sources',
    query: 'is sqlite suitable for production web applications',
    probes: 'Sources genuinely disagree. Returning only one side is a failure of retrieval, not of the web.',
    minCorroboratingDomains: 3,
  },
  {
    id: 'date-sensitive',
    category: 'date_sensitive',
    query: 'latest openssl security advisory',
    probes: 'The publication date IS the answer here; an undated result is unusable.',
    requiresDates: true,
    expectedDomains: ['openssl.org'],
    freshness: 'month',
  },
  {
    id: 'extraction-after-discovery',
    category: 'extraction_after_discovery',
    query: 'systemd ProtectSystem strict directive documentation',
    probes:
      'Discovery is not enough: the answer must be quotable from the page. This separates ' +
      'providers that return links from providers that return text.',
    expectedDomains: ['freedesktop.org', 'systemd.io', 'man7.org'],
    requiresExtractedContent: true,
  },
  {
    id: 'failure-behaviour',
    category: 'failure_behaviour',
    query: '__provoke_provider_failure__',
    probes:
      'Run with an impossibly short deadline. What matters is HOW it fails: a typed, prompt ' +
      'error that the router can fall past, versus a hang or a silent empty result that looks ' +
      'like a genuine "nothing found".',
  },
]

export const CATEGORIES: readonly BatteryCategory[] = [
  ...new Set(BATTERY.map((c) => c.category)),
]
