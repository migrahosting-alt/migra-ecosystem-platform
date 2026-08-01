/**
 * MigraAI Engine — journaling the governed coding workflow.
 *
 * The coding modules already decide WHAT to do: the planner ranks and proposes,
 * governedApply mutates under an approved scope, validationRun executes declared
 * commands, codingRun reconciles the diff against the ledger. None of that changes
 * here. What this module adds is a durable answer to a different question — what
 * was actually authorised, dispatched, and observed to finish — so that after a
 * crash the run can be resumed from evidence instead of from optimism.
 *
 * Every consequential stage goes through `runStage`, which enforces one ordering:
 *
 *   create child → persist parent reference → dispatch → running
 *     → terminal evidence → reconcile parent
 *
 * and one rule about phases: THE PAYLOAD PHASE ADVANCES ONLY AFTER THE CHILD'S
 * TERMINAL REVISION IS DURABLE. Advancing first would let a crash leave a payload
 * claiming `validating` when no validation child exists — a phase describing work
 * nothing recorded.
 *
 * Passive calculations get no child. Hashing a path set, validating a payload and
 * formatting a report are not operations whose failure, cancellation or completion
 * changes the user-visible outcome; giving them durable records would bury the
 * eight that matter. © MigraTeck LLC.
 */

import type { DurableAgentRunChild, DurableAgentRunState } from '../persistence/types.js';
import { DURABLE_CHILD_TERMINAL_STATES } from '../persistence/types.js';
import type { AgentRunJournal } from '../agentRunJournal.js';
import {
  codingCompletionEligibility,
  confirmCodingChildCancellation,
  finishCodingChild,
  registerCodingChild,
  requestCodingChildCancellation,
  startCodingChild,
  type CodingCompletionBlocker,
} from './codingChildren.js';
import type { CodingChildKind, CodingPhase, CodingRunPayloadV1 } from './codingRunPayload.js';
import { CODING_MUTATING_CHILD_KINDS } from './codingRunPayload.js';

/** The durable surface this wrapper needs. Injected so the ordering rules can be
 * tested without a live SQLite journal — the rules are the valuable part. */
export interface CodingRunStore {
  readPayload(): CodingRunPayloadV1;
  /** Returns false when the write did NOT land. Never throws; a caller that
   * cannot tell a failed write from a successful one cannot stay truthful. */
  writePayload(payload: CodingRunPayloadV1, note: string): boolean;
  parentState(): DurableAgentRunState;
  transitionParent(next: DurableAgentRunState, note: string): boolean;
}

export type StageStatus =
  /** Work ran and reported success; terminal evidence is durable. */
  | 'completed'
  /** Work ran and reported failure; terminal evidence is durable. */
  | 'failed'
  /** A durable completed child of this kind already existed — nothing re-ran. */
  | 'reused'
  /** Never dispatched: the child or its parent reference could not be persisted. */
  | 'refused'
  /** Cancellation was requested; no new work was launched. */
  | 'cancelled'
  /** The work threw. Recorded as an observed failure, not swallowed. */
  | 'errored';

export interface StageResult<T> {
  status: StageStatus;
  child?: DurableAgentRunChild;
  value?: T;
  /** Evidence recovered from a reused child, so a resumed run can continue. */
  reusedEvidence?: unknown;
  detail?: string;
}

/** What a stage's work reports back. Evidence is REQUIRED — a terminal state with
 * nothing behind it is the shape of an unverifiable completion claim. */
export interface StageWorkResult<T> {
  outcome: 'success' | 'failure';
  evidence: unknown;
  value: T;
  error?: { code: string; message: string };
}

export interface RunStageOptions {
  kind: CodingChildKind;
  /** Advanced on entry. The phase is only WRITTEN once the child is terminal. */
  phase: CodingPhase;
  required?: boolean;
  /** Reuse a durable completed child of this kind instead of re-running. */
  reuseIfCompleted?: boolean;
  metadata?: unknown;
}

const CHILD_ID_PREFIX = 'codingchild';

export class JournaledCodingRun {
  constructor(
    private readonly journal: AgentRunJournal,
    private readonly runId: string,
    private readonly store: CodingRunStore,
    private readonly now: () => number = () => Date.now(),
    private readonly mkChildId: (kind: CodingChildKind, attempt: number) => string =
      (kind, attempt) => `${CHILD_ID_PREFIX}_${kind}_${attempt}`,
  ) {}

  get payload(): CodingRunPayloadV1 {
    return this.store.readPayload();
  }

  children(): DurableAgentRunChild[] {
    return this.journal.children(this.runId);
  }

  /** Highest attempt recorded for a kind. Repeated stages increment under the
   * (run_id, kind, attempt) uniqueness constraint rather than colliding. */
  nextAttempt(kind: CodingChildKind): number {
    const attempts = this.children().filter((c) => c.kind === kind).map((c) => c.attempt);
    return attempts.length ? Math.max(...attempts) + 1 : 1;
  }

  /** A durable, successfully completed child of this kind, if one exists. */
  completedChild(kind: CodingChildKind): DurableAgentRunChild | undefined {
    return this.children().find((c) => c.kind === kind && c.state === 'completed' && c.terminalCategory === 'observed_success');
  }

  /** Cancellation was REQUESTED. Not an outcome — see `confirmCancellation`. */
  cancellationRequested(): boolean {
    return this.payload.cancellation !== undefined;
  }

  /**
   * Run one consequential stage under the dispatch invariant.
   *
   * The work function is only invoked after BOTH the child row and the parent's
   * reference to it are durable. If either write fails, the work never runs — a
   * request nothing can account for is the failure this ordering exists to
   * prevent, and it is strictly cheaper than an unexplained mutation.
   */
  async runStage<T>(opts: RunStageOptions, work: (child: DurableAgentRunChild) => Promise<StageWorkResult<T>>): Promise<StageResult<T>> {
    // 0 — cancellation is checked at the boundary, before anything is created.
    if (this.cancellationRequested()) {
      return { status: 'cancelled', detail: 'cancellation was requested; no new child was launched' };
    }

    // 0b — restart reuse. A stage whose durable child already succeeded must not
    // run a second time; re-running an apply is exactly the double-write the
    // recovery rules forbid.
    if (opts.reuseIfCompleted) {
      const existing = this.completedChild(opts.kind);
      if (existing) {
        this.advancePhase(opts.phase, `stage.reused:${opts.kind}`);
        return { status: 'reused', child: existing, reusedEvidence: parseEvidence(existing), detail: `reused durable ${opts.kind} from attempt ${existing.attempt}` };
      }
    }

    const attempt = this.nextAttempt(opts.kind);
    const childId = this.mkChildId(opts.kind, attempt);

    // 1 + 2 — existence, then reference. Refusal here means zero dispatch.
    const registration = registerCodingChild(this.journal, (p, note) => this.store.writePayload(p, note), {
      runId: this.runId,
      payload: this.payload,
      childId,
      kind: opts.kind,
      attempt,
      required: opts.required ?? true,
      at: this.now(),
      metadata: opts.metadata,
    });
    if (registration.decision !== 'dispatch') {
      return { status: 'refused', detail: registration.reason };
    }

    // 3 + 4 — dispatch, and only now does the child become `running`.
    const started = startCodingChild(this.journal, registration.child, this.now());
    if (!started) {
      return { status: 'refused', detail: 'the child could not be moved to running; nothing was dispatched' };
    }

    let result: StageWorkResult<T>;
    try {
      result = await work(started);
    } catch (error) {
      // A thrown stage is an OBSERVED failure with evidence, never a silent gap.
      const message = error instanceof Error ? error.message : String(error);
      const failed = finishCodingChild(this.journal, started, 'failure', this.now(), { threw: true, message }, { code: 'STAGE_THREW', message });
      return { status: 'errored', ...(failed ? { child: failed } : {}), detail: message };
    }

    // 5 — terminal evidence.
    const finished = finishCodingChild(
      this.journal, started, result.outcome, this.now(), result.evidence,
      ...(result.error ? [result.error] as const : []),
    );
    if (!finished) {
      // The outcome may be real but is NOT recorded. Reported as such rather than
      // promoted to the outcome the work claimed.
      return { status: 'errored', child: started, value: result.value, detail: 'the terminal revision for this stage did not persist' };
    }

    // 6 — the phase advances only now that the child's terminal revision landed.
    this.advancePhase(opts.phase, `stage.${result.outcome}:${opts.kind}`);
    return { status: result.outcome === 'success' ? 'completed' : 'failed', child: finished, value: result.value };
  }

  /** Write the phase. Never `terminal` — see `finalize`. */
  private advancePhase(phase: CodingPhase, note: string): void {
    if (phase === 'terminal') return;
    const current = this.payload;
    if (current.phase === phase) return;
    this.store.writePayload({ ...current, phase }, note);
  }

  /** Merge arbitrary payload fields (plan, scope, validation record, evidence). */
  patchPayload(patch: Partial<CodingRunPayloadV1>, note: string): boolean {
    return this.store.writePayload({ ...this.payload, ...patch }, note);
  }

  // ── Approval boundary ──────────────────────────────────────────────────────

  /**
   * Planning is finished; stop and wait for a human.
   *
   * This is a hard boundary. The same call must not continue into mutation: an
   * approval that has not been durably recorded is an approval that did not
   * happen, and resuming past it would mean writing files under authority nobody
   * can produce afterwards.
   */
  awaitScopeApproval(scope: NonNullable<CodingRunPayloadV1['scope']>, note = 'scope.proposed'): boolean {
    const written = this.patchPayload({ phase: 'awaiting_scope_approval', scope }, note);
    if (!written) return false;
    return this.store.transitionParent('AWAITING_APPROVAL', note);
  }

  /**
   * Consume an approval exactly once.
   *
   * `consumed` is a one-way door recorded in the payload, so a replayed approval
   * request cannot re-authorise mutation. The scope hash is compared before
   * anything else: an approval that arrives for a different path set is not late,
   * it is for a different plan.
   */
  consumeApproval(input: { pathSetHash: string; at: string }): { ok: true } | { ok: false; code: 'no-scope' | 'scope-mismatch' | 'not-pending' | 'already-consumed' | 'not-persisted' } {
    const current = this.payload;
    const scope = current.scope;
    if (!scope) return { ok: false, code: 'no-scope' };
    if (scope.approvalState === 'consumed' || scope.approvalState === 'approved') return { ok: false, code: 'already-consumed' };
    if (scope.approvalState !== 'pending_display' && scope.approvalState !== 'displayed') return { ok: false, code: 'not-pending' };
    if (scope.pathSetHash !== input.pathSetHash) return { ok: false, code: 'scope-mismatch' };
    const written = this.patchPayload(
      { scope: { ...scope, approvalState: 'consumed', approvedAt: input.at }, phase: 'executing_initial_changeset' },
      'scope.approved',
    );
    if (!written) return { ok: false, code: 'not-persisted' };
    return { ok: true };
  }

  // ── Cancellation ───────────────────────────────────────────────────────────

  /** Record the REQUEST. Says someone pressed stop; says nothing about stopping. */
  requestCancellation(at: string): boolean {
    const current = this.payload;
    if (current.cancellation) return true;
    return this.patchPayload({ cancellation: { requestedAt: at } }, 'cancellation.requested');
  }

  /**
   * Ask every active child to stop, then confirm only what actually stopped.
   *
   * A child that cannot be confirmed leaves the run unconfirmed, and the parent
   * resolves FAILED rather than CANCELLED — reporting `cancelled` for work that
   * may still be running is the precise lie this contract exists to prevent.
   */
  async confirmCancellation(input: {
    at: string;
    /** Observes whether a child's work actually stopped. */
    observeStopped: (child: DurableAgentRunChild) => Promise<boolean>;
  }): Promise<{ confirmed: boolean; unconfirmed: string[] }> {
    const unconfirmed: string[] = [];
    for (const child of this.children()) {
      if (DURABLE_CHILD_TERMINAL_STATES.has(child.state)) continue;
      const cancelling = child.state === 'cancelling' ? child : requestCodingChildCancellation(this.journal, child, this.now());
      if (!cancelling) { unconfirmed.push(child.childId); continue; }
      const stopped = await input.observeStopped(cancelling);
      if (!stopped) { unconfirmed.push(child.childId); continue; }
      const confirmed = confirmCodingChildCancellation(this.journal, cancelling, this.now(), { observedStopped: true });
      if (!confirmed) unconfirmed.push(child.childId);
    }
    if (unconfirmed.length) return { confirmed: false, unconfirmed };
    const current = this.payload;
    const requestedAt = current.cancellation?.requestedAt ?? input.at;
    this.patchPayload({ cancellation: { requestedAt, confirmedAt: input.at } }, 'cancellation.confirmed');
    return { confirmed: true, unconfirmed: [] };
  }

  // ── Terminal ───────────────────────────────────────────────────────────────

  /**
   * Resolve the parent.
   *
   * `phase: 'terminal'` is written ONLY after the parent's terminal revision is
   * durable. If that write fails the outcome may be real but is not recorded, and
   * the phase stays where it was — a payload claiming `terminal` with no terminal
   * parent revision would be a completion nothing can prove.
   */
  finalize(input: { report?: CodingRunPayloadV1['finalReport'] }): {
    state: 'COMPLETED' | 'FAILED' | 'CANCELLED';
    durable: boolean;
    blockers: CodingCompletionBlocker[];
  } {
    const current = this.payload;
    const eligibility = codingCompletionEligibility(current, this.children());
    let state: 'COMPLETED' | 'FAILED' | 'CANCELLED';
    if (eligibility.mayComplete) state = 'COMPLETED';
    else if (current.cancellation?.confirmedAt) state = 'CANCELLED';
    else state = 'FAILED';

    const durable = this.store.transitionParent(state, `run.${state.toLowerCase()}`);
    if (durable) {
      this.patchPayload({ phase: 'terminal', ...(input.report ? { finalReport: input.report } : {}) }, 'run.terminal');
    }
    return { state, durable, blockers: eligibility.blockers };
  }

  // ── Restart ────────────────────────────────────────────────────────────────

  /**
   * What may safely resume?
   *
   * A mutating child left `running` makes the working tree ambiguous, so nothing
   * may continue until that is reconciled. A mutating child still in `created` was
   * provably never dispatched, so abandoning it and starting a fresh attempt is
   * safe — those two look similar and must never be treated the same.
   */
  resumePlan(): {
    action: 'continue' | 'reconcile_mutation' | 'new_validation_attempt';
    ambiguousChildren: string[];
    abandonableChildren: string[];
    reusableKinds: CodingChildKind[];
  } {
    const children = this.children();
    const ambiguous: string[] = [];
    const abandonable: string[] = [];
    let interruptedValidation = false;

    for (const child of children) {
      const mutating = CODING_MUTATING_CHILD_KINDS.has(child.kind as CodingChildKind);
      const unresolved = !DURABLE_CHILD_TERMINAL_STATES.has(child.state);
      if (mutating && child.state === 'created') { abandonable.push(child.childId); continue; }
      if (mutating && (unresolved || child.terminalCategory === 'interrupted_by_restart')) { ambiguous.push(child.childId); continue; }
      if (child.state === 'created') abandonable.push(child.childId);
      if ((child.kind === 'validation' || child.kind === 'final_validation') && child.terminalCategory === 'interrupted_by_restart') {
        interruptedValidation = true;
      }
    }

    const reusableKinds = [...new Set(
      children.filter((c) => c.state === 'completed' && c.terminalCategory === 'observed_success').map((c) => c.kind as CodingChildKind),
    )];

    if (ambiguous.length) return { action: 'reconcile_mutation', ambiguousChildren: ambiguous, abandonableChildren: abandonable, reusableKinds };
    if (interruptedValidation) return { action: 'new_validation_attempt', ambiguousChildren: [], abandonableChildren: abandonable, reusableKinds };
    return { action: 'continue', ambiguousChildren: [], abandonableChildren: abandonable, reusableKinds };
  }
}

function parseEvidence(child: DurableAgentRunChild): unknown {
  if (!child.terminalEvidenceJson) return undefined;
  try { return JSON.parse(child.terminalEvidenceJson) as unknown; } catch { return undefined; }
}
