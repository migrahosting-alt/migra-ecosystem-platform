'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, Menu, Settings, User as UserIcon } from 'lucide-react'
import { Wordmark } from '@/components/brand/Logo'
import { Avatar } from '@/components/ui/Avatar'
import type { PublicSession } from '@/server/auth'
import { useDismissable } from '@/lib/hooks'
import { cn } from '@/lib/cn'

/**
 * The application header.
 *
 * TRUTHFULNESS CONTRACT. This component renders identity ONLY from a real
 * `PublicSession` handed down by the server layout. When `session` is null the
 * app is genuinely unauthenticated and says so — it does not invent a user,
 * an avatar, or an account menu.
 *
 * Nothing here may import `@/data/mock`. The previous version rendered a
 * hardcoded "Emma Johnson" plus three hardcoded notifications regardless of
 * session state, which made a fail-closed app look signed in.
 */
export function TopBar({
  onOpenNav,
  session,
}: {
  onOpenNav: () => void
  session: PublicSession | null
}) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)

  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const menuRef = useDismissable<HTMLDivElement>(menuOpen, closeMenu)

  return (
    <header className="z-30 flex h-[72px] shrink-0 items-center justify-between border-b border-hairline bg-white px-5 sm:px-7">
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenNav}
          aria-label="Open navigation"
          className="-ml-1 inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/" className="rounded-lg">
          <Wordmark />
        </Link>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        {session ? (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="flex items-center gap-2.5 rounded-field py-1.5 pr-2 pl-1.5 transition-colors hover:bg-slate-100"
            >
              <Avatar name={session.displayName} size="md" />
              <span className="hidden text-[15px] font-semibold text-slate-800 sm:block">
                {session.displayName}
              </span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 text-slate-400 transition-transform',
                  menuOpen && 'rotate-180',
                )}
              />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="animate-scale-in absolute right-0 z-40 mt-2 w-60 rounded-card border border-hairline bg-white p-1.5 shadow-raised"
              >
                <div className="border-b border-hairline px-3 py-2.5">
                  <p className="text-sm font-semibold text-slate-800">{session.displayName}</p>
                  <p className="truncate text-xs text-slate-400">{session.email}</p>
                  {session.activeOrgName && (
                    <p className="mt-1 truncate text-xs text-slate-400">
                      {session.activeOrgName}
                      {session.activeOrgRole ? ` · ${session.activeOrgRole}` : ''}
                    </p>
                  )}
                </div>
                {[
                  { label: 'Profile', icon: UserIcon, to: '/settings' },
                  { label: 'Settings', icon: Settings, to: '/settings' },
                ].map(({ label, icon: Icon, to }) => (
                  <button
                    key={label}
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      router.push(to)
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                  >
                    <Icon className="h-4 w-4 text-slate-400" />
                    {label}
                  </button>
                ))}
                {/*
                  Sign out is deliberately ABSENT until a real logout endpoint
                  exists. A button that only closes this menu — which is what
                  shipped before — is a decorative control, not a feature.
                */}
              </div>
            )}
          </div>
        ) : (
          <SignedOut />
        )}
      </div>
    </header>
  )
}

/**
 * The honest unauthenticated header.
 *
 * There is no sign-in link yet because no login route exists in this app: the
 * MigraAuth client (`migrapilot_web`) is not registered and the OAuth env is
 * unset, so `/authorize` cannot be reached. Rendering a "Sign in" control now
 * would be a dead link. This states the real state instead, and becomes a live
 * control in the auth-wiring slice.
 */
function SignedOut() {
  return (
    <span
      className="text-sm font-medium text-slate-400"
      data-testid="signed-out-indicator"
    >
      Not signed in
    </span>
  )
}
