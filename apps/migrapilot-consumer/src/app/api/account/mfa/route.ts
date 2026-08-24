/**
 * Two-step verification.
 *
 * THIS ROUTE IS A CONDUIT AND KEEPS NOTHING. The TOTP secret and the recovery
 * codes exist in exactly one response, on their way to the person setting them
 * up. They are not logged, not cached, and not stored anywhere in this app —
 * writing them down here would recreate, outside MigraAuth, the one secret the
 * whole factor depends on.
 *
 * POST   — begin enrolment; returns the setup key, the otpauth URI and the
 *          recovery codes, ONCE.
 * PUT    — confirm enrolment (or verify) with a code from the authenticator.
 * DELETE — turn it off, re-authenticated by password, a live code, or a
 *          recovery code. Which of those a given account can use depends on what
 *          it has; a provider-only account has no password, which is exactly the
 *          case that used to be locked in.
 */

import { migraAuthFetch } from '@/server/auth/migraAuthApi'

export const dynamic = 'force-dynamic'

function relay(
  result: { kind: string; status?: number; value?: unknown },
  fallback: string,
): Response {
  if (result.kind === 'unauthenticated') {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }
  if (result.kind === 'reauth_required') {
    return Response.json(
      { error: 'reauth_required', message: 'Sign in again to change two-step verification.' },
      { status: 409 },
    )
  }
  if (result.kind === 'refused') {
    const body = result.value as { error?: { code?: string; message?: string } } | null
    return Response.json(
      { error: body?.error?.code ?? 'refused', message: body?.error?.message ?? fallback },
      { status: result.status ?? 400 },
    )
  }
  return Response.json({ error: 'unavailable', message: fallback }, { status: 503 })
}

interface EnrollResponse {
  challenge_id: string
  secret: string
  otpauth_uri: string
  recovery_codes: string[]
}

export async function POST(): Promise<Response> {
  const result = await migraAuthFetch<EnrollResponse>('/v1/mfa/totp/enroll', { method: 'POST' })
  if (result.kind !== 'ok') {
    return relay(result, 'Two-step verification could not be set up right now.')
  }

  return Response.json({
    challengeId: result.value?.challenge_id,
    /*
     * PASSED STRAIGHT THROUGH, NOT PERSISTED. The setup key and otpauth URI have
     * to reach the authenticator app somehow, and this is the only moment they
     * are available. The response is not cached (`force-dynamic`, and
     * `migraAuthFetch` sends no-store) so it is not retrievable afterwards.
     */
    setupKey: result.value?.secret,
    otpauthUri: result.value?.otpauth_uri,
    /*
     * SHOWN ONCE, AND THE UI SAYS SO. Recovery codes are the only way back in
     * when the authenticator is lost — and after this response MigraAuth holds
     * hashes, so nothing can show them again.
     */
    recoveryCodes: result.value?.recovery_codes ?? [],
  })
}

export async function PUT(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { code?: unknown; challengeId?: unknown }
    | null
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (!/^\d{6}$/.test(code)) {
    return Response.json(
      { error: 'invalid', message: 'Enter the 6-digit code from your authenticator app.' },
      { status: 400 },
    )
  }

  const result = await migraAuthFetch<{ verified: boolean }>('/v1/mfa/totp/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      ...(typeof body?.challengeId === 'string' ? { challenge_id: body.challengeId } : {}),
    }),
  })

  if (result.kind !== 'ok') {
    return relay(result, 'That code could not be confirmed.')
  }
  return Response.json({ verified: true })
}

export async function DELETE(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { password?: unknown; code?: unknown }
    | null
  const password = typeof body?.password === 'string' ? body.password : undefined
  const code = typeof body?.code === 'string' ? body.code.trim() : undefined

  if (!password && !code) {
    return Response.json(
      {
        error: 'confirmation_required',
        message: 'Enter your password, an authenticator code, or a recovery code.',
      },
      { status: 400 },
    )
  }

  const result = await migraAuthFetch<{ success: boolean }>('/v1/mfa/disable', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Only what was actually supplied is forwarded, so an empty string never
    // reaches MigraAuth as an attempted credential.
    body: JSON.stringify({ ...(password ? { password } : {}), ...(code ? { code } : {}) }),
  })

  if (result.kind !== 'ok') {
    return relay(result, 'Two-step verification could not be turned off.')
  }
  return Response.json({ disabled: true })
}
