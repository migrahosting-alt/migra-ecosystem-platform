/**
 * Regenerating recovery codes.
 *
 * A CONDUIT THAT KEEPS NOTHING. The fresh codes exist in exactly one response,
 * on their way to the person who asked for them. Nothing here logs, caches or
 * stores them — only their hashes ever reach a database, so this response is the
 * single moment the plaintext exists anywhere.
 *
 * WHY IT EXISTS. Every set issued before the store/consume hash mismatch was
 * fixed is unredeemable, and until now the only way to obtain a working set was
 * to turn MFA OFF and enrol again — telling people to remove their second factor
 * in order to repair its backup, with a window where they had neither.
 */

import { migraAuthFetch, persistRenewal } from '@/server/auth/migraAuthApi'

export const dynamic = 'force-dynamic'

interface RegenerateResponse {
  recovery_codes: string[]
  count: number
}

export async function POST(request: Request): Promise<Response> {
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

  const result = await migraAuthFetch<RegenerateResponse>('/v1/mfa/recovery-codes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Only what was actually supplied is forwarded, so an empty string never
    // reaches MigraAuth as an attempted credential.
    body: JSON.stringify({ ...(password ? { password } : {}), ...(code ? { code } : {}) }),
  })
  await persistRenewal(result)

  if (result.kind === 'unauthenticated') {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }
  if (result.kind === 'reauth_required') {
    return Response.json(
      { error: 'reauth_required', message: 'Sign in again to replace your recovery codes.' },
      { status: 409 },
    )
  }
  if (result.kind === 'refused') {
    const refused = result.value as { error?: { code?: string; message?: string } } | null
    return Response.json(
      {
        error: refused?.error?.code ?? 'refused',
        message: refused?.error?.message ?? 'Your recovery codes could not be replaced.',
      },
      { status: result.status ?? 400 },
    )
  }
  if (result.kind !== 'ok' || !result.value) {
    return Response.json(
      { error: 'unavailable', message: 'Your recovery codes could not be replaced.' },
      { status: 503 },
    )
  }

  return Response.json({ recoveryCodes: result.value.recovery_codes, count: result.value.count })
}
