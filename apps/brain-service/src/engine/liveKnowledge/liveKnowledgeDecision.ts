/**
 * MigraAI Engine — the live-knowledge boundary.
 *
 * The single place that decides whether a turn may consult information OUTSIDE the
 * repository, and from which trust class. Independent of repository grounding by
 * construction: this module never reads a grounding mode, and the grounding module
 * never reads this one. `none` repository evidence does not disable live research,
 * and `off` live knowledge does not alter repository grounding.
 *
 * PURE: no fetch, no fs. The connector is injected, which is what makes "off performs
 * zero external I/O" provable — a test passes a connector that throws on any call and
 * asserts it was never touched.
 *
 * Policy first, provider later. This lands before any real search vendor exists, for
 * the same reason the grounding modes landed before their UI: a network-egress
 * control that is added after the egress already works is a control nobody can trust.
 */

import {
  DEFAULT_FRESHNESS_POLICY,
  isTierPermitted,
  parseLiveKnowledgeMode,
  permitsExternalLookup,
  type FreshnessPolicy,
  type LiveKnowledgeConnector,
  type LiveKnowledgeDecision,
  type LiveKnowledgeMode,
  type LiveSearchResult,
  type TrustTier,
} from '@migrapilot/protocol';

export {
  DEFAULT_FRESHNESS_POLICY,
  LIVE_KNOWLEDGE_MODES,
  freshnessSecondsFor,
  isLiveKnowledgeMode,
  isTierPermitted,
  parseLiveKnowledgeMode,
  permittedTiers,
  permitsExternalLookup,
  type LiveKnowledgeConnector,
  type LiveKnowledgeDecision,
  type LiveKnowledgeGateDecision,
  type LiveKnowledgeMode,
  type LiveSearchResult,
  type TrustTier,
} from '@migrapilot/protocol';

/** Bounds on a single turn's research. Every one is a hard cap, not a hint. */
export interface LiveResearchBudget {
  maxSearches: number;
  maxDocuments: number;
  maxBytesPerDocument: number;
  maxRequestsPerDomain: number;
  connectTimeoutMs: number;
  idleTimeoutMs: number;
  absoluteTimeoutMs: number;
  maxRedirects: number;
}

/**
 * Deliberately small defaults.
 *
 * An unbounded research pass is indistinguishable from a crawler, and the failure
 * mode is a surprise egress bill plus a turn that never ends. The provider timeout
 * work established that a total deadline is wrong for STREAMING; research fetches are
 * not streaming, so an absolute ceiling is appropriate here.
 */
export const DEFAULT_RESEARCH_BUDGET: LiveResearchBudget = {
  maxSearches: 3,
  maxDocuments: 5,
  maxBytesPerDocument: 512 * 1024,
  maxRequestsPerDomain: 3,
  connectTimeoutMs: 10_000,
  idleTimeoutMs: 15_000,
  absoluteTimeoutMs: 60_000,
  maxRedirects: 3,
};

export interface LiveKnowledgeRequest {
  /**
   * Set by the CALLER from an explicit request field, never inferred from the prompt.
   * A model that could talk its way onto the network by phrasing would make this
   * boundary decorative.
   */
  mode: LiveKnowledgeMode;
  query: string;
}

export interface LiveKnowledgeDeps {
  /** The connector, or undefined when none is configured for this deployment. */
  connector?: LiveKnowledgeConnector;
  /** ISO clock, injected so decisions are deterministic under test. */
  now(): string;
  budget?: LiveResearchBudget;
  freshness?: FreshnessPolicy;
}

/** A source that survived the gate, plus why it was accepted. */
export interface AcceptedSource {
  result: LiveSearchResult;
  tier: TrustTier;
}

export interface LiveKnowledgeOutcome {
  decision: LiveKnowledgeDecision;
  /** Sources the turn may cite. Empty whenever the gate refused or found nothing. */
  accepted: AcceptedSource[];
}

/**
 * Decide — and, when permitted, perform — this turn's external research.
 *
 * `off` returns BEFORE touching `deps.connector`, so no connector method can run.
 * That ordering is the whole guarantee; a check placed after a "just to see what's
 * available" call would satisfy the type system and violate the policy.
 *
 * `official` never widens to `web`. When nothing authoritative is found it reports
 * `official-sources-insufficient` and returns no sources, leaving the caller to
 * answer from other permitted evidence or to say it cannot.
 */
export async function decideLiveKnowledge(
  req: LiveKnowledgeRequest,
  deps: LiveKnowledgeDeps,
  signal?: AbortSignal,
): Promise<LiveKnowledgeOutcome> {
  const requestedMode = parseLiveKnowledgeMode(req.mode);

  // ── OFF: return before any connector access ────────────────────────────────
  if (!permitsExternalLookup(requestedMode)) {
    return {
      decision: {
        requestedMode,
        effectiveMode: 'off',
        gateDecision: 'live-knowledge-disabled',
        sourcesConsulted: 0,
        sourcesAccepted: 0,
      },
      accepted: [],
    };
  }

  // Research was ASKED for but cannot be performed. Reported as a failure, never as
  // `live-knowledge-disabled` — an operator must be able to tell "I turned it off"
  // from "it is broken".
  if (!deps.connector) {
    return {
      decision: {
        requestedMode,
        effectiveMode: requestedMode,
        gateDecision: 'live-research-failed',
        sourcesConsulted: 0,
        sourcesAccepted: 0,
        failureCategory: 'no-connector',
      },
      accepted: [],
    };
  }

  const budget = deps.budget ?? DEFAULT_RESEARCH_BUDGET;
  const startedAt = deps.now();
  let results: LiveSearchResult[];
  try {
    results = await deps.connector.search(
      {
        query: req.query,
        // `off` is unreachable here, so the connector never sees a mode it cannot act on.
        mode: requestedMode === 'official' ? 'official' : 'web',
        maxResults: budget.maxDocuments,
      },
      signal,
    );
  } catch (error) {
    return {
      decision: {
        requestedMode,
        effectiveMode: requestedMode,
        gateDecision: 'live-research-failed',
        sourcesConsulted: 0,
        sourcesAccepted: 0,
        researchedAt: startedAt,
        failureCategory: signal?.aborted ? 'cancelled' : classifyConnectorFailure(error),
      },
      accepted: [],
    };
  }

  const consulted = results.length;
  // The gate re-checks every claimed tier and every URL. A connector's own labelling
  // is an input, not an authority.
  const accepted: AcceptedSource[] = [];
  for (const result of results) {
    if (!isTierPermitted(requestedMode, result.trustTier)) continue;
    if (!isSafeExternalUrl(result.url)) continue;
    accepted.push({ result, tier: result.trustTier });
    if (accepted.length >= budget.maxDocuments) break;
  }

  const domainsConsulted = [...new Set(results.map((r) => safeDomain(r.url) ?? r.domain).filter(Boolean))];
  const trustTierCounts = accepted.reduce<Partial<Record<TrustTier, number>>>((acc, s) => {
    acc[s.tier] = (acc[s.tier] ?? 0) + 1;
    return acc;
  }, {});

  if (accepted.length === 0) {
    return {
      decision: {
        requestedMode,
        effectiveMode: requestedMode,
        // Distinct per mode: `official` finding nothing must not read as a web-search
        // miss, because the remedy differs.
        gateDecision: requestedMode === 'official' ? 'official-sources-insufficient' : 'web-research-insufficient',
        sourcesConsulted: consulted,
        sourcesAccepted: 0,
        researchedAt: startedAt,
        domainsConsulted,
        ...(consulted > 0 ? { failureCategory: 'all-sources-rejected' as const } : {}),
      },
      accepted: [],
    };
  }

  return {
    decision: {
      requestedMode,
      effectiveMode: requestedMode,
      gateDecision: requestedMode === 'official' ? 'official-sources-used' : 'web-research-used',
      sourcesConsulted: consulted,
      sourcesAccepted: accepted.length,
      researchedAt: startedAt,
      trustTierCounts,
      domainsConsulted,
    },
    accepted,
  };
}

function classifyConnectorFailure(error: unknown): 'timeout' | 'cancelled' | 'connector-error' {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'cancelled';
    if (error.name === 'TimeoutError' || /timeout/i.test(error.message)) return 'timeout';
  }
  return 'connector-error';
}

// ── URL safety ───────────────────────────────────────────────────────────────

/** Hostnames that must never be fetched, however they are reached. */
const LOCAL_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback', '0.0.0.0', '[::]', '::1', '[::1]']);

/**
 * Is this URL safe to fetch as EXTERNAL knowledge?
 *
 * Blocks loopback, link-local, private and carrier-grade-NAT ranges, non-HTTP
 * schemes, and credentials embedded in the URL. Server-side request forgery is the
 * obvious hazard once the Brain will fetch an attacker-influenced URL: without this,
 * "look up the docs" becomes a way to read `169.254.169.254` metadata or reach a
 * service on the operator's own network.
 *
 * Enforced on search RESULTS as well as on fetches, so a hostile result set cannot
 * reach the fetch stage at all.
 */
export function isSafeExternalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  // Credentials in a URL are never legitimate for public knowledge, and they would
  // otherwise ride into logs and audit records.
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase();
  if (!host) return false;
  if (LOCAL_HOSTNAMES.has(host)) return false;
  // `.localhost` and `.local` resolve inside the operator's network.
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (isPrivateIpv4(host)) return false;
  if (isPrivateIpv6(host)) return false;
  return true;
}

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return true; // malformed → refuse
  if (a === 10 || a === 127 || a === 0) return true; // private, loopback, "this host"
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast and reserved
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::' || h === '::1') return true;
  if (h.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(h)) return true; // unique local (fc00::/7)
  // IPv4-mapped addresses inherit the IPv4 verdict. Two spellings must be handled:
  // the dotted form (`::ffff:10.0.0.1`) and the COMPRESSED HEX form Node's URL parser
  // normalises it to (`::ffff:a00:1`). Checking only the dotted form let
  // `http://[::ffff:10.0.0.1]/` through as public — a working SSRF bypass, since the
  // hostname the parser reports is never the string the caller wrote.
  const dotted = /::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (dotted) return isPrivateIpv4(dotted[1]!);
  const hex = /::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (hex) {
    const high = parseInt(hex[1]!, 16);
    const low = parseInt(hex[2]!, 16);
    const octets = [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff];
    return isPrivateIpv4(octets.join('.'));
  }
  return false;
}

/** Origin + path only — no query, no fragment, no credentials. */
export function safeUrlForAudit(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

function safeDomain(raw: string): string | undefined {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

// ── Audit ────────────────────────────────────────────────────────────────────

/**
 * Metadata-only audit payload for a live-knowledge decision.
 *
 * Carries NO prompt, NO search query, NO page body, NO retrieved excerpt, NO token,
 * and NO full URL with query parameters. The query in particular is excluded because
 * it is derived from user content and routinely contains identifiers a repository
 * audit trail has no business retaining.
 */
export function liveKnowledgeAuditFields(
  decision: LiveKnowledgeDecision,
  timing?: { startedAt?: string; completedAt?: string; durationMs?: number },
): Record<string, unknown> {
  return {
    requestedMode: decision.requestedMode,
    effectiveMode: decision.effectiveMode,
    gateDecision: decision.gateDecision,
    sourcesConsulted: decision.sourcesConsulted,
    sourcesAccepted: decision.sourcesAccepted,
    ...(decision.trustTierCounts ? { trustTierCounts: decision.trustTierCounts } : {}),
    ...(decision.domainsConsulted?.length ? { domainsConsulted: decision.domainsConsulted } : {}),
    ...(decision.researchedAt ? { researchedAt: decision.researchedAt } : {}),
    ...(decision.failureCategory ? { failureCategory: decision.failureCategory } : {}),
    ...(timing?.startedAt ? { startedAt: timing.startedAt } : {}),
    ...(timing?.completedAt ? { completedAt: timing.completedAt } : {}),
    ...(timing?.durationMs !== undefined ? { durationMs: timing.durationMs } : {}),
  };
}

/**
 * Host-rendered disclosure line.
 *
 * Produced from the DECISION, never asked of the model — the same rule the
 * repository source-mode badge follows. An instruction to "mention your sources" is
 * not a disclosure guarantee.
 */
export function liveKnowledgeDisclosure(decision: LiveKnowledgeDecision): string {
  if (decision.effectiveMode === 'off') return 'Live knowledge: Off';
  if (decision.gateDecision === 'live-research-failed') {
    return `Live knowledge: unavailable (${decision.failureCategory ?? 'failed'}) — no external sources were consulted`;
  }
  if (decision.sourcesAccepted === 0) {
    return decision.requestedMode === 'official'
      ? `Live knowledge: no authoritative sources found (${decision.sourcesConsulted} considered)`
      : `Live knowledge: no usable sources found (${decision.sourcesConsulted} considered)`;
  }
  const label = decision.requestedMode === 'official' ? 'Official sources' : 'Web research';
  const counts = decision.trustTierCounts ?? {};
  const trust = [
    counts[1] ? `${counts[1]} authoritative` : undefined,
    counts[2] ? `${counts[2]} independent` : undefined,
    counts[3] ? `${counts[3]} general web` : undefined,
  ]
    .filter(Boolean)
    .join(', ');
  const checked = decision.researchedAt ? ` · Checked ${decision.researchedAt}` : '';
  return `Live knowledge: ${label} · Sources accepted: ${decision.sourcesAccepted}${trust ? ` (${trust})` : ''}${checked}`;
}
