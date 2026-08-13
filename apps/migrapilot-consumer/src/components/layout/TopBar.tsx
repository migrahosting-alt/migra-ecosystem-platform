'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bell, ChevronDown, LogOut, Menu, Settings, User as UserIcon } from 'lucide-react'
import { Wordmark } from '@/components/brand/Logo'
import { Avatar } from '@/components/ui/Avatar'
import { currentUser } from '@/data/mock'
import { useDismissable } from '@/lib/hooks'
import { cn } from '@/lib/cn'

export function TopBar({ onOpenNav }: { onOpenNav: () => void }) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)

  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const closeNotifications = useCallback(() => setNotificationsOpen(false), [])
  const menuRef = useDismissable<HTMLDivElement>(menuOpen, closeMenu)
  const bellRef = useDismissable<HTMLDivElement>(notificationsOpen, closeNotifications)

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
        <div className="relative" ref={bellRef}>
          <button
            onClick={() => setNotificationsOpen((open) => !open)}
            aria-label="Notifications"
            aria-expanded={notificationsOpen}
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <Bell className="h-[21px] w-[21px]" strokeWidth={1.8} />
            <span className="absolute top-2 right-2.5 h-2 w-2 rounded-full bg-brand-600 ring-2 ring-white" />
          </button>

          {notificationsOpen && (
            <div className="animate-scale-in absolute right-0 z-40 mt-2 w-80 rounded-card border border-hairline bg-white p-2 shadow-raised">
              <p className="px-3 py-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
                Notifications
              </p>
              {[
                { title: 'Run RUN-2025-05-16-1432 completed', time: '2m ago' },
                { title: 'Scope approval expires in 2 days', time: '1h ago' },
                { title: 'Aisha shared “Support Docs” with you', time: '1d ago' },
              ].map((item) => (
                <div
                  key={item.title}
                  className="rounded-lg px-3 py-2.5 transition-colors hover:bg-slate-50"
                >
                  <p className="text-sm font-medium text-slate-700">{item.title}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{item.time}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <span className="hidden h-8 w-px bg-slate-200 sm:block" />

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="flex items-center gap-2.5 rounded-field py-1.5 pr-2 pl-1.5 transition-colors hover:bg-slate-100"
          >
            <Avatar name={currentUser.name} size="md" />
            <span className="hidden text-[15px] font-semibold text-slate-800 sm:block">
              {currentUser.name}
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
                <p className="text-sm font-semibold text-slate-800">{currentUser.name}</p>
                <p className="truncate text-xs text-slate-400">{currentUser.email}</p>
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
              <button
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-600"
              >
                <LogOut className="h-4 w-4 text-slate-400" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
