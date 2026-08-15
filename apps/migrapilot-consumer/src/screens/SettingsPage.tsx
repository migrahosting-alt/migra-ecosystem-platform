'use client'

import { useState, type ReactNode } from 'react'
import { ShieldCheck } from 'lucide-react'
import { Workspace } from '@/components/layout/AppShell'
import { RailCard } from '@/components/rail/RailPanels'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { currentUser, scopeRequest } from '@/data/mock'
import { cn } from '@/lib/cn'

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-hairline bg-white p-5 shadow-card sm:p-6">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-slate-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-600">{label}</span>
      {children}
    </label>
  )
}

const inputClass =
  'h-11 w-full rounded-field border border-slate-200 bg-white px-3.5 text-[15px] text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none'

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  description: string
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <p className="text-[15px] font-medium text-slate-800">{label}</p>
        <p className="mt-0.5 text-sm text-slate-500">{description}</p>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-1 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-brand-600' : 'bg-slate-200',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  )
}

export function SettingsPage() {
  const [prefs, setPrefs] = useState({
    scopeApproval: true,
    autoRepair: true,
    emailDigest: false,
    groundedOnly: true,
  })

  const set = (key: keyof typeof prefs) => (value: boolean) =>
    setPrefs((current) => ({ ...current, [key]: value }))

  return (
    <Workspace
      contentClassName="mx-auto w-full max-w-[880px] px-6 py-7 sm:px-8"
      rail={
        <>
          <RailCard title="Governance">
            <p className="flex items-start gap-2.5 text-[13px] leading-relaxed text-slate-600">
              <ShieldCheck className="mt-0.5 h-4.5 w-4.5 shrink-0 text-brand-600" strokeWidth={2} />
              Every coding run is gated by a scope approval bound to a file-list hash. Decisions are
              written to an audit log.
            </p>
            <div className="mt-4 rounded-xl border border-hairline bg-slate-50/70 p-3">
              <p className="text-xs font-medium text-slate-500">Latest approval</p>
              <code className="mt-1 block truncate font-mono text-[13px] font-semibold text-slate-800">
                {scopeRequest.approvalId}
              </code>
            </div>
          </RailCard>
        </>
      }
    >
      <h1 className="text-[28px] leading-tight font-bold tracking-[-0.025em] text-slate-900">
        Settings
      </h1>
      <p className="mt-1 text-[15px] text-slate-500">
        Manage your profile, assistant behaviour, and governance controls.
      </p>

      <div className="mt-6 flex flex-col gap-5">
        <Section title="Profile" description="How you appear across the workspace.">
          <div className="flex items-center gap-4">
            <Avatar name={currentUser.name} size="lg" className="h-16 w-16 text-lg" />
            <div>
              <Button variant="secondary" size="sm">
                Change photo
              </Button>
              <p className="mt-1.5 text-xs text-slate-400">JPG or PNG, up to 2 MB.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Full name">
              <input className={inputClass} defaultValue={currentUser.name} />
            </Field>
            <Field label="Email address">
              <input className={inputClass} defaultValue={currentUser.email} type="email" />
            </Field>
          </div>
        </Section>

        <Section
          title="Assistant behaviour"
          description="Control how MigraPilot answers and how much it may do on its own."
        >
          <div className="divide-y divide-slate-100">
            <Toggle
              checked={prefs.scopeApproval}
              onChange={set('scopeApproval')}
              label="Require scope approval before any file change"
              description="Recommended. Runs pause until you approve the exact file list."
            />
            <Toggle
              checked={prefs.autoRepair}
              onChange={set('autoRepair')}
              label="Auto-repair failed validations"
              description="Retry fixes automatically when a validation fails, within the approved scope."
            />
            <Toggle
              checked={prefs.groundedOnly}
              onChange={set('groundedOnly')}
              label="Prefer grounded answers"
              description="Cite sources wherever possible and flag claims that could not be verified."
            />
            <Toggle
              checked={prefs.emailDigest}
              onChange={set('emailDigest')}
              label="Email me a weekly digest"
              description="A Monday summary of runs, files analysed, and open approvals."
            />
          </div>
        </Section>

        <Section title="Danger zone" description="These actions cannot be undone.">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-red-100 bg-red-50/50 p-4">
            <div>
              <p className="text-[15px] font-medium text-slate-800">Delete all conversation data</p>
              <p className="mt-0.5 text-sm text-slate-500">
                Removes every chat, uploaded file, and run record from this workspace.
              </p>
            </div>
            <Button variant="danger">Delete data</Button>
          </div>
        </Section>
      </div>
    </Workspace>
  )
}
