/**
 * MigraAI Engine — connector registry and bounded research execution.
 *
 * Sits between the mode decision (`liveKnowledgeDecision.ts`) and the safe fetcher
 * (`liveFetch.ts`), and owns the per-TURN budgets: how many searches, how many
 * documents, how many requests to any one domain. Those caps are what separate
 * "research" from "crawl", and they are enforced here rather than trusted to a
 * connector, because a connector is exactly the component least able to promise them.
 *
 * A registry rather than a single connector because trust classes have different
 * providers: an authoritative GitHub/npm/NVD connector is not the same component as a
 * general web search, and `official` must be able to run with NO web provider
 * registered at all.
 */

import {
  decideLiveKnowledge,
  isTierPermitted,
  liveKnowledgeAuditFields,
  parseLiveKnowledgeMode,
  safeUrlForAudit,
  permitsExternalLookup,
  DEFAULT_RESEARCH_BUDGET,
  type AcceptedSource,
  type LiveKnowledgeConnector,
  type LiveKnowledgeDecision,
  type LiveKnowledgeMode,
  type LiveResearchBudget,
} from './liveKnowledgeDecision.js';
import { fetchLiveDocument, LiveFetchAborted, LiveFetchRejected, LiveFetchTimeout, type LiveFetchDeps } from './liveFetch.js';
import { createHash } from 'node:crypto';
import { DEFAULT_FRESHNESS_POLICY, freshnessSecondsFor, type FreshnessPolicy } from '@migrapilot/protocol';
import type {
  ConnectorAvailability,
  DescribedConnector,
  LiveCitation,
  LiveDocument,
  LiveKnowledgeFrame,
  LiveSearchResult,
} from '@migrapilot/protocol';

/**
 * Which modes a connector may serve.
 *
 * A connector registered for `official` only is never consulted for a `web` turn and
 * vice versa, so widening the mode cannot silently recruit an unintended provider.
 */
export interface RegisteredConnector {
  connector: LiveKnowledgeConnector;
  serves: readonly LiveKnowledgeMode[];
}

/** Coverage and availability, for connectors that declare them. */
function describedOf(connector: LiveKnowledgeConnector): DescribedConnector | undefined {
  const candidate = connector as Partial<DescribedConnector>;
  return typeof candidate.availability === 'function' && candidate.coverage ? (connector as DescribedConnector) : undefined;
}

export class LiveConnectorRegistry {
  private readonly entries: RegisteredConnector[] = [];

  register(connector: LiveKnowledgeConnector, serves: readonly LiveKnowledgeMode[]): this {
    // `off` means "no lookup", so a connector claiming to serve it would be a
    // contradiction that could only ever be honoured by ignoring it.
    if (serves.includes('off')) throw new Error('a connector cannot serve the off mode');
    this.entries.push({ connector, serves });
    return this;
  }

  /** Register every authoritative connector for both lookup modes at once. */
  registerAuthoritative(connectors: readonly DescribedConnector[]): this {
    // Authoritative sources are Tier 1, which BOTH modes permit — `web` is a superset of
    // `official`, not an alternative to it.
    for (const connector of connectors) this.register(connector, ['official', 'web']);
    return this;
  }

  /**
   * Every connector eligible for this mode AND available right now.
   *
   * Availability is consulted here rather than at fetch time so a missing credential
   * removes the connector before it can produce results it cannot substantiate.
   */
  eligible(mode: LiveKnowledgeMode): LiveKnowledgeConnector[] {
    if (!permitsExternalLookup(mode)) return []; // off never selects any
    return this.entries
      .filter((e) => e.serves.includes(mode))
      .map((e) => e.connector)
      .filter((c) => describedOf(c)?.availability().available !== false);
  }

  /** Availability of every connector eligible for this mode, available or not. */
  availability(mode: LiveKnowledgeMode): ConnectorAvailability[] {
    if (!permitsExternalLookup(mode)) return [];
    return this.entries
      .filter((e) => e.serves.includes(mode))
      .map((e) => describedOf(e.connector)?.availability())
      .filter((a): a is ConnectorAvailability => a !== undefined);
  }

  /**
   * Did a `general-web` connector actually become eligible?
   *
   * Load-bearing for disclosure: with authoritative connectors alone, `web` mode has
   * real evidence and NOT broad coverage, and the frame has to say which one happened.
   */
  hasBroadWebCoverage(mode: LiveKnowledgeMode): boolean {
    return this.eligible(mode).some((c) => describedOf(c)?.coverage === 'general-web');
  }

  /** The connector that produced a result, for routing its fetch back to it. */
  byId(connectorId: string | undefined): LiveKnowledgeConnector | undefined {
    if (!connectorId) return undefined;
    return this.entries.find((e) => e.connector.id === connectorId)?.connector;
  }

  ids(): string[] {
    return this.entries.map((e) => e.connector.id);
  }
}

/** What went wrong for one connector during a fan-out. Coarse, never a provider message. */
export interface ConnectorFailure {
  connectorId: string;
  category: 'connector-error' | 'timeout' | 'cancelled';
}

/**
 * Fan one search out across every eligible connector.
 *
 * Failures are isolated PER CONNECTOR: GitHub being down must not erase the npm
 * registry's answer, so each connector's rejection is recorded and the others' results
 * are kept. The composite throws only when every connector failed — that is a real
 * outage, and reporting it as "nothing found" would hide it.
 *
 * Results are tagged with their producing connector so a citation stays attributable
 * even after merging, and a connector that forgot to set `connectorId` gets it stamped
 * here rather than producing an unattributable source.
 */
export function fanOut(
  connectors: readonly LiveKnowledgeConnector[],
  onFailure: (failure: ConnectorFailure) => void,
): LiveKnowledgeConnector {
  return {
    id: connectors.map((c) => c.id).join('+') || 'none',
    async search(request, signal) {
      const settled = await Promise.all(
        connectors.map(async (connector): Promise<LiveSearchResult[] | undefined> => {
          try {
            const results = await connector.search(request, signal);
            return results.map((r) => ({ ...r, connectorId: r.connectorId ?? connector.id }));
          } catch (error) {
            onFailure({ connectorId: connector.id, category: categoryOf(error) });
            return undefined;
          }
        }),
      );
      const ok = settled.filter((r): r is LiveSearchResult[] => r !== undefined);
      if (ok.length === 0 && connectors.length > 0) {
        throw new Error(`all ${connectors.length} connectors failed`);
      }
      return ok.flat();
    },
    async fetch() {
      // Routed by the registry in `researchLive`; a composite fetch has no single owner.
      throw new Error('fanOut does not fetch; route the fetch to the producing connector');
    },
  };
}

function categoryOf(error: unknown): ConnectorFailure['category'] {
  if (error instanceof LiveFetchTimeout) return 'timeout';
  if (error instanceof LiveFetchAborted) return 'cancelled';
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
  return 'connector-error';
}

/**
 * Wrap a connector so it cannot exceed the turn's search budget.
 *
 * The cap is enforced HERE rather than asked of the connector, and rather than trusted
 * to whoever assembles the query list: a provider that decides to "just refine once
 * more" is the exact failure this bounds, and it is in no position to police itself.
 * Once the budget is spent, `search` refuses instead of returning empty — a silent
 * empty result is indistinguishable from "nothing found", which would hide the cap.
 */
export class SearchBudgetExceeded extends Error {
  override readonly name = 'SearchBudgetExceeded';
  constructor(readonly maxSearches: number) {
    super(`live search budget exhausted after ${maxSearches} searches this turn`);
  }
}

export function withSearchBudget(connector: LiveKnowledgeConnector, maxSearches: number): LiveKnowledgeConnector & { used(): number } {
  let used = 0;
  return {
    id: connector.id,
    async search(request, signal) {
      if (used >= maxSearches) throw new SearchBudgetExceeded(maxSearches);
      used += 1;
      return connector.search(request, signal);
    },
    fetch: (source, signal) => connector.fetch(source, signal),
    used: () => used,
  };
}

export interface LiveResearchDeps {
  registry: LiveConnectorRegistry;
  fetch: Omit<LiveFetchDeps, 'budget'>;
  now(): string;
  budget?: LiveResearchBudget;
}

export interface LiveResearchOutcome {
  decision: LiveKnowledgeDecision;
  /** Fetched, sanitised documents the answer may cite. */
  documents: LiveDocument[];
  /** Per-source rejection reasons, for audit counts only — never page content. */
  rejections: Record<string, number>;
}

/**
 * Run this turn's research within budget, or explain why not.
 *
 * `off` short-circuits through {@link decideLiveKnowledge} without touching the
 * registry, so the zero-I/O guarantee survives the addition of an execution layer —
 * which is the point of routing through the decision first rather than reimplementing
 * the mode check here.
 */
export async function researchLive(
  req: { mode: LiveKnowledgeMode; query: string; followUpQueries?: readonly string[] },
  deps: LiveResearchDeps,
  signal?: AbortSignal,
): Promise<LiveResearchOutcome> {
  const mode = parseLiveKnowledgeMode(req.mode);
  const budget = deps.budget ?? DEFAULT_RESEARCH_BUDGET;
  const eligible = deps.registry.eligible(mode);
  const connectorAvailability = deps.registry.availability(mode);
  const broadWebCoverage = deps.registry.hasBroadWebCoverage(mode);
  const failures: ConnectorFailure[] = [];
  // Fanned out across every eligible connector, then wrapped ONCE — so a turn's
  // `maxSearches` bounds queries, not providers. Consulting seven authoritative APIs to
  // answer one question is one search; charging seven would make a complete answer
  // look like a budget violation.
  const connector =
    eligible.length > 0
      ? withSearchBudget(fanOut(eligible, (f) => failures.push(f)), budget.maxSearches)
      : undefined;
  const gateDeps = { ...(connector ? { connector } : {}), now: deps.now, budget };

  let { decision, accepted } = await decideLiveKnowledge({ mode, query: req.query }, gateDeps, signal);

  // Refinement searches, still inside the same turn budget. Every extra query spends
  // one search, so `maxSearches` bounds the whole turn rather than each call.
  for (const followUp of req.followUpQueries ?? []) {
    if (!connector || connector.used() >= budget.maxSearches) break;
    if (accepted.length >= budget.maxDocuments) break;
    if (signal?.aborted) break;
    const more = await decideLiveKnowledge({ mode, query: followUp }, gateDeps, signal);
    const seen = new Set(accepted.map((a) => a.result.url));
    accepted = [...accepted, ...more.accepted.filter((a) => !seen.has(a.result.url))].slice(0, budget.maxDocuments);
    decision = {
      ...more.decision,
      sourcesConsulted: decision.sourcesConsulted + more.decision.sourcesConsulted,
      sourcesAccepted: accepted.length,
      domainsConsulted: [...new Set([...(decision.domainsConsulted ?? []), ...(more.decision.domainsConsulted ?? [])])],
      // A later empty search must not downgrade a gate that already accepted sources.
      gateDecision:
        accepted.length > 0
          ? mode === 'official'
            ? 'official-sources-used'
            : 'web-research-used'
          : more.decision.gateDecision,
      ...(accepted.length > 0 ? { failureCategory: undefined } : {}),
    };
  }

  // Availability and coverage are stamped on EVERY outcome, including the refusals: a
  // turn that found nothing because a connector was unconfigured has to look different
  // from one where the connectors ran and the world had no answer.
  const annotate = (d: LiveKnowledgeDecision): LiveKnowledgeDecision => ({
    ...d,
    ...(connectorAvailability.length > 0 ? { connectorAvailability } : {}),
    ...(permitsExternalLookup(mode) ? { broadWebCoverage } : {}),
  });

  if (accepted.length === 0) {
    return { decision: annotate(decision), documents: [], rejections: failureCounts(failures) };
  }

  const rejections: Record<string, number> = failureCounts(failures);
  const perDomain = new Map<string, number>();
  const documents: LiveDocument[] = [];

  for (const source of accepted) {
    if (documents.length >= budget.maxDocuments) break;
    if (signal?.aborted) {
      return {
        decision: annotate({ ...decision, gateDecision: 'live-research-failed', sourcesAccepted: documents.length, failureCategory: 'cancelled' }),
        documents,
        rejections,
      };
    }

    // Per-domain cap, so one host cannot absorb the whole document budget.
    const domain = source.result.domain.toLowerCase();
    const used = perDomain.get(domain) ?? 0;
    if (used >= budget.maxRequestsPerDomain) {
      rejections['domain-budget-exceeded'] = (rejections['domain-budget-exceeded'] ?? 0) + 1;
      continue;
    }
    perDomain.set(domain, used + 1);

    try {
      const doc = await fetchAccepted(source, deps, budget, signal);
      // Re-check the tier on the FETCHED source: a redirect may have moved the
      // document, and the gate's verdict was about where it started.
      if (!isTierPermitted(mode, doc.source.trustTier)) {
        rejections['tier-not-permitted'] = (rejections['tier-not-permitted'] ?? 0) + 1;
        continue;
      }
      documents.push(doc);
    } catch (error) {
      const key = classifyFetchFailure(error);
      rejections[key] = (rejections[key] ?? 0) + 1;
      if (key === 'cancelled') {
        return {
          decision: annotate({ ...decision, gateDecision: 'live-research-failed', sourcesAccepted: documents.length, failureCategory: 'cancelled' }),
          documents,
          rejections,
        };
      }
    }
  }

  // Every source was rejected at fetch time: the mode did not change, but nothing
  // survived, so the gate reports insufficiency rather than success.
  if (documents.length === 0) {
    return {
      decision: annotate({
        ...decision,
        gateDecision: mode === 'official' ? 'official-sources-insufficient' : 'web-research-insufficient',
        sourcesAccepted: 0,
        failureCategory: 'all-sources-rejected',
      }),
      documents,
      rejections,
    };
  }

  const trustTierCounts = documents.reduce<Record<number, number>>((acc, d) => {
    acc[d.source.trustTier] = (acc[d.source.trustTier] ?? 0) + 1;
    return acc;
  }, {});

  return {
    decision: annotate({ ...decision, sourcesAccepted: documents.length, trustTierCounts }),
    documents,
    rejections,
  };
}

/** Per-connector failures as audit counts, keyed by category rather than by provider text. */
function failureCounts(failures: readonly ConnectorFailure[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of failures) {
    const key = `connector:${f.connectorId}:${f.category}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Fetch one accepted source through the connector that produced it.
 *
 * A connector that reads an API knows how to turn its own payload into compact evidence;
 * generic text extraction of raw JSON would be strictly worse. Before routing, the URL's
 * host is checked against the connector's DECLARED domains, so a connector cannot be
 * handed a source outside the surface it published — including one a redirect or a
 * merged result set moved.
 *
 * A source from an unknown connector falls back to the generic document fetch, which
 * carries the same guards.
 */
async function fetchAccepted(
  source: AcceptedSource,
  deps: LiveResearchDeps,
  budget: LiveResearchBudget,
  signal?: AbortSignal,
): Promise<LiveDocument> {
  const producer = deps.registry.byId(source.result.connectorId);
  const described = producer as Partial<DescribedConnector> | undefined;

  if (producer && described?.domains && described.domains.length > 0) {
    const host = new URL(source.result.url).hostname.toLowerCase();
    if (!described.domains.some((d) => host === d.toLowerCase())) {
      throw new LiveFetchRejected('unsafe-url', undefined, `${producer.id} does not declare this host`);
    }
    const doc = await producer.fetch(
      { id: source.result.id, url: source.result.url, domain: source.result.domain },
      signal,
    );
    // Hashing and freshness are owned HERE, not by the connector: a connector that
    // computed its own hash could describe content it did not return.
    return stampDocument(doc, deps.now(), deps.fetch.freshness);
  }

  return fetchLiveDocument(source.result, { ...deps.fetch, budget }, signal);
}

/** Content hash and freshness window, applied uniformly to every accepted document. */
function stampDocument(doc: LiveDocument, fetchedAt: string, freshness?: FreshnessPolicy): LiveDocument {
  const at = new Date(fetchedAt);
  const ttl = freshnessSecondsFor(doc.source.sourceType, freshness ?? DEFAULT_FRESHNESS_POLICY);
  return {
    ...doc,
    contentHash: createHash('sha256').update(doc.content).digest('hex').slice(0, 32),
    fetchedAt,
    expiresAt: new Date(at.getTime() + ttl * 1000).toISOString(),
  };
}

/** Coarse failure class for audit counts. Never a provider message or page text. */
function classifyFetchFailure(error: unknown): string {
  if (error instanceof LiveFetchRejected) return error.rejection;
  if (error instanceof LiveFetchTimeout) return `timeout-${error.phase}`;
  if (error instanceof LiveFetchAborted) return 'cancelled';
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
  return 'fetch-error';
}

/** Provenance for an accepted document, for disclosure and citation checking. */
export interface SourceProvenance {
  domain: string;
  safePath?: string;
  trustTier: number;
  sourceType: string;
  publishedAt?: string;
  fetchedAt: string;
  expiresAt?: string;
  contentHash: string;
}

/**
 * Provenance of accepted documents.
 *
 * The answer layer may cite ONLY what appears here: a source that was rejected at any
 * stage has no entry, so it cannot be cited even if the model saw its title in a
 * search result.
 */
export function acceptedProvenance(documents: LiveDocument[]): SourceProvenance[] {
  return documents.map((d) => ({
    domain: d.source.domain.toLowerCase(),
    ...(safePath(d.source.url) ? { safePath: safePath(d.source.url) } : {}),
    trustTier: d.source.trustTier,
    sourceType: d.source.sourceType,
    ...(d.source.publishedAt ? { publishedAt: d.source.publishedAt } : {}),
    fetchedAt: d.fetchedAt,
    ...(d.expiresAt ? { expiresAt: d.expiresAt } : {}),
    contentHash: d.contentHash,
  }));
}

function safePath(raw: string): string | undefined {
  try {
    return new URL(raw).pathname;
  } catch {
    return undefined;
  }
}

/**
 * Audit record for a research pass. METADATA ONLY.
 *
 * Built by construction rather than by filtering: the record is assembled from named
 * scalar fields, so page bodies, extracted excerpts, the search query and the user's
 * prompt have no path into it. A redaction pass over a record that started with the
 * content would be one forgotten field away from leaking it.
 *
 * `rejections` carries counts per reason, never the URL that was refused, and source
 * entries carry origin + path only, so a credential in a query string cannot reach the
 * durable log.
 */
export function liveResearchAuditFields(
  outcome: LiveResearchOutcome,
  timing?: { startedAt?: string; completedAt?: string; durationMs?: number },
): Record<string, unknown> {
  const rejectionCount = Object.values(outcome.rejections).reduce((a, b) => a + b, 0);
  return {
    ...liveKnowledgeAuditFields(outcome.decision, timing),
    documentsFetched: outcome.documents.length,
    ...(rejectionCount > 0 ? { rejections: { ...outcome.rejections }, rejectionCount } : {}),
    ...(outcome.documents.length > 0
      ? {
          sources: acceptedProvenance(outcome.documents).map((p) => ({
            domain: p.domain,
            ...(p.safePath ? { path: p.safePath } : {}),
            trustTier: p.trustTier,
            sourceType: p.sourceType,
            contentHash: p.contentHash,
            fetchedAt: p.fetchedAt,
            ...(p.expiresAt ? { expiresAt: p.expiresAt } : {}),
            ...(p.publishedAt ? { publishedAt: p.publishedAt } : {}),
          })),
        }
      : {}),
  };
}

// ── Host-owned provenance ────────────────────────────────────────────────────

/**
 * Citations for exactly the accepted documents.
 *
 * Derived from what was FETCHED, never parsed out of the model's prose. A source the
 * model invented has no document, so it gets no citation; a source rejected at any stage
 * has no document either. That is the whole reason a sources list means anything — the
 * alternative is a list the model can write whatever it likes into.
 */
export function buildCitations(documents: readonly LiveDocument[]): LiveCitation[] {
  return documents.map((d) => ({
    sourceId: d.source.id,
    connectorId: d.source.connectorId ?? 'unknown',
    title: d.source.title,
    // Origin + path. A signed query parameter or session token in the URL never renders.
    safeUrl: safeUrlForAudit(d.source.url) ?? `https://${d.source.domain}`,
    domain: d.source.domain.toLowerCase(),
    sourceType: d.source.sourceType,
    trustTier: d.source.trustTier,
    ...(d.source.publishedAt ? { publishedAt: d.source.publishedAt } : {}),
    retrievedAt: d.source.retrievedAt,
    ...(d.expiresAt ? { expiresAt: d.expiresAt } : {}),
    contentHash: d.contentHash,
  }));
}

/**
 * The frame the host renders BEFORE the answer.
 *
 * Built from the decision and the fetched documents, so the headline, the counts and the
 * citations cannot disagree with what happened. The model receives bounded source
 * content; the renderer receives this — which is what makes provenance unfabricable
 * rather than merely requested.
 */
export function buildLiveKnowledgeFrame(outcome: LiveResearchOutcome): LiveKnowledgeFrame {
  const d = outcome.decision;
  const unavailable = (d.connectorAvailability ?? [])
    .filter((a) => !a.available)
    .map((a) => ({ connectorId: a.connectorId, reason: a.reason, detail: a.detail }));

  return {
    headline: headlineFor(d),
    ...(d.researchedAt ? { checkedAt: d.researchedAt } : {}),
    sourcesConsulted: d.sourcesConsulted,
    sourcesAccepted: outcome.documents.length,
    citations: buildCitations(outcome.documents),
    unavailable,
  };
}

function headlineFor(d: LiveKnowledgeDecision): string {
  if (d.effectiveMode === 'off') return 'Live knowledge: Off';
  if (d.gateDecision === 'live-research-failed') {
    return `Live knowledge: unavailable (${d.failureCategory ?? 'failed'}) — no external sources were consulted`;
  }
  if (d.sourcesAccepted === 0) {
    return d.requestedMode === 'official'
      ? 'Live knowledge: no authoritative sources found'
      : 'Live knowledge: no usable sources found';
  }
  if (d.requestedMode === 'official') return 'Live knowledge: Official sources';
  // `web` with authoritative connectors alone has real evidence and NOT broad coverage.
  // Saying "Web research" here would claim a search of the web that never happened.
  return d.broadWebCoverage
    ? 'Live knowledge: Web research'
    : 'Live knowledge: Authoritative sources only (no general web provider configured)';
}

/**
 * Render the frame as the deterministic preamble.
 *
 * Host-rendered for the same reason the repository source-mode badge is: an instruction
 * to "mention your sources" is a request, not a guarantee, and a turn where the model
 * ignored it is indistinguishable from one where it had nothing to disclose.
 */
export function renderLiveKnowledgeFrame(frame: LiveKnowledgeFrame): string {
  const lines = [frame.headline];
  if (frame.checkedAt) lines.push(`Checked: ${frame.checkedAt}`);
  lines.push(`Sources consulted: ${frame.sourcesConsulted}`);
  lines.push(`Sources accepted: ${frame.sourcesAccepted}`);
  for (const c of frame.citations) {
    lines.push(`  [${c.sourceId}] ${c.title} — ${c.safeUrl} (tier ${c.trustTier}, ${c.connectorId}, ${c.contentHash})`);
  }
  for (const u of frame.unavailable) {
    lines.push(`  unavailable: ${u.connectorId} (${u.reason}) — ${u.detail}`);
  }
  return lines.join('\n');
}

/** Has this document passed its freshness window? */
export function isExpired(doc: LiveDocument, at: Date): boolean {
  if (!doc.expiresAt) return false;
  return new Date(doc.expiresAt).getTime() <= at.getTime();
}

export type { AcceptedSource };
