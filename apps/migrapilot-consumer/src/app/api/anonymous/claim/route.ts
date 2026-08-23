/**
 * Claim this browser's signed-out work into the account, on demand.
 *
 * The sign-in callback already does this. This route exists because that is the
 * only moment it happens, and a single moment is a single point of failure: if
 * the session cookie is not readable back inside the same request that wrote it,
 * or the user signed in through a different tab, the visitor's conversations
 * would sit in a scope they can no longer reach while their new account shows an
 * empty sidebar — with no way to recover.
 *
 * It is safe to call repeatedly. The Brain refuses a second claim of the same
 * anonymous session (409 ALREADY_CLAIMED), and the anonymous cookie is revoked
 * once the transfer is done, so the second call finds nothing to move.
 *
 * A SESSION IS REQUIRED. There is no parameter naming an account: the account is
 * whoever this request is authenticated as, which is the only formulation that
 * cannot be pointed at somebody else.
 */

import { requireSession } from '@/server/auth'
import { UnauthenticatedError } from '@/server/auth/authPort'
import { claimAnonymousWorkInto } from '@/server/anonymous/claim'

export const dynamic = 'force-dynamic'

export async function POST(): Promise<Response> {
  let session
  try {
    session = await requireSession()
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return Response.json(
        { error: 'unauthenticated', message: 'Sign in first — there is no account to claim into.' },
        { status: 401 },
      )
    }
    throw error
  }

  const outcome = await claimAnonymousWorkInto(session)
  return Response.json({
    claimed: outcome.claimed,
    failed: outcome.failed,
    hadAnonymousIdentity: outcome.hadAnonymousIdentity,
  })
}
