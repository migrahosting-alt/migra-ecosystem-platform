// The five terminal states a long-running operation may end in, and the single
// place that decides which one applies.
//
// WHY A VOCABULARY AT ALL
//
// These outcomes were previously implicit, and the implicit answer was wrong in
// both directions that matter. A generation that was still running when a
// deadline fired reached the user as HTTP 500 — a timeout reported as a model
// failure. And a client that went away mid-stream had no distinct outcome at all,
// so an interrupted answer was indistinguishable from a finished one.
//
// The rule: a timeout is never a failure of the model, a cancellation is never a
// failure of anything, and a client that stopped listening is never a success.

export type OperationOutcome =
  /** The work finished and produced its result. */
  | 'completed'
  /** The work ran and genuinely failed — the model or the tool said no. */
  | 'failed'
  /** A deadline fired while the work was still legitimately running. */
  | 'timed_out'
  /** A human stopped it. Downstream work was aborted; this is not a failure. */
  | 'cancelled'
  /** The transport died mid-answer. What was produced is partial, never complete. */
  | 'stream_interrupted';

/** Terminal states in which a result may be trusted as whole. */
export const COMPLETE_OUTCOMES: ReadonlySet<OperationOutcome> = new Set<OperationOutcome>(['completed']);

export interface OutcomeEvidence {
  /** A human asked to stop, and the abort was issued downstream. */
  cancelled?: boolean;
  /** A deadline fired. Carries which one, for the message. */
  timedOut?: { clock: 'connect' | 'idle' | 'response' | 'absolute'; limitMs: number; elapsedMs: number };
  /** The response stream ended before the engine signalled completion. */
  streamEndedEarly?: boolean;
  /** The engine signalled a normal end. */
  engineCompleted?: boolean;
  /** A genuine error from the work itself. */
  error?: { message: string } | undefined;
}

/**
 * Decide the terminal state.
 *
 * Order matters and encodes the rules above: an explicit human stop wins over
 * everything, because a cancelled request often ALSO looks like a broken stream;
 * a fired deadline outranks a generic error, because the error is usually just
 * the abort surfacing; and an early-ended stream is never `completed` even if
 * some content arrived.
 */
export function classifyOutcome(evidence: OutcomeEvidence): OperationOutcome {
  if (evidence.cancelled) return 'cancelled';
  if (evidence.timedOut) return 'timed_out';
  if (evidence.streamEndedEarly && !evidence.engineCompleted) return 'stream_interrupted';
  if (evidence.error) return 'failed';
  return evidence.engineCompleted ? 'completed' : 'stream_interrupted';
}

/** A user-facing sentence that states the outcome without blaming the wrong thing. */
export function describeOutcome(outcome: OperationOutcome, evidence: OutcomeEvidence = {}): string {
  switch (outcome) {
    case 'completed':
      return 'Completed.';
    case 'cancelled':
      return 'Cancelled — the work was stopped and nothing further was run.';
    case 'timed_out': {
      const t = evidence.timedOut;
      return t
        ? `Timed out — the ${t.clock} limit of ${Math.round(t.limitMs / 1000)}s was reached after ${Math.round(t.elapsedMs / 1000)}s. The work was still running; this is a deadline, not a failure of the answer.`
        : 'Timed out — a deadline was reached while the work was still running.';
    }
    case 'stream_interrupted':
      return 'The connection ended before the answer finished. What arrived is partial.';
    case 'failed':
      return evidence.error?.message ? `Failed — ${evidence.error.message}` : 'Failed.';
  }
}
