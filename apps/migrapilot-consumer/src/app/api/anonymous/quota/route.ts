/**
 * How many free messages this visitor has left.
 *
 * THE NUMBER COMES FROM THE LEDGER, NOT FROM THE BROWSER. A count the client
 * kept would be wrong the moment a second tab sent a turn, wrong after a
 * refresh, and trivially resettable by anyone who opened devtools — which is
 * three different ways of giving away free inference while displaying a limit.
 *
 * This is a PROJECTION for rendering. It is never what decides whether a turn
 * may run: that decision belongs to the reservation taken inside the same
 * transaction that records the spend.
 *
 * A signed-in caller has no allowance, and says so — `mode: "authenticated"` —
 * rather than being handed a quota object full of zeroes that the composer
 * would render as "0 messages left".
 */

import { cookies } from 'next/headers'
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'
import { currentQuota } from '@/server/anonymous/turnQuota'
import { ANONYMOUS_COOKIE_NAME } from '@/server/tenancy/anonymousIdentity'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const resolved = await resolveRequestPrincipal()

  // No session and no anonymous identity: anonymous chat is not configured on
  // this server. Reporting "0 left" would be a lie about a feature that is off.
  if (!resolved) return Response.json({ mode: 'unavailable' })

  if (resolved.principal.kind === 'session') {
    /*
     * A signed-in browser still carrying an anonymous cookie has work that was
     * never transferred — the sign-in callback is the normal place that happens,
     * and this is how the app notices when it did not. Reporting it lets the
     * client ask for the claim rather than leaving those conversations stranded
     * in a scope the account cannot read.
     */
    let pendingClaim = false
    try {
      pendingClaim = Boolean((await cookies()).get(ANONYMOUS_COOKIE_NAME)?.value)
    } catch {
      pendingClaim = false
    }
    return Response.json({ mode: 'authenticated', pendingClaim })
  }

  const quota = await currentQuota(resolved.principal)
  if (!quota) {
    /*
     * The ledger could not be read. This is NOT "you have none left" and it is
     * NOT a full allowance either — inventing the second would hand out free
     * inference every time storage hiccuped. The composer treats an unknown
     * allowance as "do not claim a number", and the send attempt itself is
     * refused by the reservation, which is the authority.
     */
    return Response.json({ mode: 'anonymous', quota: null }, { status: 200 })
  }

  return Response.json({ mode: 'anonymous', quota })
}
