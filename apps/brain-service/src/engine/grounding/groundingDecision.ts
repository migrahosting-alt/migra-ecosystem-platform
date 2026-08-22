import {
  groundingMayUseApprovedIndex as mayUseApprovedIndex,
  type GroundingMode,
} from '@migrapilot/protocol';
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

// The mode union lives in `@migrapilot/protocol` so the extension and the Brain
// cannot drift: two independent unions that happen to match today would let the UI
// offer a mode the Brain never enforces. Re-exported here for existing importers.
export {
  GROUNDING_MODES,
  groundingMayUseApprovedIndex as mayUseApprovedIndex,
  groundingModeFrom,
  groundingWithholdsTools as withholdsWorkspaceTools,
  isGroundingMode,
  parseGroundingMode,
  type GroundingMode,
} from '@migrapilot/protocol';

/** Legacy boolean → mode. `requireApproved` predates the mode contract. */
export function modeFromLegacy(requireApproved: boolean | undefined): GroundingMode {
  return requireApproved ? 'approved' : 'auto';
}

/** Why approved evidence could not be used. */
export type GroundingRefusal =
  | 'no-approved-index'
  | 'insufficient-relevance'
  | 'branch-diverged'
  | 'retrieval-failed';

export type GroundingDecision =
  | {
      /** What was ASKED for — kept alongside the effective mode so a degradation
       * from `auto` to the working tree is always visible, never silent. */
      requested: GroundingMode;
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
      requested: GroundingMode;
      mode: 'approved-index';
      allowed: false;
      reason: GroundingRefusal;
      indexedBranch?: string;
      currentBranch?: string;
      /**
       * The approved generation that WAS searched, when one exists. Present on a
       * relevance/divergence refusal so the disclosure can say which generation
       * came up short rather than leaving the operator guessing.
       */
      indexVersion?: number;
      /** Highest score seen, when the refusal was a relevance decision. */
      bestScore?: number;
    }
  | {
      requested: GroundingMode;
      mode: 'working-tree';
      allowed: true;
      /** ALWAYS true: unapproved evidence may never be presented unlabelled. */
      disclosureRequired: true;
      /** `true` when `workspace` was requested outright, `false` when `auto` fell
       * back here. The distinction is the whole point of recording both. */
      forced: boolean;
      currentBranch?: string;
      indexedBranch?: string;
      branchDiverged: boolean;
    }
  | {
      requested: GroundingMode;
      mode: 'none';
      allowed: true;
      /** No repository evidence of any kind was gathered, and the answer must say so. */
      disclosureRequired: true;
      currentBranch?: string;
    };

export interface GroundingRequest {
  /**
   * Set by the CALLER from an explicit request field — never inferred from the
   * prompt text. Sniffing prose for "only the approved index" would make the
   * governance boundary depend on phrasing.
   */
  mode: GroundingMode;
  query: string;
  /**
   * The caller EXPLICITLY named these files for this turn.
   *
   * 🚨 THIS REPLACES THE RELEVANCE FLOOR, and the reason is architectural rather than
   * convenience: once the user has attached or selected the files for a conversation,
   * relevance selection has already happened at the USER-INTENT layer. The floor exists to
   * stop unrelated documents surfacing from a global pool; applying it again inside an
   * explicit scope is a second gate built for a different problem, and it overrides the
   * user's own selection.
   *
   * Measured on production: a conversation grounded in two attached files answered "your
   * indexed documents do not cover that" for a value sitting in one of them, because the
   * chunk scored under 0.53. Naming the file in the question lifted the lexical score over
   * the bar and the same content answered — the floor was refusing to READ a file the user
   * had explicitly attached.
   *
   * Scoring still runs: it decides WHICH PARTS of the selected documents are shown first
   * and what fits the budget. It no longer decides whether the system is willing to look
   * at them at all.
   */
  scopedFiles?: readonly string[];
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
 * `approved` fails CLOSED: no approved index or a retrieval failure refuses, as does
 * nothing clearing {@link GroundingDeps.minScore} — EXCEPT when the caller supplied
 * {@link GroundingRequest.scopedFiles}, where the user's own selection is the relevance
 * decision and the floor does not apply. It never falls back to the
 * working tree, because a caller that asked for approved-only evidence would
 * otherwise receive unapproved evidence under an approved-sounding answer.
 *
 * `workspace` and `none` short-circuit BEFORE any approved lookup, so neither can
 * quietly become the other. `auto` keeps today's behaviour — approved evidence when
 * it is good enough, the working tree otherwise — but the fallback is recorded as a
 * fallback (`forced: false`) rather than presented as a choice.
 */
export async function decideGrounding(req: GroundingRequest, deps: GroundingDeps): Promise<GroundingDecision> {
  const requested = req.mode;

  // `none`: no repository evidence of ANY kind. Decided before any lookup, so the
  // approved index is not even touched — a mode that quietly retrieved "just to
  // check" would not be the mode it claims to be.
  if (requested === 'none') {
    return { requested, mode: 'none', allowed: true, disclosureRequired: true, currentBranch: req.currentBranch };
  }

  const indexId = mayUseApprovedIndex(requested) ? deps.approvedIndexId() : undefined;
  const identity = indexId ? deps.indexIdentity(indexId) : undefined;
  // In `workspace` mode the indexed branch is still reported for context, but it is
  // NOT consulted for evidence.
  const contextIndex = requested === 'workspace' ? deps.approvedIndexId() : indexId;
  const contextIdentity = contextIndex ? deps.indexIdentity(contextIndex) : undefined;
  const indexedBranch = (identity ?? contextIdentity)?.indexedBranch;
  const branchDiverged = Boolean(indexedBranch && req.currentBranch && indexedBranch !== req.currentBranch);

  // `workspace`: FORCED to the checkout. Never falls through to approved evidence
  // even when an approved index exists and would have cleared the floor — that is
  // the difference between this mode and `auto`.
  if (requested === 'workspace') {
    return {
      requested,
      mode: 'working-tree',
      allowed: true,
      disclosureRequired: true,
      forced: true,
      currentBranch: req.currentBranch,
      indexedBranch,
      branchDiverged,
    };
  }

  /** `auto` degrading to the checkout — always labelled as a fallback, not a choice. */
  const fellBack = (): GroundingDecision => ({
    requested,
    mode: 'working-tree',
    allowed: true,
    disclosureRequired: true,
    forced: false,
    currentBranch: req.currentBranch,
    indexedBranch,
    branchDiverged,
  });

  if (!indexId || !identity) {
    return requested === 'approved'
      ? { requested, mode: 'approved-index', allowed: false, reason: 'no-approved-index', currentBranch: req.currentBranch }
      : fellBack();
  }

  if (branchDiverged && deps.refuseOnBranchDivergence) {
    return { requested, mode: 'approved-index', allowed: false, reason: 'branch-diverged', indexedBranch, currentBranch: req.currentBranch, indexVersion: identity.version };
  }

  let chunks: GroundingChunk[];
  try {
    chunks = await deps.retrieveApproved(indexId, req.query);
  } catch {
    // A retrieval failure is NOT a licence to answer from the checkout.
    return requested === 'approved'
      ? { requested, mode: 'approved-index', allowed: false, reason: 'retrieval-failed', indexedBranch, currentBranch: req.currentBranch, indexVersion: identity.version }
      : fellBack();
  }

  /*
   * An explicit scope replaces the floor; it does not lower it to another number.
   *
   * A "scoped threshold" would be a second magic constant needing its own experimental
   * justification, when the product semantics already give a clean boundary: the user
   * either named the documents or did not. Ranking above has already ordered these chunks
   * and the caller's maxChunks/tokenBudget still bound them, so dropping the floor changes
   * WHICH evidence is admitted, never HOW MUCH.
   */
  const scoped = (req.scopedFiles?.length ?? 0) > 0;
  const relevant = scoped ? chunks : chunks.filter((c) => c.score >= deps.minScore);
  if (relevant.length === 0) {
    const bestScore = chunks.length ? Math.max(...chunks.map((c) => c.score)) : undefined;
    if (requested === 'approved') {
      return {
        requested,
        mode: 'approved-index',
        allowed: false,
        reason: 'insufficient-relevance',
        indexedBranch,
        currentBranch: req.currentBranch,
        indexVersion: identity.version,
        ...(bestScore !== undefined ? { bestScore } : {}),
      };
    }
    return fellBack();
  }

  return {
    requested,
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
export function groundingAuditFields(decision: GroundingDecision, minScore: number): Record<string, unknown> {
  const base = {
    // BOTH modes are recorded. `requestedMode` alone cannot show a degradation and
    // `sourceMode` alone cannot show what was asked for; only the pair proves that
    // no mode silently became another.
    requestedMode: decision.requested,
    sourceMode: decision.mode,
    allowed: decision.allowed,
    minScore,
    currentBranch: decision.currentBranch,
  };
  if (decision.mode === 'none') {
    return { ...base, gateDecision: 'no-repository-evidence' };
  }
  if (decision.mode === 'working-tree') {
    return {
      ...base,
      gateDecision: decision.forced ? 'working-tree-forced' : 'working-tree-fallback',
      forced: decision.forced,
      indexedBranch: decision.indexedBranch,
      branchDiverged: decision.branchDiverged,
    };
  }
  if (!decision.allowed) {
    return { ...base, gateDecision: 'refused', refusalReason: decision.reason, indexedBranch: decision.indexedBranch, indexVersion: decision.indexVersion, bestScore: round(decision.bestScore) };
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
