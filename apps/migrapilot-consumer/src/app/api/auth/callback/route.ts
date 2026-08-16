/**
 * Complete the OAuth callback.
 *
 * `handleCallback` verifies `state`, exchanges the code with the PKCE verifier,
 * calls `/userinfo`, runs the bootstrap below, and writes the httpOnly session
 * cookie. This route's only jobs are to read the query parameters, refuse
 * anything malformed, and send the browser somewhere sensible afterwards.
 *
 * NOTHING here may put tokens in a redirect, a log line, or a response body.
 */

import { getAuthPort } from '@/server/auth'
import { AuthNotConfiguredError, type BootstrapFn } from '@/server/auth/authPort'
import { absoluteHttpUrl, readEnv } from '@/server/auth/env'

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
    // A rejected exchange (replayed code, bad state, expired verifier) is a
    // failed sign-in, not a server fault — and its detail must not reach the URL.
    return home(request, '?auth_error=exchange_failed')
  }

  return home(request)
}
