/**
 * The state of this user's connected mailbox, and disconnecting it.
 *
 * A thin pass-through. Which account is connected, what it may do, and whether
 * the grant still works all belong to the Brain — the consumer's only jobs are
 * to know who is asking and to keep "we could not reach the service" from being
 * reported as "your email is not connected", which are opposite claims.
 */

import { callBrain } from '@/server/brain/gateway'
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'
import { MAIL_SIGN_IN, canConnectMail } from '@/server/mail/mailPrincipal'

export const dynamic = 'force-dynamic'

const signIn = (): Response =>
  Response.json(
    { error: MAIL_SIGN_IN.error, message: MAIL_SIGN_IN.message, remedy: MAIL_SIGN_IN.remedy },
    { status: MAIL_SIGN_IN.status },
  )

/**
 * 🚨 NOT a "not connected" state. That would answer a question about an account
 * we have not identified, and would make the Connect control appear to a
 * visitor who cannot use it.
 */
export async function GET(): Promise<Response> {
  const resolved = await resolveRequestPrincipal()
  if (!resolved || !canConnectMail(resolved.principal)) return signIn()

  const result = await callBrain({ kind: 'mailConnection' }, { principal: resolved.principal })
  if (result.kind !== 'ok') return unreachable(result.kind)
  return Response.json(result.value)
}

export async function DELETE(request: Request): Promise<Response> {
  const resolved = await resolveRequestPrincipal()
  if (!resolved || !canConnectMail(resolved.principal)) return signIn()

  /*
   * The account id is a HINT the Brain re-validates against what this principal
   * owns. It is read from the body rather than the path so a mailbox identifier
   * does not become a routable, logged URL component.
   */
  const body = (await request.json().catch(() => ({}))) as { providerAccountId?: unknown }
  const providerAccountId =
    typeof body.providerAccountId === 'string' && body.providerAccountId.length > 0
      ? body.providerAccountId
      : undefined

  const result = await callBrain(
    { kind: 'disconnectMail', ...(providerAccountId ? { providerAccountId } : {}) },
    { principal: resolved.principal },
  )

  if (result.kind === 'not_found') {
    return Response.json({ removed: false, message: 'That email account is not connected.' }, { status: 404 })
  }
  if (result.kind === 'conflict') {
    // Several accounts and none named. The user chooses; we do not guess.
    return Response.json(result.body, { status: result.status })
  }
  if (result.kind !== 'ok') return unreachable(result.kind)
  return Response.json(result.value)
}

/**
 * 🚨 503, and never a claim about the connection.
 *
 * Rendering unreachability as "not connected" would show a Connect button to
 * someone whose mail is connected — and if they pressed it, they would consent
 * again for no reason.
 */
function unreachable(kind: string): Response {
  const status = kind === 'unauthenticated' || kind === 'forbidden_for_principal' ? 401 : 503
  return Response.json(
    status === 401
      ? { error: MAIL_SIGN_IN.error, message: MAIL_SIGN_IN.message, remedy: MAIL_SIGN_IN.remedy }
      : {
          error: 'brain_unavailable',
          message: 'Your email settings could not be loaded right now. Try again shortly.',
          remedy: 'retry',
        },
    { status },
  )
}
