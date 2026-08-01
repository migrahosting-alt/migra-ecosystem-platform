// MigraPilot — governed CHAT TURNS.
//
// A chat turn is not a Brain request. It is the unit of work the USER asked for, and
// it may dispatch zero, one, or several Brain operations. Modelling it as a Brain
// operation would be a lie in the other direction — so it gets its own record, its own
// state machine, and its own file, with the Brain operations as CHILDREN.
//
// The whole reason this module exists: `cancelled: token.isCancellationRequested` was
// being reported as a turn outcome. A VS Code CancellationToken is a REQUEST signal.
// It says someone pressed stop; it says nothing about whether the work stopped.
//
// ── Write ordering ──────────────────────────────────────────────────────────
//
//   existence first  →  reference second  →  dispatch third
//
// Generate the child id, persist the child as `created`, append it to the parent and
// persist the parent, and only then dispatch. Never the reverse. A parent that names a
// child which does not exist is unrecoverable — recovery cannot tell "never written"
// from "lost" — whereas a child with no parent reference is merely an orphan, and an
// orphan still in `created` is provably harmless because nothing was ever sent.

import type { ExecutionState } from './executionState.js';
import { isLegalTransition } from './executionState.js';
import {
  SCHEMA_VERSION,
  type BrainStore,
  type PersistedBrainOperation,
} from './brainPersistence.js';

/** A turn is never `ready` or `degraded` — those describe a transport, not work. */
export type ChatTurnState = 'running' | 'cancelling' | 'cancelled' | 'completed' | 'failed';

export type ChatTurnFailure =
  /** A child this turn dispatched never reached a persisted terminal record. */
  | 'child_unresolved'
  /** The parent names a child that is not on disk. Never allowed to occur forward;
   * detectable only from a corrupted or externally-modified store. */
  | 'referential_integrity_violated'
  /** The parent's own terminal revision could not be written. */
  | 'terminal_not_persisted'
  | 'cancellation_unconfirmed'
  | 'child_failed';

export interface PersistedChatTurn {
  schemaVersion: typeof SCHEMA_VERSION;
  revision: number;
  turnId: string;
  operationKind: 'chat_turn';
  currentState: ChatTurnState;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  /** Only ids whose reference write SUCCEEDED. An id here is a promise that the child
   * record exists; that promise is what recovery relies on. */
  childOperationIds: string[];
  /** Children whose parent-reference write failed, so they were never dispatched. */
  abandonedChildIds?: string[];
  cancellation?: { requestedAt: string; acknowledgedAt?: string; confirmed: boolean };
  terminalEvidence?: {
    observedAt: string;
    outcome: 'success' | 'failure' | 'cancelled';
    evidenceType: string;
  };
  failure?: ChatTurnFailure;
  transitions: Array<{ from: string; to: string; at: string; reason: string; rejected?: true }>;
  invariantViolations: string[];
  recovery?: { evidence: ChatTurnRecovery; recoveredAt: string };
}

export type ChatTurnRecovery =
  | 'turn_interrupted'
  | 'cancellation_acknowledgment_missing'
  | 'child_missing'
  | 'child_never_dispatched'
  | 'child_orphaned'
  | 'child_terminal_under_nonterminal_parent';

const LEGAL_TURN: Record<ChatTurnState, readonly ChatTurnState[]> = {
  running: ['cancelling', 'completed', 'failed'],
  cancelling: ['cancelled', 'failed'],
  cancelled: [],
  completed: [],
  failed: [],
};

/** Outcome of registering a child. `dispatch` is the ONLY value that permits a send. */
export type ChildRegistration =
  | { decision: 'dispatch'; childId: string }
  | { decision: 'orphaned_before_dispatch'; childId: string; reason: string };

export interface ChatTurnPersister {
  save(turn: PersistedChatTurn): Promise<PersistedChatTurn>;
}

/** Minimal child record: exists on disk, state `created`, nothing dispatched. */
export function createdChildRecord(
  childId: string,
  requestedAction: string,
  now: string,
): PersistedBrainOperation {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 1,
    operationId: childId,
    requestedAction,
    operationKind: 'consequential',
    currentState: 'created' as ExecutionState,
    startedAt: now,
    updatedAt: now,
    transitions: [],
    invariantViolations: [],
    precondition: { required: true },
    transportAttempts: [],
    commands: [],
    changedFiles: [],
    tests: [],
    failures: [],
    remainingWork: [],
  };
}

/**
 * The parent record for one chat turn.
 *
 * Every mutation is driven by an OBSERVED fact. There is no method that marks a turn
 * complete because it is probably complete.
 */
export class ChatTurnExecution {
  private turn: PersistedChatTurn;
  /** Child terminal outcomes this turn actually observed, keyed by child id. */
  private readonly observed = new Map<string, 'success' | 'failure' | 'cancelled'>();
  /** Whether the terminal revision was actually written. Only `finish()` sets it. */
  private terminalDurable = false;

  private constructor(
    turn: PersistedChatTurn,
    private readonly store: BrainStore,
    private readonly now: () => string,
  ) {
    this.turn = turn;
  }

  /**
   * Create and PERSIST the parent before anything can reference it.
   *
   * Rejects if the first write fails: a turn whose parent does not exist cannot
   * legally dispatch a child, because the child's reference would have nowhere to go.
   */
  static async begin(
    store: BrainStore,
    turnId: string,
    now: () => string = () => new Date().toISOString(),
  ): Promise<ChatTurnExecution> {
    const at = now();
    const turn: PersistedChatTurn = {
      schemaVersion: SCHEMA_VERSION,
      revision: 1,
      turnId,
      operationKind: 'chat_turn',
      currentState: 'running',
      startedAt: at,
      updatedAt: at,
      childOperationIds: [],
      transitions: [],
      invariantViolations: [],
    };
    const saved = await store.saveTurn(turn);
    return new ChatTurnExecution(saved, store, now);
  }

  snapshot(): PersistedChatTurn {
    return JSON.parse(JSON.stringify(this.turn)) as PersistedChatTurn;
  }

  get state(): ChatTurnState {
    return this.turn.currentState;
  }

  get childIds(): readonly string[] {
    return [...this.turn.childOperationIds];
  }

  private transition(to: ChatTurnState, reason: string): boolean {
    const from = this.turn.currentState;
    const at = this.now();
    if (!LEGAL_TURN[from].includes(to)) {
      // Recorded, not thrown. A refused transition is evidence of a bug and must
      // survive into the record rather than vanishing into an exception handler.
      this.turn.transitions.push({ from, to, at, reason, rejected: true });
      this.turn.invariantViolations.push(`illegal turn transition ${from} -> ${to} (${reason})`);
      return false;
    }
    this.turn.transitions.push({ from, to, at, reason });
    this.turn.currentState = to;
    return true;
  }

  private async persist(): Promise<boolean> {
    this.turn.revision += 1;
    try {
      this.turn = await this.store.saveTurn({ ...this.turn, updatedAt: this.now() });
      return true;
    } catch {
      // Roll the in-memory revision back so the next attempt does not skip a number
      // and make the on-disk chain look gapped.
      this.turn.revision -= 1;
      return false;
    }
  }

  /**
   * existence → reference → dispatch.
   *
   * The child record is written FIRST, in `created`. Only once the parent's reference
   * is durable does the caller get permission to dispatch. If the parent write fails
   * the child is marked `failed`/abandoned and dispatch is refused — a Brain request
   * that no record can account for is exactly what this slice exists to prevent.
   */
  async registerChild(childId: string, requestedAction: string): Promise<ChildRegistration> {
    if (this.turn.currentState !== 'running') {
      return {
        decision: 'orphaned_before_dispatch',
        childId,
        reason: `turn is ${this.turn.currentState}, not accepting children`,
      };
    }

    // 1 — existence.
    try {
      await this.store.saveOperation(createdChildRecord(childId, requestedAction, this.now()));
    } catch (err) {
      return { decision: 'orphaned_before_dispatch', childId, reason: `child not created: ${String(err)}` };
    }

    // 2 — reference.
    this.turn.childOperationIds.push(childId);
    if (!(await this.persist())) {
      this.turn.childOperationIds = this.turn.childOperationIds.filter((id) => id !== childId);
      this.turn.abandonedChildIds = [...(this.turn.abandonedChildIds ?? []), childId];
      await this.abandonChild(childId, 'parent reference not persisted');
      // Best-effort: record the abandonment. Even if THIS write fails, the child on
      // disk is still `created`, which is provably "never dispatched".
      await this.persist();
      return {
        decision: 'orphaned_before_dispatch',
        childId,
        reason: 'parent reference not persisted',
      };
    }

    // 3 — the caller may now dispatch.
    return { decision: 'dispatch', childId };
  }

  /** Move an undispatched child out of `created` so it is never mistaken for live. */
  private async abandonChild(childId: string, reason: string): Promise<void> {
    try {
      const existing = await this.store.readOperation(childId);
      if (!existing) return;
      const to: ExecutionState = 'failed';
      if (!isLegalTransition(existing.currentState, to)) return;
      await this.store.saveOperation({
        ...existing,
        revision: existing.revision + 1,
        currentState: to,
        endedAt: this.now(),
        failures: [...existing.failures, `orphaned_before_dispatch: ${reason}`],
        transitions: [
          ...existing.transitions,
          { from: existing.currentState, to, at: this.now(), reason: 'orphaned_before_dispatch' },
        ],
      });
    } catch {
      /* the child stays `created`, which recovery already reads as never-dispatched */
    }
  }

  /**
   * created → running, persisted.
   *
   * The walk goes through `connecting` and `ready` because `created → running` is
   * FORBIDDEN: a record must pass through the states that describe actually reaching
   * the endpoint. All three steps land in one revision — the transition list carries
   * the path, so nothing is lost by not writing three times.
   */
  async startChild(childId: string): Promise<boolean> {
    const existing = await this.store.readOperation(childId);
    if (!existing) {
      this.turn.invariantViolations.push(`cannot start missing child ${childId}`);
      return false;
    }
    const at = this.now();
    const path: ExecutionState[] = ['connecting', 'ready', 'running'];
    const transitions = [...existing.transitions];
    let from: ExecutionState = existing.currentState;
    for (const to of path) {
      if (!isLegalTransition(from, to)) {
        transitions.push({ from, to, at, reason: 'child start', rejected: true });
        return false;
      }
      transitions.push({ from, to, at, reason: 'child start' });
      from = to;
    }
    try {
      await this.store.saveOperation({
        ...existing,
        revision: existing.revision + 1,
        currentState: 'running',
        transitions,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Persist the child's terminal evidence. Awaited by the dispatcher, so the caller
   * cannot continue on an outcome that was never written down.
   */
  async finishChild(
    childId: string,
    outcome: 'success' | 'failure' | 'cancelled',
    detail?: string,
  ): Promise<boolean> {
    const existing = await this.store.readOperation(childId);
    if (!existing) {
      this.turn.invariantViolations.push(`cannot finish missing child ${childId}`);
      return false;
    }
    const to: ExecutionState =
      outcome === 'success' ? 'completed' : outcome === 'cancelled' ? 'cancelled' : 'failed';
    const at = this.now();
    // `running → cancelled` is not legal directly; a cancelled child must have passed
    // through `cancelling`, and that path is recorded rather than skipped.
    const path: ExecutionState[] = outcome === 'cancelled' ? ['cancelling', 'cancelled'] : [to];
    const transitions = [...existing.transitions];
    let from: ExecutionState = existing.currentState;
    for (const step of path) {
      if (!isLegalTransition(from, step)) {
        transitions.push({ from, to: step, at, reason: 'child terminal', rejected: true });
        this.turn.invariantViolations.push(
          `illegal child transition ${from} -> ${step} for ${childId}`,
        );
        return false;
      }
      transitions.push({ from, to: step, at, reason: 'child terminal' });
      from = step;
    }
    try {
      await this.store.saveOperation({
        ...existing,
        revision: existing.revision + 1,
        currentState: from,
        endedAt: at,
        transitions,
        terminalEvidence: {
          observedAt: at,
          outcome: outcome === 'success' ? 'success' : 'failure',
          evidenceType: `child_${outcome}`,
        },
        ...(detail ? { failures: [...existing.failures, detail] } : {}),
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Record an OBSERVED child terminal outcome. Never inferred from the parent. */
  noteChildTerminal(childId: string, outcome: 'success' | 'failure' | 'cancelled'): void {
    if (!this.turn.childOperationIds.includes(childId)) {
      this.turn.invariantViolations.push(`terminal reported for unreferenced child ${childId}`);
      return;
    }
    this.observed.set(childId, outcome);
  }

  /** The user pressed stop. A REQUEST — not an outcome. */
  async requestCancellation(): Promise<void> {
    if (this.turn.currentState !== 'running') return;
    this.turn.cancellation = { requestedAt: this.now(), confirmed: false };
    this.transition('cancelling', 'user requested cancellation');
    await this.persist();
  }

  /**
   * Cancellation was ACKNOWLEDGED — work actually stopped.
   *
   * Without this, `finish()` reports `cancellation_unconfirmed`, because a request that
   * was never acknowledged means the work may still be running.
   */
  acknowledgeCancellation(): void {
    if (!this.turn.cancellation) return;
    this.turn.cancellation.acknowledgedAt = this.now();
    this.turn.cancellation.confirmed = true;
  }

  /**
   * Resolve the turn against OBSERVED facts and durable child records.
   *
   * Completion requires all of:
   *   - every referenced child resolves to a record on disk, and
   *   - that record is terminal, and
   *   - the parent's own terminal revision persisted.
   *
   * A missing child is a referential-integrity failure, never a completion.
   */
  async finish(): Promise<{ state: ChatTurnState; durable: boolean; failure?: ChatTurnFailure }> {
    // Idempotent: a turn is resolved once. The wrapper calls this in a `finally`, so a
    // path that already resolved explicitly must not be re-resolved into a different
    // answer — and must not push a second terminal revision.
    if (this.turn.currentState !== 'running' && this.turn.currentState !== 'cancelling') {
      return {
        state: this.turn.currentState,
        // NOT hardcoded true. If the first finish() failed to write the terminal
        // revision, the state still moved in memory, so the wrapper's `finally` would
        // hit this path and report durable — masking exactly the durability failure
        // this design exists to surface. `terminalDurable` is what was OBSERVED.
        durable: this.terminalDurable,
        ...(this.turn.failure ? { failure: this.turn.failure } : {}),
      };
    }
    const unresolved: string[] = [];
    const missing: string[] = [];
    let anyChildFailed = false;

    for (const childId of this.turn.childOperationIds) {
      let record: PersistedBrainOperation | undefined;
      try {
        record = await this.store.readOperation(childId);
      } catch {
        record = undefined;
      }
      if (!record) {
        missing.push(childId);
        continue;
      }
      if (record.currentState === 'completed') continue;
      if (record.currentState === 'failed' || record.currentState === 'cancelled') {
        anyChildFailed = true;
        continue;
      }
      unresolved.push(childId);
    }

    let failure: ChatTurnFailure | undefined;
    let target: ChatTurnState;

    if (missing.length > 0) {
      failure = 'referential_integrity_violated';
      this.turn.invariantViolations.push(`referenced child record(s) absent: ${missing.join(', ')}`);
      target = 'failed';
    } else if (unresolved.length > 0) {
      failure = 'child_unresolved';
      target = 'failed';
    } else if (this.turn.cancellation && !this.turn.cancellation.confirmed) {
      failure = 'cancellation_unconfirmed';
      target = 'failed';
    } else if (this.turn.cancellation?.confirmed) {
      target = 'cancelled';
    } else if (anyChildFailed) {
      failure = 'child_failed';
      target = 'failed';
    } else {
      target = 'completed';
    }

    // A cancelling turn cannot go straight to `completed`; the table refuses it and the
    // refusal is recorded rather than silently downgraded.
    if (!this.transition(target, failure ?? 'resolved from observed child outcomes')) {
      this.transition('failed', `illegal resolution to ${target}`);
      failure = failure ?? 'child_unresolved';
    }

    this.turn.endedAt = this.now();
    // Re-read through an explicit annotation: the idempotence guard above narrowed the
    // field, but `transition()` has since mutated it.
    const finalState = this.turn.currentState as ChatTurnState;
    this.turn.terminalEvidence = {
      observedAt: this.now(),
      outcome:
        finalState === 'completed' ? 'success' : finalState === 'cancelled' ? 'cancelled' : 'failure',
      evidenceType: 'child_records_resolved',
    };
    if (failure) this.turn.failure = failure;

    const durable = await this.persist();
    this.terminalDurable = durable;
    if (!durable && !this.turn.failure) this.turn.failure = 'terminal_not_persisted';
    return {
      state: this.turn.currentState,
      durable,
      ...(this.turn.failure ? { failure: this.turn.failure } : {}),
    };
  }
}

/** One reconciliation finding. Bidirectional: parent→child AND child→parent. */
export interface ReconciliationFinding {
  kind:
    | 'parent_references_missing_child'
    | 'child_never_dispatched'
    | 'child_orphaned'
    | 'active_child_under_interrupted_parent'
    | 'terminal_child_under_nonterminal_parent';
  turnId?: string;
  childId?: string;
  detail: string;
}

/**
 * Reconcile turns against operations after a restart.
 *
 * Deliberately reports rather than repairs. Every finding below is a state the forward
 * write ordering is supposed to make impossible or harmless; seeing one means either a
 * crash landed in the one-write window, or something modified the store. Silently
 * "fixing" either would destroy the evidence.
 */
export function reconcile(
  turns: readonly PersistedChatTurn[],
  operations: readonly PersistedBrainOperation[],
): ReconciliationFinding[] {
  const byId = new Map(operations.map((o) => [o.operationId, o]));
  const referenced = new Set<string>();
  const findings: ReconciliationFinding[] = [];
  const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

  for (const turn of turns) {
    const parentTerminal = TERMINAL.has(turn.currentState);
    for (const childId of turn.childOperationIds) {
      referenced.add(childId);
      const child = byId.get(childId);
      if (!child) {
        // The dangerous direction, and the reason references are written second.
        findings.push({
          kind: 'parent_references_missing_child',
          turnId: turn.turnId,
          childId,
          detail: 'parent names a child with no record — outcome unknowable',
        });
        continue;
      }
      if (child.currentState === 'created') {
        findings.push({
          kind: 'child_never_dispatched',
          turnId: turn.turnId,
          childId,
          detail: 'child exists but was never dispatched — provably no work was sent',
        });
        continue;
      }
      if (!parentTerminal && TERMINAL.has(child.currentState)) {
        findings.push({
          kind: 'terminal_child_under_nonterminal_parent',
          turnId: turn.turnId,
          childId,
          detail: `child is ${child.currentState} but the turn is ${turn.currentState}`,
        });
      }
      if (parentTerminal && !TERMINAL.has(child.currentState)) {
        findings.push({
          kind: 'active_child_under_interrupted_parent',
          turnId: turn.turnId,
          childId,
          detail: `child is ${child.currentState} under a ${turn.currentState} turn`,
        });
      }
    }
  }

  // child → parent. An unreferenced child still in `created` is the benign case the
  // ordering guarantees; anything further along was dispatched with no parent record.
  for (const op of operations) {
    if (referenced.has(op.operationId)) continue;
    if (op.operationKind === 'health' || op.operationKind === 'diagnostic') continue;
    findings.push({
      kind: op.currentState === 'created' ? 'child_never_dispatched' : 'child_orphaned',
      childId: op.operationId,
      detail:
        op.currentState === 'created'
          ? 'unreferenced and never dispatched — safe to discard'
          : `unreferenced child in ${op.currentState} — dispatched with no owning turn`,
    });
  }

  return findings;
}
