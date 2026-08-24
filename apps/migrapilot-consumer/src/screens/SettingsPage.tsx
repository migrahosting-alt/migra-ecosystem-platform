'use client'

import { useEffect, useState } from 'react'
import {
  Bell,
  CreditCard,
  Link2,
  Palette,
  ShieldCheck,
  ShieldAlert,
  Sliders,
  Lock,
  User,
} from 'lucide-react'
import { Workspace } from '@/components/layout/AppShell'
import type { PublicSession } from '@/server/auth'
import { cn } from '@/lib/cn'
import { usePreferences } from '@/features/settings/usePreferences'
import { useAccount } from '@/features/settings/useAccount'
import {
  AppearanceCard,
  ConnectedAccountsCard,
  DangerCard,
  IdentityCard,
  NotificationsCard,
  PersonalizationCard,
  PlanCard,
  PrivacyCard,
  SecurityCard,
} from '@/features/settings/cards'

/**
 * The account hub.
 *
 * TRUTHFULNESS CONTRACT, inherited and unchanged. This screen renders only facts
 * it can establish: identity read live from MigraAuth, preferences read from the
 * preferences document, sessions read from MigraAuth. Where a read fails it says
 * so; where a capability does not exist it is absent, not disabled-and-hopeful.
 *
 * IDENTITY IS NOT EDITED HERE. Name, email, photo and sign-in methods are
 * MigraAuth's, and the honest control for them is a link to where they live —
 * not a form that writes a second copy which drifts.
 *
 * The navigation is a convenience over ONE scrolling document rather than a
 * router. Every section stays reachable on every device, deep links keep
 * working, and the mobile experience is the same content without a second
 * layout to maintain.
 */

interface SectionDef {
  id: string
  label: string
  icon: typeof User
}

const SECTIONS: SectionDef[] = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'responses', label: 'Responses', icon: Sliders },
  { id: 'connected', label: 'Connected accounts', icon: Link2 },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'privacy', label: 'Privacy and data', icon: Lock },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'email', label: 'Email', icon: Bell },
  { id: 'plan', label: 'Plan and usage', icon: CreditCard },
  { id: 'danger', label: 'Delete history', icon: ShieldAlert },
]

export function SettingsPage({ session }: { session: PublicSession | null }) {
  const preferences = usePreferences()
  const account = useAccount()
  const [active, setActive] = useState('account')

  /*
   * The nav follows the reader rather than the reader following the nav.
   *
   * `scrollIntoView` on click plus an observer on the way back means the
   * highlight is always the section actually on screen — including after a
   * manual scroll, which a click-only implementation gets wrong immediately.
   */
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (visible?.target.id) setActive(visible.target.id)
      },
      { rootMargin: '-96px 0px -60% 0px', threshold: 0 },
    )
    for (const section of SECTIONS) {
      const element = document.getElementById(section.id)
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [])

  const go = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActive(id)
  }

  return (
    <Workspace contentClassName="mx-auto w-full max-w-[1100px] px-5 py-7 sm:px-8">
      <header>
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.025em] text-slate-900">
          Settings
        </h1>
        <p className="mt-1 text-[15px] text-slate-500">
          Your account, how MigraPilot answers, and what it keeps.
        </p>
      </header>

      <div className="mt-7 flex flex-col gap-7 lg:flex-row lg:items-start lg:gap-10">
        {/*
          Desktop: a sticky rail. Mobile: a horizontally scrollable strip rather
          than a stack of links pushing the content off the first screen.
        */}
        <nav
          aria-label="Settings sections"
          className={cn(
            'shrink-0 lg:sticky lg:top-6 lg:w-[228px]',
            '-mx-5 overflow-x-auto px-5 pb-1 sm:-mx-8 sm:px-8 lg:mx-0 lg:overflow-visible lg:px-0 lg:pb-0',
          )}
        >
          <ul className="flex gap-1.5 lg:flex-col lg:gap-0.5">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <li key={id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => go(id)}
                  aria-current={active === id ? 'true' : undefined}
                  className={cn(
                    'flex h-10 items-center gap-2.5 rounded-field px-3 text-sm font-medium whitespace-nowrap transition-colors lg:w-full',
                    active === id
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900',
                    id === 'danger' && active !== id && 'text-red-600 hover:bg-red-50 hover:text-red-700',
                  )}
                >
                  <Icon
                    className={cn(
                      'h-[17px] w-[17px] shrink-0',
                      active === id ? 'text-brand-600' : 'text-slate-400',
                      id === 'danger' && active !== id && 'text-red-400',
                    )}
                    strokeWidth={1.9}
                  />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <section id="account" className="scroll-mt-24">
            <IdentityCard controller={account} />
          </section>

          <section id="responses" className="scroll-mt-24">
            <PersonalizationCard controller={preferences} />
          </section>

          <section id="connected" className="scroll-mt-24">
            <ConnectedAccountsCard controller={account} />
          </section>

          <section id="security" className="scroll-mt-24">
            <SecurityCard controller={account} />
          </section>

          <section id="privacy" className="scroll-mt-24">
            <PrivacyCard controller={preferences} />
          </section>

          <section id="appearance" className="scroll-mt-24">
            <AppearanceCard controller={preferences} />
          </section>

          <section id="email" className="scroll-mt-24">
            <NotificationsCard controller={preferences} />
          </section>

          <section id="plan" className="scroll-mt-24">
            <PlanCard signedIn={session !== null} />
          </section>

          {/* Isolated at the bottom, and the only card with a danger tone. */}
          <section id="danger" className="scroll-mt-24 pt-2">
            <DangerCard onHistoryDeleted={() => account.reload()} />
          </section>

          <footer className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 pt-2 pb-4 text-[13px] text-slate-400">
            <a href="https://migrateck.com/legal/privacy" className="hover:text-slate-600">
              Privacy
            </a>
            <a href="https://migrateck.com/legal/terms" className="hover:text-slate-600">
              Terms
            </a>
            {session && (
              <form action="/api/auth/logout" method="post" className="ml-auto">
                <button
                  type="submit"
                  data-testid="settings-sign-out"
                  className="font-semibold text-slate-500 hover:text-red-600"
                >
                  Sign out
                </button>
              </form>
            )}
          </footer>
        </div>
      </div>
    </Workspace>
  )
}
