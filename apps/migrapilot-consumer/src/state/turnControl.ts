/**
 * The in-flight turn registry — what makes Stop possible.
 *
 * A streamed turn could not be stopped. The SERVER was already correct about
 * cancellation: aborting the request runs the stream route's `cancel()`, which
 * returns the Brain generator and stops the model costing time. Nothing in the
 * browser ever aborted anything, so the only way to end a running turn was to
 * close the tab — and a graphics card kept working on an answer nobody was
 * waiting for, while the user sat in front of a control that could only send.
 *
 * WHY A REGISTRY RATHER THAN ONE CONTROLLER. The conversation an in-flight turn
 * belongs to CHANGES MID-TURN: a new chat is sent under an optimistic
 * client-side id and the Brain names it a moment later, so a Stop pressed after
 * the `meta` frame arrives is asking about a different id than the one the turn
 * opened with. `rekey` is what keeps the control pointed at its own turn across
 * that rename — without it, Stop would silently do nothing on exactly the turns
 * that take long enough to want stopping.
 */

/** One running turn, and the two facts a stop needs to know about it. */
export interface InFlightTurn {
  /** The conversation as it is CURRENTLY known. Updated by `rekey`. */
  conversationId: string
  controller: AbortController
  /**
   * True only when the USER stopped it.
   *
   * A stop surfaces in the browser exactly where a dropped connection does — a
   * rejected read — and the two must not read the same on screen. One is the
   * user's own decision and needs no apology; the other is a fault worth
   * reporting. Nothing else can tell them apart after the fact.
   */
  stopped: boolean
}

/**
 * Every turn currently streaming.
 *
 * A list rather than a map keyed by conversation: two turns on one conversation
 * is not reachable from the UI (the send control becomes Stop while a turn
 * runs), but if it ever happens, a keyed store would leave the first turn
 * running with nothing able to reach it. Stopping a conversation stops every
 * turn open on it.
 */
export class TurnRegistry {
  private turns: InFlightTurn[] = []

  /** Register a turn about to be sent, and hand back its abort handle. */
  open(conversationId: string): InFlightTurn {
    const turn: InFlightTurn = { conversationId, controller: new AbortController(), stopped: false }
    this.turns.push(turn)
    return turn
  }

  /** Follow a conversation through the Brain naming it. */
  rekey(from: string, to: string): void {
    if (from === to) return
    for (const turn of this.turns) {
      if (turn.conversationId === from) turn.conversationId = to
    }
  }

  /**
   * Stop what is running on this conversation. Returns whether anything was.
   *
   * Marking BEFORE aborting matters: the abort rejects the reader synchronously
   * enough that the handler can observe `stopped` in the same tick, and a turn
   * that read `false` there would be reported to the user as an outage.
   */
  stop(conversationId: string): boolean {
    const running = this.turns.filter((turn) => turn.conversationId === conversationId)
    for (const turn of running) {
      turn.stopped = true
      turn.controller.abort()
    }
    return running.length > 0
  }

  /**
   * Retire a finished turn.
   *
   * By IDENTITY, never by conversation id: a turn that ends while a later one is
   * open on the same conversation must not deregister its successor and leave
   * that one unstoppable.
   */
  close(turn: InFlightTurn): void {
    const at = this.turns.indexOf(turn)
    if (at >= 0) this.turns.splice(at, 1)
  }

  /** Is a turn streaming on this conversation right now? */
  isRunning(conversationId: string): boolean {
    return this.turns.some((turn) => turn.conversationId === conversationId)
  }
}

/** What a stopped turn had produced by the time the user stopped it. */
export interface StoppedTurn {
  /** Text painted into the bubble so far. */
  streamed: string
  /** Pictures this turn already made durable, by count. */
  generated: number
}

/**
 * Keep the partial answer, or say nothing arrived.
 *
 * Neither branch may imply the answer was saved. The stream route persists ONLY
 * a completed turn, so a stopped one is on screen and nowhere else — which is
 * worth keeping (the user stopped because they had read enough) and worth
 * labelling (a reload will not have it).
 */
export type StopOutcome = { keep: true } | { keep: false; notice: string }

export function stoppedOutcome(turn: StoppedTurn): StopOutcome {
  /*
   * A PICTURE IS AN ANSWER — the same rule as the delivery path, for the same
   * reason. An image-generation turn produces no text, so judging this by
   * `streamed` alone would discard a picture the user watched arrive and had
   * every right to stop after.
   */
  if (turn.streamed.trim() || turn.generated > 0) return { keep: true }
  return { keep: false, notice: 'You stopped this turn before the model produced anything.' }
}
