// MigraPilot — the governed coding workflow, as the user experiences it.
//
// One approval, presented once, bound to an exact proposal. Everything else is
// display of durable Brain state.
//
// The rule that shapes this file: THE EXTENSION NEVER DECIDES WHAT A RUN DID. It
// starts a run, shows what the Brain proposes, carries one operator decision back,
// and renders the durable record. It does not infer completion, does not label a
// cancellation, and does not retry a conflict on the user's behalf — a stale
// approval refreshes the snapshot and RE-ASKS, because the operator approved a
// specific proposal and a changed one is a different decision.
//
// vscode-free so the sequencing is testable without an editor host.

import type { CodingRunClient, CodingRunSnapshot, CodingConflict, CodingRunAccepted } from './codingRunClient.js';
import { cancellationLabel } from './codingRunClient.js';
import { pollCodingRun, type PollOutcome } from './codingRunPoller.js';

export interface ScopeApprovalRequest {
  runId: string;
  revision: number;
  pathSetHash: string;
  expiresAt: string;
  files: Array<{ path: string; rationale: string; evidence: Array<{ startLine: number; endLine: number; excerptHash: string }> }>;
  excluded: Array<{ path: string; reason: string }>;
  issueSummary?: string;
  /** Set when this proposal REPLACED one the operator already saw. */
  supersededPreviousProposal?: boolean;
}

export type ScopeDecision = 'approve' | 'reject';

export interface CodingWorkflowUi {
  /** Ask once. Returning undefined means the operator dismissed the panel. */
  requestScopeApproval(request: ScopeApprovalRequest): Promise<ScopeDecision | undefined>;
  /** Called only when the durable revision changed. */
  onProgress(snapshot: CodingRunSnapshot): void;
  onFinalReport(snapshot: CodingRunSnapshot): void;
  onProblem(problem: { title: string; detail: string; recoverable: boolean }): void;
}

export type WorkflowOutcome =
  | { kind: 'completed'; snapshot: CodingRunSnapshot }
  | { kind: 'incomplete'; snapshot: CodingRunSnapshot }
  | { kind: 'rejected'; snapshot: CodingRunSnapshot }
  | { kind: 'cancelled'; snapshot: CodingRunSnapshot; label: string }
  | { kind: 'dismissed'; snapshot?: CodingRunSnapshot }
  | { kind: 'unavailable'; detail: string }
  | { kind: 'problem'; detail: string; snapshot?: CodingRunSnapshot };

export interface RunCodingWorkflowOptions {
  issueText: string;
  workspaceRoot: string;
  ui: CodingWorkflowUi;
  isDisposed?: () => boolean;
  signal?: AbortSignal;
  /** Re-presentation guard. A proposal may be re-asked at most this many times
   * after a stale/changed-scope conflict before the workflow gives up rather than
   * looping an operator through an endlessly moving target. */
  maxApprovalRounds?: number;
  poll?: typeof pollCodingRun;
}

const DEFAULT_APPROVAL_ROUNDS = 3;

export async function runCodingWorkflow(client: CodingRunClient, options: RunCodingWorkflowOptions): Promise<WorkflowOutcome> {
  const poll = options.poll ?? pollCodingRun;
  const maxRounds = options.maxApprovalRounds ?? DEFAULT_APPROVAL_ROUNDS;

  // 1 — never start against a Brain that cannot do this.
  const capability = await client.getCodingCapability(options.signal);
  if (capability.kind === 'capability_unavailable') return { kind: 'unavailable', detail: capability.detail };
  if (capability.kind !== 'ok') return { kind: 'problem', detail: describe(capability) };
  if (!capability.value.available) {
    return { kind: 'unavailable', detail: capability.value.unavailableReason ?? 'Governed coding is not available on this Brain.' };
  }

  // 2 — start.
  const started = await client.startCodingRun({ issueText: options.issueText, workspaceRoot: options.workspaceRoot }, options.signal);
  if (started.kind !== 'accepted' && started.kind !== 'ok') return { kind: 'problem', detail: describe(started) };
  const accepted = (started.kind === 'accepted' ? started.value : started.value) as CodingRunAccepted;
  const runId = accepted.runId;

  let seenProposalHash: string | undefined;

  for (let round = 0; round < maxRounds; round += 1) {
    // 3 — poll until the Brain needs the operator or the run ends.
    const outcome: PollOutcome = await poll(client, {
      runId,
      onSnapshot: (snapshot) => options.ui.onProgress(snapshot),
      ...(options.isDisposed ? { isDisposed: options.isDisposed } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (outcome.reason === 'terminal') return finish(outcome.snapshot!, options.ui);
    if (outcome.reason === 'disposed') return { kind: 'dismissed', ...(outcome.snapshot ? { snapshot: outcome.snapshot } : {}) };
    if (outcome.reason === 'corrupt') {
      options.ui.onProblem({ title: 'This run’s durable record cannot be read', detail: outcome.detail ?? '', recoverable: false });
      return { kind: 'problem', detail: outcome.detail ?? 'unreadable durable record', ...(outcome.snapshot ? { snapshot: outcome.snapshot } : {}) };
    }
    if (outcome.reason !== 'awaiting_approval') {
      options.ui.onProblem({ title: 'The run could not be followed', detail: outcome.detail ?? outcome.reason, recoverable: true });
      return { kind: 'problem', detail: outcome.detail ?? outcome.reason, ...(outcome.snapshot ? { snapshot: outcome.snapshot } : {}) };
    }

    const snapshot = outcome.snapshot!;
    const scope = snapshot.scope!;

    // 4 — ask ONCE per distinct proposal.
    const decision = await options.ui.requestScopeApproval({
      runId,
      revision: snapshot.revision,
      pathSetHash: scope.pathSetHash,
      expiresAt: scope.approvalExpiresAt,
      files: scope.proposedPaths.map((p) => ({
        path: p,
        rationale: scope.rationales.find((r) => r.path === p)?.rationale ?? '',
        evidence: scope.evidence.find((e) => e.path === p)?.spans ?? [],
      })),
      excluded: scope.excluded,
      ...(snapshot.issueSummary ? { issueSummary: snapshot.issueSummary } : {}),
      ...(seenProposalHash && seenProposalHash !== scope.pathSetHash ? { supersededPreviousProposal: true } : {}),
    });
    seenProposalHash = scope.pathSetHash;

    if (decision === undefined) return { kind: 'dismissed', snapshot };

    // 5 — carry the decision back, bound to the revision AND hash the operator saw.
    const submitted = await client.submitScopeDecision(runId, {
      expectedRevision: snapshot.revision,
      pathSetHash: scope.pathSetHash,
      decision,
    }, options.signal);

    if (submitted.kind === 'ok') {
      if (decision === 'reject') return { kind: 'rejected', snapshot: submitted.value };
      // Approved: follow execution to its terminal state.
      const executed = await poll(client, {
        runId,
        onSnapshot: (s) => options.ui.onProgress(s),
        ...(options.isDisposed ? { isDisposed: options.isDisposed } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
      if (executed.reason === 'terminal') return finish(executed.snapshot!, options.ui);
      if (executed.reason === 'disposed') return { kind: 'dismissed', ...(executed.snapshot ? { snapshot: executed.snapshot } : {}) };
      options.ui.onProblem({ title: 'The run could not be followed to completion', detail: executed.detail ?? executed.reason, recoverable: true });
      return { kind: 'problem', detail: executed.detail ?? executed.reason, ...(executed.snapshot ? { snapshot: executed.snapshot } : {}) };
    }

    if (submitted.kind === 'conflict') {
      // A stale revision or a changed scope means the operator decided against a
      // proposal that no longer stands. REFRESH and re-ask; never resubmit
      // blindly, because that would apply their decision to something else.
      if (isRepresentable(submitted.conflict)) {
        options.ui.onProblem({
          title: conflictTitle(submitted.conflict),
          detail: `${submitted.conflict.reason} — the proposal moved to revision ${submitted.conflict.currentRevision}. Re-reading the plan.`,
          recoverable: true,
        });
        continue;
      }
      const current = await client.getCodingRun(runId, options.signal);
      const latest = current.kind === 'ok' ? current.value : undefined;
      options.ui.onProblem({ title: conflictTitle(submitted.conflict), detail: submitted.conflict.reason, recoverable: false });
      return { kind: 'problem', detail: submitted.conflict.reason, ...(latest ? { snapshot: latest } : {}) };
    }

    options.ui.onProblem({ title: 'The scope decision was not accepted', detail: describe(submitted), recoverable: false });
    return { kind: 'problem', detail: describe(submitted), snapshot };
  }

  const final = await client.getCodingRun(runId, options.signal);
  return { kind: 'problem', detail: `The proposal changed more than ${maxRounds} times without a stable decision.`, ...(final.kind === 'ok' ? { snapshot: final.value } : {}) };
}

/** Conflicts that a fresh read can legitimately resolve by re-asking. */
function isRepresentable(conflict: CodingConflict): boolean {
  return conflict.reason === 'stale_revision' || conflict.reason === 'scope_hash_mismatch';
}

function conflictTitle(conflict: CodingConflict): string {
  switch (conflict.reason) {
    case 'stale_revision': return 'The plan changed while you were reviewing it';
    case 'scope_hash_mismatch': return 'The proposed file scope changed';
    case 'approval_expired': return 'The approval window expired';
    case 'approval_invalidated': return 'The evidence behind this plan changed';
    case 'approval_already_consumed': return 'This approval was already used';
    case 'cancellation_requested': return 'Cancellation was requested for this run';
    case 'invalid_state': return 'This run is no longer awaiting approval';
  }
}

/**
 * Resolve a terminal run.
 *
 * Completion is read from the Brain's own report; the extension never computes
 * it. A cancelled run is labelled from the durable record, so a requested-but-
 * unconfirmed cancellation can never be shown as "Cancelled".
 */
function finish(snapshot: CodingRunSnapshot, ui: CodingWorkflowUi): WorkflowOutcome {
  ui.onFinalReport(snapshot);
  const label = cancellationLabel(snapshot);
  if (snapshot.cancellation) return { kind: 'cancelled', snapshot, label: label ?? 'Cancellation requested' };
  if (snapshot.finalReport?.complete === true) return { kind: 'completed', snapshot };
  return { kind: 'incomplete', snapshot };
}

function describe(result: { kind: string; detail?: string; message?: string; status?: number }): string {
  if (result.message) return result.message;
  if (result.detail) return result.detail;
  return result.status ? `${result.kind} (${result.status})` : result.kind;
}

/**
 * Request cancellation and report it TRUTHFULLY.
 *
 * The returned label is derived from the durable record only. A VS Code
 * cancellation token says a button was pressed; it says nothing about whether the
 * work stopped, and letting it decide the terminal label is the exact defect this
 * project already fixed once on the Brain side.
 */
export async function requestCodingCancellation(
  client: CodingRunClient,
  runId: string,
  expectedRevision: number,
  signal?: AbortSignal,
): Promise<{ label: string; snapshot?: CodingRunSnapshot; conflict?: CodingConflict }> {
  const result = await client.cancelCodingRun(runId, { expectedRevision }, signal);
  if (result.kind === 'ok') {
    return { label: cancellationLabel(result.value) ?? 'Cancellation requested', snapshot: result.value };
  }
  if (result.kind === 'conflict') {
    // A stale revision here is not a cancellation: re-read before saying anything.
    const current = await client.getCodingRun(runId, signal);
    const snapshot = current.kind === 'ok' ? current.value : undefined;
    return {
      label: snapshot ? cancellationLabel(snapshot) ?? 'Cancellation could not be confirmed' : 'Cancellation could not be confirmed',
      ...(snapshot ? { snapshot } : {}),
      conflict: result.conflict,
    };
  }
  return { label: 'Cancellation could not be confirmed' };
}
