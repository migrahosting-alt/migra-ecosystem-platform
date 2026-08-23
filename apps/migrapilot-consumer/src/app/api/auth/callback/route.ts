/**
 * Complete the OAuth callback.
 *
 * `handleCallback` verifies `state`, exchanges the code with the PKCE verifier,
 * calls `/userinfo`, runs the bootstrap below, and writes the httpOnly session
 * cookie. This route's only jobs are to read the query parameters, refuse
 * anything malformed, and send the browser somewhere sensible afterwards.
 *
 * NOTHING here may put tokens in a redirect, a log line, or a response body.
 *
 * It is also where a signed-out visitor's work becomes theirs. The claim runs
 * AFTER the exchange, never before: the account is established by a completed
 * sign-in rather than asserted by a parameter, and the anonymous authority is
 * revoked once the transfer is done.
 */

import { getAuthPort, getSession } from '@/server/auth'
import { AuthNotConfiguredError, type BootstrapFn } from '@/server/auth/authPort'
import { absoluteHttpUrl, readEnv } from '@/server/auth/env'
import { takeReturnPath } from '@/server/auth/returnTo'
import { claimAnonymousWorkInto } from '@/server/anonymous/claim'

export const dynamic = 'force-dynamic'

/**
 * Where to land the browser after the callback.
 *
 * `Response.redirect` requires an absolute URL, so an empty or relative
 * `APP_BASE_URL` here produces a 500 on a sign-in that otherwise succeeded —
 * the same empty-string hazard documented in `server/auth/env.ts`.
 *
 * The request origin is the last resort rather than the first choice: behind
 * the proxy it is the internal address, which is a bad redirect but still
 * strictly better than failing a completed authentication.
 */
const appBase = (request: Request): string =>
  absoluteHttpUrl(readEnv('APP_BASE_URL')) ?? new URL(request.url).origin

/** Land the user back on the app, never on an API path. */
const home = (request: Request, query = ''): Response =>
  Response.redirect(`${appBase(request)}/${query}`, 302)

/**
 * Land them where they were, if this app remembered a destination.
 *
 * The path was validated when it was stored and again when it was read, and it
 * is joined to THIS app's base — so nothing that arrived from the provider can
 * steer the final redirect.
 */
const landing = (request: Request, path: string | null): Response =>
  path ? Response.redirect(`${appBase(request)}${path}`, 302) : home(request)

/**
 * Resolve org context and permissions for the authenticated principal.
 *
 * Deliberately minimal and HONEST: this app has no organization-resolution
 * service wired yet, so `activeOrg` is null and `permissions` is empty rather
 * than invented. Org context must arrive here — not from token claims — see the
 * PR #147 note in ../../../server/auth/README.md. When a real resolver exists,
 * it is called from this function and nowhere else.
 */
const bootstrap: BootstrapFn = async () => ({
  activeOrg: null,
  permissions: [],
})

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams

  // The provider reported a failure — surface it as a failed sign-in, not a crash.
  const providerError = params.get('error')
  if (providerError) return home(request, `?auth_error=${encodeURIComponent(providerError)}`)

  const code = params.get('code')
  const state = params.get('state')
  if (!code || !state) {
    return Response.json(
      { error: 'invalid_callback', message: 'The sign-in response was missing its code or state.' },
      { status: 400 },
    )
  }

  try {
    await (await getAuthPort()).handleCallback({ code, state, bootstrap })
  } catch (error) {
    if (error instanceof AuthNotConfiguredError) {
      return Response.json(
        { error: 'auth_not_configured', message: 'Sign-in is unavailable: MigraAuth is not configured.' },
        { status: 503 },
      )
    }
    // A rejected exchange (replayed code, bad state, expired verifier, an
    // unreachable issuer) is a failed sign-in, not a server fault — and its
    // detail must not reach the URL.
    //
    // It must still reach the LOG. Swallowing it entirely meant a sign-in that
    // failed on every attempt left no server-side evidence at all: the browser
    // showed `?auth_error=exchange_failed` and the log showed nothing, so the
    // cause had to be found by probing the network by hand. The message is
    // safe — `@migrateck/auth-client` puts a status and an OAuth error code in
    // it, never a token or the raw response body.
    console.error('[auth] callback exchange failed:', error instanceof Error ? error.message : error)
    return home(request, '?auth_error=exchange_failed')
  }

  /*
   * THE SESSION EXISTS NOW. Only now may anything be claimed.
   *
   * Order is the security property: the account being claimed INTO is
   * established by a completed exchange, not by anything the request asked for.
   * A claim that ran before this line would be a way to request someone else's
   * conversation.
   *
   * A failure to move the work does NOT fail the sign-in. The person is
   * authenticated; turning that into an error page over a data move would throw
   * away the thing that just succeeded. It is logged instead.
   */
  const destination = await takeReturnPath()
  try {
    const session = await getSession()
    if (session) {
      const outcome = await claimAnonymousWorkInto(session)
      if (outcome.hadAnonymousIdentity) {
        console.info(
          '[auth] claimed anonymous work on sign-in',
          JSON.stringify({ claimed: outcome.claimed.length, failed: outcome.failed.length }),
        )
      }
    } else {
      // The exchange succeeded but no session read back. Nothing is claimed on a
      // principal we cannot see, and saying so beats moving rows hopefully.
      console.warn('[auth] callback completed but no session resolved; nothing claimed.')
    }
  } catch (error) {
    console.error('[auth] anonymous claim failed after sign-in:', error instanceof Error ? error.message : error)
  }

  return landing(request, destination)
}
