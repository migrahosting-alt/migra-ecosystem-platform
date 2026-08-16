/**
 * Begin login.
 *
 * Delegates entirely to the configured `AuthPort`: this route holds no OAuth
 * knowledge of its own, builds no URL, and invents no state. `buildLoginRedirect`
 * is what generates the PKCE S256 authorize URL and stores the verifier/state
 * server-side, so a route that constructed its own URL would silently bypass PKCE.
 *
 * When MigraAuth is not configured the port throws `AuthNotConfiguredError` and
 * this answers 503 — never a redirect to a login that cannot complete, and never
 * a fabricated session.
 */

import { getAuthPort } from '@/server/auth'
import { AuthNotConfiguredError } from '@/server/auth/authPort'

/** Session-dependent and side-effecting: must never be cached or prerendered. */
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  try {
    const authorizeUrl = await (await getAuthPort()).buildLoginRedirect()
    return Response.redirect(authorizeUrl, 302)
  } catch (error) {
    if (error instanceof AuthNotConfiguredError) {
      return Response.json(
        { error: 'auth_not_configured', message: 'Sign-in is unavailable: MigraAuth is not configured.' },
        { status: 503 },
      )
    }
    throw error
  }
}
