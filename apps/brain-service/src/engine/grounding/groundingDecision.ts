/**
 * MigraAI Engine — the ONE grounding boundary.
 *
 * Every path that answers a repository question must decide, explicitly and in one
 * place, WHERE its evidence came from. Two paths previously decided independently
 * and neither said so:
 *
 *  - `/api/ai/chat` retrieved from the approved index, then — when that returned
 *    nothing — SILENTLY replaced it with working-tree lexical chunks carrying the
 *    same "cite these" instruction.
 *  - the engineer route never consulted the approved index at all: it seeded the
 *    loop from a lexical retriever over the live checkout. Asked about code that
 *    existed only on an unmerged branch, it cited three `package.json` files and a
 *    `PROVENANCE.md` — high lexical scores, zero relevance — and answered as if
 *    those were approved evidence.
 *
 * So "approved index" was never a boundary; it was a preference. This module makes
 * it a decision with a name, and refusal a first-class outcome.
 *
 * PURE: no fetch, no fs, no vscode. The index and branch lookups are injected, so
 * every policy branch is unit-testable without a running Brain.
 */

/**
 * Default relevance floor for approved chunks — CALIBRATED, not guessed.
 *
 * Measured against the live approved index (36,428 chunks) with five questions whose
 * answers are in that generation and four that are not:
 *
 *   present  0.587  0.623  0.650  0.680  0.691
 *   absent   0.364  0.415  0.466  0.470
 *
 * The classes separate cleanly in `(0.470, 0.587]`; 0.53 sits near the midpoint with
 * ~0.06 margin either side. The failing historical question — "schema v6
 * approved_version pointer index_version isolation", answerable only on a branch the
 * approved index predates — peaks at 0.466 and is therefore refused.
 *
 * NOT comparable to the lexical seeder's 0.8 "definition-grade" bar: that is a
 * different retriever on a different scale. Re-calibrate if the embedding model
 * changes, since scores are model-specific.
 */
export const DEFAULT_MIN_APPROVED_SCORE = 0.53;

/** A chunk offered as evidence. `path` is WORKSPACE-RELATIVE — never absolute. */
export interface GroundingChunk {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
}

/** Why approved evidence could not be used. */
export type GroundingRefusal =
  | 'no-approved-index'
  | 'insufficient-relevance'
  | 'branch-diverged'
  | 'retrieval-failed';

export type GroundingDecision =
  | {
      mode: 'approved-index';
      allowed: true;
      indexId: string;
      indexVersion: number;
      indexedBranch?: string;
      currentBranch?: string;
      /** The approved index was built from a different branch than the checkout. */
      branchDiverged: boolean;
      chunks: GroundingChunk[];
    }
  | {
      mode: 'approved-index';
      allowed: false;
      reason: GroundingRefusal;
      indexedBranch?: string;
      currentBranch?: string;
      /** Highest score seen, when the refusal was a relevance decision. */
      bestScore?: number;
    }
  | {
      mode: 'working-tree';
      allowed: true;
      /** ALWAYS true: unapproved evidence may never be presented unlabelled. */
      disclosureRequired: true;
      currentBranch?: string;
      indexedBranch?: string;
      branchDiverged: boolean;
    };

export interface GroundingRequest {
  /**
   * Set by the CALLER from an explicit request field — never inferred from the
   * prompt text. Sniffing prose for "only the approved index" would make the
   * governance boundary depend on phrasing.
   */
  requireApproved: boolean;
  query: string;
  /** Branch of the working tree, when the caller knows it. */
  currentBranch?: string;
}

export interface GroundingDeps {
  /** Approved index id for this workspace, or undefined when none is approved. */
  approvedIndexId(): string | undefined;
  /** Retrieve from the approved index. Throws on provider/index failure. */
  retrieveApproved(indexId: string, query: string): Promise<GroundingChunk[]>;
  /** Version + indexed branch of an index, for disclosure. */
  indexIdentity(indexId: string): { version: number; indexedBranch?: string } | undefined;
  /**
   * Minimum score an approved chunk needs to count as evidence.
   *
   * Injected rather than baked in: approved retrieval returns hybrid similarity
   * scores, which are NOT on the same scale as the lexical seeder's 0.8
   * "definition-grade" bar. Calibrated per deployment.
   */
  minScore: number;
  /**
   * Refuse outright when the approved index was built from another branch, instead
   * of answering with disclosure. Off by default: the reviewed evidence is still
   * the best available, and hiding it behind a refusal would push callers back to
   * the unapproved checkout — the exact failure this module exists to stop.
   */
  refuseOnBranchDivergence?: boolean;
}

/**
 * Decide where this turn's evidence comes from.
 *
 * `requireApproved` requests fail CLOSED: no approved index, a retrieval failure,
 * or nothing clearing {@link GroundingDeps.minScore} all refuse. They never fall
 * back to the working tree, because a caller that asked for approved-only evidence
 * would otherwise receive unapproved evidence under an approved-sounding answer.
 *
 * Ordinary requests keep today's behaviour — approved evidence when it is good
 * enough, working tree otherwise — except that working-tree mode is now LABELLED.
 */
export async function decideGrounding(req: GroundingRequest, deps: GroundingDeps): Promise<GroundingDecision> {
  const indexId = deps.approvedIndexId();
  const identity = indexId ? deps.indexIdentity(indexId) : undefined;
  const indexedBranch = identity?.indexedBranch;
  const branchDiverged = Boolean(indexedBranch && req.currentBranch && indexedBranch !== req.currentBranch);

  if (!indexId || !identity) {
    return req.requireApproved
      ? { mode: 'approved-index', allowed: false, reason: 'no-approved-index', currentBranch: req.currentBranch }
      : { mode: 'working-tree', allowed: true, disclosureRequired: true, currentBranch: req.currentBranch, branchDiverged: false };
  }

  if (branchDiverged && deps.refuseOnBranchDivergence) {
    return { mode: 'approved-index', allowed: false, reason: 'branch-diverged', indexedBranch, currentBranch: req.currentBranch };
  }

  let chunks: GroundingChunk[];
  try {
    chunks = await deps.retrieveApproved(indexId, req.query);
  } catch {
    // A retrieval failure is NOT a licence to answer from the checkout.
    return req.requireApproved
      ? { mode: 'approved-index', allowed: false, reason: 'retrieval-failed', indexedBranch, currentBranch: req.currentBranch }
      : { mode: 'working-tree', allowed: true, disclosureRequired: true, currentBranch: req.currentBranch, indexedBranch, branchDiverged };
  }

  const relevant = chunks.filter((c) => c.score >= deps.minScore);
  if (relevant.length === 0) {
    const bestScore = chunks.length ? Math.max(...chunks.map((c) => c.score)) : undefined;
    if (req.requireApproved) {
      return {
        mode: 'approved-index',
        allowed: false,
        reason: 'insufficient-relevance',
        indexedBranch,
        currentBranch: req.currentBranch,
        ...(bestScore !== undefined ? { bestScore } : {}),
      };
    }
    return { mode: 'working-tree', allowed: true, disclosureRequired: true, currentBranch: req.currentBranch, indexedBranch, branchDiverged };
  }

  return {
    mode: 'approved-index',
    allowed: true,
    indexId,
    indexVersion: identity.version,
    indexedBranch,
    currentBranch: req.currentBranch,
    branchDiverged,
    chunks: relevant,
  };
}

/**
 * Metadata-only audit payload for a grounding decision.
 *
 * Deliberately carries NO prompt, completion, chunk text, diff or absolute path —
 * the operational store is metadata-only by contract. Chunk references are
 * workspace-relative `path:start-end`, which the redactor passes through unchanged
 * while still stripping any absolute path that slips in.
 */
export function groundingAuditFields(decision: GroundingDecision, requireApproved: boolean, minScore: number): Record<string, unknown> {
  const base = {
    sourceMode: decision.mode,
    requireApproved,
    allowed: decision.allowed,
    minScore,
    currentBranch: decision.currentBranch,
  };
  if (decision.mode === 'working-tree') {
    return { ...base, gateDecision: 'working-tree-disclosed', indexedBranch: decision.indexedBranch, branchDiverged: decision.branchDiverged };
  }
  if (!decision.allowed) {
    return { ...base, gateDecision: 'refused', refusalReason: decision.reason, indexedBranch: decision.indexedBranch, bestScore: round(decision.bestScore) };
  }
  return {
    ...base,
    gateDecision: 'approved-evidence',
    indexId: decision.indexId,
    indexVersion: decision.indexVersion,
    indexedBranch: decision.indexedBranch,
    branchDiverged: decision.branchDiverged,
    chunkCount: decision.chunks.length,
    // References only — never the snippet.
    chunkRefs: decision.chunks.map((c) => `${c.path}:${c.startLine}-${c.endLine}`),
    scores: decision.chunks.map((c) => round(c.score)),
  };
}

function round(n?: number): number | undefined {
  return n === undefined ? undefined : Math.round(n * 1000) / 1000;
}

/** Operator-facing refusal text. States what was searched and what to do next. */
export function refusalMessage(decision: Extract<GroundingDecision, { allowed: false }>): string {
  const where = decision.indexedBranch ? `The approved index was built from \`${decision.indexedBranch}\`` : 'No index is approved for this workspace';
  const here = decision.currentBranch ? `, while the current checkout is \`${decision.currentBranch}\`` : '';
  switch (decision.reason) {
    case 'no-approved-index':
      return `I have no approved semantic index for this workspace, so I cannot answer from approved evidence. Sync and approve an index first, or ask again without requiring approved-only evidence.`;
    case 'insufficient-relevance':
      return `I could not find relevant evidence in the approved semantic index. ${where}${here}. If the code you are asking about is not in that approved generation, sync and approve the current branch before asking for those implementation details.`;
    case 'branch-diverged':
      return `${where}${here}, so approved evidence cannot answer questions about the current checkout. Sync and approve this branch first.`;
    case 'retrieval-failed':
      return `Retrieval from the approved semantic index failed, so I have no approved evidence to answer from. I will not substitute unapproved working-tree content.`;
  }
}
