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

/**
 * What this account can actually do, as MigraAuth reports it.
 *
 * Null anywhere this appears means UNKNOWN. Rendering unknown as `false` would
 * tell someone MFA is off when it may be on, and offer "set a password" to an
 * account that already has one.
 */
export interface AccountSecurity {
  mfa_enabled: boolean
  recovery_codes_stale: boolean
  has_password: boolean
  password_updated_at: string | null
  email_verified: boolean
  linked_providers: string[]
  sign_in_methods: number
  can_unlink_a_provider: boolean
}

export type AccountState =
  | { status: 'loading' }
  | {
      status: 'ready'
      profile: AccountProfile
      providers: LinkedProvider[] | null
      security: AccountSecurity | null
    }
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
  /** Write the display name to MigraAuth. Null clears it. */
  saveDisplayName: (name: string | null) => Promise<{ ok: boolean; message?: string }>
  /** Detach a sign-in provider. MigraAuth refuses the last way in. */
  unlinkProvider: (provider: string) => Promise<{ ok: boolean; message?: string }>
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
          security: (body?.['security'] as AccountSecurity | null) ?? null,
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

  const saveDisplayName = useCallback(
    async (name: string | null) => {
      try {
        const response = await fetch('/api/account', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ displayName: name }),
        })
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { message?: string } | null
          return { ok: false, message: body?.message ?? 'Your name could not be saved.' }
        }
        /*
         * Re-read rather than trusting the submitted value. MigraAuth trims, and
         * an all-whitespace name is stored as cleared — so the screen must show
         * what was SAVED, not what was typed, or the next reload disagrees with
         * the "Saved" the user just watched appear.
         */
        await read()
        return { ok: true }
      } catch {
        return { ok: false, message: 'Your name could not be saved. Check your connection.' }
      }
    },
    [read],
  )

  const unlinkProvider = useCallback(
    async (provider: string) => {
      try {
        const response = await fetch(`/api/account/providers?provider=${encodeURIComponent(provider)}`, {
          method: 'DELETE',
        })
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { message?: string } | null
          /*
           * MigraAuth's own words are relayed. When it refuses because this is
           * the last way in, it says to set a password first — an instruction
           * the user can act on, which a generic failure message would destroy.
           */
          return { ok: false, message: body?.message ?? 'That sign-in method could not be removed.' }
        }
        await read()
        return { ok: true }
      } catch {
        return { ok: false, message: 'That could not be changed. Check your connection.' }
      }
    },
    [read],
  )

  return {
    account,
    sessions,
    sessionsError,
    reload: () => void read(),
    revoke,
    saveDisplayName,
    unlinkProvider,
  }
}
