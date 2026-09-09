/**
 * Start connecting a mailbox.
 *
 * POST, never GET: this mints single-use state and writes a row on the Brain,
 * so a link preview, a prefetch or a crawler must not be able to trigger it.
 *
 * The consumer does not build the consent URL and does not know the provider's
 * name. It asks the Brain where to send the user, and sends them there.
 */

import { callBrain } from '@/server/brain/gateway'
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'
import { MAIL_SIGN_IN, canConnectMail } from '@/server/mail/mailPrincipal'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const resolved = await resolveRequestPrincipal()
  if (!resolved || !canConnectMail(resolved.principal)) {
    return Response.json(
      { error: MAIL_SIGN_IN.error, message: MAIL_SIGN_IN.message, remedy: MAIL_SIGN_IN.remedy },
      { status: MAIL_SIGN_IN.status },
    )
  }

  const body = (await request.json().catch(() => ({}))) as { returnTo?: unknown }
  const returnTo = typeof body.returnTo === 'string' ? body.returnTo : undefined

  const result = await callBrain(
    { kind: 'beginMailConnection', ...(returnTo ? { returnTo } : {}) },
    { principal: resolved.principal },
  )
  if (result.kind !== 'ok') {
    return Response.json(
      {
        error: 'brain_unavailable',
        message: 'Connecting your email is unavailable right now. Try again shortly.',
        remedy: 'retry',
      },
      { status: 503 },
    )
  }

  /*
   * Returned as a value rather than a 302. The browser navigates deliberately,
   * which keeps a redirect out of an API response that a fetch caller would
   * follow automatically — and lets the UI show what is about to happen before
   * the user leaves the app.
   */
  return Response.json(result.value)
}
