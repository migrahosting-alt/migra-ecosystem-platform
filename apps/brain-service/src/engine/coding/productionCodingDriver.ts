/**
 * MigraAI Engine — the production governed-coding workflow driver.
 *
 * This is the ONLY component that binds the HTTP service to real capability: the
 * evidence planner, the model proposal adapters, the approved edit scope, the
 * governed mutation engine, `command.run` validation, the repair loop, and
 * reconciliation. Everything above it (routes) and below it (journal, coding
 * modules) stays unchanged — which is what makes the route contract testable
 * without a model and the coding modules testable without HTTP.
 *
 * Two rules shape the whole file.
 *
 *  1. PLANNING NEVER MUTATES. `plan()` ranks, opens evidence, asks the model for a
 *     scope, records it, and stops at the approval boundary. There is no path
 *     through it that reaches governedApply.
 *
 *  2. RESUMPTION NEVER TRUSTS THE PAYLOAD ALONE. Before the first write it
 *     re-verifies the workspace identity and every cited excerpt hash. An approval
 *     is authority over the repository AS IT WAS SHOWN; if the tree moved
 *     underneath, that authority no longer describes anything real.
 *
 * Cancellation is checked at every stage boundary, and a cancelled run confirms
 * only what it observed to stop. © MigraTeck LLC.
 */

import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { EvidenceLedger, normalizePath, type EvidenceSource } from '../grounding/evidenceLedger.js';
import { nodeChangesetFs } from '../../tools/changesetFs.js';
import { ChangesetProposalStore } from '../../tools/changeset.js';
import { planCodingTask, type PlannerModel } from './codingPlanner.js';
import {
  approveEditScope,
  proposeEditScope,
  ScopedEditLedger,
  type ApprovedEditScope,
} from './editScope.js';
import { governedApply } from './governedApply.js';
import {
  createInitialChangesetAuthor,
  createRepairChangesetAuthor,
  changesetFingerprint,
  extractFailureEvidence,
  importedModules,
  REPAIR_HISTORY_LIMITS,
  type PreviousRepairAttempt,
  type ProposalModel,
} from './modelProposals.js';
import { observedFailure, runValidation, type DeclaredValidation, type ValidationRecord } from './validationRun.js';
import { reconcile, type CodingStopReason } from './codingRun.js';
import {
  applyEvidence,
  applyOutcome,
  rolledBackPaths,
  type ApplyEvidence,
  digest,
  modelProposalEvidence,
  planningEvidence,
  reconciliationEvidence,
  repairProposalEvidence,
  validationEvidence,
} from './codingStageEvidence.js';
import { codingCompletionEligibility, reconcileCodingChildren } from './codingChildren.js';
import { recoverPendingScope } from './codingRecovery.js';
import { hashPaths } from './editScope.js';
import type { CodingRunPayloadV1 } from './codingRunPayload.js';
import type { CodingWorkflowContext, CodingWorkflowDriver } from './codingRunService.js';

export interface ProductionCodingDriverDeps {
  /** Structured-output model for planning and changeset authoring. */
  plannerModel: PlannerModel;
  proposalModel: ProposalModel;
  /** Declared by the task contract. NEVER model-authored. */
  validationCommand: DeclaredValidation;
  maxRepairAttempts?: number;
  now?: () => number;
  /** Injected for tests; defaults to a real `git diff --name-only` read. */
  gitDiffPaths?: (rootPath: string) => string[];
  /** Injected for tests; defaults to reading the real file. */
  readSpan?: (rootPath: string, relPath: string, startLine: number, endLine: number) => Promise<string | undefined>;
  /** Surfaces why planning produced no usable plan. */
  onPlanRefused?: (runId: string, reason: string) => void;
}

const DEFAULT_MAX_REPAIRS = 3;

/** Stands in for "no apply evidence was captured", so rollback derivation stays total. */
const EMPTY_APPLY_EVIDENCE: ApplyEvidence = {
  changesetDigest: '', requestedPaths: [], admittedPaths: [], refusedPaths: [],
  readback: 'not-performed', rollback: 'none', mutation: 'none', status: 'refused',
};

/** Working-tree changes vs HEAD, plus untracked files. Authoritative for effect. */
export function gitDiffPaths(rootPath: string): string[] {
  const run = (args: string[]): string[] => {
    try {
      return execFileSync('git', args, { cwd: rootPath, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
        .split('\n').map((l) => l.trim()).filter(Boolean);
    } catch {
      return [];
    }
  };
  return [...new Set([...run(['diff', '--name-only', 'HEAD']), ...run(['ls-files', '--others', '--exclude-standard'])])].map(normalizePath);
}

async function readSpanText(rootPath: string, relPath: string, startLine: number, endLine: number): Promise<string | undefined> {
  try {
    const text = await readFile(`${rootPath}/${relPath}`, 'utf8');
    return text.split(/\r?\n/).slice(startLine - 1, endLine).join('\n');
  } catch {
    return undefined;
  }
}

export function createProductionCodingDriver(deps: ProductionCodingDriverDeps): CodingWorkflowDriver {
  const now = deps.now ?? (() => Date.now());
  const maxRepairs = deps.maxRepairAttempts ?? DEFAULT_MAX_REPAIRS;
  const diffPaths = deps.gitDiffPaths ?? gitDiffPaths;
  const readSpan = deps.readSpan ?? readSpanText;

  const openSpan = (rootPath: string) => (relPath: string, startLine: number, endLine: number): EvidenceSource => ({
    async fingerprint() { return undefined; },
    async read() {
      const text = await readSpan(rootPath, relPath, startLine, endLine);
      if (text === undefined) throw new Error(`unreadable ${relPath}`);
      return { startLine, endLine, text };
    },
  });

  return {
    // ── plan ───────────────────────────────────────────────────────────────
    async plan(ctx: CodingWorkflowContext): Promise<void> {
      // 1 — repository planning. Ranks the map, opens a bounded evidence set, and
      // asks the model to choose only among files this run actually retrieved.
      let plannerLedger: EvidenceLedger | undefined;
      const planning = await ctx.run.runStage({ kind: 'repository_planning', phase: 'planning', reuseIfCompleted: true }, async () => {
        const result = await planCodingTask({
          issue: ctx.issueText,
          rootPath: ctx.workspaceRoot,
          validationCommand: deps.validationCommand,
          model: deps.plannerModel,
          openSpan: openSpan(ctx.workspaceRoot),
        });
        if (result.ok) plannerLedger = result.ledger;
        const evidence = planningEvidence({ issue: ctx.issueText, candidateCount: result.ok ? result.ledger.readPaths.length : result.openedPaths.length, plan: result });
        return {
          outcome: result.ok ? ('success' as const) : ('failure' as const),
          evidence,
          value: result,
          ...(result.ok ? {} : { error: { code: result.reason, message: result.message } }),
        };
      });
      // A stage that did not complete must still leave the run TERMINAL. Returning
      // here without finalizing was a real defect: a planner whose model call
      // failed left the run sitting in `planning` forever with no terminal state
      // and nothing explaining why — the precise condition a client polls against
      // and never gets an answer from. `finalize()` computes FAILED from the child
      // evidence, so the reason stays inspectable.
      if (planning.status !== 'completed' || !planning.value?.ok) {
        // Record WHY. Discarding this was what made a refused registration
        // indistinguishable from a run that simply did nothing.
        const refusal = planning.value && !planning.value.ok ? planning.value : undefined;
        const why = refusal
          ? `repository_planning refused: ${refusal.reason} — ${refusal.message} (opened ${refusal.openedPaths.length} path(s))`
          : `repository_planning did not complete: ${planning.status}${planning.detail ? ` — ${planning.detail}` : ''}`;
        ctx.run.patchPayload({ phase: 'terminal' }, `plan.refused:${planning.status}`);
        deps.onPlanRefused?.(ctx.runId, why);
        ctx.run.finalize({});
        return;
      }
      const plan = planning.value.plan;

      // 2 — the initial model proposal is a SEPARATE child: a plan that is sound
      // and a changeset that is sound fail in different ways, and collapsing them
      // would make the recovery question unanswerable.
      const scopePaths = plan.proposedScope.map((s) => s.path);
      const proposal = await ctx.run.runStage({ kind: 'initial_model_proposal', phase: 'planning', reuseIfCompleted: true }, async () => ({
        outcome: 'success' as const,
        evidence: modelProposalEvidence({
          model: 'planner', runner: 'engine', attempt: 1,
          rawResponse: JSON.stringify(plan.initialChangeset),
          structuredOutput: 'valid',
          proposedPaths: plan.initialChangeset.ops.map((o) => normalizePath(o.path)),
        }),
        value: plan.initialChangeset,
      }));
      if (proposal.status !== 'completed') {
        ctx.run.finalize({});
        return;
      }

      // 3 — record the plan and freeze the scope. `hashPaths` is the SAME function
      // the edit scope uses, so the hash an operator approves is the hash the
      // mutation boundary will later enforce.
      const sourcesByPath = Object.fromEntries(plan.proposedScope.map((s) => [s.path, s.sources]));
      ctx.run.patchPayload({
        plan: {
          issueSummary: plan.issueSummary,
          proposedScope: plan.proposedScope,
          excludedCandidates: plan.excludedCandidates.map((e) => ({ path: e.path, reason: e.reason })),
          validationCommand: { command: [...plan.validationCommand.command], ...(plan.validationCommand.cwd ? { cwd: plan.validationCommand.cwd } : {}) },
        },
        attempts: { initialProposal: 1, repair: 0 },
      }, 'plan.recorded');

      const expiresAt = new Date(now() + 5 * 60 * 1000).toISOString();
      ctx.run.awaitScopeApproval({
        proposedPaths: scopePaths,
        pathSetHash: hashPaths(scopePaths),
        sourcesByPath,
        proposalRevision: 0,
        proposedAt: new Date(now()).toISOString(),
        approvalExpiresAt: expiresAt,
        approvalState: 'displayed',
      });
      void plannerLedger;
    },

    // ── resume ─────────────────────────────────────────────────────────────
    async resume(ctx: CodingWorkflowContext): Promise<void> {
      const payload = ctx.run.payload;
      const scope = payload.scope;
      if (!scope || !payload.plan) { ctx.run.finalize({}); return; }

      // Re-verify BEFORE the first write. An approval is authority over the
      // repository as it was shown; a tree that moved underneath invalidates it.
      const verified = await recoverPendingScope({
        payload: { ...payload, scope: { ...scope, approvalState: 'displayed' } },
        readSpan: (path, start, end) => readSpan(ctx.workspaceRoot, path, start, end),
        now: now(),
      });
      if (verified.outcome !== 'still_valid') {
        ctx.run.patchPayload({ scope: { ...scope, approvalState: 'invalidated' } }, 'scope.reverification_failed');
        ctx.run.finalize({});
        return;
      }

      const approved = approveEditScope(
        proposeEditScope({
          runId: ctx.runId,
          rationale: payload.plan.issueSummary,
          files: scope.proposedPaths.map((path) => ({
            path,
            // The operator-facing reason comes from the recorded plan, so approval
            // shows the model's own rationale rather than a generated stand-in.
            reason: payload.plan!.proposedScope.find((entry) => entry.path === path)?.rationale ?? 'proposed by the recorded plan',
            sources: scope.sourcesByPath[path] ?? [],
          })),
        }, now()),
        now(),
      );
      const ledger = new ScopedEditLedger(approved, approved.approvalToken);
      const evidenceLedger = new EvidenceLedger();
      for (const path of scope.proposedPaths) {
        for (const source of scope.sourcesByPath[path] ?? []) {
          try {
            await evidenceLedger.request(path, source.startLine, source.endLine, openSpan(ctx.workspaceRoot)(path, source.startLine, source.endLine));
          } catch { /* an unreadable span was already caught by re-verification */ }
        }
      }

      const applyDeps = { fs: nodeChangesetFs(), store: new ChangesetProposalStore(), scope: approved, approvalToken: approved.approvalToken, ledger };
      const validation: DeclaredValidation = {
        ...deps.validationCommand,
        command: [...payload.plan.validationCommand.command],
      };
      const validate = (stage: 'baseline' | 'final' | 'repair'): Promise<ValidationRecord> =>
        runValidation(validation, stage, { rootPath: ctx.workspaceRoot, now, ...(ctx.signal ? { signal: ctx.signal } : {}) });

      // ── initial apply ──────────────────────────────────────────────────────
      const currentFiles = await Promise.all(scope.proposedPaths.map(async (path) => ({
        path,
        content: (await readFile(`${ctx.workspaceRoot}/${path}`, 'utf8').catch(() => '')) as string,
      })));
      /**
       * Bare modules this repository demonstrably already uses.
       *
       * Its declared dependencies, plus whatever the approved files import today. A
       * repair may reach for these; anything else is a dependency the evidence does
       * not support, which is exactly how a real run turned an ESM codebase into an
       * Express app. Read here, in the driver, so the proposal adapters stay IO-free.
       */
      const knownModules = await (async (): Promise<string[]> => {
        const mods = new Set<string>();
        for (const file of currentFiles) for (const m of importedModules(file.content)) mods.add(m);
        try {
          const pkg = JSON.parse(await readFile(`${ctx.workspaceRoot}/package.json`, 'utf8')) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
            peerDependencies?: Record<string, string>;
          };
          for (const group of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
            for (const name of Object.keys(group ?? {})) mods.add(name);
          }
        } catch {
          // No manifest, or an unreadable one. The imports already in the approved
          // files still stand as evidence; nothing is assumed on their behalf.
        }
        return [...mods];
      })();

      const author = createInitialChangesetAuthor({ model: deps.proposalModel, rootPath: ctx.workspaceRoot, ledger: evidenceLedger });
      const authored = await ctx.run.runStage({ kind: 'initial_model_proposal', phase: 'executing_initial_changeset' }, async () => {
        const result = await author.propose({
          issue: payload.issueText,
          scope: approved,
          evidence: evidenceLedger.spans.map((s) => ({ path: s.path, startLine: s.startLine, endLine: s.endLine, text: s.text })),
          currentFiles,
          validationCommand: validation,
        });
        return {
          outcome: result.ok ? ('success' as const) : ('failure' as const),
          evidence: modelProposalEvidence({
            model: 'proposal', runner: 'engine', attempt: 2,
            rawResponse: result.ok ? JSON.stringify(result.changeset) : '',
            structuredOutput: result.ok ? 'valid' : 'malformed',
            proposedPaths: result.ok ? result.changeset.ops.map((o) => normalizePath(o.path)) : [],
            ...(result.ok ? {} : { rejectionCategory: 'kind' in result ? String(result.kind) : 'rejected' }),
          }),
          value: result,
        };
      });
      if (authored.status !== 'completed' || !authored.value?.ok) { ctx.run.finalize({}); return; }

      /**
       * Declared BEFORE the apply, because `finish()` reads them.
       *
       * `finish()` is hoisted and closes over both. They used to be declared after
       * the `initialApply.status !== 'completed'` early return that calls it, so
       * that one path — the only path that exists to report a refused apply — hit
       * a temporal-dead-zone `ReferenceError` on `current` instead of reporting
       * anything. The run still ended non-complete, so nothing was falsely claimed,
       * but the throw happened INSIDE the reconciliation stage: the journal then
       * recorded `reconciliation: observed_failure` for a reconciliation that never
       * evaluated a thing. A record asserting an outcome that was never computed is
       * exactly what this journal exists to prevent.
       */
      let current: ValidationRecord | undefined;
      let repairAttempt = 0;
      /**
       * What each repair actually did, carried forward so the NEXT one is not
       * authored blind. Seeded from the durable payload so a restart resumes with
       * the strategies it has already disproved rather than a clean slate.
       */
      const repairHistory: PreviousRepairAttempt[] = [...(payload.repairHistory ?? [])];
      /** Paths written and then rolled back. Derived from apply evidence, never assumed. */
      const rollbacks: string[] = [];

      /**
       * Append an attempt, bounded, and make it durable immediately.
       *
       * Written through the payload rather than held in memory because a restart
       * that forgot would hand the next attempt a clean slate — and the strategy it
       * would try first is precisely the one already disproved.
       */
      const recordAttempt = (entry: PreviousRepairAttempt): void => {
        repairHistory.push(entry);
        if (repairHistory.length > REPAIR_HISTORY_LIMITS.maxAttempts) {
          repairHistory.splice(0, repairHistory.length - REPAIR_HISTORY_LIMITS.maxAttempts);
        }
        ctx.run.patchPayload({ repairHistory: [...repairHistory] }, 'repair.history');
      };
      /** Why the repair loop stopped, so the report can name it rather than guess. */
      let loopExit: 'ran-to-completion' | 'cancelled' | 'repair-proposal-rejected' | 'repair-apply-refused' = 'ran-to-completion';

      let initialApplyEvidence: ApplyEvidence | undefined;
      const initialApply = await ctx.run.runStage({ kind: 'initial_apply', phase: 'executing_initial_changeset' }, async () => {
        const changeset = authored.value!.ok ? authored.value!.changeset : undefined;
        const result = await governedApply(changeset!, applyDeps);
        const evidence = applyEvidence({ changeset, requestedPaths: changeset!.ops.map((o) => normalizePath(o.path)), result });
        initialApplyEvidence = evidence;
        // The OUTCOME comes from the evidence, so a partial mutation cannot be
        // reported as success by a caller reading `ok` alone.
        return { outcome: applyOutcome(evidence), evidence, value: result };
      });
      if (initialApply.status !== 'completed') { await finish(); return; }

      // ── validate → repair ─────────────────────────────────────────────────
      current = await recordValidation('validation', 'final');
      while (current && !current.passed && repairAttempt < maxRepairs) {
        if (ctx.run.cancellationRequested() || ctx.signal.aborted) { loopExit = 'cancelled'; break; }
        repairAttempt += 1;
        const observed = observedFailure(current);
        const evidenceBlocks = extractFailureEvidence(current, current.id);
        const repairAuthor = createRepairChangesetAuthor({ model: deps.proposalModel, rootPath: ctx.workspaceRoot, runId: ctx.runId, ledger: evidenceLedger });

        const proposed = await ctx.run.runStage({ kind: 'repair_model_proposal', phase: 'repairing', required: false }, async () => {
          const result = await repairAuthor.propose({
            scope: approved,
            currentDiff: diffPaths(ctx.workspaceRoot),
            latestValidation: current!,
            evidence: evidenceBlocks,
            commandRunId: current!.id,
            previousAttempts: repairHistory,
            knownModules,
            remainingAttempts: maxRepairs - repairAttempt + 1,
          });
          return {
            outcome: result.ok ? ('success' as const) : ('failure' as const),
            evidence: repairProposalEvidence({
              model: 'repair', runner: 'engine', attempt: repairAttempt,
              rawResponse: result.ok ? JSON.stringify(result.changeset) : '',
              structuredOutput: result.ok ? 'valid' : 'malformed',
              proposedPaths: result.ok ? result.changeset.ops.map((o) => normalizePath(o.path)) : [],
              citedEvidenceIds: result.ok ? result.citedEvidenceIds : [],
              ...(result.ok && result.concerns?.length ? { concerns: result.concerns } : {}),
              ...(result.ok && result.evidenceIdVerified !== undefined ? { evidenceIdVerified: result.evidenceIdVerified } : {}),
              ...(result.ok && result.quotationMatched !== undefined ? { quotationMatched: result.quotationMatched } : {}),
              ...(result.ok ? { acceptedProposal: result.changeset } : { rejectionCategory: 'kind' in result ? String(result.kind) : 'rejected' }),
            }),
            value: result,
          };
        });
        ctx.run.patchPayload({ attempts: { initialProposal: 1, repair: repairAttempt }, failureEvidence: evidenceBlocks }, 'repair.evidence');

        if (proposed.status !== 'completed' || !proposed.value?.ok) {
          // Record the refusal BEFORE leaving. A rejected proposal is the single most
          // useful thing a later attempt can know, and on this path the loop ends —
          // so if the run is later resumed, this is all that survives of the attempt.
          const failure = proposed.value && !proposed.value.ok ? proposed.value : undefined;
          recordAttempt({
            attempt: repairAttempt,
            citedEvidenceIds: [],
            rationale: '(the proposal was refused before it could be applied)',
            proposedPaths: [],
            proposalDigest: `rejected_${repairAttempt}`,
            outcome: 'proposal_rejected',
            outcomeReason: failure?.message ?? proposed.detail ?? 'the repair proposal was not accepted',
          });
          // A rejected proposal COSTS an attempt; it does not end the run.
          //
          // Breaking here made repair memory pointless by construction: the model
          // never got a second chance to use what it had just been told. It is also
          // what ended 5 of 8 real `qwen3-coder:30b` runs — each on its second
          // repair — while attempts still remained.
          //
          // The one case that must still break is a refusal that consumed NOTHING
          // (an exhausted ceiling, a transport failure the author declined to
          // charge for). Continuing on those would spin without progress.
          if (failure && failure.consumedAttempt === false) {
            loopExit = 'repair-proposal-rejected';
            break;
          }
          continue;
        }
        const accepted = proposed.value;

        let repairApplyEvidence: ApplyEvidence | undefined;
        const repairApply = await ctx.run.runStage({ kind: 'repair_apply', phase: 'repairing', required: false }, async () => {
          const changeset = accepted.changeset;
          const result = await governedApply(changeset, applyDeps);
          const evidence = applyEvidence({ changeset, requestedPaths: changeset.ops.map((o) => normalizePath(o.path)), result });
          repairApplyEvidence = evidence;
          return { outcome: applyOutcome(evidence), evidence, value: result };
        });
        const digest = changesetFingerprint(accepted.changeset);
        const attemptPaths = accepted.changeset.ops.map((o) => normalizePath(o.path));
        const applyEv = repairApplyEvidence;
        if (applyEv) rollbacks.push(...rolledBackPaths(applyEv));

        if (repairApply.status !== 'completed') {
          // A rolled-back apply is NOT a refusal: the write landed and was undone.
          // Naming it as such is the difference between "the boundary stopped you"
          // and "your change did not survive", which are different instructions.
          const rolledBack = applyEv?.rollback === 'rolled-back';
          recordAttempt({
            attempt: repairAttempt,
            citedEvidenceIds: accepted.citedEvidenceIds,
            rationale: accepted.rationale,
            proposedPaths: attemptPaths,
            proposalDigest: digest,
            outcome: rolledBack ? 'rolled_back' : applyEv?.mutation === 'partial' ? 'apply_failed' : 'apply_refused',
            outcomeReason: rolledBack
              ? 'the apply was rolled back; nothing survived and the tree is at its pre-change state'
              : applyEv?.refusal ?? 'the governed apply did not land this changeset',
          });
          // Same reasoning as a rejected proposal: the boundary refused THIS
          // changeset, not every possible one. The attempt is spent and recorded,
          // and the next is told exactly what did not land.
          if (repairAttempt >= maxRepairs) {
            loopExit = 'repair-apply-refused';
            break;
          }
          continue;
        }
        void observed;
        current = await recordValidation('validation', 'repair');

        // The change landed. Whether it WORKED is the validation's verdict.
        // Recorded only when it did NOT work. A repair that passes ends the loop, and
        // history exists to stop the NEXT attempt repeating a failure — a success has
        // nothing to warn anyone about.
        if (current && !current.passed) {
          recordAttempt({
            attempt: repairAttempt,
            citedEvidenceIds: accepted.citedEvidenceIds,
            rationale: accepted.rationale,
            proposedPaths: attemptPaths,
            proposalDigest: digest,
            outcome: 'validation_failed',
            outcomeReason: `the change applied cleanly but validation still exited ${current.exitCode ?? 'null'}`,
            validationEvidenceIds: extractFailureEvidence(current, current.id).map((b) => b.evidenceId),
          });
        }
      }

      // The report rests on the CONTRACT's final validation, at its own stage,
      // never on a repair-stage result.
      if (current?.passed) current = await recordValidation('final_validation', 'final');
      await finish();

      /**
       * Which children GATE completion.
       *
       * An intermediate `validation` that fails is the normal path — it is what
       * triggers repair — so marking it required would mean any run needing a
       * repair could never report complete, making the repair loop pointless. The
       * same goes for a rejected repair proposal or a refused repair apply: those
       * are recoverable steps, not verdicts. The run's success rests on the
       * CONTRACT's `final_validation` and on `reconciliation`, and those two stay
       * required.
       */
      async function recordValidation(kind: 'validation' | 'final_validation', stage: 'baseline' | 'final' | 'repair'): Promise<ValidationRecord | undefined> {
        const result = await ctx.run.runStage({ kind, phase: 'validating', required: kind === 'final_validation' }, async () => {
          const record = await validate(stage);
          return {
            outcome: record.passed ? ('success' as const) : ('failure' as const),
            evidence: validationEvidence({
              record,
              failureEvidence: record.passed ? [] : extractFailureEvidence(record, record.id),
              cancellation: ctx.run.cancellationRequested() ? 'requested' : 'none',
            }),
            value: record,
          };
        });
        if (result.value) ctx.run.patchPayload({ latestValidation: result.value }, 'validation.recorded');
        return result.value;
      }

      async function finish(): Promise<void> {
        const reconciliation = await ctx.run.runStage({ kind: 'reconciliation', phase: 'reconciling' }, async () => {
          const rec = reconcile({
            scope: approved,
            ledger,
            diffPaths: diffPaths(ctx.workspaceRoot),
            // Derived from apply evidence, not assumed empty. `reconcile` uses this
            // to tell "a recorded write is missing from the diff" (a real mismatch)
            // apart from "it was rolled back" (a known, explained outcome). Passing
            // [] made every rollback surface as an unexplained discrepancy.
            rollbacks: [...new Set([...rollbacks, ...rolledBackPaths(initialApplyEvidence ?? EMPTY_APPLY_EVIDENCE)])],
            finalValidation: current,
          });
          const findings = reconcileCodingChildren(ctx.run.payload, ctx.run.children(), false);
          const eligibility = codingCompletionEligibility(ctx.run.payload, ctx.run.children());
          return {
            outcome: rec.consistent ? ('success' as const) : ('failure' as const),
            evidence: reconciliationEvidence({ reconciliation: rec, findings, blockers: eligibility.blockers, terminalDurable: false }),
            value: rec,
          };
        });

        const rec = reconciliation.value;
        const complete = rec?.consistent === true && current?.passed === true;

        // A report is built FROM records. `baseline` and `initialApply` are
        // required fields of CodingRunReport, and both can legitimately be absent
        // here — a validation stage that was refused or cancelled at a boundary
        // returns no record, and finish() is reached after a non-completed apply.
        // Asserting them non-null would persist a finalReport whose required
        // fields are `undefined`: structurally invalid, and a report claiming a
        // baseline that never ran. The run still finalizes; the blockers already
        // say why there is nothing to report.
        const applyResult = initialApply.value;
        const allRollbacks = [...new Set([...rollbacks, ...rolledBackPaths(initialApplyEvidence ?? EMPTY_APPLY_EVIDENCE)])];
        if (!current || !applyResult) {
          ctx.run.finalize({});
          return;
        }

        /**
         * Name the cause the run actually hit.
         *
         * This used to be `complete ? 'validated' : rec ? 'reconciliation-failed'
         * : 'apply-refused'`, which labelled EVERY incomplete run with a
         * reconciliation record as `reconciliation-failed` — including the common
         * case where the diff and the ledger agreed perfectly and the real cause
         * was that the model burned its repair attempts without making the tests
         * pass. A real `qwen3-coder:30b` run stopped exactly that way. The detail
         * was never lost (it is in `blockers`), but the headline sent an operator
         * hunting a scope/diff integrity problem that did not exist.
         *
         * `reconciliation-failed` now means what it says in `codingRun.ts`: the
         * validation passed and the records still did not agree. That is the alarm
         * worth keeping distinct, and it stays distinct only if the other endings
         * are named honestly.
         */
        const stopReason: CodingStopReason = complete
          ? 'validated'
          : ctx.run.cancellationRequested() || ctx.signal.aborted
            ? 'cancelled'
            : !current.admitted
              ? 'validation-refused'
              : current.passed
                ? 'reconciliation-failed'
                : loopExit === 'repair-proposal-rejected'
                  ? 'repair-proposal-rejected'
                  : loopExit === 'repair-apply-refused'
                    ? 'apply-refused'
                    : repairAttempt >= maxRepairs
                      ? 'repair-ceiling-exhausted'
                      : 'apply-refused';

        ctx.run.finalize({
          report: {
            runId: ctx.runId,
            stopReason,
            complete,
            scopeId: approved.scopeId,
            scopeHash: approved.scopeHash,
            approvalToken: '[REDACTED]',
            rationale: payload.plan!.issueSummary,
            reconciliation: rec ?? { approved: [], attempted: [], refused: [], written: [], unusedScope: [], diffPaths: [], blockers: ['reconciliation did not run'], consistent: false },
            baseline: current,
            repairs: [],
            finalValidation: current,
            initialApply: applyResult,
            rollbacks: allRollbacks,
            // A rollback is a real outcome the operator must see, not a silent
            // non-event: the write was permitted, landed, and did not survive.
            unresolvedRisks: allRollbacks.length
              ? [`${allRollbacks.length} path(s) were written and rolled back; the tree is at its pre-change state for: ${allRollbacks.join(', ')}`]
              : [],
          },
        });
        void digest;
        void changesetFingerprint;
      }
    },
  };
}
