/**
 * End the session.
 *
 * Order matters: the local application session is destroyed FIRST, then the
 * browser is sent to the issuer's end-session endpoint. Reversing that would
 * leave a live local cookie behind if the redirect were never followed.
 *
 * POST is the real method — a logout reachable by GET is triggerable by any
 * third-party image tag or prefetch. GET is offered only as an explicit,
 * same-origin fallback for environments without JS, and both paths do the
 * identical work.
 *
 * WHERE THE USER LANDS. Signing out of MigraPilot must leave the user in
 * MigraPilot, signed out — not on a different product. The issuer redirect is
 * built by `buildLogoutRedirect`, which sends the target as
 * `post_logout_redirect_uri`; sending it as `return_to` alone meant MigraAuth
 * never saw it and fell back to a per-product home URL, handing MigraPilot
 * users to migrateck.com.
 *
 * KNOWN ISSUER-SIDE GAP, reported rather than worked around: MigraAuth's logout
 * page assigns that parameter straight to `window.location.href`.
 * `validatePostLogoutUri` exists in `apps/auth-api/src/modules/clients/index.ts`
 * but is never called, so the issuer will currently redirect to ANY absolute
 * URL supplied in that query parameter. That is a post-logout open redirect on
 * the identity provider and belongs to the MigraAuth workstream; nothing this
 * app can do fixes it, and this route is not the place to paper over it.
 */

import { getAuthPort } from '@/server/auth'
import { AuthNotConfiguredError } from '@/server/auth/authPort'

export const dynamic = 'force-dynamic'

async function endSession(): Promise<Response> {
  const port = await getAuthPort()
  try {
    // Local session first: if the issuer redirect is never followed, this
    // browser is still signed out of the application.
    await port.clearSession()
    return Response.redirect(port.buildLogoutRedirect(), 302)
  } catch (error) {
    if (error instanceof AuthNotConfiguredError) {
      return Response.json(
        { error: 'auth_not_configured', message: 'Sign-out is unavailable: MigraAuth is not configured.' },
        { status: 503 },
      )
    }
    throw error
  }
}

export async function POST(): Promise<Response> {
  return endSession()
}

export async function GET(): Promise<Response> {
  return endSession()
}
