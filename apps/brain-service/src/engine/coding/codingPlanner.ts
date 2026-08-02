/**
 * MigraAI Engine — planning a governed coding scope from repository evidence.
 *
 * This is where the three merged repository-understanding slices become write
 * authority. The planner ranks the map (content signals), opens a bounded evidence
 * set (bounded planning), and proposes a file scope in which every entry cites the
 * spans that justify it (claim-level grounding). Nothing it proposes can be
 * approved without that provenance, so the scope an operator sees is derived from
 * the repository rather than asserted about it.
 *
 * Two rules do most of the work:
 *
 *  1. A FILE THE PLANNER NEVER OPENED CANNOT ENTER THE SCOPE. The model may only
 *     choose among files whose content the run actually retrieved. Otherwise a
 *     plausible filename becomes write authority, which is the ranking failure
 *     already measured — with edit permission attached.
 *
 *  2. EVERY OPENED FILE IS ACCOUNTED FOR. A candidate that was read and then not
 *     proposed appears in `excludedCandidates` with a reason. Exclusions are
 *     COMPUTED from what was opened rather than taken from the model, so a file it
 *     examined and quietly dropped cannot disappear from the record — which is how
 *     the trap file is guaranteed to be explicitly excluded rather than merely
 *     absent.
 *
 * The validation command is NOT model-authored. It arrives from the task contract
 * and is passed through untouched; a model that could write its own test command
 * could, under pressure to finish, write one that passes.
 *
 * The planner NEVER mutates. It returns a proposal; approval and application are
 * separate steps by construction. © MigraTeck LLC.
 */

import type { ChangesetRequest } from '@migrapilot/protocol';
import { EvidenceLedger, normalizePath, type EvidenceSource } from '../grounding/evidenceLedger.js';
import type { ClaimSource } from '../grounding/claimVerifier.js';
import { buildRepoMap, type RepoMap } from '../planning/repoMap.js';
import { aboveRelevanceFloor, rankCandidates } from '../planning/candidateRanking.js';
import { isWorkspaceRelativeContained } from './editScope.js';
import type { DeclaredValidation } from './validationRun.js';

export type ProposedChangeset = ChangesetRequest;
export type GovernedCommand = DeclaredValidation;

export interface ScopeProposal {
  path: string;
  rationale: string;
  sources: ClaimSource[];
}

export interface ExcludedCandidate {
  path: string;
  reason: string;
  sources?: ClaimSource[];
}

export interface GovernedCodingPlan {
  issueSummary: string;
  proposedScope: ScopeProposal[];
  excludedCandidates: ExcludedCandidate[];
  initialChangeset: ProposedChangeset;
  validationCommand: GovernedCommand;
}

export type PlanRefusalReason =
  | 'no-candidates'
  | 'insufficient-evidence'
  | 'malformed-model-output'
  | 'unsupported-path'
  | 'scope-too-large'
  | 'changeset-outside-scope'
  | 'empty-changeset'
  | 'map-unavailable';

export interface PlanRefused {
  ok: false;
  reason: PlanRefusalReason;
  message: string;
  /** What WAS retrieved, so a refusal is diagnosable rather than merely negative. */
  openedPaths: string[];
}

export type PlanResult = { ok: true; plan: GovernedCodingPlan; ledger: EvidenceLedger } | PlanRefused;

/** Ceilings for planning. Separate from the execution budget it will later spend. */
export interface PlanningLimits {
  /** Ranked candidates whose content may be opened as planning evidence. */
  maxCandidatesOpened: number;
  /** Files the proposed scope may contain. */
  maxScopeFiles: number;
  /** Lines opened per candidate. */
  spanLines: number;
  /** Minimum candidates that must yield real content before planning may proceed. */
  minEvidenceFiles: number;
}

export const DEFAULT_PLANNING_LIMITS: PlanningLimits = {
  maxCandidatesOpened: 8,
  maxScopeFiles: 6,
  spanLines: 400,
  minEvidenceFiles: 2,
};

/** What the model is given. Contains evidence, never the answer. */
export interface PlannerModelInput {
  issue: string;
  /** Exact retrieved spans, with real line numbers. */
  evidence: Array<{ path: string; startLine: number; endLine: number; text: string }>;
  /** The only paths the model may propose. */
  candidatePaths: string[];
  maxScopeFiles: number;
}

/** Raw, unvalidated model output. Validated before it becomes a plan. */
export type PlannerModel = (input: PlannerModelInput) => Promise<unknown>;

interface RawPlan {
  issueSummary: unknown;
  scope: unknown;
  excluded: unknown;
  edits: unknown;
}

/**
 * Validate model output into a shape the rest of the system can trust.
 *
 * Returns `null` rather than throwing, and never repairs: a plan that has to be
 * guessed at is a plan nobody wrote, and silently fixing a malformed scope would
 * mean approving paths the model did not actually choose.
 */
export function parsePlannerOutput(raw: unknown): {
  issueSummary: string;
  scope: Array<{ path: string; rationale: string }>;
  excluded: Array<{ path: string; reason: string }>;
  edits: Array<{ path: string; content: string }>;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as RawPlan;
  if (typeof r.issueSummary !== 'string' || !r.issueSummary.trim()) return null;
  if (!Array.isArray(r.scope) || r.scope.length === 0) return null;
  if (!Array.isArray(r.edits) || r.edits.length === 0) return null;
  if (r.excluded !== undefined && !Array.isArray(r.excluded)) return null;

  const scope: Array<{ path: string; rationale: string }> = [];
  for (const entry of r.scope) {
    const e = entry as { path?: unknown; rationale?: unknown };
    if (typeof e.path !== 'string' || !e.path.trim()) return null;
    if (typeof e.rationale !== 'string' || !e.rationale.trim()) return null;
    // Refused, not normalised. Rewriting an absolute or escaping path into a
    // plausible relative one would weaken the promise that malformed output is
    // never repaired, and would make the audit trail describe a path the model
    // did not actually propose.
    if (!isWorkspaceRelativeContained(e.path)) return null;
    scope.push({ path: normalizePath(e.path), rationale: e.rationale.trim() });
  }
  const edits: Array<{ path: string; content: string }> = [];
  for (const entry of r.edits) {
    const e = entry as { path?: unknown; content?: unknown };
    if (typeof e.path !== 'string' || !e.path.trim()) return null;
    if (typeof e.content !== 'string') return null;
    if (!isWorkspaceRelativeContained(e.path)) return null;
    edits.push({ path: normalizePath(e.path), content: e.content });
  }
  const excluded: Array<{ path: string; reason: string }> = [];
  for (const entry of (r.excluded as unknown[]) ?? []) {
    const e = entry as { path?: unknown; reason?: unknown };
    if (typeof e.path !== 'string' || typeof e.reason !== 'string') return null;
    if (!isWorkspaceRelativeContained(e.path)) return null;
    excluded.push({ path: normalizePath(e.path), reason: e.reason.trim() });
  }
  return { issueSummary: r.issueSummary.trim(), scope, excluded, edits };
}

export interface PlanCodingTaskOptions {
  issue: string;
  rootPath: string;
  /** Declared by the task contract. Never model-authored. */
  validationCommand: GovernedCommand;
  model: PlannerModel;
  limits?: Partial<PlanningLimits>;
  openSpan: (relPath: string, startLine: number, endLine: number) => EvidenceSource;
  /** Injected for tests; defaults to the real map builder. */
  buildMap?: (rootPath: string) => Promise<RepoMap>;
}

/** Plan a governed coding change. Never mutates; returns a proposal or a refusal. */
export async function planCodingTask(opts: PlanCodingTaskOptions): Promise<PlanResult> {
  const limits = { ...DEFAULT_PLANNING_LIMITS, ...(opts.limits ?? {}) };
  const ledger = new EvidenceLedger();
  const refuse = (reason: PlanRefusalReason, message: string): PlanRefused => ({ ok: false, reason, message, openedPaths: ledger.readPaths });

  const map = await (opts.buildMap ? opts.buildMap(opts.rootPath) : buildRepoMap(opts.rootPath));
  if (map.unavailable) return refuse('map-unavailable', `No repository map could be built: ${map.unavailable}`);

  // ── Rank, then open a bounded evidence set ──────────────────────────────────
  const ranked = aboveRelevanceFloor(rankCandidates(map, opts.issue, { limit: limits.maxCandidatesOpened * 4 }));
  if (!ranked.length) return refuse('no-candidates', 'The issue text matched no file in this repository.');

  for (const candidate of ranked.slice(0, limits.maxCandidatesOpened)) {
    const end = Math.min(limits.spanLines, candidate.entry.lineCount || limits.spanLines);
    try {
      await ledger.request(candidate.entry.path, 1, end, opts.openSpan(candidate.entry.path, 1, end));
    } catch {
      /* an unreadable candidate is simply not evidence */
    }
  }
  const openedPaths = ledger.readPaths;
  if (openedPaths.length < limits.minEvidenceFiles) {
    return refuse('insufficient-evidence', `Only ${openedPaths.length} file(s) could be retrieved; at least ${limits.minEvidenceFiles} are required to plan a change.`);
  }

  // ── Ask the model to choose among what was actually retrieved ───────────────
  const evidence = ledger.spans.map((s) => ({ path: s.path, startLine: s.startLine, endLine: s.endLine, text: s.text }));
  const raw = await opts.model({ issue: opts.issue, evidence, candidatePaths: openedPaths, maxScopeFiles: limits.maxScopeFiles });
  const parsed = parsePlannerOutput(raw);
  if (!parsed) return refuse('malformed-model-output', 'The planner output did not match the required shape and was not repaired.');

  if (parsed.scope.length > limits.maxScopeFiles) {
    return refuse('scope-too-large', `The proposed scope names ${parsed.scope.length} files; the limit is ${limits.maxScopeFiles}.`);
  }

  // ── Every scoped path must be a file this run RETRIEVED ─────────────────────
  const sourcesFor = (path: string): ClaimSource[] =>
    ledger.spansFor(path).map((s) => ({ path: s.path, startLine: s.startLine, endLine: s.endLine, excerptHash: s.excerptHash }));

  const proposedScope: ScopeProposal[] = [];
  for (const entry of parsed.scope) {
    const sources = sourcesFor(entry.path);
    if (!sources.length) {
      return refuse('unsupported-path', `The plan proposes editing ${entry.path}, which this run never retrieved. A file nobody read is not a file anybody has grounds to change.`);
    }
    proposedScope.push({ path: entry.path, rationale: entry.rationale, sources });
  }

  // ── Account for EVERY opened file. Computed, not taken from the model. ──────
  const scopedPaths = new Set(proposedScope.map((s) => s.path));
  const modelReasons = new Map(parsed.excluded.map((e) => [e.path, e.reason]));
  const excludedCandidates: ExcludedCandidate[] = openedPaths
    .filter((p) => !scopedPaths.has(p))
    .map((path) => ({
      path,
      reason: modelReasons.get(path) ?? 'retrieved as evidence but not proposed for change',
      sources: sourcesFor(path),
    }));

  // ── The initial changeset may only touch proposed-scope paths ───────────────
  if (!parsed.edits.length) return refuse('empty-changeset', 'The plan produced no edits.');
  const strayEdits = parsed.edits.filter((e) => !scopedPaths.has(e.path));
  if (strayEdits.length) {
    return refuse('changeset-outside-scope', `The initial changeset edits ${strayEdits.map((e) => e.path).join(', ')}, which the plan did not propose for approval.`);
  }

  return {
    ok: true,
    ledger,
    plan: {
      issueSummary: parsed.issueSummary,
      proposedScope,
      excludedCandidates,
      initialChangeset: {
        rootPath: opts.rootPath,
        ops: parsed.edits.map((e) => ({ op: 'replace' as const, path: e.path, content: e.content })),
      },
      // Passed through from the task contract, verbatim. The model never sees it
      // and could not influence it if it did.
      validationCommand: { ...opts.validationCommand, command: [...opts.validationCommand.command] },
    },
  };
}
