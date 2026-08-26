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
 *
 * `?next=` names where to land afterwards. It is kept in an httpOnly cookie
 * rather than forwarded through the provider, so the value that eventually
 * reaches `Response.redirect` is one this application wrote — not one a third
 * party handed back.
 */

import { getAuthPort } from '@/server/auth'
import { AuthNotConfiguredError } from '@/server/auth/authPort'
import { redirectRememberingReturnPath, rememberReturnPath } from '@/server/auth/returnTo'

/** Session-dependent and side-effecting: must never be cached or prerendered. */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  /*
   * Remember where they were, so signing in CONTINUES the conversation instead
   * of dropping them on the home page beside a thread they can no longer find.
   * Stored server-side and re-validated on the way out — see
   * `server/auth/returnTo.ts`.
   */
  const next = new URL(request.url).searchParams.get('next')
  await rememberReturnPath(next)

  try {
    const authorizeUrl = await (await getAuthPort()).buildLoginRedirect()
    /*
     * The destination is attached to THIS response, not left to the framework to
     * associate. `Response.redirect` is not built by Next, so a cookie written
     * through `cookies()` never reached the browser and every sign-in landed on
     * the home page regardless of where it started.
     */
    return redirectRememberingReturnPath(authorizeUrl, next)
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
