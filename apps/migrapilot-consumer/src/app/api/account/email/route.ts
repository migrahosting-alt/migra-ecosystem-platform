/**
 * Changing the address the account is reached at.
 *
 * TWO STEPS, AND THE FIRST ONE CHANGES NOTHING. `POST` asks MigraAuth to send a
 * code to the NEW address; `PUT` submits that code and completes the swap. The
 * account keeps its current address in between, because writing an unverified
 * address onto an account would redirect its password resets to a mailbox
 * nobody has proven they own.
 *
 * The challenge id is returned to the browser and sent back on confirm. It is a
 * lookup handle, not an authority: MigraAuth binds it to the signed-in user and
 * to the CHANGE_IDENTIFIER kind, so holding one is not enough to complete
 * anything.
 */

import { migraAuthFetch } from '@/server/auth/migraAuthApi'

export const dynamic = 'force-dynamic'

/** Relays MigraAuth's own refusal wording, which is more specific than ours. */
function relay(
  result: { kind: string; status?: number; value?: unknown },
  fallback: string,
): Response {
  if (result.kind === 'unauthenticated') {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }
  if (result.kind === 'reauth_required') {
    return Response.json(
      { error: 'reauth_required', message: 'Sign in again to change your email address.' },
      { status: 409 },
    )
  }
  if (result.kind === 'refused') {
    const body = result.value as { error?: { code?: string; message?: string } } | null
    return Response.json(
      { error: body?.error?.code ?? 'refused', message: body?.error?.message ?? fallback },
      // Preserved, so "already in use" stays a conflict and a wrong code stays a
      // bad request — the screen distinguishes them.
      { status: result.status ?? 400 },
    )
  }
  return Response.json({ error: 'unavailable', message: fallback }, { status: 503 })
}

/** Step one: send a code to the new address. Nothing changes yet. */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  if (email.length === 0) {
    return Response.json(
      { error: 'invalid', message: 'Enter the email address you want to use.' },
      { status: 400 },
    )
  }

  const result = await migraAuthFetch<{ challenge_id: string; sent_to: string }>(
    '/v1/me/email/change',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    },
  )

  if (result.kind !== 'ok') {
    return relay(result, 'That change could not be started. Your address is unchanged.')
  }
  return Response.json({
    challengeId: result.value?.challenge_id,
    // MASKED, as MigraAuth sends it. The full address is already known to
    // whoever typed it; echoing it back adds nothing and puts it in one more log.
    sentTo: result.value?.sent_to,
  })
}

/** Step two: the code proves the new address, and the swap happens. */
export async function PUT(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { challengeId?: unknown; code?: unknown }
    | null
  const challengeId = typeof body?.challengeId === 'string' ? body.challengeId : ''
  const code = typeof body?.code === 'string' ? body.code.trim() : ''

  if (!challengeId || !code) {
    return Response.json(
      { error: 'invalid', message: 'Enter the code sent to your new address.' },
      { status: 400 },
    )
  }

  const result = await migraAuthFetch<{ user?: { email: string | null } }>('/v1/me/email/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challenge_id: challengeId, code }),
  })

  if (result.kind !== 'ok') {
    return relay(result, 'That code could not be confirmed. Your address is unchanged.')
  }
  return Response.json({ email: result.value?.user?.email ?? null })
}
