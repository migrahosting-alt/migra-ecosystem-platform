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
  type ProposalModel,
} from './modelProposals.js';
import { observedFailure, runValidation, type DeclaredValidation, type ValidationRecord } from './validationRun.js';
import { reconcile } from './codingRun.js';
import {
  applyEvidence,
  applyOutcome,
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
}

const DEFAULT_MAX_REPAIRS = 3;

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
      if (planning.status !== 'completed' || !planning.value?.ok) return;
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
      if (proposal.status !== 'completed') return;

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
      if (!scope || !payload.plan) return;

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

      const initialApply = await ctx.run.runStage({ kind: 'initial_apply', phase: 'executing_initial_changeset' }, async () => {
        const changeset = authored.value!.ok ? authored.value!.changeset : undefined;
        const result = await governedApply(changeset!, applyDeps);
        const evidence = applyEvidence({ changeset, requestedPaths: changeset!.ops.map((o) => normalizePath(o.path)), result });
        // The OUTCOME comes from the evidence, so a partial mutation cannot be
        // reported as success by a caller reading `ok` alone.
        return { outcome: applyOutcome(evidence), evidence, value: result };
      });
      if (initialApply.status !== 'completed') { await finish(); return; }

      // ── validate → repair ─────────────────────────────────────────────────
      let current = await recordValidation('validation', 'final');
      let repairAttempt = 0;
      while (current && !current.passed && repairAttempt < maxRepairs) {
        if (ctx.run.cancellationRequested() || ctx.signal.aborted) break;
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
            previousAttempts: [],
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
              ...(result.ok ? { acceptedProposal: result.changeset } : { rejectionCategory: 'kind' in result ? String(result.kind) : 'rejected' }),
            }),
            value: result,
          };
        });
        ctx.run.patchPayload({ attempts: { initialProposal: 1, repair: repairAttempt }, failureEvidence: evidenceBlocks }, 'repair.evidence');
        if (proposed.status !== 'completed' || !proposed.value?.ok) break;

        const repairApply = await ctx.run.runStage({ kind: 'repair_apply', phase: 'repairing', required: false }, async () => {
          const changeset = proposed.value!.ok ? proposed.value!.changeset : undefined;
          const result = await governedApply(changeset!, applyDeps);
          const evidence = applyEvidence({ changeset, requestedPaths: changeset!.ops.map((o) => normalizePath(o.path)), result });
          return { outcome: applyOutcome(evidence), evidence, value: result };
        });
        if (repairApply.status !== 'completed') break;
        void observed;
        current = await recordValidation('validation', 'repair');
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
            rollbacks: [],
            ...(current ? { finalValidation: current } : {}),
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
        ctx.run.finalize({
          report: {
            runId: ctx.runId,
            stopReason: complete ? 'validated' : rec ? 'reconciliation-failed' : 'apply-refused',
            complete,
            scopeId: approved.scopeId,
            scopeHash: approved.scopeHash,
            approvalToken: '[REDACTED]',
            rationale: payload.plan!.issueSummary,
            reconciliation: rec ?? { approved: [], attempted: [], refused: [], written: [], unusedScope: [], diffPaths: [], blockers: ['reconciliation did not run'], consistent: false },
            baseline: current!,
            repairs: [],
            ...(current ? { finalValidation: current } : {}),
            initialApply: initialApply.value!,
            rollbacks: [],
            unresolvedRisks: [],
          },
        });
        void digest;
        void changesetFingerprint;
      }
    },
  };
}
