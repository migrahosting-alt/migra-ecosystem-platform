/**
 * MigraAI Engine — terminal evidence for each governed coding stage.
 *
 * Evidence is what makes a terminal state checkable after the fact. A child that
 * says `completed` and carries nothing behind it is an assertion; one that carries
 * the exit code, the paths, and the digest of what it acted on is a record.
 *
 * Two rules shape everything below.
 *
 *  1. DIGESTS, NOT PAYLOADS. Model responses and command output are digested and
 *     bounded rather than stored whole. The durable journal is not a transcript
 *     store, and an unbounded field is how a credential or a megabyte of stdout
 *     ends up in an operational database.
 *
 *  2. MUTATION IS CLASSIFIED, NEVER INFERRED. `none | complete | partial` is read
 *     from what governedApply actually reported. `partial` exists because the
 *     engine can fail to undo its own writes, and a partial mutation must never
 *     terminate as successful — so it is carried explicitly instead of being
 *     collapsed into a boolean nobody can interrogate later.
 *
 * © MigraTeck LLC.
 */

import { createHash } from 'node:crypto';
import type { GovernedApplyResult } from './governedApply.js';
import type { ValidationRecord } from './validationRun.js';
import type { ObservedFailureEvidence } from './modelProposals.js';
import type { Reconciliation } from './codingRun.js';
import type { PlanResult } from './codingPlanner.js';
import type { CodingCompletionBlocker } from './codingChildren.js';
import type { CodingReconciliationFinding } from './codingChildren.js';

/** Short, stable content digest. Enough to prove two artefacts are the same one. */
export function digest(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

/** Output digests plus a short head. Never the whole stream. */
const HEAD_CHARS = 400;
function streamRef(text: string): { digest: string; chars: number; head: string } {
  return { digest: digest(text), chars: text.length, head: text.slice(0, HEAD_CHARS) };
}

// ── 1. repository_planning ───────────────────────────────────────────────────

export interface PlanningEvidence {
  issueDigest: string;
  candidateCount: number;
  openedPaths: string[];
  selectedPaths: string[];
  excludedPaths: string[];
  spans: Array<{ path: string; startLine: number; endLine: number; excerptHash: string }>;
  result: 'planned' | 'refused';
  refusalCategory?: string;
}

export function planningEvidence(input: { issue: string; candidateCount: number; plan: PlanResult }): PlanningEvidence {
  if (!input.plan.ok) {
    return {
      issueDigest: digest(input.issue),
      candidateCount: input.candidateCount,
      openedPaths: [...input.plan.openedPaths],
      selectedPaths: [],
      excludedPaths: [],
      spans: [],
      result: 'refused',
      refusalCategory: input.plan.reason,
    };
  }
  const { plan, ledger } = input.plan;
  return {
    issueDigest: digest(input.issue),
    candidateCount: input.candidateCount,
    openedPaths: ledger.readPaths,
    selectedPaths: plan.proposedScope.map((s) => s.path),
    excludedPaths: plan.excludedCandidates.map((e) => e.path),
    spans: plan.proposedScope.flatMap((s) => s.sources.map((src) => ({ path: src.path, startLine: src.startLine, endLine: src.endLine, excerptHash: src.excerptHash }))),
    result: 'planned',
  };
}

// ── 2. initial_model_proposal / 5. repair_model_proposal ─────────────────────

export interface ModelProposalEvidence {
  model: string;
  runner: string;
  attempt: number;
  responseDigest: string;
  responseChars: number;
  structuredOutput: 'valid' | 'malformed' | 'absent';
  proposedPaths: string[];
  rejectionCategory?: string;
}

export function modelProposalEvidence(input: {
  model: string;
  runner: string;
  attempt: number;
  rawResponse: string;
  structuredOutput: ModelProposalEvidence['structuredOutput'];
  proposedPaths?: readonly string[];
  rejectionCategory?: string;
}): ModelProposalEvidence {
  return {
    model: input.model,
    runner: input.runner,
    attempt: input.attempt,
    // The response itself is never persisted — only a digest and its size.
    responseDigest: digest(input.rawResponse),
    responseChars: input.rawResponse.length,
    structuredOutput: input.structuredOutput,
    proposedPaths: [...(input.proposedPaths ?? [])],
    ...(input.rejectionCategory ? { rejectionCategory: input.rejectionCategory } : {}),
  };
}

export interface RepairProposalEvidence extends ModelProposalEvidence {
  /** The immutable evidence IDs this proposal claimed to answer. */
  citedEvidenceIds: string[];
  acceptedProposalDigest?: string;
  /**
   * Accepted, but not without remark — a voluntary quotation that did not match the
   * block it named. Recorded rather than fatal: the quotation confers no authority,
   * so it cannot veto a repair, but a paraphrasing model must not become invisible.
   *
   * The mismatched quotation TEXT is deliberately absent. Storing it would put a
   * string that failed its check into the record beside verified evidence, where a
   * later reader could mistake it for source.
   */
  concerns?: string[];
  /** Every cited id existed, was current, belonged to this run, and hashed true. */
  evidenceIdVerified?: boolean;
  /** Absent when no quotation was offered; false when one did not match its block. */
  quotationMatched?: boolean;
}

export function repairProposalEvidence(input: Parameters<typeof modelProposalEvidence>[0] & {
  concerns?: readonly string[];
  evidenceIdVerified?: boolean;
  quotationMatched?: boolean;
  citedEvidenceIds: readonly string[];
  acceptedProposal?: unknown;
}): RepairProposalEvidence {
  return {
    ...modelProposalEvidence(input),
    citedEvidenceIds: [...input.citedEvidenceIds],
    ...(input.acceptedProposal !== undefined ? { acceptedProposalDigest: digest(input.acceptedProposal) } : {}),
    ...(input.concerns?.length ? { concerns: [...input.concerns] } : {}),
    ...(input.evidenceIdVerified !== undefined ? { evidenceIdVerified: input.evidenceIdVerified } : {}),
    ...(input.quotationMatched !== undefined ? { quotationMatched: input.quotationMatched } : {}),
  };
}

// ── 3. initial_apply / 6. repair_apply ───────────────────────────────────────

/** Read from what the apply reported. `partial` can never be a success. */
export type MutationClassification = 'none' | 'complete' | 'partial';

export interface ApplyEvidence {
  changesetDigest: string;
  requestedPaths: string[];
  admittedPaths: string[];
  refusedPaths: string[];
  readback: 'verified' | 'not-performed';
  rollback: 'none' | 'rolled-back' | 'rollback-failed';
  mutation: MutationClassification;
  status: 'applied' | 'refused';
  refusal?: string;
  engineCode?: string;
}

export function applyEvidence(input: {
  changeset: unknown;
  requestedPaths: readonly string[];
  result: GovernedApplyResult;
}): ApplyEvidence {
  const base = {
    changesetDigest: digest(input.changeset),
    requestedPaths: [...input.requestedPaths],
  };
  if (input.result.ok) {
    const rolledBack = input.result.result.rolledBack === true;
    return {
      ...base,
      admittedPaths: [...input.result.paths],
      refusedPaths: [],
      readback: 'verified',
      rollback: rolledBack ? 'rolled-back' : 'none',
      // A rolled-back apply changed nothing that survived, so it is `none`.
      mutation: rolledBack ? 'none' : 'complete',
      status: 'applied',
    };
  }
  return {
    ...base,
    admittedPaths: [],
    refusedPaths: [...input.result.offendingPaths],
    readback: 'not-performed',
    // `mutated: 'partial'` means the engine's own rollback failed.
    rollback: input.result.mutated === 'partial' ? 'rollback-failed' : 'none',
    mutation: input.result.mutated === 'partial' ? 'partial' : 'none',
    status: 'refused',
    refusal: input.result.refusal,
    ...(input.result.engineCode ? { engineCode: input.result.engineCode } : {}),
  };
}

/** A partial mutation must never terminate as successful. Callers derive the
 * child outcome from HERE rather than from their own reading of the result. */
/**
 * An apply succeeded only if something SURVIVED it.
 *
 * This required `mutation !== 'partial'`, which let a rolled-back apply through:
 * `governedApply` returns `ok: true` when its own rollback succeeded, so the stage
 * completed as an ordinary success while the tree sat at its pre-change state.
 * Reconciliation still refused completion — it saw a recorded write absent from the
 * diff — but it reported that absence as UNEXPLAINED, so the one outcome the run
 * understood perfectly well arrived at the operator as a mystery.
 *
 * `complete` is now the only success. `none` covers both a refusal and a rollback,
 * and both are failures because neither left a change behind.
 */
export function applyOutcome(evidence: ApplyEvidence): 'success' | 'failure' {
  return evidence.status === 'applied' && evidence.mutation === 'complete' ? 'success' : 'failure';
}

/** Paths this apply wrote and then rolled back, for the reconciliation's rollback set. */
export function rolledBackPaths(evidence: ApplyEvidence): string[] {
  return evidence.rollback === 'rolled-back' ? [...evidence.admittedPaths] : [];
}

// ── 4. validation / 7. final_validation ──────────────────────────────────────

export interface ValidationEvidence {
  commandRunId: string;
  executable: string;
  arguments: string[];
  cwd: string;
  admitted: boolean;
  refusedReason?: string;
  exitCode: number | null;
  timedOut: boolean;
  passed: boolean;
  durationMs: number;
  stdout: { digest: string; chars: number; head: string };
  stderr: { digest: string; chars: number; head: string };
  failureEvidenceIds: string[];
  cancellation: 'none' | 'requested' | 'confirmed';
}

export function validationEvidence(input: {
  record: ValidationRecord;
  failureEvidence?: readonly ObservedFailureEvidence[];
  cancellation?: ValidationEvidence['cancellation'];
}): ValidationEvidence {
  const [executable, ...args] = input.record.command;
  return {
    commandRunId: input.record.id,
    executable: executable ?? '',
    arguments: args,
    cwd: input.record.cwd,
    admitted: input.record.admitted,
    ...(input.record.refusedReason ? { refusedReason: input.record.refusedReason } : {}),
    exitCode: input.record.exitCode,
    timedOut: input.record.timedOut,
    // Copied from the record, which sets it ONLY for a real zero exit.
    passed: input.record.passed,
    durationMs: input.record.durationMs,
    stdout: streamRef(input.record.stdout),
    stderr: streamRef(input.record.stderr),
    failureEvidenceIds: (input.failureEvidence ?? []).map((f) => f.evidenceId),
    cancellation: input.cancellation ?? 'none',
  };
}

// ── 8. reconciliation ────────────────────────────────────────────────────────

export interface ReconciliationEvidence {
  approvedPaths: string[];
  diffPaths: string[];
  writtenPaths: string[];
  refusedPaths: string[];
  unusedScope: string[];
  childFindings: Array<{ kind: string; childId: string }>;
  blockers: string[];
  completion: 'complete' | 'incomplete';
  terminalWrite: 'durable' | 'not-durable';
}

/**
 * Summarise authoritative records. Invents nothing.
 *
 * Every field is copied from something already decided elsewhere — the git diff,
 * the scope ledger, the child rows. This child is the last one to run, and a stage
 * that computed its own view of the truth at the end would be able to disagree
 * with the records it is supposed to be summarising.
 */
export function reconciliationEvidence(input: {
  reconciliation: Reconciliation;
  findings: readonly CodingReconciliationFinding[];
  blockers: readonly CodingCompletionBlocker[];
  terminalDurable: boolean;
}): ReconciliationEvidence {
  const blockers = [
    ...input.reconciliation.blockers,
    ...input.blockers.map((b) => ('detail' in b && b.detail ? `${b.kind}: ${b.detail}` : 'childId' in b ? `${b.kind}: ${b.childId}` : b.kind)),
  ];
  return {
    approvedPaths: [...input.reconciliation.approved],
    diffPaths: [...input.reconciliation.diffPaths],
    writtenPaths: [...input.reconciliation.written],
    refusedPaths: [...input.reconciliation.refused],
    unusedScope: [...input.reconciliation.unusedScope],
    childFindings: input.findings.map((f) => ({ kind: f.kind, childId: f.childId })),
    blockers,
    completion: blockers.length === 0 ? 'complete' : 'incomplete',
    terminalWrite: input.terminalDurable ? 'durable' : 'not-durable',
  };
}
