import type { Metadata } from 'next'
import { getSession, toPublicSession } from '@/server/auth'
import { codingCapability } from '@/server/brain/seams'
import { governedCodingView } from '@/server/brain/view'
import { SettingsPage } from '@/screens/SettingsPage'

export const metadata: Metadata = { title: 'Settings' }

/**
 * Session- and Brain-dependent, so it must never be prerendered — the same rule the
 * root layout documents. A cached Settings page would show one user's identity and a
 * stale capability state to everyone.
 */
export const dynamic = 'force-dynamic'

/**
 * The first screen wired to the Brain.
 *
 * Both facts on this page are resolved on the SERVER and handed down: identity from
 * the real session, governed-coding readiness from the real capability endpoint. The
 * browser never talks to the Brain, and the screen receives no tokens — only the
 * narrow public shapes it is allowed to render.
 */
export default async function Settings() {
  const session = await getSession()
  const capability = governedCodingView(await codingCapability())

  return <SettingsPage session={session ? toPublicSession(session) : null} capability={capability} />
}
