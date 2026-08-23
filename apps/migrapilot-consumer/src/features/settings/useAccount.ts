'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * The account, as MigraAuth holds it.
 *
 * READ-THROUGH, NEVER MIRRORED. Everything here is fetched from MigraAuth on
 * demand. Nothing is written to a MigraPilot store, because a second copy of a
 * name or a provider link goes stale the moment the account changes elsewhere.
 *
 * `reauth_required` is a first-class state, not an error. A session created
 * before this app began keeping tokens is genuinely signed in but cannot read
 * MigraAuth for that person — the honest response is to say so and offer a
 * sign-in, which recovers. Rendering an empty provider list would not.
 */

export interface AccountProfile {
  id: string
  email: string | null
  emailVerified: boolean
  displayName: string | null
  status: string
}

export interface LinkedProvider {
  provider: string
  email: string | null
  display_name: string | null
  linked_at: string
  last_used_at: string | null
}

export interface ActiveSession {
  id: string
  createdAt: string
  lastSeenAt: string | null
  expiresAt: string
  ipAddress: string | null
  userAgent: string | null
  current: boolean
}

export type AccountState =
  | { status: 'loading' }
  | { status: 'ready'; profile: AccountProfile; providers: LinkedProvider[] | null }
  | { status: 'reauth_required' }
  | { status: 'signed_out' }
  | { status: 'unavailable'; message: string }

export interface AccountController {
  account: AccountState
  sessions: ActiveSession[] | null
  sessionsError: string | null
  reload: () => void
  /** End one session, or every OTHER session when no id is given. */
  revoke: (sessionId?: string) => Promise<{ ok: boolean; message?: string }>
}

export function useAccount(): AccountController {
  const [account, setAccount] = useState<AccountState>({ status: 'loading' })
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null)
  const [sessionsError, setSessionsError] = useState<string | null>(null)

  const read = useCallback(async () => {
    try {
      const response = await fetch('/api/account', { cache: 'no-store' })
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null

      if (response.status === 401) setAccount({ status: 'signed_out' })
      else if (response.status === 409) setAccount({ status: 'reauth_required' })
      else if (!response.ok) {
        setAccount({
          status: 'unavailable',
          message: (body?.['message'] as string) ?? 'Your account could not be loaded.',
        })
      } else {
        setAccount({
          status: 'ready',
          profile: body?.['profile'] as AccountProfile,
          // Null means UNKNOWN, not none — the distinction matters, because one
          // of them invites you to unlink your last way in.
          providers: (body?.['linkedProviders'] as LinkedProvider[] | null) ?? null,
        })
      }
    } catch {
      setAccount({ status: 'unavailable', message: 'Your account could not be loaded.' })
    }

    try {
      const response = await fetch('/api/account/sessions', { cache: 'no-store' })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null
        setSessions(null)
        setSessionsError(body?.message ?? 'Your sessions could not be loaded.')
        return
      }
      const body = (await response.json()) as { sessions: ActiveSession[] }
      setSessions(body.sessions)
      setSessionsError(null)
    } catch {
      setSessions(null)
      setSessionsError('Your sessions could not be loaded.')
    }
  }, [])

  useEffect(() => {
    void read()
  }, [read])

  const revoke = useCallback(
    async (sessionId?: string) => {
      try {
        const query = sessionId ? `?id=${encodeURIComponent(sessionId)}` : ''
        const response = await fetch(`/api/account/sessions${query}`, { method: 'DELETE' })
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { message?: string } | null
          return { ok: false, message: body?.message ?? 'That session could not be ended.' }
        }
        /*
         * Re-read rather than removing the row locally. A revoked session is
         * gone because MigraAuth says so; splicing it out of an array would show
         * success even when the server refused, which is the exact lie a
         * destructive control must never tell.
         */
        await read()
        return { ok: true }
      } catch {
        return { ok: false, message: 'That session could not be ended. Check your connection.' }
      }
    },
    [read],
  )

  return { account, sessions, sessionsError, reload: () => void read(), revoke }
}
