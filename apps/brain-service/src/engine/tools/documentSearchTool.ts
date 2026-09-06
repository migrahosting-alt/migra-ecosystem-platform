/**
 * THE FIRST TOOL WIRED THROUGH THE FRAMEWORK — document search, read-only.
 *
 * Chosen because it exercises the whole path without mutation semantics
 * contaminating the result: real CapabilityRegistry state, `not_required`
 * connection, a real product authorization basis, mandatory preflight, no
 * consent path at all, a real retrieval backend, a typed result and provenance.
 *
 * It goes through the retrieval path the product already depends on —
 * `IndexService.retrieve` with `requireApproved`, resolved via
 * `approvedIndexFor` — so this doubles as an integration test of the
 * stale-index fix: a scope with two approved indexes must search the one that
 * actually holds the file.
 *
 * ---------------------------------------------------------------------------
 * 🚨 "NO DOCUMENTS MATCHED" IS A SUCCESS
 *
 * Flattening an empty result into a failure is the defect this file refuses to
 * ship with. They are different facts and lead to different words on screen:
 * `success_no_results` means the search ran and the answer is nothing;
 * `backend_failed` means we do not know what the answer is. A UI that renders
 * both as "search failed" teaches users to distrust a working feature, and a
 * UI that renders both as "no results" hides an outage.
 * ---------------------------------------------------------------------------
 */

import type { IndexService, Scope } from '../rag/indexService.js';
import { hashInput, type PreflightFact, type RoutedDecision } from './toolRouter.js';

export interface DocumentSearchInput {
  query: string;
  /** Upper bound on hits returned. Clamped during normalization. */
  limit?: number;
}

export interface DocumentHit {
  /** The file the passage came from, as the user knows it. */
  file: string;
  /** The passage itself. */
  excerpt: string;
  score: number;
}

/**
 * Five outcomes, kept distinct on purpose.
 *
 * `refused_policy` and `preflight_failed` are separated because one is "you may
 * not" and the other is "this request cannot work" — a user can act on the
 * second and often cannot on the first.
 */
export type DocumentSearchOutcome =
  | 'success_with_results'
  | 'success_no_results'
  | 'refused_policy'
  | 'preflight_failed'
  | 'backend_failed';

export interface ToolProvenanceRecord {
  decisionId: string;
  invocationId: string;
  capability: string;
  tool: string;
  authorizationBasis: string | null;
  connectionState: string;
  normalizedInputHash: string | null;
  preflightOutcome: string;
  backend: string;
  startedAt: string;
  completedAt: string;
  outcome: DocumentSearchOutcome;
  /** What the answer rests on. Empty for every non-success outcome. */
  evidenceRefs: string[];
  /**
   * ABSENT BY CONSTRUCTION for a read-only tool. Declared as `never` so a future
   * edit that tries to attach one to this path does not compile.
   */
  consentId?: never;
}

export interface DocumentSearchResult {
  outcome: DocumentSearchOutcome;
  hits: DocumentHit[];
  /** Present for every non-success outcome. A sentence a user can act on. */
  message?: string;
  provenance: ToolProvenanceRecord;
}

/** Clamp and tidy. The hash binds THIS, so it must be what actually runs. */
export function normalizeDocumentSearch(input: DocumentSearchInput): DocumentSearchInput {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 6), 1), 25);
  return { query: input.query.trim().replace(/\s+/g, ' '), limit };
}

/**
 * Side-effect free. Refuses what cannot work before anything is attempted.
 *
 * An empty query is not a search that returns nothing — it is a request that
 * cannot be answered, and saying so is more use than an empty list.
 */
export function preflightDocumentSearch(input: DocumentSearchInput): PreflightFact {
  if (input.query.length === 0) {
    return { state: 'failed', reason: 'Type something to search for.' };
  }
  if (input.query.length > 2000) {
    return { state: 'failed', reason: 'That search is too long. Try a shorter phrase.' };
  }
  return { state: 'passed' };
}

export interface DocumentSearchDeps {
  indexService: Pick<IndexService, 'approvedIndexFor' | 'retrieve'>;
  scope: Scope;
  now?: () => number;
  mkInvocationId?: () => string;
}

/**
 * Execute, having been routed.
 *
 * Takes the ROUTED DECISION rather than re-deciding: this function has no
 * authority of its own and must not acquire any. A non-executable decision
 * returns `refused_policy` carrying the decision's own words — it does not
 * second-guess why.
 */
export async function executeDocumentSearch(
  routed: RoutedDecision<DocumentSearchInput>,
  deps: DocumentSearchDeps,
): Promise<DocumentSearchResult> {
  const now = deps.now ?? (() => Date.now());
  const invocationId = (deps.mkInvocationId ?? (() => `inv_${Math.random().toString(36).slice(2, 12)}`))();
  const startedAt = new Date(now()).toISOString();

  const record = (
    outcome: DocumentSearchOutcome,
    evidenceRefs: string[] = [],
  ): ToolProvenanceRecord => ({
    decisionId: routed.decisionId,
    invocationId,
    capability: routed.decision.capability,
    tool: routed.decision.toolId,
    authorizationBasis: routed.authorizationState?.basis ?? null,
    connectionState: routed.connectionState.state,
    normalizedInputHash: routed.inputHash,
    preflightOutcome: routed.preflightState.state,
    backend: 'approved-index',
    startedAt,
    completedAt: new Date(now()).toISOString(),
    outcome,
    evidenceRefs,
  });

  if (!routed.decision.executable) {
    /*
     * The decision already said why, in words meant for a user. Restating it
     * here would be a second opinion from a layer with no authority to hold one.
     */
    const outcome: DocumentSearchOutcome =
      routed.decision.blockedAt === 'preflight:failed' || routed.decision.blockedAt === 'preflight:not-run'
        ? 'preflight_failed'
        : 'refused_policy';
    return {
      outcome,
      hits: [],
      message: routed.decision.reason ?? 'This search cannot run.',
      provenance: record(outcome),
    };
  }

  const input = routed.normalizedInput;
  if (!input) {
    // Executable with no normalized input is a routing fault, not a user error.
    return {
      outcome: 'backend_failed',
      hits: [],
      message: 'Search could not run. Please try again.',
      provenance: record('backend_failed'),
    };
  }

  const indexId = deps.indexService.approvedIndexFor(deps.scope);
  if (!indexId) {
    /*
     * No approved index is a legitimate empty state, not an outage: the user has
     * uploaded nothing, or nothing has been approved yet. Reporting it as a
     * backend failure would blame the system for an empty library.
     */
    return {
      outcome: 'success_no_results',
      hits: [],
      message: 'You have no approved documents to search yet.',
      provenance: record('success_no_results'),
    };
  }

  try {
    const res = await deps.indexService.retrieve(indexId, deps.scope, input.query, {
      requireApproved: true,
      maxChunks: input.limit ?? 6,
    });
    if (!res.ok) {
      return {
        outcome: 'backend_failed',
        hits: [],
        // The backend's code is for operators; the sentence is for the user.
        message: 'Document search is temporarily unavailable. Please try again shortly.',
        provenance: record('backend_failed'),
      };
    }
    const hits: DocumentHit[] = res.chunks.map((c) => ({
      file: c.filePath,
      excerpt: c.snippet,
      score: c.score,
    }));
    const outcome: DocumentSearchOutcome = hits.length > 0 ? 'success_with_results' : 'success_no_results';
    return {
      outcome,
      hits,
      ...(hits.length === 0 ? { message: 'No documents matched that search.' } : {}),
      provenance: record(outcome, hits.map((h) => h.file)),
    };
  } catch {
    return {
      outcome: 'backend_failed',
      hits: [],
      message: 'Document search is temporarily unavailable. Please try again shortly.',
      provenance: record('backend_failed'),
    };
  }
}

/** The resolvers this tool contributes to the router. Auth and registry are the caller's. */
export function documentSearchResolvers() {
  return {
    normalize: normalizeDocumentSearch,
    preflight: preflightDocumentSearch,
    /*
     * Read-only: the router never reaches this, and it throws rather than
     * returning a permissive default. If the consent path is ever entered for
     * this tool, that is a framework fault and must be loud.
     */
    consent: (): never => {
      throw new Error('documents.search is read-only; consent must never be sought for it');
    },
    connectionState: () => ({ state: 'not_required' as const }),
  };
}

export { hashInput };
