import type { Metadata, Viewport } from 'next'
import './globals.css'
import { AppShell } from '@/components/layout/AppShell'
import { ChatProvider } from '@/state/ChatProvider'

/**
 * Root layout — a Server Component.
 *
 * It renders no Brain data and holds no session logic; the shell below it is a
 * client component. Server data flows in later through page-level Server
 * Components calling `src/server/brain/seams.ts`, never through the browser.
 */
export const metadata: Metadata = {
  title: 'MigraPilot',
  description:
    'MigraPilot — your AI assistant for smarter answers, simpler workflows, and better results.',
  icons: { icon: '/favicon.svg' },
}

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
          <AppShell>{children}</AppShell>
        </ChatProvider>
      </body>
    </html>
  )
}
