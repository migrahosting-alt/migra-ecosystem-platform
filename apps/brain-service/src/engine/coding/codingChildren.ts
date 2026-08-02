/**
 * MigraAI Engine — durable child operations for a governed coding run.
 *
 * The coding modules (planner, apply, validation, repair) own DOMAIN behaviour.
 * This module owns LIFECYCLE TRUTH: what was authorised, what was actually
 * dispatched, what finished, and whether the parent is entitled to claim it is
 * done. Those are different questions, and a module that answers both tends to
 * answer the second one optimistically.
 *
 * ── The dispatch invariant ──────────────────────────────────────────────────
 *
 *   persist child (created) → persist parent reference → dispatch
 *     → running → terminal evidence → parent reconciliation
 *
 * Existence is written before the reference, and the reference before the send.
 * Never the reverse. A parent naming a child with no record is UNRECOVERABLE —
 * recovery cannot distinguish "never written" from "lost", so the outcome of
 * real work becomes unknowable. A child with no parent reference is merely an
 * orphan, and an orphan still in `created` is provably harmless because nothing
 * was ever sent. The cheap failure is chosen deliberately.
 *
 * If the parent reference cannot be persisted, the child is abandoned and
 * dispatch is REFUSED. A request nothing can account for is the exact failure
 * this ordering exists to prevent. © MigraTeck LLC.
 */

import type { AgentRunJournal } from '../agentRunJournal.js';
import type { DurableAgentRunChild } from '../persistence/types.js';
import { DURABLE_CHILD_TERMINAL_STATES } from '../persistence/types.js';
import type { CodingChildKind, CodingChildRef, CodingRunPayloadV1 } from './codingRunPayload.js';

/** Outcome of registering a child. `dispatch` is the ONLY value that permits a send. */
export type CodingChildRegistration =
  | { decision: 'dispatch'; child: DurableAgentRunChild; payload: CodingRunPayloadV1 }
  | { decision: 'refused'; childId: string; reason: string; payload: CodingRunPayloadV1 };

/** Persists the parent's domain payload. Returns false when the write did NOT
 * land — callers must treat that as "the reference does not exist", never as a
 * warning to log and continue past. */
export type PayloadWriter = (payload: CodingRunPayloadV1, note: string) => boolean;

/**
 * Steps 1 and 2 of the invariant.
 *
 * On a failed reference write the child is driven out of `created` so it can
 * never be mistaken for live work, and its id is recorded as abandoned. Even if
 * THAT write also fails, the row on disk is still `created`, which reconciliation
 * already reads as provably-never-dispatched.
 */
export function registerCodingChild(
  journal: AgentRunJournal,
  writePayload: PayloadWriter,
  input: {
    runId: string;
    payload: CodingRunPayloadV1;
    childId: string;
    kind: CodingChildKind;
    attempt?: number;
    required?: boolean;
    at: number;
    metadata?: unknown;
  },
): CodingChildRegistration {
  const attempt = input.attempt ?? 1;

  // A cancelling or cancelled run must not acquire new work.
  if (input.payload.cancellation) {
    return { decision: 'refused', childId: input.childId, reason: 'cancellation requested; not accepting new children', payload: input.payload };
  }

  // 1 — existence.
  const created = journal.registerChild({
    childId: input.childId, runId: input.runId, kind: input.kind, attempt,
    required: input.required ?? true, at: input.at, metadata: input.metadata,
  });
  if (!created.ok) {
    return { decision: 'refused', childId: input.childId, reason: `child not created: ${created.code}`, payload: input.payload };
  }

  // 2 — reference.
  const ref: CodingChildRef = { childId: input.childId, kind: input.kind, attempt };
  const next: CodingRunPayloadV1 = { ...input.payload, childRefs: [...input.payload.childRefs, ref] };
  if (!writePayload(next, `child.registered:${input.kind}`)) {
    const abandoned = abandonChild(journal, created.child, input.at, 'parent reference not persisted');
    const payload: CodingRunPayloadV1 = {
      ...input.payload,
      abandonedChildIds: [...(input.payload.abandonedChildIds ?? []), input.childId],
    };
    // Best effort — the child row already proves nothing was dispatched.
    writePayload(payload, 'child.abandoned');
    return {
      decision: 'refused',
      childId: input.childId,
      reason: abandoned ? 'parent reference not persisted' : 'parent reference not persisted; child left in created',
      payload,
    };
  }

  // 3 — the caller may now dispatch.
  return { decision: 'dispatch', child: created.child, payload: next };
}

function abandonChild(journal: AgentRunJournal, child: DurableAgentRunChild, at: number, reason: string): boolean {
  const result = journal.transitionChild({
    childId: child.childId, expectedRevision: child.revision, nextState: 'failed', at, endedAt: at,
    terminalCategory: 'orphaned_before_dispatch', terminalEvidence: { reason },
  });
  return result.ok;
}

/** Step 4. `created → running` is the only way work begins. */
export function startCodingChild(journal: AgentRunJournal, child: DurableAgentRunChild, at: number): DurableAgentRunChild | undefined {
  const result = journal.transitionChild({ childId: child.childId, expectedRevision: child.revision, nextState: 'running', at, startedAt: at });
  return result.ok ? result.child : undefined;
}

/** A cancellation REQUEST. Says someone pressed stop; says nothing about whether
 * the work stopped. `running → cancelled` is refused by the table for this reason. */
export function requestCodingChildCancellation(journal: AgentRunJournal, child: DurableAgentRunChild, at: number): DurableAgentRunChild | undefined {
  const result = journal.transitionChild({ childId: child.childId, expectedRevision: child.revision, nextState: 'cancelling', at, cancellationRequestedAt: at });
  return result.ok ? result.child : undefined;
}

/** Cancellation CONFIRMED — the work was observed to stop. */
export function confirmCodingChildCancellation(journal: AgentRunJournal, child: DurableAgentRunChild, at: number, evidence: unknown): DurableAgentRunChild | undefined {
  const result = journal.transitionChild({
    childId: child.childId, expectedRevision: child.revision, nextState: 'cancelled', at, endedAt: at,
    cancellationConfirmedAt: at, terminalCategory: 'cancellation_confirmed', terminalEvidence: evidence,
  });
  return result.ok ? result.child : undefined;
}

/** Step 5. Terminal state plus the evidence that justifies it. */
export function finishCodingChild(
  journal: AgentRunJournal,
  child: DurableAgentRunChild,
  outcome: 'success' | 'failure',
  at: number,
  evidence: unknown,
  error?: { code: string; message: string },
): DurableAgentRunChild | undefined {
  const result = journal.transitionChild({
    childId: child.childId, expectedRevision: child.revision,
    nextState: outcome === 'success' ? 'completed' : 'failed', at, endedAt: at,
    terminalCategory: outcome === 'success' ? 'observed_success' : 'observed_failure',
    terminalEvidence: evidence, error,
  });
  return result.ok ? result.child : undefined;
}

/** Required children that are not yet terminal. */
export function activeRequiredChildren(journal: AgentRunJournal, runId: string): DurableAgentRunChild[] {
  return journal.blockingChildren(runId);
}

/**
 * Restart: mark every non-terminal child interrupted.
 *
 * `interrupted` is deliberately not `failed`. The outcome is UNKNOWN, not
 * known-bad — an apply that was live at process death may have written files.
 * Resuming means a new child; this record is never rewritten into a success.
 */
export function markInterruptedChildren(journal: AgentRunJournal, runId: string, at: number): DurableAgentRunChild[] {
  const interrupted: DurableAgentRunChild[] = [];
  for (const child of journal.children(runId)) {
    if (DURABLE_CHILD_TERMINAL_STATES.has(child.state)) continue;
    const result = journal.transitionChild({
      childId: child.childId, expectedRevision: child.revision, nextState: 'interrupted', at, endedAt: at,
      terminalCategory: child.state === 'created' ? 'orphaned_before_dispatch' : 'interrupted_by_restart',
      terminalEvidence: { priorState: child.state, reason: 'process restarted while the operation was unresolved' },
    });
    if (result.ok) interrupted.push(result.child);
  }
  return interrupted;
}

// ── Bidirectional reconciliation ─────────────────────────────────────────────

export type CodingReconciliationKind =
  /** The dangerous direction — and the reason references are written second. */
  | 'parent_references_missing_child'
  | 'child_never_dispatched'
  | 'child_orphaned'
  | 'active_child_under_terminal_parent'
  | 'terminal_child_under_nonterminal_parent';

export interface CodingReconciliationFinding {
  kind: CodingReconciliationKind;
  childId: string;
  detail: string;
}

/**
 * Compare what the parent claims against what the child rows say, in BOTH
 * directions. Pure, so the rules are testable without a live journal.
 *
 * Reports rather than repairs. Every finding below is a state the write ordering
 * is meant to make impossible or harmless; seeing one means a crash landed in the
 * one-write window, or something modified the store. Silently "fixing" either
 * would destroy the evidence that says so.
 */
export function reconcileCodingChildren(
  payload: Pick<CodingRunPayloadV1, 'childRefs' | 'abandonedChildIds'>,
  children: readonly DurableAgentRunChild[],
  parentTerminal: boolean,
): CodingReconciliationFinding[] {
  const byId = new Map(children.map((c) => [c.childId, c]));
  const referenced = new Set(payload.childRefs.map((r) => r.childId));
  const abandoned = new Set(payload.abandonedChildIds ?? []);
  const findings: CodingReconciliationFinding[] = [];

  for (const ref of payload.childRefs) {
    const child = byId.get(ref.childId);
    if (!child) {
      findings.push({ kind: 'parent_references_missing_child', childId: ref.childId, detail: 'the parent names a child with no record — its outcome is unknowable' });
      continue;
    }
    if (child.state === 'created') {
      findings.push({ kind: 'child_never_dispatched', childId: ref.childId, detail: 'the child exists but was never dispatched — provably no work was sent' });
      continue;
    }
    const terminal = DURABLE_CHILD_TERMINAL_STATES.has(child.state);
    if (parentTerminal && !terminal) {
      findings.push({ kind: 'active_child_under_terminal_parent', childId: ref.childId, detail: `child is ${child.state} under a terminal parent` });
    }
    if (!parentTerminal && terminal && child.terminalCategory === 'interrupted_by_restart') {
      findings.push({ kind: 'terminal_child_under_nonterminal_parent', childId: ref.childId, detail: 'child was interrupted while the parent remained active' });
    }
  }

  // child → parent. An unreferenced child still in `created` is the benign case
  // the ordering guarantees; anything further along was dispatched with no parent
  // record naming it.
  for (const child of children) {
    if (referenced.has(child.childId) || abandoned.has(child.childId)) continue;
    findings.push({
      kind: child.state === 'created' ? 'child_never_dispatched' : 'child_orphaned',
      childId: child.childId,
      detail: child.state === 'created'
        ? 'unreferenced and never dispatched — safe to discard'
        : `unreferenced child in ${child.state} — dispatched with no owning parent reference`,
    });
  }

  return findings;
}

// ── Parent completion eligibility ────────────────────────────────────────────

export type CodingCompletionBlocker =
  /** The run recorded no successful required work at all. */
  | { kind: 'no_work_recorded'; detail: string }
  | { kind: 'active_required_child'; childId: string; state: string }
  | { kind: 'required_child_not_successful'; childId: string; category?: string }
  | { kind: 'reconciliation_finding'; childId: string; detail: string }
  | { kind: 'cancellation_unconfirmed'; detail: string }
  | { kind: 'cancellation_requested'; detail: string };

export interface CodingCompletionEligibility {
  /** True only when the parent may claim a SUCCESSFUL terminal state. */
  mayComplete: boolean;
  blockers: CodingCompletionBlocker[];
  findings: CodingReconciliationFinding[];
}

/**
 * May this parent claim success?
 *
 * Terminality of a child is not enough. `interrupted` and `failed` are terminal
 * and are not successes, so the CATEGORY is consulted rather than mere
 * terminality — which is exactly the shortcut a `success` boolean would have
 * invited. A run whose cancellation was requested can never complete
 * successfully, and one whose cancellation was never confirmed cannot claim to
 * have been cancelled either.
 */
export function codingCompletionEligibility(
  payload: Pick<CodingRunPayloadV1, 'childRefs' | 'abandonedChildIds' | 'cancellation'>,
  children: readonly DurableAgentRunChild[],
): CodingCompletionEligibility {
  const blockers: CodingCompletionBlocker[] = [];
  const findings = reconcileCodingChildren(payload, children, false);

  for (const finding of findings) {
    // An unreferenced, never-dispatched child is provably harmless.
    if (finding.kind === 'child_never_dispatched') continue;
    blockers.push({ kind: 'reconciliation_finding', childId: finding.childId, detail: `${finding.kind}: ${finding.detail}` });
  }

  // COMPLETION REQUIRES POSITIVE EVIDENCE, NOT THE ABSENCE OF OBJECTIONS.
  //
  // Without this, a run that never registered a single child — planning that
  // failed before its first write, a driver that returned early — had no blockers
  // and was therefore reported COMPLETED. A run that did nothing is not a run that
  // succeeded, and this was observed: `children: [], blockers: [], COMPLETED`.
  const referenced = new Set(payload.childRefs.map((r) => r.childId));
  const successfulRequired = children.filter(
    (c) => referenced.has(c.childId) && c.required && c.state === 'completed' && c.terminalCategory === 'observed_success',
  );
  if (successfulRequired.length === 0) {
    blockers.push({ kind: 'no_work_recorded', detail: 'no required operation completed successfully; a run that recorded no work has not succeeded' });
  }

  for (const child of children) {
    if (!referenced.has(child.childId)) continue;
    if (!child.required) continue;
    if (!DURABLE_CHILD_TERMINAL_STATES.has(child.state)) {
      blockers.push({ kind: 'active_required_child', childId: child.childId, state: child.state });
      continue;
    }
    if (child.terminalCategory !== 'observed_success') {
      blockers.push({ kind: 'required_child_not_successful', childId: child.childId, category: child.terminalCategory });
    }
  }

  if (payload.cancellation) {
    blockers.push(payload.cancellation.confirmedAt
      ? { kind: 'cancellation_requested', detail: 'cancellation was confirmed; this run did not complete' }
      : { kind: 'cancellation_unconfirmed', detail: 'cancellation was requested but never confirmed; work may still be running' });
  }

  return { mayComplete: blockers.length === 0, blockers, findings };
}

/**
 * The parent's terminal state, computed from observed facts.
 *
 * `durable` reports whether the terminal revision actually landed. It is NOT
 * hardcoded true: if the write failed, the outcome may be real but is not
 * recorded, and the caller must suppress a normal success rather than report one
 * nothing can prove.
 */
export function resolveCodingRun(
  payload: Pick<CodingRunPayloadV1, 'childRefs' | 'abandonedChildIds' | 'cancellation'>,
  children: readonly DurableAgentRunChild[],
  persistTerminal: (state: 'COMPLETED' | 'FAILED' | 'CANCELLED') => boolean,
): { state: 'COMPLETED' | 'FAILED' | 'CANCELLED'; durable: boolean; blockers: CodingCompletionBlocker[] } {
  const eligibility = codingCompletionEligibility(payload, children);
  let state: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  if (eligibility.mayComplete) {
    state = 'COMPLETED';
  } else if (payload.cancellation?.confirmedAt) {
    // Confirmed cancellation is its own outcome — never a success, never a bare
    // failure. A late child success arriving after this cannot promote it.
    state = 'CANCELLED';
  } else {
    state = 'FAILED';
  }
  const durable = persistTerminal(state);
  return { state, durable, blockers: eligibility.blockers };
}
