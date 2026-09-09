'use client'

import { useCallback, useEffect, useState } from 'react'
import { SettingsCard } from '@/features/settings/controls'
import { beginEmailConnection } from './connectEmail'
import {
  mailCardState,
  offersConnect,
  offersDisconnect,
  type MailCardState,
  type MailStatusBody,
} from './mailConnectionState'

/**
 * The connected mailbox.
 *
 * 🚨 SEPARATE FROM "CONNECTED ACCOUNTS", DELIBERATELY. That card lists ways to
 * SIGN IN. This is delegated access to a third-party data source, and merging
 * the two would let someone believe that disconnecting their mailbox removed a
 * way into their own account.
 *
 * 🚨 THE CLIENT NEVER NAMES AN ACCOUNT. Disconnect sends no identifier: the
 * server resolves which connection this principal means. A card that posted an
 * account id would be one edited request away from removing someone else's.
 */
export function ConnectedEmailCard() {
  const [state, setState] = useState<MailCardState>({ kind: 'checking' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/account/mail', { cache: 'no-store' })
      const body = (await response.json().catch(() => null)) as MailStatusBody | null
      setState(mailCardState(response.status, body))
    } catch {
      // Unreachable is NOT "not connected" — see mailConnectionState.
      setState(mailCardState(0, null))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const connect = async () => {
    setBusy(true)
    setNotice(null)
    const outcome = await beginEmailConnection('/settings')
    setBusy(false)
    if (!outcome.ok) {
      setNotice(outcome.message)
      return
    }
    window.location.assign(outcome.authorizationUrl)
  }

  const disconnect = async () => {
    setBusy(true)
    setNotice(null)
    let message: string | null = null
    try {
      const response = await fetch('/api/account/mail', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        // 🚨 An EMPTY body. The server resolves which connection this principal
        // means; naming one here would be a client deciding whose mail to
        // remove.
        body: '{}',
      })
      const body = (await response.json().catch(() => null)) as { message?: unknown } | null
      /*
       * Surfaced verbatim when present. The server says so when it could not
       * confirm the grant was withdrawn at the provider, and swallowing that
       * would leave someone believing their mail is disconnected when it may
       * not be.
       */
      if (typeof body?.message === 'string') message = body.message
    } catch {
      message = 'Your email account could not be disconnected just now. Try again shortly.'
    }
    setBusy(false)
    setNotice(message)
    // 🚨 Re-read rather than assume. The card must show what the SERVER says
    // the state is now, not what the button hoped it would be.
    await refresh()
  }

  return (
    <SettingsCard
      title="Email account"
      description="A mailbox MigraPilot can read on your behalf. Separate from how you sign in."
    >
      <div className="flex flex-col gap-3">
        <Summary state={state} />

        {notice && (
          <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            {notice}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {offersConnect(state) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void connect()}
              className="rounded-lg bg-brand-600 px-3.5 py-2 text-[13.5px] font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {state.kind === 'expired' ? 'Reconnect' : 'Connect email'}
            </button>
          )}
          {offersDisconnect(state) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void disconnect()}
              className="rounded-lg border border-slate-200 px-3.5 py-2 text-[13.5px] font-medium text-slate-700 transition hover:border-slate-300 disabled:opacity-50"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>
    </SettingsCard>
  )
}

/** What the card SAYS, kept apart from what it offers. */
function Summary({ state }: { state: MailCardState }) {
  switch (state.kind) {
    case 'checking':
      return <p className="text-sm text-slate-500">Checking…</p>
    case 'connected':
      return (
        <div>
          <p className="text-[15px] font-medium text-slate-800">{state.account || 'Connected'}</p>
          <p className="mt-0.5 text-[13px] text-slate-500">
            {state.canRead
              ? 'MigraPilot can search and read this mailbox. It cannot send.'
              : 'Connected, but without permission to read mail. Reconnect to allow access.'}
          </p>
        </div>
      )
    case 'not_connected':
      return (
        <p className="text-sm text-slate-500">
          No mailbox is connected. Connecting lets MigraPilot search and read your email — never send it.
        </p>
      )
    default:
      // Every remaining state carries the engine's own sentence. This layer
      // does not write its own excuse.
      return <p className="text-sm text-slate-500">{state.reason}</p>
  }
}
