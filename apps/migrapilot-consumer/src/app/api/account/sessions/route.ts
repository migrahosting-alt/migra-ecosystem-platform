/**
 * Active sessions, and ending them.
 *
 * Read straight from MigraAuth every time. A revoked session must disappear
 * because it is gone, not because this app remembered to forget it.
 */

import { migraAuthFetch, persistRenewal } from '@/server/auth/migraAuthApi'

export const dynamic = 'force-dynamic'

interface SessionsResponse {
  sessions?: {
    id: string
    created_at: string
    last_seen_at: string | null
    expires_at: string
    ip_address: string | null
    user_agent: string | null
    current?: boolean
  }[]
}

const fail = (kind: string): Response => {
  if (kind === 'unauthenticated') return Response.json({ error: 'unauthenticated' }, { status: 401 })
  if (kind === 'reauth_required') {
    return Response.json(
      { error: 'reauth_required', message: 'Sign in again to manage your sessions.' },
      { status: 409 },
    )
  }
  return Response.json(
    { error: 'unavailable', message: 'Your sessions could not be loaded right now.' },
    { status: 503 },
  )
}

export async function GET(): Promise<Response> {
  const result = await migraAuthFetch<SessionsResponse>('/v1/sessions')
  await persistRenewal(result)
  if (result.kind !== 'ok') return fail(result.kind)

  return Response.json({
    sessions: (result.value?.sessions ?? []).map((s) => ({
      id: s.id,
      createdAt: s.created_at,
      lastSeenAt: s.last_seen_at,
      expiresAt: s.expires_at,
      /*
       * IP and user agent are shown because MigraAuth genuinely records them and
       * they are how a person recognises their own devices. Nothing is derived
       * beyond what is stored — no geolocation, no device fingerprint, no
       * inferred location. A settings page that guesses where you were is
       * claiming knowledge it does not have.
       */
      ipAddress: s.ip_address,
      userAgent: s.user_agent,
      current: s.current === true,
    })),
  })
}

/**
 * End sessions.
 *
 * `?id=` ends one; no id ends every OTHER session and keeps this one. Signing
 * yourself out from a "sign out everywhere else" control is a trap, and the
 * distinction belongs on the server rather than in whichever screen calls it.
 */
export async function DELETE(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id')
  const path = id ? `/v1/sessions/${encodeURIComponent(id)}` : '/v1/sessions/others'

  const result = await migraAuthFetch<{ revoked?: number }>(path, { method: 'DELETE' })
  await persistRenewal(result)
  if (result.kind !== 'ok') return fail(result.kind)

  return Response.json({ revoked: result.value?.revoked ?? (id ? 1 : 0), scope: id ? 'one' : 'others' })
}
