/**
 * MigraAI Engine — the durable domain payload for a governed coding run.
 *
 * The parent `agent_runs` row stays authoritative for GLOBAL lifecycle: run id,
 * revision, execution state, cancellation, terminality, restart recovery. This
 * payload answers a different question — where inside the coding workflow that run
 * had reached at that revision. The two must never be merged: an outer state that
 * knew about `repairing` would make every agent run carry coding vocabulary, and a
 * payload that claimed terminality would be a second answer to a question the
 * journal already answers.
 *
 * Everything here is opaque to the journal. It validates that the payload is
 * well-formed, redacted, versioned and within its size limit; it never interprets
 * a field below.
 *
 * PARSING IS STRICT AND NEVER REPAIRS. A payload that has to be guessed at is a
 * record nobody wrote — and this one carries the file scope an operator approved.
 * © MigraTeck LLC.
 */

import type { ClaimSource } from '../grounding/claimVerifier.js';
import type { ValidationRecord } from './validationRun.js';
import { boundRepairAttempt, REPAIR_HISTORY_LIMITS, type ObservedFailureEvidence, type PreviousRepairAttempt } from './modelProposals.js';
import type { CodingRunReport } from './codingRun.js';

/** Domain identity written to `agent_runs.domain_kind`.
 *
 * Deliberately NOT added to `AgentModeRecipeIdSchema`: that enum is the set of
 * SHELL COMMAND recipes Agent Mode may execute, and each member needs an argument
 * vector in `agentRecipe.ts`. A coding run is not a shell command, and admitting it
 * to that enum would let a coding run be proposed, previewed and executed as one. */
export const CODING_DOMAIN_KIND = 'coding.governed';
export const CODING_PAYLOAD_SCHEMA_VERSION = 1;

/** Where the coding workflow is. Explains the outer state; never replaces it. */
export type CodingPhase =
  | 'planning'
  | 'awaiting_scope_approval'
  | 'executing_initial_changeset'
  | 'validating'
  | 'repairing'
  | 'reconciling'
  | 'terminal';

export const CODING_PHASES: readonly CodingPhase[] = [
  'planning',
  'awaiting_scope_approval',
  'executing_initial_changeset',
  'validating',
  'repairing',
  'reconciling',
  'terminal',
];

/**
 * Consequential child operations, named explicitly.
 *
 * Not collapsed into a generic `coding_step`: the recovery question "was the apply
 * interrupted, or the validation?" has completely different answers, and a generic
 * kind would erase exactly the distinction restart reconciliation depends on.
 */
export type CodingChildKind =
  | 'repository_planning'
  | 'initial_model_proposal'
  | 'initial_apply'
  | 'validation'
  | 'repair_model_proposal'
  | 'repair_apply'
  | 'final_validation'
  | 'reconciliation';

export const CODING_CHILD_KINDS: readonly CodingChildKind[] = [
  'repository_planning',
  'initial_model_proposal',
  'initial_apply',
  'validation',
  'repair_model_proposal',
  'repair_apply',
  'final_validation',
  'reconciliation',
];

/** Child kinds that MUTATE the working tree. Restart must never replay one blindly. */
export const CODING_MUTATING_CHILD_KINDS: ReadonlySet<CodingChildKind> = new Set([
  'initial_apply',
  'repair_apply',
]);

export type ScopeApprovalState =
  | 'pending_display'
  | 'displayed'
  | 'approved'
  | 'expired'
  | 'invalidated'
  | 'consumed';

/** The plan as it was PROPOSED. A snapshot, never re-derived: an operator approves
 * what they were shown, so what they were shown has to survive verbatim. */
export interface GovernedCodingPlanSnapshot {
  issueSummary: string;
  proposedScope: Array<{ path: string; rationale: string; sources: ClaimSource[] }>;
  excludedCandidates: Array<{ path: string; reason: string }>;
  validationCommand: { command: string[]; cwd?: string; timeoutMs?: number };
}

export interface CodingScopeState {
  proposedPaths: string[];
  /** Binds an approval to an exact path set. Widening the set invalidates it. */
  pathSetHash: string;
  sourcesByPath: Record<string, ClaimSource[]>;
  /** Parent revision that produced this proposal — what an approval must match. */
  proposalRevision: number;
  proposedAt: string;
  approvalExpiresAt: string;
  approvalState: ScopeApprovalState;
  approvedAt?: string;
}

/** The parent's OWN record of a child it authorised. Deliberately duplicated
 * against the child row: with a reference in both directions, reconciliation can
 * tell "parent names a child that does not exist" (unrecoverable — the outcome is
 * unknowable) from "a child exists that no parent named" (an orphan, harmless if
 * it never left `created`). One direction alone cannot distinguish those. */
export interface CodingChildRef {
  childId: string;
  kind: CodingChildKind;
  attempt: number;
}

export interface CodingRunPayloadV1 {
  issueText: string;
  phase: CodingPhase;
  plan?: GovernedCodingPlanSnapshot;
  scope?: CodingScopeState;
  attempts: { initialProposal: number; repair: number };
  /** Only children whose reference write SUCCEEDED. An entry here is a promise
   * that the child row exists; recovery relies on that promise. */
  childRefs: CodingChildRef[];
  /** Children whose parent-reference write failed, so they were never dispatched. */
  abandonedChildIds?: string[];
  /** Parent-level cancellation. A request is not an outcome — `confirmedAt` is
   * written only once work is observed to have stopped. */
  cancellation?: { requestedAt: string; confirmedAt?: string };
  latestValidation?: ValidationRecord;
  failureEvidence?: ObservedFailureEvidence[];
  /**
   * What earlier repair attempts tried and what became of them.
   *
   * Durable because a restart must not hand the model a clean slate: the whole
   * point of the history is that an attempt already shown not to land is not tried
   * again, and a process that forgot would repeat exactly the strategy it had
   * already spent an attempt disproving. Bounded and summarised — never raw output.
   */
  repairHistory?: PreviousRepairAttempt[];
  finalReport?: CodingRunReport;
}

export type CodingPayloadFault =
  | 'not-an-object'
  | 'missing-issue-text'
  | 'unknown-phase'
  | 'invalid-attempts'
  | 'invalid-scope'
  | 'invalid-plan'
  | 'invalid-child-refs'
  | 'invalid-cancellation';

export type CodingPayloadParse =
  | { ok: true; payload: CodingRunPayloadV1 }
  | { ok: false; fault: CodingPayloadFault; detail: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function parseClaimSources(raw: unknown): ClaimSource[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ClaimSource[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) return undefined;
    const { path, startLine, endLine, excerptHash } = entry;
    if (!isNonEmptyString(path)) return undefined;
    if (typeof startLine !== 'number' || typeof endLine !== 'number') return undefined;
    if (!isNonEmptyString(excerptHash)) return undefined;
    out.push({ path, startLine, endLine, excerptHash });
  }
  return out;
}

/**
 * Validate an untrusted payload read back from the journal.
 *
 * Returns a typed fault rather than throwing, and rather than filling in defaults.
 * A run whose scope cannot be parsed must surface as unreadable — silently
 * defaulting `approvalState` would hand out write authority nobody granted.
 */
const REPAIR_OUTCOMES = new Set(['proposal_rejected', 'apply_refused', 'apply_failed', 'validation_failed', 'rolled_back']);

/** A history entry is trusted only if every field it will be rendered from is sound. */
function isRepairAttempt(raw: unknown): raw is PreviousRepairAttempt {
  if (!isRecord(raw)) return false;
  if (!isCount(raw.attempt)) return false;
  if (!isNonEmptyString(raw.rationale) || !isNonEmptyString(raw.proposalDigest)) return false;
  if (typeof raw.outcome !== 'string' || !REPAIR_OUTCOMES.has(raw.outcome)) return false;
  if (typeof raw.outcomeReason !== 'string') return false;
  if (!Array.isArray(raw.citedEvidenceIds) || !raw.citedEvidenceIds.every(isNonEmptyString)) return false;
  if (!Array.isArray(raw.proposedPaths) || !raw.proposedPaths.every(isNonEmptyString)) return false;
  if (raw.validationEvidenceIds !== undefined
    && (!Array.isArray(raw.validationEvidenceIds) || !raw.validationEvidenceIds.every(isNonEmptyString))) return false;
  return true;
}

/**
 * Copy ONLY the declared fields.
 *
 * Filtering with a type guard keeps the original object, so anything the writer
 * attached — a raw model reply, a transcript — rode along into durable storage and
 * back out into the next prompt. History is a summary by construction, and that is
 * only true if the parser makes it true.
 */
function projectRepairAttempt(raw: PreviousRepairAttempt): PreviousRepairAttempt {
  // Bounded on the way IN as well as on the way out: a payload written by an older
  // build, or by anything that skipped the writer's own bound, must not be able to
  // reintroduce unbounded text simply by being read back.
  return boundRepairAttempt({
    attempt: raw.attempt,
    citedEvidenceIds: [...raw.citedEvidenceIds],
    rationale: raw.rationale,
    proposedPaths: [...raw.proposedPaths],
    proposalDigest: raw.proposalDigest,
    outcome: raw.outcome,
    outcomeReason: raw.outcomeReason,
    ...(raw.validationEvidenceIds ? { validationEvidenceIds: [...raw.validationEvidenceIds] } : {}),
  });
}

export function parseCodingPayload(raw: unknown): CodingPayloadParse {
  if (!isRecord(raw)) return { ok: false, fault: 'not-an-object', detail: 'payload is not an object' };
  if (!isNonEmptyString(raw.issueText)) return { ok: false, fault: 'missing-issue-text', detail: 'issueText is absent or empty' };
  if (typeof raw.phase !== 'string' || !CODING_PHASES.includes(raw.phase as CodingPhase)) {
    return { ok: false, fault: 'unknown-phase', detail: `phase ${JSON.stringify(raw.phase)} is not a known coding phase` };
  }
  if (!isRecord(raw.attempts) || !isCount(raw.attempts.initialProposal) || !isCount(raw.attempts.repair)) {
    return { ok: false, fault: 'invalid-attempts', detail: 'attempts must carry non-negative integer counters' };
  }

  // Repair history is optional but STRICTLY shaped when present. A malformed entry
  // is dropped rather than failing the whole payload: history is an aid to model
  // competence, and losing one summary must never make a durable run unreadable.
  const repairHistory: PreviousRepairAttempt[] = Array.isArray(raw.repairHistory)
    ? (raw.repairHistory as unknown[]).filter(isRepairAttempt).map(projectRepairAttempt).slice(-REPAIR_HISTORY_LIMITS.maxAttempts)
    : [];

  // Child references are REQUIRED, even when empty. An absent list would be
  // indistinguishable from "this parent never authorised anything", which is
  // exactly the claim reconciliation must not be able to make by accident.
  if (!Array.isArray(raw.childRefs)) return { ok: false, fault: 'invalid-child-refs', detail: 'childRefs is absent' };
  const childRefs: CodingChildRef[] = [];
  const seenChildIds = new Set<string>();
  for (const entry of raw.childRefs) {
    if (!isRecord(entry) || !isNonEmptyString(entry.childId)) {
      return { ok: false, fault: 'invalid-child-refs', detail: 'a child reference is malformed' };
    }
    if (typeof entry.kind !== 'string' || !CODING_CHILD_KINDS.includes(entry.kind as CodingChildKind)) {
      return { ok: false, fault: 'invalid-child-refs', detail: `unknown child kind ${JSON.stringify(entry.kind)}` };
    }
    if (!isCount(entry.attempt) || entry.attempt < 1) {
      return { ok: false, fault: 'invalid-child-refs', detail: 'child attempt must be a positive integer' };
    }
    if (seenChildIds.has(entry.childId)) {
      return { ok: false, fault: 'invalid-child-refs', detail: `child ${entry.childId} is referenced twice` };
    }
    seenChildIds.add(entry.childId);
    childRefs.push({ childId: entry.childId, kind: entry.kind as CodingChildKind, attempt: entry.attempt });
  }

  let cancellation: CodingRunPayloadV1['cancellation'];
  if (raw.cancellation !== undefined) {
    const c = raw.cancellation;
    if (!isRecord(c) || !isNonEmptyString(c.requestedAt)) {
      return { ok: false, fault: 'invalid-cancellation', detail: 'cancellation.requestedAt is absent' };
    }
    if (c.confirmedAt !== undefined && !isNonEmptyString(c.confirmedAt)) {
      return { ok: false, fault: 'invalid-cancellation', detail: 'cancellation.confirmedAt is malformed' };
    }
    cancellation = { requestedAt: c.requestedAt, ...(isNonEmptyString(c.confirmedAt) ? { confirmedAt: c.confirmedAt } : {}) };
  }

  let scope: CodingScopeState | undefined;
  if (raw.scope !== undefined) {
    const s = raw.scope;
    if (!isRecord(s)) return { ok: false, fault: 'invalid-scope', detail: 'scope is not an object' };
    if (!Array.isArray(s.proposedPaths) || !s.proposedPaths.every(isNonEmptyString)) {
      return { ok: false, fault: 'invalid-scope', detail: 'scope.proposedPaths must be non-empty strings' };
    }
    if (!isNonEmptyString(s.pathSetHash)) return { ok: false, fault: 'invalid-scope', detail: 'scope.pathSetHash is absent' };
    if (typeof s.proposalRevision !== 'number' || !Number.isInteger(s.proposalRevision)) {
      return { ok: false, fault: 'invalid-scope', detail: 'scope.proposalRevision must be an integer' };
    }
    if (!isNonEmptyString(s.proposedAt) || !isNonEmptyString(s.approvalExpiresAt)) {
      return { ok: false, fault: 'invalid-scope', detail: 'scope timestamps are absent' };
    }
    const approvalStates: ScopeApprovalState[] = ['pending_display', 'displayed', 'approved', 'expired', 'invalidated', 'consumed'];
    if (typeof s.approvalState !== 'string' || !approvalStates.includes(s.approvalState as ScopeApprovalState)) {
      return { ok: false, fault: 'invalid-scope', detail: `unknown approvalState ${JSON.stringify(s.approvalState)}` };
    }
    if (!isRecord(s.sourcesByPath)) return { ok: false, fault: 'invalid-scope', detail: 'scope.sourcesByPath is not an object' };
    const sourcesByPath: Record<string, ClaimSource[]> = {};
    for (const [path, value] of Object.entries(s.sourcesByPath)) {
      const parsed = parseClaimSources(value);
      if (!parsed) return { ok: false, fault: 'invalid-scope', detail: `sourcesByPath[${path}] is not a claim-source list` };
      sourcesByPath[path] = parsed;
    }
    // Every approved path must carry the evidence that justified it. A path with no
    // source is a path nobody had grounds to propose.
    for (const path of s.proposedPaths as string[]) {
      if (!sourcesByPath[path]?.length) {
        return { ok: false, fault: 'invalid-scope', detail: `scoped path ${path} carries no evidence` };
      }
    }
    scope = {
      proposedPaths: [...(s.proposedPaths as string[])],
      pathSetHash: s.pathSetHash,
      sourcesByPath,
      proposalRevision: s.proposalRevision,
      proposedAt: s.proposedAt,
      approvalExpiresAt: s.approvalExpiresAt,
      approvalState: s.approvalState as ScopeApprovalState,
      ...(isNonEmptyString(s.approvedAt) ? { approvedAt: s.approvedAt } : {}),
    };
  }

  let plan: GovernedCodingPlanSnapshot | undefined;
  if (raw.plan !== undefined) {
    const p = raw.plan;
    if (!isRecord(p)) return { ok: false, fault: 'invalid-plan', detail: 'plan is not an object' };
    if (!isNonEmptyString(p.issueSummary)) return { ok: false, fault: 'invalid-plan', detail: 'plan.issueSummary is absent' };
    if (!Array.isArray(p.proposedScope)) return { ok: false, fault: 'invalid-plan', detail: 'plan.proposedScope is not a list' };
    const proposedScope: GovernedCodingPlanSnapshot['proposedScope'] = [];
    for (const entry of p.proposedScope) {
      if (!isRecord(entry) || !isNonEmptyString(entry.path) || !isNonEmptyString(entry.rationale)) {
        return { ok: false, fault: 'invalid-plan', detail: 'plan.proposedScope entry is malformed' };
      }
      const sources = parseClaimSources(entry.sources);
      if (!sources) return { ok: false, fault: 'invalid-plan', detail: `plan scope ${entry.path} has malformed sources` };
      proposedScope.push({ path: entry.path, rationale: entry.rationale, sources });
    }
    const excludedCandidates: GovernedCodingPlanSnapshot['excludedCandidates'] = [];
    for (const entry of Array.isArray(p.excludedCandidates) ? p.excludedCandidates : []) {
      if (!isRecord(entry) || !isNonEmptyString(entry.path) || typeof entry.reason !== 'string') {
        return { ok: false, fault: 'invalid-plan', detail: 'plan.excludedCandidates entry is malformed' };
      }
      excludedCandidates.push({ path: entry.path, reason: entry.reason });
    }
    const vc = p.validationCommand;
    if (!isRecord(vc) || !Array.isArray(vc.command) || !vc.command.every(isNonEmptyString) || vc.command.length === 0) {
      return { ok: false, fault: 'invalid-plan', detail: 'plan.validationCommand.command is absent or malformed' };
    }
    plan = {
      issueSummary: p.issueSummary,
      proposedScope,
      excludedCandidates,
      validationCommand: {
        command: [...(vc.command as string[])],
        ...(isNonEmptyString(vc.cwd) ? { cwd: vc.cwd } : {}),
        ...(typeof vc.timeoutMs === 'number' ? { timeoutMs: vc.timeoutMs } : {}),
      },
    };
  }

  return {
    ok: true,
    payload: {
      issueText: raw.issueText,
      phase: raw.phase as CodingPhase,
      attempts: { initialProposal: raw.attempts.initialProposal, repair: raw.attempts.repair },
      childRefs,
      ...(Array.isArray(raw.abandonedChildIds) && raw.abandonedChildIds.every(isNonEmptyString)
        ? { abandonedChildIds: [...(raw.abandonedChildIds as string[])] } : {}),
      ...(cancellation ? { cancellation } : {}),
      ...(plan ? { plan } : {}),
      ...(scope ? { scope } : {}),
      ...(raw.latestValidation !== undefined ? { latestValidation: raw.latestValidation as ValidationRecord } : {}),
      ...(Array.isArray(raw.failureEvidence) ? { failureEvidence: raw.failureEvidence as ObservedFailureEvidence[] } : {}),
      ...(repairHistory.length ? { repairHistory } : {}),
      ...(raw.finalReport !== undefined ? { finalReport: raw.finalReport as CodingRunReport } : {}),
    },
  };
}

/** A fresh payload for a run that has been accepted but not yet planned. */
export function initialCodingPayload(issueText: string): CodingRunPayloadV1 {
  return { issueText, phase: 'planning', attempts: { initialProposal: 0, repair: 0 }, childRefs: [] };
}
