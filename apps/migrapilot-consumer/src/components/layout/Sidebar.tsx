'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  FileText,
  FolderKanban,
  History,
  Plus,
  Settings,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/cn'

const navItems = [
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/files', label: 'Files', icon: FileText },
  { to: '/assistants', label: 'Assistants', icon: Users },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter()
  const pathname = usePathname()

  /*
   * `from-canvas`, NOT `from-white`. This gradient shipped a light sidebar
   * beside a dark page: the migration replaced `bg-white` everywhere and never
   * looked at GRADIENT STOPS, so `to-slate-50` themed correctly while
   * `from-white` stayed literally white. A colour utility is not only `bg-*`.
   */
  return (
    <div className="flex h-full w-[264px] shrink-0 flex-col border-r border-hairline bg-linear-to-b from-canvas to-slate-50/80 px-5 py-6">
      <button
        onClick={() => {
          router.push('/')
          onNavigate?.()
        }}
        className="inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-field bg-linear-to-r from-brand-500 to-brand-700 text-[15px] font-semibold text-white shadow-brand transition-all duration-150 hover:from-brand-600 hover:to-brand-800 active:scale-[0.99]"
      >
        <Plus className="h-5 w-5" strokeWidth={2.5} />
        New Chat
      </button>

      <nav className="mt-5 flex flex-col gap-0.5">
        {navItems.map(({ to, label, icon: Icon }) => {
          const isActive = pathname === to || (pathname?.startsWith(`${to}/`) ?? false)
          return (
            <Link
              key={to}
              href={to}
              onClick={onNavigate}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'group flex h-11 items-center gap-3.5 rounded-field px-3.5 text-[15px] font-medium transition-colors',
                isActive
                  ? 'bg-brand-50 text-brand-text'
                  : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900',
              )}
            >
              <Icon
                className={cn(
                  'h-[19px] w-[19px] shrink-0 transition-colors',
                  isActive ? 'text-brand-text' : 'text-slate-400 group-hover:text-slate-600',
                )}
                strokeWidth={1.9}
              />
              {label}
            </Link>
          )
        })}
      </nav>

    </div>
  )
}
