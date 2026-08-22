/**
 * Anonymous chat allowance.
 *
 * A person lands on the site and can talk to MigraPilot before signing in. That
 * costs real inference, so it is bounded — and the bound has to be a server-side
 * fact, not a number the browser reports about itself.
 *
 * THE SPLIT THAT MATTERS. {@link evaluateAnonymousQuota} is a pure projection
 * for RENDERING: it turns a known count into what the user should see. It is
 * NOT the authority. The authoritative decrement happens inside a persistence
 * transaction when a turn is accepted, via {@link AnonymousTurnReservation} —
 * because `count++` after generation loses races to refreshes, retries and
 * double-clicks, and every one of those is free inference.
 */

export interface AnonymousChatQuota {
  mode: 'anonymous';
  allowed: boolean;

  limit: number;
  used: number;
  remaining: number;

  resetAt?: string;

  warning: boolean;
  exhausted: boolean;
}

/**
 * Render-time projection of a KNOWN count. Never the authority.
 *
 * Clamps rather than trusting its inputs: a negative or over-large `used` is a
 * bug somewhere upstream, and the honest response is a coherent quota object
 * rather than a negative `remaining` rendered as "-3 messages left".
 */
export function evaluateAnonymousQuota(input: {
  limit: number;
  used: number;
  warningThreshold?: number;
}): AnonymousChatQuota {
  const limit = Math.max(0, input.limit);
  const used = Math.max(0, input.used);
  const remaining = Math.max(0, limit - used);
  const warningThreshold = input.warningThreshold ?? 2;

  return {
    mode: 'anonymous',
    allowed: remaining > 0,
    limit,
    used,
    remaining,
    warning: remaining > 0 && remaining <= warningThreshold,
    exhausted: remaining === 0,
  };
}

/* ── Reservation ─────────────────────────────────────────────────────────── */

export interface AnonymousTurnReservation {
  anonymousSessionId: string;
  reservationId: string;
  remainingAfterReservation: number;
}

/**
 * Why a reservation was refused. Distinct from a failure to reserve.
 */
export type ReservationRefusal =
  | { kind: 'exhausted'; quota: AnonymousChatQuota }
  | { kind: 'unknown_session' }
  | { kind: 'persistence_unavailable' };

export type ReservationOutcome =
  | { ok: true; reservation: AnonymousTurnReservation }
  | { ok: false; refusal: ReservationRefusal };

/**
 * What happens to a reservation when the turn does not produce useful output.
 *
 * The policy, encoded rather than guessed inside a UI handler:
 *
 *   a valid completed turn CONSUMES quota — including one the user dislikes;
 *   infrastructure failure before useful output does NOT.
 *
 * The asymmetry is deliberate. Charging for our own outage teaches people the
 * product is broken AND stingy; refunding a completed answer because the user
 * asked again makes the limit meaningless.
 */
export type ReservationSettlement =
  /** The turn produced an answer. The reservation is spent. */
  | { kind: 'consume'; reservationId: string }
  /** Infrastructure failed before useful output. The reservation returns. */
  | { kind: 'release'; reservationId: string; reason: string };

/**
 * Decide the settlement from what actually happened to the turn.
 *
 * `producedOutput` is the pivot, not the HTTP status: a stream that delivered
 * tokens and then failed to persist DID give the user something, and a 200 that
 * returned an empty answer did not.
 */
export function settleReservation(input: {
  reservationId: string;
  producedOutput: boolean;
  failure?: 'persistence_unavailable' | 'brain_unreachable' | 'model_timeout' | 'cancelled';
}): ReservationSettlement {
  if (input.producedOutput) return { kind: 'consume', reservationId: input.reservationId };

  const reason = input.failure ?? 'no_output';
  return { kind: 'release', reservationId: input.reservationId, reason };
}

/* ── Claiming an anonymous conversation ──────────────────────────────────── */

export interface ClaimAnonymousConversationRequest {
  anonymousConversationId: string;
  /**
   * Proof that this browser owns the anonymous conversation.
   *
   * Server-issued and server-verified. The browser NEVER submits a user id and
   * asks for the conversation to be made theirs — that would let anyone claim
   * any conversation by guessing an id.
   */
  anonymousSessionToken: string;
}

export interface ClaimAnonymousConversationResult {
  conversationId: string;
  claimed: boolean;
  /** Present when `claimed` is false, so the UI can say what happened. */
  reason?: 'invalid_token' | 'not_found' | 'already_claimed' | 'persistence_unavailable';
}
