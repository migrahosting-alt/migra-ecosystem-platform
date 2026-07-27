/**
 * MigraPilot protocol — LIVE KNOWLEDGE: governed access to information outside
 * the repository.
 *
 * A SECOND, INDEPENDENT evidence dimension. Repository grounding answers "what
 * repository material may be used"; live knowledge answers "may information from
 * outside the repository be consulted, and from which trust class". The two never
 * imply one another: `none` repository evidence does not disable live research, and
 * `off` live knowledge does not change repository grounding.
 *
 * Defined ONCE here so the extension and the Brain cannot drift — the same reason
 * the grounding modes live in `./grounding.js`. A UI offering a mode the Brain does
 * not enforce is a false governance guarantee, and for external network egress that
 * failure would be considerably worse than for repository retrieval.
 *
 *  off       no external lookup of any kind
 *  official  Tier 1 only — authoritative, first-party sources
 *  web       Tiers 1–3, with the trust of each source disclosed
 *
 * Tier 4 is never accepted, in any mode.
 */

/** The wire values. Order is the UI's presentation order, least → most permissive. */
export const LIVE_KNOWLEDGE_MODES = [
  'off',
  'official',
  'web',
] as const;

export type LiveKnowledgeMode =
  (typeof LIVE_KNOWLEDGE_MODES)[number];

export function isLiveKnowledgeMode(value: unknown): value is LiveKnowledgeMode {
  return typeof value === 'string' && (LIVE_KNOWLEDGE_MODES as readonly string[]).includes(value);
}

/**
 * Coerce an untrusted value to a mode — FAIL CLOSED to `off`.
 *
 * Deliberately unlike `parseGroundingMode`, which defaults to `auto`. There the
 * default is the prior behaviour and it discloses its source. Here, defaulting to
 * anything but `off` would grant network egress to a caller that never asked for it,
 * including every request written before this field existed.
 */
export function parseLiveKnowledgeMode(value: unknown): LiveKnowledgeMode {
  return isLiveKnowledgeMode(value) ? value : 'off';
}

/**
 * Source trust tiers.
 *
 *  1  Authoritative — official documentation, first-party APIs, government sites,
 *     vendor security advisories, official repositories and releases
 *  2  High-quality independent — recognised technical publishers, standards bodies,
 *     peer-reviewed research, reputable news organisations
 *  3  General web — blogs, forums, community posts, comparison sites
 *  4  Untrusted or prohibited — scraped mirrors, malware domains, content farms,
 *     anonymous claims without corroboration
 */
export type TrustTier = 1 | 2 | 3 | 4;

/** What kind of thing a source is — narrower than its tier, and used for disclosure. */
export type LiveSourceType =
  | 'official-docs'
  | 'official-api'
  | 'release'
  | 'security-advisory'
  | 'status-page'
  | 'research'
  | 'news'
  | 'general-web';

/**
 * Tiers a mode may accept. `off` returns an EMPTY list, so "is this tier allowed"
 * and "may I look at all" collapse into a single check that cannot be forgotten at
 * one call site while being honoured at another.
 */
export function permittedTiers(mode: LiveKnowledgeMode): readonly TrustTier[] {
  switch (mode) {
    case 'off':
      return [];
    case 'official':
      return [1];
    case 'web':
      return [1, 2, 3];
  }
}

/**
 * May a source of this tier be accepted under this mode?
 *
 * Tier 4 is rejected unconditionally: it appears in no mode's permitted set, so a
 * future mode cannot admit it by widening a numeric range.
 */
export function isTierPermitted(mode: LiveKnowledgeMode, tier: TrustTier): boolean {
  return permittedTiers(mode).includes(tier);
}

/** True when the mode permits any external lookup at all. */
export function permitsExternalLookup(mode: LiveKnowledgeMode): boolean {
  return permittedTiers(mode).length > 0;
}

// ── Freshness ────────────────────────────────────────────────────────────────

/**
 * How long a class of source stays usable.
 *
 * Configurable rather than scattered as literals: an hour-stale security advisory is
 * a different risk from day-stale documentation, and an operator must be able to
 * tighten either without editing call sites.
 */
export interface FreshnessPolicy {
  securityAdvisorySeconds: number;
  statusPageSeconds: number;
  packageReleaseSeconds: number;
  productDocumentationSeconds: number;
  generalTechnicalSeconds: number;
  newsSeconds: number;
}

export const DEFAULT_FRESHNESS_POLICY: FreshnessPolicy = {
  securityAdvisorySeconds: 60 * 60, // 1 hour
  statusPageSeconds: 5 * 60, // 5 minutes — an hour-old status page is worthless
  packageReleaseSeconds: 60 * 60, // 1 hour
  productDocumentationSeconds: 24 * 60 * 60,
  generalTechnicalSeconds: 24 * 60 * 60,
  newsSeconds: 30 * 60,
};

/** Seconds a source of this type stays usable under the given policy. */
export function freshnessSecondsFor(
  sourceType: LiveSourceType,
  policy: FreshnessPolicy = DEFAULT_FRESHNESS_POLICY,
): number {
  switch (sourceType) {
    case 'security-advisory':
      return policy.securityAdvisorySeconds;
    case 'status-page':
      return policy.statusPageSeconds;
    case 'release':
    case 'official-api':
      return policy.packageReleaseSeconds;
    case 'official-docs':
      return policy.productDocumentationSeconds;
    case 'news':
      return policy.newsSeconds;
    case 'research':
    case 'general-web':
      return policy.generalTechnicalSeconds;
  }
}

// ── Connector contract (provider-neutral) ────────────────────────────────────

export interface LiveSearchRequest {
  query: string;
  /** Never `off`: in that mode no connector is consulted at all. */
  mode: 'official' | 'web';
  maxResults: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
  freshness?: {
    maximumAgeSeconds?: number;
    publishedAfter?: string;
  };
}

export interface LiveSearchResult {
  id: string;
  title: string;
  url: string;
  domain: string;
  /**
   * Which connector produced this result.
   *
   * Recorded so a citation can be traced to the component that vouched for it, and so
   * one connector's failure is attributable instead of appearing as a general outage.
   */
  connectorId?: string;
  snippet?: string;
  publishedAt?: string;
  retrievedAt: string;
  /**
   * Claimed by the CONNECTOR, then re-checked against the mode by the Brain. A
   * connector asserting Tier 1 for a blog cannot smuggle it past the gate, because
   * the gate does not trust this field as authority — only as a claim.
   */
  trustTier: TrustTier;
  sourceType: LiveSourceType;
}

export interface LiveSourceReference {
  id: string;
  url: string;
  domain: string;
}

export interface LiveDocument {
  source: LiveSearchResult;
  content: string;
  contentHash: string;
  fetchedAt: string;
  expiresAt?: string;
}

/**
 * A provider-neutral live-knowledge connector.
 *
 * The Brain depends on this interface, never on a particular search vendor, so
 * swapping vendors cannot move the governance surface. Both methods take an
 * `AbortSignal` because user cancellation must reach in-flight network work rather
 * than being dropped at the boundary.
 */
export interface LiveKnowledgeConnector {
  /** Stable id for audit (`domainsConsulted`), not a display name. */
  readonly id: string;
  search(request: LiveSearchRequest, signal?: AbortSignal): Promise<LiveSearchResult[]>;
  fetch(source: LiveSourceReference, signal?: AbortSignal): Promise<LiveDocument>;
}

/**
 * How much of the world a connector can actually see.
 *
 * `authoritative` connectors answer from first-party APIs — a release from the GitHub
 * API, a version from the npm registry — and are the only kind `official` may use.
 * `general-web` is unrestricted search. The distinction is load-bearing for
 * DISCLOSURE: with only authoritative connectors registered, `web` mode has real
 * evidence but not broad coverage, and saying otherwise would overstate what was
 * checked.
 */
export type ConnectorCoverage = 'authoritative' | 'general-web';

/**
 * A credential a connector may use, named but never carried.
 *
 * The field is the ENVIRONMENT VARIABLE NAME, so this structure can be logged, audited
 * and rendered without any handling rules. A connector that stored the value here would
 * put a token into every record that touches its configuration.
 */
export interface ConnectorCredentialRef {
  envVar: string;
  /**
   * `false` means the connector degrades — usually to a lower rate limit — rather than
   * disappearing. A missing optional credential must disable only that connector, never
   * collapse the mode.
   */
  required: boolean;
  /** What the credential buys, for an operator deciding whether to set it. */
  purpose: string;
}

export type ConnectorUnavailableReason =
  | 'missing-credential'
  | 'not-configured'
  | 'disabled-by-operator';

/**
 * Whether a connector can run this turn.
 *
 * Unavailability is NAMED rather than silent: a connector that vanishes without saying
 * so is indistinguishable from one that ran and found nothing, which is exactly the
 * confusion that hides a misconfiguration for months.
 */
export type ConnectorAvailability =
  | { connectorId: string; available: true; coverage: ConnectorCoverage }
  | {
      connectorId: string;
      available: false;
      coverage: ConnectorCoverage;
      reason: ConnectorUnavailableReason;
      /** Names the missing variable — a NAME, never a value. */
      detail: string;
    };

/** An authoritative connector, plus the metadata governance needs about it. */
export interface DescribedConnector extends LiveKnowledgeConnector {
  readonly coverage: ConnectorCoverage;
  /** Domains this connector is allowed to reach. Enforced, not documentation. */
  readonly domains: readonly string[];
  readonly credentials?: readonly ConnectorCredentialRef[];
  /** Availability for THIS process, decided from the environment at build time. */
  availability(): ConnectorAvailability;
}

// ── Decision model ───────────────────────────────────────────────────────────

/**
 * Why the turn ended up with the external evidence it did.
 *
 * `live-knowledge-disabled` means the OPERATOR chose `off`. It is deliberately
 * distinct from `live-research-failed`, which means research was requested and could
 * not be performed — conflating them would hide an outage behind a setting.
 *
 * `official-sources-insufficient` exists so `official` can report that it found
 * nothing authoritative WITHOUT quietly widening to general web search.
 */
export type LiveKnowledgeGateDecision =
  | 'live-knowledge-disabled'
  | 'official-sources-used'
  | 'official-sources-insufficient'
  | 'web-research-used'
  | 'web-research-insufficient'
  | 'live-research-failed';

export interface LiveKnowledgeDecision {
  requestedMode: LiveKnowledgeMode;
  /** What was actually permitted and used. NEVER broader than `requestedMode`. */
  effectiveMode: LiveKnowledgeMode;
  gateDecision: LiveKnowledgeGateDecision;
  sourcesConsulted: number;
  sourcesAccepted: number;
  /** ISO timestamp of the research pass, when one happened. */
  researchedAt?: string;
  /** Accepted sources by tier, for disclosure ("2 authoritative, 1 independent"). */
  trustTierCounts?: Partial<Record<TrustTier, number>>;
  /** Origins consulted — never full URLs, never query strings. */
  domainsConsulted?: string[];
  /** Coarse failure class; never a provider message and never page content. */
  failureCategory?: 'no-connector' | 'connector-error' | 'timeout' | 'cancelled' | 'all-sources-rejected';
  /** Per-connector availability, so a misconfiguration is visible rather than inferred. */
  connectorAvailability?: ConnectorAvailability[];
  /**
   * True only when a `general-web` connector actually ran.
   *
   * `web` mode with authoritative connectors alone produces real evidence but not broad
   * coverage, and the disclosure has to say which one happened.
   */
  broadWebCoverage?: boolean;
}

/**
 * One citation the host may render.
 *
 * Produced from the ACCEPTED set by the host, never parsed out of the model's prose.
 * A citation the model invented has no entry here, so it cannot be rendered — which is
 * the only way a "sources" list means anything.
 */
export interface LiveCitation {
  sourceId: string;
  connectorId: string;
  title: string;
  /** Origin + path. Never a query string, never a fragment. */
  safeUrl: string;
  domain: string;
  sourceType: LiveSourceType;
  trustTier: TrustTier;
  publishedAt?: string;
  retrievedAt: string;
  expiresAt?: string;
  contentHash: string;
}

/**
 * The host-rendered live-knowledge frame.
 *
 * Built from the decision and the accepted set, so the header line and the citations
 * cannot disagree with what was actually fetched. The model receives bounded source
 * CONTENT; the renderer receives this structure separately, which is what makes
 * provenance unfabricable.
 */
export interface LiveKnowledgeFrame {
  headline: string;
  checkedAt?: string;
  sourcesConsulted: number;
  sourcesAccepted: number;
  citations: LiveCitation[];
  /** Named unavailable connectors, for the operator rather than the end user. */
  unavailable: { connectorId: string; reason: ConnectorUnavailableReason; detail: string }[];
}
