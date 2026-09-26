/**
 * Why did this person stop being signed in?
 *
 * 🚨 THE DEFECT THIS EXISTS FOR IS THE SILENCE, NOT THE LOGOUT.
 *
 * A live staging session became an unauthenticated one, and `journalctl` for the
 * whole window held no auth line, no refresh line, no 401 line — nothing an
 * operator could read. Three hypotheses were investigated from code alone and
 * two were disproven; the third could not be tested because the event cannot be
 * reproduced on demand and leaves no trace when it happens.
 *
 * That is the actual failure. A session that ends is ordinary; a session that
 * ends leaving nothing to read is undiagnosable, and every future occurrence
 * costs the same investigation over again.
 *
 * ── WHAT THIS MAY NEVER CONTAIN ──
 *
 * No access token, no refresh token, no session secret, no cookie value, no
 * authorization header, no client secret. Not truncated, not hashed-with-a-hint,
 * not "just the first few characters". The rule is that reading every line this
 * emits must never move anyone closer to holding a credential — which is why it
 * takes DURATIONS and BOOLEANS rather than values, and why the payload is built
 * from named fields instead of spreading an object that might carry one.
 *
 * A subject id is deliberately NOT logged either. "Which user" is answerable
 * from the request context an operator already has; putting identity in an auth
 * log invites it to become an audit trail, which has different rules.
 */

/** The stages an operator must be able to tell apart. */
export type AuthEvent =
  /** A session was read and honoured. Only emitted near expiry — see below. */
  | 'session_expiring_soon'
  /** A session existed and was rejected as expired. The logout moment. */
  | 'session_expired'
  /** No session at all was present on a request that wanted one. */
  | 'session_absent'
  /** The access token was past its life and a renewal was about to be tried. */
  | 'token_expired'
  | 'refresh_attempted'
  | 'refresh_succeeded'
  | 'refresh_failed'
  /** Renewal succeeded but storing it did not — the rotated token is now lost. */
  | 'renewal_persist_failed'
  /** Nothing further can be done without the person signing in again. */
  | 'reauth_required'

export interface AuthEventFields {
  /** How long the thing that just ended had lived, in seconds. */
  livedSeconds?: number
  /** How long it had left when observed, in seconds. Negative means overdue. */
  remainingSeconds?: number
  /** The configured lifetime, so a wrong TTL is visible without reading env. */
  configuredTtlSeconds?: number
  /** HTTP status from the issuer, when one was received. */
  status?: number
  /** Whether a client secret was configured for this exchange. NOT the secret. */
  clientSecretConfigured?: boolean
  /** Short, non-sensitive reason. Never an issuer body, which may echo input. */
  reason?: string
}

/**
 * One line, structured, greppable.
 *
 * `console.warn` rather than `error`: these are operational facts, and a session
 * ending normally is not a fault. An operator greps `[auth]` and reads the
 * sequence; a monitor can alert on `refresh_failed` without drowning in the
 * ordinary ones.
 */
export function logAuthEvent(event: AuthEvent, fields: AuthEventFields = {}): void {
  const payload: Record<string, unknown> = { event }
  // Named copies, never a spread: a spread would carry whatever a caller happened
  // to hand it, which is exactly how a token reaches a log by accident.
  if (typeof fields.livedSeconds === 'number') payload.livedSeconds = Math.round(fields.livedSeconds)
  if (typeof fields.remainingSeconds === 'number') payload.remainingSeconds = Math.round(fields.remainingSeconds)
  if (typeof fields.configuredTtlSeconds === 'number') payload.configuredTtlSeconds = fields.configuredTtlSeconds
  if (typeof fields.status === 'number') payload.status = fields.status
  if (typeof fields.clientSecretConfigured === 'boolean') {
    payload.clientSecretConfigured = fields.clientSecretConfigured
  }
  if (typeof fields.reason === 'string' && fields.reason) payload.reason = fields.reason.slice(0, 120)

  try {
    console.warn(`[auth] ${JSON.stringify(payload)}`)
  } catch {
    /* Logging must never be the thing that fails a request. */
  }
}

/** Seconds between two epoch millisecond marks, positive when `later` is later. */
export function secondsBetween(earlierMs: number, laterMs: number): number {
  return (laterMs - earlierMs) / 1000
}
