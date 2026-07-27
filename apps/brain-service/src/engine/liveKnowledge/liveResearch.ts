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
  permitsExternalLookup,
  DEFAULT_RESEARCH_BUDGET,
  type AcceptedSource,
  type LiveKnowledgeConnector,
  type LiveKnowledgeDecision,
  type LiveKnowledgeMode,
  type LiveResearchBudget,
} from './liveKnowledgeDecision.js';
import { fetchLiveDocument, LiveFetchAborted, LiveFetchRejected, LiveFetchTimeout, type LiveFetchDeps } from './liveFetch.js';
import type { LiveDocument } from '@migrapilot/protocol';

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

export class LiveConnectorRegistry {
  private readonly entries: RegisteredConnector[] = [];

  register(connector: LiveKnowledgeConnector, serves: readonly LiveKnowledgeMode[]): this {
    // `off` means "no lookup", so a connector claiming to serve it would be a
    // contradiction that could only ever be honoured by ignoring it.
    if (serves.includes('off')) throw new Error('a connector cannot serve the off mode');
    this.entries.push({ connector, serves });
    return this;
  }

  /** The connector for this mode, or undefined when none is registered for it. */
  select(mode: LiveKnowledgeMode): LiveKnowledgeConnector | undefined {
    if (!permitsExternalLookup(mode)) return undefined; // off never selects one
    return this.entries.find((e) => e.serves.includes(mode))?.connector;
  }

  ids(): string[] {
    return this.entries.map((e) => e.connector.id);
  }
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
  const selected = deps.registry.select(mode);
  // Wrapped even for a single search, so the cap does not depend on this function
  // remaining single-search forever.
  const connector = selected ? withSearchBudget(selected, budget.maxSearches) : undefined;
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

  if (accepted.length === 0) {
    return { decision, documents: [], rejections: {} };
  }

  const rejections: Record<string, number> = {};
  const perDomain = new Map<string, number>();
  const documents: LiveDocument[] = [];

  for (const source of accepted) {
    if (documents.length >= budget.maxDocuments) break;
    if (signal?.aborted) {
      return {
        decision: { ...decision, gateDecision: 'live-research-failed', sourcesAccepted: documents.length, failureCategory: 'cancelled' },
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
      const doc = await fetchLiveDocument(source.result, { ...deps.fetch, budget }, signal);
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
          decision: { ...decision, gateDecision: 'live-research-failed', sourcesAccepted: documents.length, failureCategory: 'cancelled' },
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
      decision: {
        ...decision,
        gateDecision: mode === 'official' ? 'official-sources-insufficient' : 'web-research-insufficient',
        sourcesAccepted: 0,
        failureCategory: 'all-sources-rejected',
      },
      documents,
      rejections,
    };
  }

  const trustTierCounts = documents.reduce<Record<number, number>>((acc, d) => {
    acc[d.source.trustTier] = (acc[d.source.trustTier] ?? 0) + 1;
    return acc;
  }, {});

  return {
    decision: { ...decision, sourcesAccepted: documents.length, trustTierCounts },
    documents,
    rejections,
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

/** Has this document passed its freshness window? */
export function isExpired(doc: LiveDocument, at: Date): boolean {
  if (!doc.expiresAt) return false;
  return new Date(doc.expiresAt).getTime() <= at.getTime();
}

export type { AcceptedSource };
