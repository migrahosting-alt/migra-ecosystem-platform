'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { cn } from '@/lib/cn'

export function AppShell({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => setNavOpen(false), [pathname])

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <TopBar onOpenNav={() => setNavOpen(true)} />

      <div className="flex min-h-0 flex-1">
        <aside className="hidden lg:block">
          <Sidebar />
        </aside>

        {navOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div
              className="animate-fade absolute inset-0 bg-slate-900/30"
              onClick={() => setNavOpen(false)}
              aria-hidden
            />
            <div className="animate-fade absolute inset-y-0 left-0 shadow-modal">
              <Sidebar onNavigate={() => setNavOpen(false)} />
              <button
                onClick={() => setNavOpen(false)}
                aria-label="Close navigation"
                className="absolute top-4 -right-12 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white text-slate-500 shadow-card"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}

        {children}
      </div>
    </div>
  )
}

/**
 * A page body: an optional secondary column, the scrolling main region, and an
 * optional right rail. Every screen in the product is one of these shapes.
 */
export function Workspace({
  children,
  rail,
  secondary,
  mainClassName,
  contentClassName,
}: {
  children: ReactNode
  rail?: ReactNode
  secondary?: ReactNode
  mainClassName?: string
  contentClassName?: string
}) {
  return (
    <div className="flex min-h-0 w-full flex-1">
      {secondary && (
        <div className="hidden w-[300px] shrink-0 border-r border-hairline md:block">
          {secondary}
        </div>
      )}

      <main className={cn('scroll-slim min-w-0 flex-1 overflow-y-auto', mainClassName)}>
        <div className={cn('mx-auto w-full max-w-[860px] px-6 py-7 sm:px-8', contentClassName)}>
          {children}
        </div>
      </main>

      {rail && (
        <aside className="scroll-slim hidden w-[336px] shrink-0 overflow-y-auto border-l border-hairline bg-rail px-5 py-6 xl:block">
          <div className="flex flex-col gap-5">{rail}</div>
        </aside>
      )}
    </div>
  )
}

/** Hook for pages that need to know whether the rail is on screen. */
export function useIsWide() {
  const [wide, setWide] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= 1280,
  )

  const onResize = useCallback(() => setWide(window.innerWidth >= 1280), [])

  useEffect(() => {
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [onResize])

  return wide
}
