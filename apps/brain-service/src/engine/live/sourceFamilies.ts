/**
 * MigraAI Engine — open source families for Live Source Intelligence.
 *
 * WHY THIS EXISTS. Paying a general web-search API to rediscover a page we could
 * have asked for directly is both more expensive and worse retrieval: the API
 * returns a ranked guess at where the answer lives, while the official endpoint
 * returns the answer with its provenance intact. For a large share of questions
 * the authoritative source is KNOWN in advance, and going straight to it is the
 * better engineering as well as the cheaper one.
 *
 * So the router's first question is not "which search vendor" but "is there a
 * direct source for this kind of question". General web search becomes the
 * fallback for what these cannot reach, rather than the front door.
 *
 * ══ THIS FILE IS AN ANALYSIS, NOT A MEASUREMENT ══
 *
 * `servesCategories` is a PROJECTION of what each family should be able to do,
 * written before any of them is implemented and before the battery has been run
 * against them. It is a plan for what to build and test — not evidence, and not
 * a scorecard. Nothing here may be reported as a result. The `verified` field on
 * each family records how much of its LEGAL position was actually read from the
 * source, which is a different question again.
 */

import type { BatteryCategory } from './qualification/battery.js'

/**
 * How confident we are that automated commercial use is permitted.
 *
 * Deliberately conservative, and separate from whether the family is useful:
 * a family can be technically ideal and legally unresolved, and shipping on the
 * second is how a product acquires a problem it cannot see.
 */
export type LegalConfidence =
  /** Terms read; automated commercial use is clearly permitted within stated limits. */
  | 'clear'
  /** Terms read; permitted but with an obligation that constrains how we may use it. */
  | 'clear_with_obligations'
  /** Terms not fully read, or silent on the point. Must be resolved before use. */
  | 'unverified'

export interface SourceFamily {
  id: string
  label: string
  /** What it actually returns — the thing that decides which jobs it can do. */
  returns: 'structured_records' | 'full_documents' | 'feed_items' | 'metadata_only'
  legal: LegalConfidence
  /** Verbatim obligations that shape the implementation, not a summary. */
  obligations: readonly string[]
  /** Documented request limits, as read from the source. */
  rateLimit?: string
  /** Recurring cost. These families exist because this is zero. */
  costPerQueryCents: 0
  /**
   * PROJECTED — which battery jobs this family should serve. Unmeasured.
   * @see the file header.
   */
  servesCategories: readonly BatteryCategory[]
  /** What it plainly cannot do, so the gap is explicit rather than discovered. */
  cannotServe: string
}

export const SOURCE_FAMILIES: readonly SourceFamily[] = [
  {
    id: 'wikimedia',
    label: 'Wikipedia / Wikimedia APIs',
    returns: 'full_documents',
    legal: 'clear_with_obligations',
    obligations: [
      'Text is CC BY-SA: attribution is required, and share-alike may attach to verbatim reuse.',
      'Safer to state facts WITH a citation than to reproduce article text into an answer.',
      'High-volume commercial reuse is steered toward the paid Wikimedia Enterprise service.',
    ],
    rateLimit: 'published separately; a descriptive User-Agent is expected',
    costPerQueryCents: 0,
    servesCategories: ['long_tail_fact', 'ambiguous_query', 'semantic_discovery'],
    cannotServe: 'Anything current. Encyclopaedic background, not news or prices.',
  },
  {
    id: 'arxiv',
    label: 'arXiv API',
    returns: 'metadata_only',
    legal: 'clear_with_obligations',
    obligations: [
      'Descriptive METADATA is CC0 — free to store, use and redistribute.',
      'Full text/PDFs may NOT be stored or served without the copyright holder’s permission.',
      'So: cite and link the paper; do not ingest the PDF.',
    ],
    rateLimit: 'no more than one request every three seconds, single connection',
    costPerQueryCents: 0,
    servesCategories: ['primary_technical_docs', 'long_tail_fact'],
    cannotServe: 'General web, products, prices, news. Preprints only, and metadata only.',
  },
  {
    id: 'pubmed',
    label: 'PubMed / NCBI E-utilities',
    returns: 'structured_records',
    legal: 'clear_with_obligations',
    obligations: [
      'NCBI’s disclaimer and copyright notice must be evident to users of the product.',
      'Abstract copyright stays with publishers; redistribution follows their terms, not NCBI’s.',
    ],
    rateLimit: '3 requests/second without an API key, 10/second with one',
    costPerQueryCents: 0,
    servesCategories: ['primary_technical_docs', 'long_tail_fact', 'multi_source_corroboration'],
    cannotServe: 'Anything outside biomedical literature.',
  },
  {
    id: 'official_docs',
    label: 'Official product documentation and changelogs',
    returns: 'full_documents',
    legal: 'unverified',
    obligations: [
      'Per-publisher: each site’s own terms and robots.txt govern, and they differ.',
      'Must be resolved per domain before automated fetching, not assumed from the class.',
    ],
    costPerQueryCents: 0,
    servesCategories: ['primary_technical_docs', 'changed_product_fact', 'extraction_after_discovery', 'stale_source_trap'],
    cannotServe: 'Nothing outside the documented product. Requires knowing the vendor first.',
  },
  {
    id: 'release_feeds',
    label: 'Release feeds and RSS/Atom',
    returns: 'feed_items',
    legal: 'unverified',
    obligations: [
      'A published feed implies intent for automated consumption, but that is an inference — ' +
        'per-publisher terms still govern and should be confirmed for any feed we depend on.',
    ],
    costPerQueryCents: 0,
    servesCategories: ['breaking_event', 'changed_product_fact', 'date_sensitive'],
    cannotServe: 'Only what publishers chose to syndicate. No general discovery.',
  },
  {
    id: 'package_registries',
    label: 'Package registries and software metadata',
    returns: 'structured_records',
    legal: 'unverified',
    obligations: ['Per-registry terms; npm, PyPI and crates.io differ and were not read.'],
    costPerQueryCents: 0,
    servesCategories: ['changed_product_fact', 'date_sensitive'],
    cannotServe: 'Software versions only — the narrowest family here, and the most exact.',
  },
  {
    id: 'gov_open_data',
    label: 'Government and open-data APIs',
    returns: 'structured_records',
    legal: 'unverified',
    obligations: [
      'api.data.gov requires a key and applies per-user rate limits.',
      'Commercial use, attribution and redistribution are NOT addressed on its About page — ' +
        'each underlying agency API has its own terms.',
    ],
    costPerQueryCents: 0,
    servesCategories: ['official_source', 'long_tail_fact'],
    cannotServe: 'Jurisdiction-bound, and only what an agency chose to publish as an API.',
  },
]

/** Families that could plausibly serve a job — the router's first question. */
export function familiesFor(category: BatteryCategory): readonly SourceFamily[] {
  return SOURCE_FAMILIES.filter((f) => f.servesCategories.includes(category))
}

/**
 * Battery jobs NO open family claims.
 *
 * This is the number that decides whether a paid general-web provider is
 * necessary at all, so it is computed rather than asserted.
 */
export function uncoveredCategories(categories: readonly BatteryCategory[]): BatteryCategory[] {
  return categories.filter((c) => familiesFor(c).length === 0)
}
