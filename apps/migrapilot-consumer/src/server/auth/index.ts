import 'server-only'

import {
  UnauthenticatedError,
  unconfiguredAuthPort,
  type AppSession,
  type AuthPort,
} from './authPort'
import { cookies } from 'next/headers'

import { logAuthEvent, secondsBetween } from './authTrace'
import { readEnv } from './env'

/**
 * The single place the application resolves its auth implementation.
 *
 * Today this returns the fail-closed default. When the app lands in the
 * monorepo, `migraAuthPort` (a thin adapter over `@migrateck/auth-client`)
 * replaces it here — one line, no other call site changes.
 */
/** An explicit override always wins. This is the test/injection seam. */
let override: AuthPort | undefined

/** Memoised per-runtime resolution. Cleared whenever the override changes. */
let resolved: Promise<AuthPort> | undefined

/** Install an implementation. Used by tests and by any explicit composition root. */
export function setAuthPort(port: AuthPort): void {
  override = port
  resolved = undefined
}

/**
 * The auth implementation for THIS runtime.
 *
 * Async and lazily resolved on purpose. It previously returned a module-level
 * variable that `instrumentation.ts` mutated — but Next runs that hook in a
 * separate module graph, so route handlers read a different instance and always
 * saw the fail-closed default. Resolving here means the runtime that serves the
 * request is the one that reads the environment.
 *
 * Fail-closed is preserved: a failed or incomplete resolution yields
 * `unconfiguredAuthPort`, which refuses every operation.
 */
export async function getAuthPort(): Promise<AuthPort> {
  if (override) return override
  if (!resolved) {
    resolved = import('./resolveAuthPort')
      .then(({ resolveAuthPort }) => resolveAuthPort())
      .then((resolution) => {
        if (!resolution.configured) {
          console.warn(`[auth] MigraAuth not configured (missing: ${resolution.missing.join(', ')}). Running fail-closed.`)
        }
        return resolution.port
      })
      .catch((error) => {
        // Never let a resolution fault promote into a served principal.
        console.error('[auth] auth port resolution failed; serving fail-closed.', error)
        return unconfiguredAuthPort
      })
  }
  return resolved
}

/** Restore the fail-closed default and drop any memoised resolution. Test hygiene. */
export function resetAuthPort(): void {
  override = undefined
  resolved = undefined
}

/**
 * An expired session is not a session — and the moment it stops being one is
 * RECORDED.
 *
 * 🚨 THE SILENCE WAS THE DEFECT. A staging session became unauthenticated with
 * nothing in the log for the entire window: no auth line, no 401, nothing an
 * operator could read. Two hypotheses were disproven from code alone and the
 * third could not be tested, because the event leaves no trace when it happens
 * and cannot be reproduced on demand.
 *
 * This is the one place that knows a session has just been refused, so it is
 * the one place that can say so. It reports HOW LONG the session lived, which
 * is the fact that distinguishes "the TTL is wrong" from "something cut it
 * short" — the exact question that could not be answered before.
 *
 * ── 🚨 AND IT IS NOT REACHED FOR AN ORDINARY EXPIRY. READ THIS BEFORE TRUSTING
 *    A `session_expired` LINE, OR ITS ABSENCE ──
 *
 * `@migrateck/auth-client`'s `readSession` returns **null** for a session past
 * `expiresAt` (`session.ts`: `if (Date.now() > session.expiresAt) return null`).
 * So by the time an expired session reaches this function it is already `null`,
 * the first branch takes it, and NOTHING below runs.
 *
 * Measured on staging 2026-09-27: a session that had expired logged
 * `session_absent`, never `session_expired`. The instrumentation was written to
 * tell "the cookie vanished" from "the session was refused" and it cannot tell
 * "expired" from "undecryptable" — which are the two cases an operator actually
 * has to separate. That was MY defect, and it was documented as fixing the
 * silence.
 *
 * This branch still fires for a session the port hands back WITH a past
 * `expiresAt` (a port that does not pre-filter, and the in-process test doubles),
 * so it is kept rather than deleted. It is simply not the signal to reason from
 * in production. `getSession` below records what is actually knowable there.
 */
const isLive = (session: AppSession | null): session is AppSession => {
  if (session === null) return false
  if (!session.expiresAt) return true
  const now = Date.now()
  if (session.expiresAt > now) return true
  logAuthEvent('session_expired', {
    livedSeconds: session.createdAt ? secondsBetween(session.createdAt, now) : undefined,
    remainingSeconds: secondsBetween(now, session.expiresAt),
    configuredTtlSeconds: session.createdAt
      ? Math.round(secondsBetween(session.createdAt, session.expiresAt))
      : undefined,
  })
  return false
}

/**
 * The current session, or null. Never throws for the unauthenticated case.
 *
 * Expiry is applied HERE, not only in `requireSession`. It used to be checked
 * only there, so an expired cookie still rendered a signed-in header while
 * every action behind it answered 401 — the shell claimed an identity the rest
 * of the app refused to honour. One definition of "signed in", for both.
 */
export async function getSession(): Promise<AppSession | null> {
  const session = await (await getAuthPort()).getSession()
  if (session) return isLive(session) ? session : null

  /*
   * 🚨 THE BLIND SPOT THIS CLOSES — and it is the most likely cause.
   *
   * `isLive` can only report a session it was GIVEN. When the port returns null
   * there is nothing to measure, so a session that vanished rather than expired
   * produced no line at all — which is precisely the unexplained case in §41.
   *
   * These are different failures with different fixes, and only the cookie tells
   * them apart:
   *   · no cookie at all  → the browser dropped it. A cookie Max-Age or domain
   *                         problem, or the person really did sign out.
   *   · cookie PRESENT and no session → the server refused it: a bad signature,
   *                         a rotated `APP_SESSION_SECRET`, or an expired payload.
   *
   * Only the SECOND is logged. An anonymous visitor with no cookie is ordinary
   * traffic, and logging every such request would bury the one line that matters
   * — a log nobody can read is the defect this whole module exists for.
   *
   * ── 🚨 "cookie present, no session" WAS NOT SPECIFIC ENOUGH ──
   *
   * It lumped together an EXPIRED session and a REJECTED one, and those have
   * opposite causes: the first is the TTL doing its job, the second is a rotated
   * `APP_SESSION_SECRET` or a tampered cookie. Measured on staging 2026-09-27: a
   * session that had simply expired logged exactly this line, and there was no way
   * to tell which had happened — while `session_expired`, written for the job,
   * never fires in production because the auth client returns null for an expired
   * session before `isLive` ever sees it.
   *
   * The session cookie is `base64url(JSON).hmac` — SIGNED, not encrypted — so the
   * payload's own timestamps are readable here without the secret, and the two
   * cases can finally be separated.
   *
   * WHAT IS AND IS NOT DONE WITH THAT PAYLOAD. It is decoded for DIAGNOSIS ONLY
   * and never trusted: the signature is not checked here, so nothing read from it
   * may influence any decision — this function still returns null either way. Only
   * DURATIONS are logged. No subject id, no email, no session id, no cookie value,
   * not truncated and not hashed; an unsigned payload is attacker-controlled, and
   * the one thing worse than an undiagnosable logout is a log that repeats
   * whatever a forged cookie put in it.
   */
  try {
    const jar = await cookies()
    const name = readEnv('APP_SESSION_COOKIE_NAME') ?? 'migrapilot_consumer_session'
    const raw = jar.get(name)?.value
    if (raw) logAuthEvent('session_absent', cookieDiagnosis(raw))
  } catch {
    /* No request scope — a unit test or a statically evaluated module. */
  }
  return null
}

/**
 * Why a present cookie produced no session, from the cookie's own shape.
 *
 * Never throws: this runs on a path that is already failing, and a diagnostic that
 * can break the request it is describing is worse than no diagnostic.
 */
/** Test seam: the classification, without a Next request scope. */
export const cookieDiagnosisForTest = (raw: string): ReturnType<typeof cookieDiagnosis> =>
  cookieDiagnosis(raw)

function cookieDiagnosis(raw: string): { reason: string; livedSeconds?: number; remainingSeconds?: number } {
  try {
    const payload = raw.split('.')[0]
    if (!payload) return { reason: 'cookie_malformed_no_payload' }
    const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof decoded !== 'object' || decoded === null) return { reason: 'cookie_payload_not_an_object' }

    const { createdAt, expiresAt } = decoded as { createdAt?: unknown; expiresAt?: unknown }
    if (typeof expiresAt !== 'number') return { reason: 'cookie_payload_has_no_expiry' }

    const now = Date.now()
    if (expiresAt <= now) {
      /*
       * The ordinary case, and the one that used to be indistinguishable. Both
       * numbers are here because they answer different questions: `livedSeconds`
       * says whether the TTL is what it should be, `remainingSeconds` (negative)
       * says how long ago it lapsed — i.e. whether the person was away or the
       * session died under their hands.
       */
      return {
        reason: 'session_expired_before_read',
        ...(typeof createdAt === 'number' ? { livedSeconds: secondsBetween(createdAt, expiresAt) } : {}),
        remainingSeconds: secondsBetween(now, expiresAt),
      }
    }
    /*
     * Still in date and still refused. The payload is fine, so the SIGNATURE is
     * not — a rotated `APP_SESSION_SECRET` (which invalidates every session at
     * once, across all users) or a tampered cookie. Worth alerting on; an expiry
     * is not.
     */
    return { reason: 'signature_rejected_while_unexpired', remainingSeconds: secondsBetween(now, expiresAt) }
  } catch {
    return { reason: 'cookie_unreadable' }
  }
}

/**
 * The session, or throw. Every server operation that touches tenant data must
 * go through this — it is the only sanctioned way to obtain a principal.
 */
export async function requireSession(): Promise<AppSession> {
  const session = await (await getAuthPort()).getSession()
  if (!session) throw new UnauthenticatedError()
  if (!isLive(session)) throw new UnauthenticatedError('Session expired.')
  return session
}

/**
 * The session shape a client component may receive.
 *
 * Deliberately narrow: no tokens, no productAccount blob, no session secret,
 * nothing that could be used to construct tenancy on the browser side.
 */
export interface PublicSession {
  displayName: string
  email: string
  activeOrgName?: string
  activeOrgRole?: string
  permissions: string[]
}

export function toPublicSession(session: AppSession): PublicSession {
  return {
    displayName: session.displayName ?? session.email,
    email: session.email,
    ...(session.activeOrgName ? { activeOrgName: session.activeOrgName } : {}),
    ...(session.activeOrgRole ? { activeOrgRole: session.activeOrgRole } : {}),
    permissions: session.permissions,
  }
}

export * from './authPort'
