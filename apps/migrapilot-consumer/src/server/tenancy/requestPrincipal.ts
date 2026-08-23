import 'server-only'

/**
 * The principal for THE CURRENT REQUEST, resolved once and carried explicitly.
 *
 * WHY ONCE, AND WHY EXPLICITLY. A request may make several Brain calls — create
 * the conversation, append the prompt, run the turn, append the answer. If each
 * one re-resolved the principal, a visitor arriving with no cookie would mint a
 * NEW anonymous identity per call: four identities, four quota rows, four fresh
 * allowances, and a conversation filed under a scope the next request cannot
 * see. So the route resolves this at its top and passes it down.
 *
 * WHY THE COOKIE IS WRITTEN HERE. A minted identity that is not persisted is
 * unlimited free inference: every subsequent request mints another one. Writing
 * it is therefore part of resolving it, not a step a caller can forget — and
 * when the write is impossible the caller is TOLD, rather than served an
 * identity that will not survive the response.
 */

import { cookies } from 'next/headers'
import { getSession } from '../auth'
import { readFirstEnv } from '../auth/env'
import { ANONYMOUS_COOKIE_NAME, ANONYMOUS_COOKIE_OPTIONS } from './anonymousIdentity'
import {
  AnonymousDisabledError,
  resolveSessionOrAnonymous,
  type Principal,
} from './principal'

/**
 * The HMAC key for anonymous identities.
 *
 * `APP_SESSION_SECRET` is the fallback because it is already required for
 * MigraAuth and is already a real secret in every environment that can serve a
 * session. A dedicated variable is honoured first so the two can be rotated
 * independently later without a code change.
 */
export function anonymousSecret(): string | undefined {
  return readFirstEnv('MIGRAPILOT_ANON_SECRET', 'APP_SESSION_SECRET')
}

export interface ResolvedRequestPrincipal {
  principal: Principal
  /**
   * False ONLY when a newly minted anonymous identity could not be written to
   * the response — i.e. this identity will not exist on the next request.
   * Always true for a session, and for an anonymous visitor who arrived with a
   * cookie we verified.
   */
  identityPersisted: boolean
}

/**
 * Resolve the principal, or `null` when there is neither a session nor a usable
 * anonymous identity.
 *
 * `null` means "unauthenticated", and it covers the deliberate case where no
 * signing secret is configured: an unsigned anonymous identity is forgeable by
 * anyone, so missing configuration disables anonymous chat rather than
 * weakening it.
 */
export async function resolveRequestPrincipal(): Promise<ResolvedRequestPrincipal | null> {
  let jar: Awaited<ReturnType<typeof cookies>> | null = null
  try {
    jar = await cookies()
  } catch {
    // No request scope (a unit test, a statically evaluated module). There is no
    // cookie to read and none to write; a session may still resolve below.
    jar = null
  }

  let principal: Principal
  try {
    principal = await resolveSessionOrAnonymous({
      session: () => getSession(),
      anonymousCookie: () => jar?.get(ANONYMOUS_COOKIE_NAME)?.value,
      secret: anonymousSecret,
    })
  } catch (error) {
    if (error instanceof AnonymousDisabledError) return null
    throw error
  }

  if (principal.kind !== 'anonymous' || !principal.mintedCookie) {
    return { principal, identityPersisted: true }
  }

  if (!jar) return { principal, identityPersisted: false }
  try {
    jar.set(ANONYMOUS_COOKIE_NAME, principal.mintedCookie, ANONYMOUS_COOKIE_OPTIONS)
    return { principal, identityPersisted: true }
  } catch {
    // A Server Component cannot write cookies. That is not a fault — it is a
    // read-only context — but the identity is not real yet, and the caller must
    // not spend an allowance against it.
    return { principal, identityPersisted: false }
  }
}

/**
 * Revoke this browser's anonymous authority.
 *
 * Called after a successful sign-in. The durable side is already closed by the
 * Brain — the conversation rows have moved out of the anonymous scope and the
 * quota row is marked claimed — so this removes the browser's copy of a token
 * that can no longer read or reclaim anything.
 */
export async function clearAnonymousIdentity(): Promise<void> {
  try {
    const jar = await cookies()
    jar.delete(ANONYMOUS_COOKIE_NAME)
  } catch {
    // Nothing to clear outside a request scope.
  }
}
