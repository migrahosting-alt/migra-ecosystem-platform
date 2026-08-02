/**
 * MigraAI Engine — the coding run: repair loop, reconciliation, and report.
 *
 * The load-bearing idea is that the FINAL GIT DIFF is authoritative for what
 * changed, and the ledger only explains under what authority it changed. Those two
 * are reconciled before anything may be called complete, and they must agree
 * exactly. A run that believes it wrote three files while the tree shows two has
 * not "mostly succeeded"; it has lost track of its own effects, which is the
 * condition under which a confident completion report is most dangerous.
 *
 * Completion is therefore not something the model asserts. It is a verdict computed
 * from: the diff, the scope ledger, and real command exit codes. The model may
 * summarise that evidence. It may not override it.
 *
 * The repair loop reasons ONLY from observed output. A proposal that cites a
 * failure the command never printed is refused before it can be applied — an
 * invented explanation is how a loop "fixes" a problem that was never there and
 * declares victory over the wrong defect. © MigraTeck LLC.
 */

import type { ChangesetRequest } from '@migrapilot/protocol';
import { governedApply, type GovernedApplyDeps, type GovernedApplyResult } from './governedApply.js';
import { observedFailure, runValidation, type DeclaredValidation, type ValidationRecord, type ValidationStage } from './validationRun.js';
import { ScopedEditLedger, type ApprovedEditScope } from './editScope.js';
import { normalizePath } from '../grounding/evidenceLedger.js';

/** Why a run stopped. Every ending is labelled; there is no unlabelled success. */
export type CodingStopReason =
  | 'validated'
  | 'repair-ceiling-exhausted'
  /**
   * The model's repair proposal was rejected before anything was applied —
   * malformed output, or a rationale citing evidence the run cannot support.
   *
   * Distinct from `apply-refused` on purpose. Both end the repair loop early, but
   * one is the model failing to produce a usable proposal and the other is the
   * governed write boundary refusing one. Observed in real `qwen3-coder:30b` runs,
   * where the second repair proposal was rejected and the run then reported an
   * apply refusal that never happened.
   */
  | 'repair-proposal-rejected'
  | 'apply-refused'
  | 'validation-refused'
  | 'cancelled'
  | 'reconciliation-failed';

export interface RepairAttempt {
  attempt: number;
  /** The failure evidence this attempt was allowed to reason from. */
  failureSummary: string;
  failureLines: string[];
  rationale: string;
  requestedPaths: string[];
  apply: GovernedApplyResult;
  validation?: ValidationRecord;
}

/** A model-authored proposal for one repair round. */
export interface RepairProposal {
  rationale: string;
  changeset: ChangesetRequest;
  /** Lines from the observed output the proposal claims to be responding to. */
  citedFailureLines: string[];
}

export type RepairAuthor = (input: {
  attempt: number;
  failureSummary: string;
  failureLines: string[];
  appliedPaths: string[];
  scope: ApprovedEditScope;
}) => Promise<RepairProposal | null>;

export interface CodingRunOptions {
  runId: string;
  rootPath: string;
  scope: ApprovedEditScope;
  approvalToken: string;
  /** Declared by the task contract, never authored by the model. */
  validations: { baseline: DeclaredValidation; final: DeclaredValidation };
  /** The initial change the plan produced. */
  initialChangeset: ChangesetRequest;
  /** Produces each repair round from observed failure evidence. */
  repairAuthor: RepairAuthor;
  /** Finite. Exhaustion is an incomplete result, never a success. */
  maxRepairAttempts: number;
  /**
   * Files the task contract requires to change. When set, leaving one unwritten
   * blocks success — a partial change that happens to pass is still not the change
   * that was approved.
   */
  requiredPaths?: readonly string[];
  applyDeps: Omit<GovernedApplyDeps, 'scope' | 'approvalToken' | 'ledger'>;
  gitDiffPaths: (rootPath: string) => string[];
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  now?: () => number;
}

export interface Reconciliation {
  approved: string[];
  attempted: string[];
  refused: string[];
  written: string[];
  unusedScope: string[];
  diffPaths: string[];
  /** Every reason success is blocked. Empty means the evidence agrees. */
  blockers: string[];
  consistent: boolean;
}

export interface CodingRunReport {
  runId: string;
  stopReason: CodingStopReason;
  complete: boolean;
  scopeId: string;
  scopeHash: string;
  approvalToken: string;
  rationale: string;
  reconciliation: Reconciliation;
  baseline: ValidationRecord;
  repairs: RepairAttempt[];
  finalValidation?: ValidationRecord;
  initialApply: GovernedApplyResult;
  rollbacks: string[];
  unresolvedRisks: string[];
}

/**
 * Reconcile authority against effect.
 *
 * The diff is what happened; the ledger is what was permitted. Disagreement in
 * EITHER direction is a blocker: a diff entry with no ledger record is an
 * unrecorded write, and a ledger record with no diff entry is a claimed write that
 * did not land.
 */
export function reconcile(input: {
  scope: ApprovedEditScope;
  ledger: ScopedEditLedger;
  diffPaths: string[];
  rollbacks: string[];
  finalValidation?: ValidationRecord;
  requiredPaths?: readonly string[];
}): Reconciliation {
  const approved = input.scope.files.map((f) => f.path);
  const written = input.ledger.applied;
  const refused = [...new Set(input.ledger.refused.map((r) => r.path))];
  const attempted = [...new Set(input.ledger.history.map((r) => r.path))];
  const diffPaths = [...new Set(input.diffPaths.map(normalizePath))];
  const rolledBack = new Set(input.rollbacks.map(normalizePath));
  const blockers: string[] = [];

  for (const path of diffPaths) {
    if (!approved.includes(path)) blockers.push(`the diff changed ${path}, which is outside the approved scope`);
    else if (!written.includes(path)) blockers.push(`the diff changed ${path}, but no governed write was recorded for it`);
  }
  for (const path of written) {
    if (!diffPaths.includes(path) && !rolledBack.has(path)) {
      blockers.push(`a write to ${path} was recorded, but it is absent from the diff and no rollback explains it`);
    }
  }
  for (const path of input.requiredPaths ?? []) {
    if (!diffPaths.includes(normalizePath(path))) blockers.push(`${path} is required by the task contract but was never changed`);
  }
  if (!input.finalValidation) blockers.push('no final validation was run');
  else if (!input.finalValidation.admitted) blockers.push(`final validation was refused: ${input.finalValidation.refusedReason ?? 'unknown'}`);
  else if (!input.finalValidation.passed) blockers.push(`final validation exited ${input.finalValidation.exitCode ?? 'null'}`);
  if (input.rollbacks.length) blockers.push(`unresolved rollback(s): ${input.rollbacks.join(', ')}`);

  return {
    approved,
    attempted,
    refused,
    written,
    unusedScope: input.ledger.unusedScope,
    diffPaths,
    blockers,
    consistent: blockers.length === 0,
  };
}

/**
 * Does a repair proposal rest on evidence the command actually produced?
 *
 * Cheap and strict on purpose: every line the proposal cites must appear in the
 * observed output. A loop permitted to invent its own failure explanation will
 * eventually repair a defect that was never reported and call the run a success.
 */
export function citesObservedEvidence(proposal: RepairProposal, observedLines: string[]): boolean {
  if (!proposal.citedFailureLines.length) return false;
  const haystack = observedLines.join('\n');
  return proposal.citedFailureLines.every((line) => haystack.includes(line.trim()));
}

/** Run the change: apply, validate, repair from observed failure, reconcile, report. */
export async function runCodingTask(opts: CodingRunOptions): Promise<CodingRunReport> {
  const now = opts.now ?? Date.now;
  const ledger = new ScopedEditLedger(opts.scope, opts.approvalToken);
  const applyDeps: GovernedApplyDeps = { ...opts.applyDeps, scope: opts.scope, approvalToken: opts.approvalToken, ledger };
  const rollbacks: string[] = [];
  const unresolvedRisks: string[] = [];
  const repairs: RepairAttempt[] = [];

  const validate = (v: DeclaredValidation, stage: ValidationStage): Promise<ValidationRecord> =>
    runValidation(v, stage, { rootPath: opts.rootPath, ...(opts.env ? { env: opts.env } : {}), ...(opts.signal ? { signal: opts.signal } : {}), now });

  const cancelled = (): boolean => opts.signal?.aborted === true;

  const finish = (stopReason: CodingStopReason, baseline: ValidationRecord, initialApply: GovernedApplyResult, finalValidation?: ValidationRecord): CodingRunReport => {
    const reconciliation = reconcile({
      scope: opts.scope,
      ledger,
      diffPaths: opts.gitDiffPaths(opts.rootPath),
      rollbacks,
      ...(finalValidation ? { finalValidation } : {}),
      ...(opts.requiredPaths ? { requiredPaths: opts.requiredPaths } : {}),
    });
    // Completion is COMPUTED. `validated` alone is not enough — the diff and the
    // ledger must also agree, or the run does not know what it did.
    const complete = stopReason === 'validated' && reconciliation.consistent;
    if (!complete && stopReason === 'validated') unresolvedRisks.push('validation passed but the diff and ledger did not reconcile');
    return {
      runId: opts.runId,
      stopReason: complete ? 'validated' : stopReason === 'validated' ? 'reconciliation-failed' : stopReason,
      complete,
      scopeId: opts.scope.scopeId,
      scopeHash: opts.scope.scopeHash,
      approvalToken: opts.approvalToken,
      rationale: opts.scope.rationale,
      reconciliation,
      baseline,
      repairs,
      ...(finalValidation ? { finalValidation } : {}),
      initialApply,
      rollbacks,
      unresolvedRisks,
    };
  };

  // ── Baseline: the failure must be observed BEFORE anything is changed. ────────
  const baseline = await validate(opts.validations.baseline, 'baseline');
  if (cancelled()) return finish('cancelled', baseline, { ok: false, refusal: 'cancelled-before-apply', message: 'the run was cancelled after baseline validation and before any write was attempted', offendingPaths: [], mutated: false });

  // ── Initial governed apply ───────────────────────────────────────────────────
  const initialApply = await governedApply(opts.initialChangeset, applyDeps);
  if (!initialApply.ok) {
    unresolvedRisks.push(`the planned change was refused: ${initialApply.message}`);
    if (initialApply.mutated === 'partial') {
      // The engine could not undo its own writes. Naming the paths puts them in
      // the reconciliation as unresolved, which blocks completion by construction.
      rollbacks.push(...initialApply.offendingPaths);
      unresolvedRisks.push('the workspace may be in a PARTIAL state — the mutation engine reported that its rollback also failed; manual recovery required');
    }
    return finish('apply-refused', baseline, initialApply);
  }
  if (initialApply.result.rolledBack) {
    rollbacks.push(...initialApply.paths);
    unresolvedRisks.push('the initial apply rolled back; the tree is at its pre-change state');
  }

  let current = await validate(opts.validations.final, 'final');
  if (cancelled()) return finish('cancelled', baseline, initialApply, current);

  // ── Repair, only from observed failure ───────────────────────────────────────
  for (let attempt = 1; !current.passed && attempt <= opts.maxRepairAttempts; attempt += 1) {
    if (cancelled()) return finish('cancelled', baseline, initialApply, current);
    const observed = observedFailure(current);
    const proposal = await opts.repairAuthor({
      attempt,
      failureSummary: observed.summary,
      failureLines: observed.lines,
      appliedPaths: ledger.applied,
      scope: opts.scope,
    });
    if (!proposal) {
      unresolvedRisks.push(`repair attempt ${attempt} produced no proposal`);
      break;
    }
    // A proposal must answer the failure that was actually printed.
    if (!citesObservedEvidence(proposal, observed.lines)) {
      const refused: GovernedApplyResult = {
        ok: false,
        refusal: 'evidence-missing',
        message: 'the repair cited failure evidence that does not appear in the observed output',
        offendingPaths: [],
        mutated: false,
      };
      repairs.push({ attempt, failureSummary: observed.summary, failureLines: observed.lines, rationale: proposal.rationale, requestedPaths: [], apply: refused });
      unresolvedRisks.push(`repair attempt ${attempt} was refused: it cited evidence the run never observed`);
      continue;
    }

    const apply = await governedApply(proposal.changeset, applyDeps);
    const record: RepairAttempt = {
      attempt,
      failureSummary: observed.summary,
      failureLines: observed.lines,
      rationale: proposal.rationale,
      requestedPaths: proposal.changeset.ops.map((o) => normalizePath(o.path)),
      apply,
    };
    if (apply.ok && apply.result.rolledBack) rollbacks.push(...apply.paths);
    if (apply.ok) {
      current = await validate(opts.validations.final, 'repair');
      record.validation = current;
    } else {
      unresolvedRisks.push(`repair attempt ${attempt} was refused: ${apply.message}`);
    }
    repairs.push(record);
  }

  if (!current.passed) {
    if (!current.admitted) return finish('validation-refused', baseline, initialApply, current);
    unresolvedRisks.push(`validation still failing after ${repairs.length} repair attempt(s)`);
    return finish('repair-ceiling-exhausted', baseline, initialApply, current);
  }

  // A passing run still ends with the CONTRACT's final validation, at its own
  // stage, so the report never rests on a repair-stage result.
  const finalRecord = current.stage === 'final' ? current : await validate(opts.validations.final, 'final');
  return finish('validated', baseline, initialApply, finalRecord);
}

/** Human-readable report, rendered from persisted evidence only. */
export function renderCodingReport(report: CodingRunReport): string {
  const r = report.reconciliation;
  const lines: string[] = [];
  lines.push(`# Coding run ${report.runId} — ${report.complete ? '✅ complete' : '⛔ incomplete'} (${report.stopReason})`);
  lines.push('');
  lines.push(`**Approved scope** \`${report.scopeId}\` (hash \`${report.scopeHash}\`): ${r.approved.join(', ')}`);
  lines.push(`> ${report.rationale}`);
  lines.push('');
  lines.push(`**Files changed (git diff, authoritative):** ${r.diffPaths.join(', ') || 'none'}`);
  if (r.refused.length) lines.push(`**Refused (outside authority):** ${r.refused.join(', ')}`);
  if (r.unusedScope.length) lines.push(`**Approved but never written:** ${r.unusedScope.join(', ')}`);
  if (report.rollbacks.length) lines.push(`**Rolled back:** ${report.rollbacks.join(', ')}`);
  lines.push('');
  const v = (rec?: ValidationRecord): string =>
    rec ? `\`${rec.command.join(' ')}\` → exit ${rec.exitCode ?? 'null'}${rec.timedOut ? ' (timed out)' : ''}` : '(not run)';
  lines.push(`**Baseline:** ${v(report.baseline)} — ${observedFailure(report.baseline).summary}`);
  for (const attempt of report.repairs) {
    lines.push(
      `**Repair ${attempt.attempt}:** ${attempt.apply.ok ? `applied ${attempt.requestedPaths.join(', ')}` : `refused (${attempt.apply.refusal})`} — from observed: ${attempt.failureSummary}`,
    );
  }
  lines.push(`**Final:** ${v(report.finalValidation)}`);
  if (r.blockers.length) {
    lines.push('');
    lines.push('**Completion blocked by:**');
    for (const b of r.blockers) lines.push(`- ${b}`);
  }
  if (report.unresolvedRisks.length) {
    lines.push('');
    lines.push('**Unresolved risks:**');
    for (const risk of report.unresolvedRisks) lines.push(`- ${risk}`);
  }
  return lines.join('\n');
}
