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
  | 'stream_interrupted'
  /**
   * The engine finished normally and produced nothing usable.
   *
   * Measured: an Explain returned a title, a provenance line and an unterminated
   * code fence — 67 bytes, no error — and was presented to the user as a finished
   * answer. Nothing failed, so nothing said so. An empty answer is not a
   * completed one, and calling it `completed` is the same class of untruth as
   * reporting a dead stream as success.
   */
  | 'empty_completion';

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
  /** The answer the engine produced, for the emptiness check. */
  content?: string;
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
  if (!evidence.engineCompleted) return 'stream_interrupted';
  // A normal end that produced nothing usable is not a completed answer.
  return evidence.content !== undefined && !isSubstantive(evidence.content) ? 'empty_completion' : 'completed';
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
    case 'empty_completion':
      return 'The model returned no usable answer. Nothing failed — there is simply nothing to show, so this is not reported as a result.';
    case 'failed':
      return evidence.error?.message ? `Failed — ${evidence.error.message}` : 'Failed.';
  }
}

/**
 * Is there an actual answer in here?
 *
 * Deliberately crude and generous: strip code fences, list bullets, headings and
 * whitespace, and ask whether anything is left. It is looking for the difference
 * between "an answer" and "punctuation", not judging quality — a wrong answer is
 * still an answer and belongs to the model, not to this check.
 */
export function isSubstantive(content: string): boolean {
  const stripped = content
    .replace(/^```[^\n]*$/gm, '')      // fence markers, opened or closed
    .replace(/^#{1,6}\s.*$/gm, '')      // headings
    .replace(/^[-*+>\s]+$/gm, '')       // bare bullets and rules
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length >= 40;
}
