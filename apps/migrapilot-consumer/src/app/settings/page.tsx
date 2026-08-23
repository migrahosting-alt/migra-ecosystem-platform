import type { Metadata } from 'next'
import { getSession, toPublicSession } from '@/server/auth'
import { SettingsPage } from '@/screens/SettingsPage'

export const metadata: Metadata = { title: 'Settings' }

/**
 * Session-dependent, so it must never be prerendered — the same rule the root
 * layout documents. A cached Settings page would show one person's account to
 * everyone.
 */
export const dynamic = 'force-dynamic'

/**
 * The account hub.
 *
 * ONLY THE SESSION IS RESOLVED HERE. Everything else the hub shows — account
 * details, linked providers, sessions, preferences — is read by the client from
 * this app's own routes, because all of it is mutable from the page itself. A
 * server-rendered copy would be stale the moment someone revoked a session or
 * changed a setting, and the page would then have two disagreeing sources.
 *
 * The governed-coding capability card that used to live here is GONE. Run
 * telemetry belongs to the Command Center, not to a consumer account screen —
 * and it was the only card here that described the engine rather than the
 * person's account.
 */
export default async function Settings() {
  const session = await getSession()
  return <SettingsPage session={session ? toPublicSession(session) : null} />
}
