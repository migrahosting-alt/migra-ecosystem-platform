import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AppShell } from '@/components/layout/AppShell'
import { ChatProvider } from '@/state/ChatProvider'
import { getSession, toPublicSession } from '@/server/auth'

/**
 * Root layout — a Server Component.
 *
 * It renders no Brain data. It DOES resolve the session, because identity is
 * the one thing the shell cannot honestly render without: `getSession()` never
 * throws for the unauthenticated case, and `toPublicSession` narrows the result
 * to the token-free shape a client component is allowed to receive.
 *
 * Brain data still flows in later through page-level Server Components calling
 * `src/server/brain/seams.ts`, never through the browser.
 */
export const metadata: Metadata = {
  /* `default` names a bare page; `template` brands every nested route. */
  title: { default: 'MigraPilot', template: '%s · MigraPilot' },
  applicationName: 'MigraPilot',
  description:
    'MigraPilot — your AI assistant for smarter answers, simpler workflows, and better results.',
  /* Icons are resolved from src/app/{icon,apple-icon,favicon.ico}, which are
   * generated from the official brand mark. Declaring paths here too would
   * duplicate them, so the convention files are left to do the work. */
  openGraph: {
    title: 'MigraPilot',
    siteName: 'MigraPilot',
    description:
      'MigraPilot — your AI assistant for smarter answers, simpler workflows, and better results.',
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: '#2060e0',
  width: 'device-width',
  initialScale: 1,
}

/**
 * The shell is session-dependent, so it must never be prerendered.
 *
 * This is not a precaution — without it the app renders signed-out for
 * everyone, permanently. Next infers dynamism from a `cookies()` call, and at
 * BUILD time MigraAuth is (correctly) unconfigured, so `getSession()` returns
 * through the fail-closed port, which answers `null` without reading a cookie.
 * No cookie read means no dynamic signal, so every page was prerendered with a
 * signed-out header and kept serving it after a real sign-in succeeded.
 *
 * The fail-closed default is right; depending on it to force dynamism was the
 * mistake. Session-dependent chrome states its own rendering requirement.
 */
export const dynamic = 'force-dynamic'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  const publicSession = session ? toPublicSession(session) : null

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ChatProvider>
          <AppShell session={publicSession}>{children}</AppShell>
        </ChatProvider>
      </body>
    </html>
  )
}
