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
import type { ObservedFailureEvidence } from './modelProposals.js';
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

export interface CodingRunPayloadV1 {
  issueText: string;
  phase: CodingPhase;
  plan?: GovernedCodingPlanSnapshot;
  scope?: CodingScopeState;
  attempts: { initialProposal: number; repair: number };
  latestValidation?: ValidationRecord;
  failureEvidence?: ObservedFailureEvidence[];
  finalReport?: CodingRunReport;
}

export type CodingPayloadFault =
  | 'not-an-object'
  | 'missing-issue-text'
  | 'unknown-phase'
  | 'invalid-attempts'
  | 'invalid-scope'
  | 'invalid-plan';

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
export function parseCodingPayload(raw: unknown): CodingPayloadParse {
  if (!isRecord(raw)) return { ok: false, fault: 'not-an-object', detail: 'payload is not an object' };
  if (!isNonEmptyString(raw.issueText)) return { ok: false, fault: 'missing-issue-text', detail: 'issueText is absent or empty' };
  if (typeof raw.phase !== 'string' || !CODING_PHASES.includes(raw.phase as CodingPhase)) {
    return { ok: false, fault: 'unknown-phase', detail: `phase ${JSON.stringify(raw.phase)} is not a known coding phase` };
  }
  if (!isRecord(raw.attempts) || !isCount(raw.attempts.initialProposal) || !isCount(raw.attempts.repair)) {
    return { ok: false, fault: 'invalid-attempts', detail: 'attempts must carry non-negative integer counters' };
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
      ...(plan ? { plan } : {}),
      ...(scope ? { scope } : {}),
      ...(raw.latestValidation !== undefined ? { latestValidation: raw.latestValidation as ValidationRecord } : {}),
      ...(Array.isArray(raw.failureEvidence) ? { failureEvidence: raw.failureEvidence as ObservedFailureEvidence[] } : {}),
      ...(raw.finalReport !== undefined ? { finalReport: raw.finalReport as CodingRunReport } : {}),
    },
  };
}

/** A fresh payload for a run that has been accepted but not yet planned. */
export function initialCodingPayload(issueText: string): CodingRunPayloadV1 {
  return { issueText, phase: 'planning', attempts: { initialProposal: 0, repair: 0 } };
}
