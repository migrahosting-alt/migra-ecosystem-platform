// MigraPilot — authoritative Brain execution state.
//
// TRUTHFULNESS INVARIANT. This module exists because of a concrete failure: an
// operator issued a destructive call to prove a rule would REFUSE it, without first
// checking that the precondition which would cause the refusal had actually been
// established. The precondition creation had failed; the destructive call therefore
// succeeded and did real damage, and the outcome reported was the one that was
// *expected*, not the one that was *observed*.
//
// The rules below encode that lesson so the same class of error cannot recur here:
//
//  1. `completed` is unreachable except through observed terminal evidence. There is
//     no bare transition into it — see `observeTerminal()`.
//  2. Every operation passes through five explicit phases. An action cannot be
//     attempted until its precondition is CONFIRMED, not merely REQUESTED.
//  3. Cancellation never yields success. `cancelled` requires acknowledgement; an
//     unacknowledged cancel reports `cancellation_unconfirmed` and NEVER `cancelled`.
//  4. A late success arriving after cancellation is discarded, not promoted.
//  5. Illegal transitions are rejected and recorded as invariant failures rather
//     than silently coerced.
//
// The user-facing status and the durable record both derive from the single state
// object here, so they cannot disagree.

/** Every state the transport/execution layer can occupy.
 *
 * Distinct from `AgentModeState` in @migrapilot/protocol, which is the SERVER-owned
 * run lifecycle. This machine describes what *this extension* has actually observed
 * about connectivity and the in-flight operation. */
export type ExecutionState =
  /** Pre-dispatch. The record EXISTS on disk but nothing has been sent yet, so a
   * restart that finds one knows for certain no work was started. Initial-only:
   * nothing transitions INTO `created`. */
  | 'created'
  | 'disconnected'
  | 'connecting'
  | 'ready'
  | 'degraded'
  | 'failed'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'completed';

/** Observed failure categories. Deliberately specific: "it broke" is not a
 * diagnosis, and a generic Error erases the difference between "nothing was
 * listening" and "we sent the work and never learned the outcome". */
export type FailureCategory =
  | 'connection_refused'
  | 'connection_lost'
  | 'request_timeout'
  | 'invalid_response'
  | 'brain_process_exit'
  | 'cancellation_unconfirmed'
  | 'precondition_failed'
  | 'terminal_state_unverified';

/** The five phases every operation passes through. An action may not be attempted
 * until its precondition is CONFIRMED — phase 2, not phase 1. */
export type OperationPhase =
  | 'precondition_requested'
  | 'precondition_confirmed'
  | 'action_attempted'
  | 'response_received'
  | 'terminal_verified';

/** Legal transitions. Anything absent is an invariant violation.
 *
 * `completed` appears as a target ONLY from `running`, and even then the bare
 * transition is not exposed — `observeTerminal()` is the only way in. */
const LEGAL: Record<ExecutionState, readonly ExecutionState[]> = {
  // A created child either gets dispatched, or is abandoned before dispatch when its
  // parent reference could not be written. It can never reach a success state.
  created: ['connecting', 'failed'],
  disconnected: ['connecting'],
  connecting: ['ready', 'degraded', 'failed', 'disconnected'],
  ready: ['running', 'degraded', 'disconnected', 'failed'],
  running: ['completed', 'failed', 'cancelling', 'degraded'],
  cancelling: ['cancelled', 'failed'],
  // Terminal-for-this-operation. They may begin a NEW cycle, but they can never
  // reach `completed` — the operation they describe did not succeed.
  cancelled: ['connecting', 'disconnected', 'ready'],
  failed: ['connecting', 'disconnected'],
  completed: ['ready', 'disconnected', 'connecting'],
  degraded: ['connecting', 'ready', 'failed', 'disconnected'],
};

/** Transitions that must never occur, asserted explicitly so the guarantee is
 * testable rather than merely implied by the table above. */
export const FORBIDDEN_TRANSITIONS: ReadonlyArray<readonly [ExecutionState, ExecutionState]> = [
  ['failed', 'completed'],
  ['cancelled', 'completed'],
  ['cancelling', 'completed'],
  ['disconnected', 'completed'],
  ['disconnected', 'ready'],
  ['disconnected', 'running'],
  // A record that was never dispatched cannot have succeeded, run, or been cancelled.
  ['created', 'completed'],
  ['created', 'running'],
  ['created', 'cancelled'],
];

export function isLegalTransition(from: ExecutionState, to: ExecutionState): boolean {
  return (LEGAL[from] ?? []).includes(to);
}

/** One recorded step in the operation's life. */
export interface TransitionRecord {
  readonly from: ExecutionState;
  readonly to: ExecutionState;
  readonly at: string;
  readonly reason: string;
  /** Present only when the transition was refused. */
  readonly rejected?: true;
}

export interface TransportAttempt {
  readonly at: string;
  readonly endpoint: string;
  readonly outcome: 'response' | 'error';
  readonly detail: string;
}

/** Everything an operation must be able to prove after the fact. The durable record
 * and the user-facing status derive from this same object. */
export interface ExecutionRecord {
  readonly operationId: string;
  readonly requestedAction: string;
  readonly brainEndpoint: string;
  readonly startedAt: string;
  endedAt?: string;
  state: ExecutionState;
  phase?: OperationPhase;
  failureCategory?: FailureCategory;
  /** Free-text detail of what was actually observed. Never a guess. */
  failureDetail?: string;
  cancellationRequestedAt?: string;
  cancellationAcknowledgedAt?: string;
  /** True only when a terminal response was actually observed on the wire. */
  terminalObserved: boolean;
  transitions: TransitionRecord[];
  transportAttempts: TransportAttempt[];
  commands: string[];
  filesChanged: string[];
  testsRun: string[];
  failures: string[];
  remainingWork: string[];
  invariantViolations: string[];
}

export interface Clock {
  now(): string;
}

const systemClock: Clock = { now: () => new Date().toISOString() };

/**
 * The authoritative state object for one Brain operation.
 *
 * Deliberately has no network access: it is pure, so every rule below is directly
 * testable without a live Brain.
 */
export class ExecutionStateMachine {
  private readonly record: ExecutionRecord;

  constructor(
    init: { operationId: string; requestedAction: string; brainEndpoint: string },
    private readonly clock: Clock = systemClock,
  ) {
    this.record = {
      operationId: init.operationId,
      requestedAction: init.requestedAction,
      brainEndpoint: init.brainEndpoint,
      startedAt: clock.now(),
      state: 'disconnected',
      terminalObserved: false,
      transitions: [],
      transportAttempts: [],
      commands: [],
      filesChanged: [],
      testsRun: [],
      failures: [],
      remainingWork: [],
      invariantViolations: [],
    };
  }

  get state(): ExecutionState {
    return this.record.state;
  }

  /** A defensive copy — callers must not mutate authoritative state directly. */
  snapshot(): ExecutionRecord {
    return JSON.parse(JSON.stringify(this.record)) as ExecutionRecord;
  }

  /**
   * Attempt a transition. Illegal transitions are REJECTED and recorded as invariant
   * violations — never silently applied, and never silently ignored.
   *
   * Returns whether the transition was applied.
   */
  transition(to: ExecutionState, reason: string): boolean {
    const from = this.record.state;
    if (!isLegalTransition(from, to)) {
      const violation = `illegal transition ${from} -> ${to} (${reason})`;
      this.record.invariantViolations.push(violation);
      this.record.transitions.push({ from, to, at: this.clock.now(), reason, rejected: true });
      return false;
    }
    this.record.transitions.push({ from, to, at: this.clock.now(), reason });
    this.record.state = to;
    if (to === 'cancelled' || to === 'failed' || to === 'completed') {
      this.record.endedAt = this.clock.now();
    }
    return true;
  }

  // ── Five-phase operation gating ─────────────────────────────────────────────

  requestPrecondition(what: string): void {
    this.record.phase = 'precondition_requested';
    this.record.commands.push(`precondition requested: ${what}`);
  }

  /**
   * Confirm the precondition was actually established. `observed` must be the real
   * result of checking — passing `false` records the failure rather than proceeding.
   */
  confirmPrecondition(observed: boolean, detail: string): boolean {
    if (!observed) {
      this.fail('precondition_failed', `precondition not confirmed: ${detail}`);
      return false;
    }
    this.record.phase = 'precondition_confirmed';
    return true;
  }

  /**
   * Gate for the destructive action. THIS is the guard that the governance incident
   * lacked: an action may not be attempted while the precondition is merely
   * *requested*. Returns false and records `precondition_failed` instead of throwing,
   * so callers cannot proceed by ignoring an exception.
   */
  mayAttemptAction(): boolean {
    if (this.record.phase !== 'precondition_confirmed') {
      this.fail(
        'precondition_failed',
        `action refused: phase is ${this.record.phase ?? 'none'}, expected precondition_confirmed`,
      );
      return false;
    }
    return true;
  }

  markActionAttempted(endpoint: string): void {
    this.record.phase = 'action_attempted';
    this.record.transportAttempts.push({
      at: this.clock.now(),
      endpoint,
      outcome: 'response',
      detail: 'dispatched',
    });
  }

  markResponseReceived(): void {
    this.record.phase = 'response_received';
  }

  /**
   * The ONLY route to `completed`.
   *
   * Requires that a terminal response was actually observed. If cancellation was
   * requested, a late success is DISCARDED — the operation did not succeed just
   * because a stale response arrived.
   */
  observeTerminal(terminalObserved: boolean, detail: string): boolean {
    if (this.record.cancellationRequestedAt) {
      this.record.failures.push(`late terminal response discarded after cancellation: ${detail}`);
      return false;
    }
    if (!terminalObserved) {
      this.fail('terminal_state_unverified', `terminal state not verified: ${detail}`);
      return false;
    }
    this.record.terminalObserved = true;
    this.record.phase = 'terminal_verified';
    return this.transition('completed', detail);
  }

  // ── Cancellation contract ───────────────────────────────────────────────────

  requestCancellation(reason: string): void {
    this.record.cancellationRequestedAt = this.clock.now();
    this.record.remainingWork.push(`cancellation requested: ${reason}`);
    // Only a live operation can enter `cancelling`. Cancelling an already-terminal
    // operation is a no-op, not an error, and must not rewrite its outcome.
    if (this.record.state === 'running') {
      this.transition('cancelling', reason);
    }
  }

  /**
   * Resolve a cancellation. `acknowledged` must reflect what was actually observed —
   * an acknowledgement from the Brain, or conclusive transport termination.
   *
   * When it cannot be confirmed the state does NOT become `cancelled`; it becomes
   * `failed` with `cancellation_unconfirmed`, and the operator is told exactly that.
   */
  resolveCancellation(acknowledged: boolean, detail: string): void {
    if (acknowledged) {
      this.record.cancellationAcknowledgedAt = this.clock.now();
      this.transition('cancelled', detail);
      return;
    }
    this.fail('cancellation_unconfirmed', `Cancellation requested but not confirmed: ${detail}`);
  }

  // ── Failure ─────────────────────────────────────────────────────────────────

  /** Record an observed failure. Recoverable categories degrade; the rest fail. */
  fail(category: FailureCategory, detail: string): void {
    this.record.failureCategory = category;
    this.record.failureDetail = detail;
    this.record.failures.push(`${category}: ${detail}`);
    const recoverable = category === 'connection_lost' || category === 'request_timeout';
    const target: ExecutionState = recoverable && this.record.state === 'ready' ? 'degraded' : 'failed';
    if (!this.transition(target, detail) && target === 'failed') {
      // Even when the transition is illegal the failure is still recorded above, so
      // a refused transition can never be mistaken for success.
      this.record.invariantViolations.push(`failure could not be applied from ${this.record.state}`);
    }
  }

  recordTransportAttempt(endpoint: string, outcome: 'response' | 'error', detail: string): void {
    this.record.transportAttempts.push({ at: this.clock.now(), endpoint, outcome, detail });
  }

  noteCommand(command: string): void {
    this.record.commands.push(command);
  }

  noteFileChanged(path: string): void {
    this.record.filesChanged.push(path);
  }

  noteTest(name: string): void {
    this.record.testsRun.push(name);
  }

  noteRemainingWork(item: string): void {
    this.record.remainingWork.push(item);
  }

  /**
   * The single user-facing sentence, derived from the same object as the durable
   * record so the two can never disagree. Never optimistic.
   */
  statusLine(): string {
    const r = this.record;
    switch (r.state) {
      case 'completed':
        return 'Completed — terminal response observed.';
      case 'cancelled':
        return 'Cancelled — cancellation acknowledged.';
      case 'cancelling':
        return 'Cancelling — stopping work, awaiting acknowledgement.';
      case 'failed':
        return r.failureCategory === 'cancellation_unconfirmed'
          ? 'Cancellation requested but not confirmed'
          : `Failed — ${r.failureCategory ?? 'unknown'}${r.failureDetail ? `: ${r.failureDetail}` : ''}`;
      case 'degraded':
        return `Degraded — ${r.failureCategory ?? 'recoverable transport problem'}. Recovery still possible.`;
      case 'running':
        return 'Running — no terminal response yet.';
      case 'created':
        return 'Created — nothing has been dispatched yet.';
      case 'ready':
        return 'Ready.';
      case 'connecting':
        return 'Connecting…';
      case 'disconnected':
      default:
        return 'Disconnected.';
    }
  }
}

/** Rehydrate a persisted operation after an extension or Brain restart.
 *
 * An operation that was mid-flight when the process died did NOT complete. It is
 * reported as `terminal_state_unverified` rather than being optimistically closed
 * or silently dropped. */
export function recoverFromRecord(record: ExecutionRecord): ExecutionRecord {
  const wasInFlight =
    record.state === 'running' || record.state === 'connecting' || record.state === 'cancelling';
  if (!wasInFlight) return record;

  const recovered: ExecutionRecord = JSON.parse(JSON.stringify(record));
  const at = new Date().toISOString();

  if (record.state === 'cancelling') {
    recovered.state = 'failed';
    recovered.failureCategory = 'cancellation_unconfirmed';
    recovered.failureDetail = 'process restarted while cancelling; acknowledgement never observed';
  } else {
    recovered.state = 'failed';
    recovered.failureCategory = 'terminal_state_unverified';
    recovered.failureDetail = 'process restarted while the operation was in flight';
  }
  recovered.transitions.push({
    from: record.state,
    to: 'failed',
    at,
    reason: 'recovered after restart — outcome was never observed',
  });
  recovered.failures.push(`${recovered.failureCategory}: ${recovered.failureDetail}`);
  recovered.remainingWork.push('Operation outcome unknown; re-run if still required.');
  recovered.endedAt = at;
  return recovered;
}
