'use client'

import type { ReactNode } from 'react'
import { AlertTriangle, PlugZap, ShieldCheck, ShieldOff } from 'lucide-react'
import { Workspace } from '@/components/layout/AppShell'
import { RailCard } from '@/components/rail/RailPanels'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import type { PublicSession } from '@/server/auth'
import type { GovernedCodingView } from '@/server/brain/view'
import { cn } from '@/lib/cn'

/**
 * TRUTHFULNESS CONTRACT — the same one TopBar holds, now enforced here too.
 *
 * This screen may render ONLY facts handed to it by the server: a real session and a
 * real governed-coding capability. It must not import `@/data/mock`. The previous
 * version showed "Emma Johnson / emma.johnson@migrapilot.io" in the profile fields
 * while the header three inches above rendered the genuinely signed-in account, and
 * pinned a decorative approval id (`MP-7F3A-2C9D-8B6E`) under a "Latest approval"
 * heading — a governance claim with nothing behind it.
 *
 * The rule applied throughout: if there is no backend for a control, the control is
 * DISABLED and says why. It is never left looking operable. A settings toggle that
 * flips, looks saved, and is forgotten on reload is worse than one that admits it is
 * not wired up, because the user only discovers the truth after trusting it.
 */

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

/** A read-only fact from the session. Not an input: nothing here can be saved yet. */
function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-slate-600">{label}</span>
      <p className="flex h-11 w-full items-center rounded-field border border-slate-200 bg-slate-50 px-3.5 text-[15px] text-slate-700">
        {value}
      </p>
    </div>
  )
}

/**
 * A preference control with no store behind it.
 *
 * Rendered in its real position and real state so the page still communicates what
 * MigraPilot's behaviour IS, but visibly inert — `disabled`, `aria-disabled`, and no
 * handler — so it cannot be mistaken for a saved setting.
 */
function PendingToggle({
  checked,
  label,
  description,
}: {
  checked: boolean
  label: string
  description: string
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <p className="text-[15px] font-medium text-slate-500">{label}</p>
        <p className="mt-0.5 text-sm text-slate-400">{description}</p>
      </div>
      <span
        role="switch"
        aria-checked={checked}
        aria-disabled="true"
        aria-label={`${label} (not editable yet)`}
        title="Not editable yet — MigraPilot has no settings service to save this to."
        className={cn(
          'relative mt-1 inline-flex h-6 w-11 shrink-0 cursor-not-allowed rounded-full opacity-50',
          checked ? 'bg-brand-600' : 'bg-slate-200',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </span>
    </div>
  )
}

function Notice({ tone, icon, children }: { tone: 'amber' | 'slate'; icon: ReactNode; children: ReactNode }) {
  return (
    <p
      className={cn(
        'flex items-start gap-2.5 rounded-xl border p-3 text-[13px] leading-relaxed',
        tone === 'amber'
          ? 'border-amber-200 bg-amber-50/70 text-amber-900'
          : 'border-hairline bg-slate-50/70 text-slate-600',
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </p>
  )
}

/** The governance rail — real capability state, or an honest account of why not. */
function GovernanceCard({ capability }: { capability: GovernedCodingView }) {
  if (capability.state === 'ready') {
    return (
      <RailCard title="Governance">
        <p className="flex items-start gap-2.5 text-[13px] leading-relaxed text-slate-600">
          <ShieldCheck className="mt-0.5 h-4.5 w-4.5 shrink-0 text-brand-600" strokeWidth={2} />
          Governed coding is active. Every run is gated by a scope approval before any file
          changes, and progress is reported by {capability.progressMode}.
        </p>
        <div className="mt-4 rounded-xl border border-hairline bg-slate-50/70 p-3">
          <p className="text-xs font-medium text-slate-500">Approval mode</p>
          <code className="mt-1 block truncate font-mono text-[13px] font-semibold text-slate-800">
            {capability.approvalMode}
          </code>
          <p className="mt-2 text-xs text-slate-500">
            {capability.workspaceRootsConfigured} workspace root
            {capability.workspaceRootsConfigured === 1 ? '' : 's'} configured
          </p>
        </div>
      </RailCard>
    )
  }

  const headline =
    capability.state === 'incompatible'
      ? 'This app and the Brain disagree on the capability contract, so nothing is being claimed here.'
      : capability.state === 'unreachable'
        ? 'The Brain could not be reached, so governed-coding state is unknown.'
        : capability.state === 'signed_out'
          ? 'Sign in to see governed-coding state.'
          : 'Governed coding is not available on this workspace.'

  return (
    <RailCard title="Governance">
      <p className="flex items-start gap-2.5 text-[13px] leading-relaxed text-slate-600">
        <ShieldOff className="mt-0.5 h-4.5 w-4.5 shrink-0 text-slate-400" strokeWidth={2} />
        {headline}
      </p>
      <div className="mt-4 rounded-xl border border-hairline bg-slate-50/70 p-3">
        <p className="text-xs font-medium text-slate-500">Reported reason</p>
        <p className="mt-1 text-[13px] break-words text-slate-700">{capability.reason}</p>
      </div>
    </RailCard>
  )
}

export function SettingsPage({
  session,
  capability,
}: {
  session: PublicSession | null
  capability: GovernedCodingView
}) {
  return (
    <Workspace
      contentClassName="mx-auto w-full max-w-[880px] px-6 py-7 sm:px-8"
      rail={<GovernanceCard capability={capability} />}
    >
      <h1 className="text-[28px] leading-tight font-bold tracking-[-0.025em] text-slate-900">
        Settings
      </h1>
      <p className="mt-1 text-[15px] text-slate-500">
        Manage your profile, assistant behaviour, and governance controls.
      </p>

      <div className="mt-6 flex flex-col gap-5">
        <Section title="Profile" description="How you appear across the workspace.">
          {session ? (
            <>
              <div className="flex items-center gap-4">
                <Avatar name={session.displayName} size="lg" className="h-16 w-16 text-lg" />
                <div>
                  <Button variant="secondary" size="sm" disabled title="Profile photos are not stored yet.">
                    Change photo
                  </Button>
                  <p className="mt-1.5 text-xs text-slate-400">
                    Photo uploads are not available yet.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <ReadOnlyField label="Full name" value={session.displayName} />
                <ReadOnlyField label="Email address" value={session.email} />
              </div>
              {session.activeOrgName && (
                <p className="mt-4 text-sm text-slate-500">
                  Workspace: <span className="font-medium text-slate-700">{session.activeOrgName}</span>
                  {session.activeOrgRole ? ` · ${session.activeOrgRole}` : ''}
                </p>
              )}
              <div className="mt-4">
                <Notice tone="slate" icon={<PlugZap className="h-4 w-4" />}>
                  Your name and email come from your MigraAuth account and are shown read-only —
                  MigraPilot has no profile service to save changes to, so it does not offer an
                  edit box that would quietly discard them.
                </Notice>
              </div>
            </>
          ) : (
            <Notice tone="amber" icon={<AlertTriangle className="h-4 w-4" />}>
              You are not signed in, so there is no profile to show. Sign in to see your account
              details here.
            </Notice>
          )}
        </Section>

        <Section
          title="Assistant behaviour"
          description="How MigraPilot answers today, and how much it may do on its own."
        >
          <Notice tone="amber" icon={<AlertTriangle className="h-4 w-4" />}>
            These are MigraPilot&rsquo;s current built-in behaviours, shown for transparency. They
            are <strong>not editable yet</strong>: there is no settings service to store a choice,
            so the controls are disabled rather than appearing to save and resetting on reload.
          </Notice>
          <div className="mt-4 divide-y divide-slate-100">
            <PendingToggle
              checked
              label="Require scope approval before any file change"
              description="Runs pause until you approve the exact file list."
            />
            <PendingToggle
              checked
              label="Prefer grounded answers"
              description="Cite sources wherever possible and flag claims that could not be verified."
            />
          </div>
        </Section>

        <Section title="Danger zone" description="These actions cannot be undone.">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div>
              <p className="text-[15px] font-medium text-slate-600">Delete all conversation data</p>
              <p className="mt-0.5 text-sm text-slate-500">
                Not available yet — MigraPilot has no delete-my-data path, and a button that
                appears to erase everything without doing so is the worst kind to fake.
              </p>
            </div>
            <Button variant="danger" disabled title="No deletion service exists yet.">
              Delete data
            </Button>
          </div>
        </Section>
      </div>
    </Workspace>
  )
}
