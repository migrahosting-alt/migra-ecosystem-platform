/**
 * Begin account creation.
 *
 * The sibling of `/api/auth/login`, and separate for a product reason rather
 * than a technical one: a visitor who has just used their last free message is
 * usually creating an account, not remembering a password. Sending them to a
 * sign-in form is where that moment gets lost.
 *
 * Same delegation, same guarantees: `buildSignupRedirect` generates the PKCE
 * S256 parameters and stores the verifier server-side, so this route builds no
 * URL of its own and cannot bypass PKCE. The callback is the same one, so the
 * anonymous work is claimed on the way back exactly as it is after a sign-in.
 */

import { getAuthPort } from '@/server/auth'
import { AuthNotConfiguredError } from '@/server/auth/authPort'
import { rememberReturnPath } from '@/server/auth/returnTo'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  await rememberReturnPath(new URL(request.url).searchParams.get('next'))

  try {
    const signupUrl = await (await getAuthPort()).buildSignupRedirect()
    return Response.redirect(signupUrl, 302)
  } catch (error) {
    if (error instanceof AuthNotConfiguredError) {
      return Response.json(
        { error: 'auth_not_configured', message: 'Account creation is unavailable: MigraAuth is not configured.' },
        { status: 503 },
      )
    }
    throw error
  }
}
