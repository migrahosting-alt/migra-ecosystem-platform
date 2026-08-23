'use client'

import { useState } from 'react'
import {
  AlertTriangle,
  Check,
  Download,
  Loader2,
  Monitor,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import {
  AUTONOMY_LEVELS,
  DENSITIES,
  DETAIL_LEVELS,
  GROUNDING_PREFERENCES,
  LANGUAGES,
  MAX_CUSTOM_INSTRUCTIONS,
  MEMORY_MODES,
  REASONING_DEPTHS,
  RESPONSE_STYLES,
  THEMES,
} from '@migrapilot/shared-types/user-preferences'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { Field, SaveIndicator, SettingsCard, Select, Toggle, Unavailable } from './controls'
import type { AccountController } from './useAccount'
import type { PreferencesController } from './usePreferences'

/**
 * The cards the Settings hub is made of.
 *
 * EVERY CONTROL HERE IS REAL OR VISIBLY ABSENT. Nothing renders as an operable
 * switch over a store that does not exist, and nothing claims a fact the product
 * cannot establish. Where a read failed, the card says so rather than showing a
 * default that would read as an answer.
 */

const labelled = <T extends string>(values: readonly T[], labels: Record<T, string>) =>
  values.map((value) => ({ value, label: labels[value] }))

/* ── identity ─────────────────────────────────────────────────────────────── */

export function IdentityCard({ account }: { account: AccountController['account'] }) {
  if (account.status === 'loading') {
    return <SettingsCard title="Account"><SkeletonRows /></SettingsCard>
  }
  if (account.status === 'signed_out') {
    return (
      <SettingsCard title="Account" description="You are not signed in.">
        <a
          href="/api/auth/login?next=%2Fsettings"
          className="inline-flex h-10 items-center rounded-field bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Sign in
        </a>
      </SettingsCard>
    )
  }
  if (account.status === 'reauth_required') {
    return (
      <SettingsCard title="Account">
        <Unavailable>
          This sign-in predates a security update, so your account details cannot be read yet.
          Signing in again fixes it — nothing has been lost.
        </Unavailable>
        <a
          href="/api/auth/login?next=%2Fsettings"
          className="mt-3 inline-flex h-10 items-center rounded-field bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Sign in again
        </a>
      </SettingsCard>
    )
  }
  if (account.status === 'unavailable') {
    return (
      <SettingsCard title="Account">
        <Unavailable>{account.message}</Unavailable>
      </SettingsCard>
    )
  }

  const { profile } = account
  const name = profile.displayName ?? profile.email ?? 'Your account'

  return (
    <SettingsCard
      title="Account"
      description="Your identity is managed by MigraAuth and shared across every MigraTeck product."
    >
      <div className="flex items-center gap-4">
        <Avatar name={name} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-[17px] font-semibold text-slate-900">{name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
            <span className="truncate">{profile.email ?? 'No email address'}</span>
            {profile.emailVerified ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                <Check className="h-3 w-3" /> Verified
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                <AlertTriangle className="h-3 w-3" /> Unverified
              </span>
            )}
          </p>
        </div>
      </div>

      {/*
        Name, email and photo are edited where they LIVE. MigraPilot showing an
        editable name field would need somewhere to save it, and the only correct
        destination is MigraAuth — so the honest control is a link to it, not a
        form that writes a second copy.
      */}
      <p className="mt-5 text-[13px] leading-relaxed text-slate-500">
        Your name, email address and profile photo are changed in your MigraTeck account, so every
        product stays in step.
      </p>
      <a
        href="https://auth.migrateck.com/sessions"
        className="mt-3 inline-flex h-10 items-center rounded-field border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
      >
        Manage MigraTeck account
      </a>
    </SettingsCard>
  )
}

/* ── connected accounts ───────────────────────────────────────────────────── */

const PROVIDER_LABEL: Record<string, string> = { google: 'Google', github: 'GitHub' }

export function ConnectedAccountsCard({ account }: { account: AccountController['account'] }) {
  if (account.status !== 'ready') return null

  const providers = account.providers

  return (
    <SettingsCard
      title="Connected accounts"
      description="Ways you can sign in. Managed by MigraAuth."
    >
      {providers === null ? (
        /*
         * UNKNOWN, not none. "You have no linked accounts" and "we could not
         * check" look identical and mean opposite things — and one of them
         * invites someone to remove their last way in.
         */
        <Unavailable>Your connected accounts could not be checked just now.</Unavailable>
      ) : providers.length === 0 ? (
        <p className="text-sm text-slate-500">
          You sign in with your email address and password.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {providers.map((p) => (
            <li
              key={p.provider}
              className="flex items-center justify-between gap-3 rounded-xl border border-hairline px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-slate-800">
                  {PROVIDER_LABEL[p.provider] ?? p.provider}
                </p>
                <p className="mt-0.5 truncate text-[13px] text-slate-500">
                  {p.email ?? p.display_name ?? 'Connected'}
                </p>
              </div>
              <span className="shrink-0 text-[13px] text-slate-400">
                Added {new Date(p.linked_at).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/*
        Linking and unlinking live in MigraAuth, and so does the safeguard that
        refuses to remove your last sign-in method. Duplicating that control here
        would mean duplicating the safeguard, and a second copy of a safety check
        is a second chance to get it wrong.
      */}
      <p className="mt-4 text-[13px] leading-relaxed text-slate-500">
        Add or remove a sign-in method in your MigraTeck account. Your last remaining method cannot
        be removed, so you can never be locked out.
      </p>
    </SettingsCard>
  )
}

/* ── security ─────────────────────────────────────────────────────────────── */

function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device'
  // Deliberately coarse. A precise device string is a fingerprint, and a guess
  // dressed up as precision ("MacBook Pro, Cupertino") claims knowledge we do
  // not have.
  if (/iphone|android|mobile/i.test(userAgent)) return 'Mobile browser'
  if (/ipad|tablet/i.test(userAgent)) return 'Tablet browser'
  if (/mac os x/i.test(userAgent)) return 'Mac'
  if (/windows/i.test(userAgent)) return 'Windows'
  if (/linux/i.test(userAgent)) return 'Linux'
  return 'Browser'
}

export function SecurityCard({ controller }: { controller: AccountController }) {
  const { sessions, sessionsError, revoke } = controller
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const end = async (id?: string) => {
    setBusy(id ?? 'others')
    setError(null)
    const result = await revoke(id)
    setBusy(null)
    if (!result.ok) setError(result.message ?? 'That could not be done.')
  }

  return (
    <SettingsCard
      title="Security"
      description="Where your account is signed in right now."
    >
      {sessionsError ? (
        <Unavailable>{sessionsError}</Unavailable>
      ) : sessions === null ? (
        <SkeletonRows />
      ) : sessions.length === 0 ? (
        <p className="text-sm text-slate-500">No other active sessions.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex flex-col gap-3 rounded-xl border border-hairline px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[15px] font-medium text-slate-800">
                  <Monitor className="h-4 w-4 shrink-0 text-slate-400" />
                  {deviceLabel(s.userAgent)}
                  {/*
                    NO "THIS DEVICE" BADGE. MigraAuth derives `current` from its
                    session COOKIE, and this app authenticates with a bearer
                    token — so `current` is false for every row, always. Badging
                    on it would mark nothing, and trusting it to hide a revoke
                    button would offer to sign you out of the session you are
                    reading the page with, while calling it someone else's.
                  */}
                </p>
                {/* Only what MigraAuth actually records. No inferred location. */}
                <p className="mt-0.5 text-[13px] text-slate-500">
                  {s.ipAddress ?? 'IP not recorded'} · last active{' '}
                  {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : 'unknown'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void end(s.id)}
                disabled={busy !== null}
                className="shrink-0 rounded-field border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
              >
                {busy === s.id ? 'Ending…' : 'End session'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {sessions !== null && sessions.length > 1 && (
        <button
          type="button"
          onClick={() => void end()}
          disabled={busy !== null}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-field border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
        >
          <ShieldCheck className="h-4 w-4 text-slate-400" />
          {busy === 'others' ? 'Ending…' : 'End all other sessions'}
        </button>
      )}

      {/*
        SAID PLAINLY, BECAUSE IT IS NOT WHAT PEOPLE ASSUME. Ending a session here
        ends the MigraTeck sign-in. It does NOT immediately close MigraPilot on
        that device: this app holds its own session, and it stops working when
        that session lapses rather than the instant the MigraTeck one is ended.
        A "signed out everywhere" claim would be false for that window, and the
        window is exactly when someone reaches for this control.
      */}
      <p className="mt-4 text-[13px] leading-relaxed text-slate-500">
        Ending a session signs that device out of your MigraTeck account. MigraPilot itself may stay
        open on that device until its own session lapses — to close it immediately, use Sign out on
        the device.
      </p>

      {error && (
        <p role="alert" className="mt-3 text-[13px] text-red-600">
          {error}
        </p>
      )}
    </SettingsCard>
  )
}

/* ── personalization ──────────────────────────────────────────────────────── */

export function PersonalizationCard({ controller }: { controller: PreferencesController }) {
  const { preferences, set, setMany, save, loading, loadError } = controller
  const [instructions, setInstructions] = useState<string | null>(null)

  if (loadError) {
    return (
      <SettingsCard title="Responses">
        <Unavailable>{loadError}</Unavailable>
      </SettingsCard>
    )
  }

  const draft = instructions ?? preferences.customInstructions

  return (
    <SettingsCard
      title="Responses"
      description="How MigraPilot answers by default. You can still change any of this for a single message."
      footer={<SaveIndicator state={save} />}
    >
      <Field label="Writing style" hint="The voice answers are written in." htmlFor="pref-style">
        <Select
          id="pref-style"
          value={preferences.responseStyle}
          disabled={loading}
          options={labelled(RESPONSE_STYLES, {
            neutral: 'Neutral',
            concise: 'Concise',
            friendly: 'Friendly',
            formal: 'Formal',
            technical: 'Technical',
          })}
          onChange={(v) => void set('responseStyle', v)}
        />
      </Field>

      <Field label="Level of detail" hint="How much ground an answer covers." htmlFor="pref-detail">
        <Select
          id="pref-detail"
          value={preferences.detailLevel}
          disabled={loading}
          options={labelled(DETAIL_LEVELS, {
            brief: 'Brief',
            balanced: 'Balanced',
            thorough: 'Thorough',
          })}
          onChange={(v) => void set('detailLevel', v)}
        />
      </Field>

      <Field
        label="Thinking depth"
        hint={
          <>
            Auto lets MigraPilot choose per question, which is usually best.{' '}
            <strong className="font-medium text-slate-600">
              Saved now, applied once the runtime control ships.
            </strong>
          </>
        }
        htmlFor="pref-depth"
      >
        <Select
          id="pref-depth"
          value={preferences.reasoningDepth}
          disabled={loading}
          options={labelled(REASONING_DEPTHS, {
            auto: 'Auto (recommended)',
            fast: 'Fast',
            balanced: 'Balanced',
            deep: 'Deep',
          })}
          onChange={(v) => void set('reasoningDepth', v)}
        />
      </Field>

      <Field
        label="Answering from your files"
        hint="Whether answers should be grounded in documents you have uploaded."
        htmlFor="pref-grounding"
      >
        <Select
          id="pref-grounding"
          value={preferences.groundingPreference}
          disabled={loading}
          options={labelled(GROUNDING_PREFERENCES, {
            auto: 'Automatic',
            prefer_sources: 'Prefer my files',
            require_sources: 'Only answer from my files',
          })}
          onChange={(v) => void set('groundingPreference', v)}
        />
      </Field>

      <Field
        label="Acting without asking"
        hint="How much MigraPilot may do on its own before checking with you."
        htmlFor="pref-autonomy"
      >
        <Select
          id="pref-autonomy"
          value={preferences.autonomyLevel}
          disabled={loading}
          options={labelled(AUTONOMY_LEVELS, {
            ask_first: 'Ask me first',
            suggest: 'Suggest actions',
            act: 'Act, then tell me',
          })}
          onChange={(v) => void set('autonomyLevel', v)}
        />
      </Field>

      <Field label="Language" hint="Auto follows your browser." htmlFor="pref-language">
        <Select
          id="pref-language"
          value={preferences.language}
          disabled={loading}
          options={labelled(LANGUAGES, {
            auto: 'Automatic',
            en: 'English',
            fr: 'Français',
            es: 'Español',
          })}
          onChange={(v) => void set('language', v)}
        />
      </Field>

      <div className="border-t border-hairline pt-4">
        <label htmlFor="pref-instructions" className="block text-[15px] font-medium text-slate-800">
          Custom instructions
        </label>
        <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">
          Anything MigraPilot should keep in mind in every conversation.
        </p>
        <textarea
          id="pref-instructions"
          value={draft}
          disabled={loading}
          maxLength={MAX_CUSTOM_INSTRUCTIONS}
          rows={4}
          onChange={(event) => setInstructions(event.target.value)}
          /*
           * Saved on BLUR, not per keystroke. A PATCH per character would put
           * partial sentences in the audit trail and race itself; this saves the
           * finished thought once.
           */
          onBlur={() => {
            if (instructions === null || instructions === preferences.customInstructions) return
            void setMany({ customInstructions: instructions }).then(() => setInstructions(null))
          }}
          placeholder="For example: I work in healthcare compliance — prefer precise, cautious answers."
          className="mt-2.5 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-[15px] leading-relaxed text-slate-800 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none disabled:bg-slate-50"
        />
        <p className="mt-1.5 text-right text-xs text-slate-400">
          {draft.length} / {MAX_CUSTOM_INSTRUCTIONS}
        </p>
      </div>
    </SettingsCard>
  )
}

/* ── appearance ───────────────────────────────────────────────────────────── */

export function AppearanceCard({ controller }: { controller: PreferencesController }) {
  const { preferences, set, save, loading, loadError } = controller
  if (loadError) return null

  return (
    <SettingsCard
      title="Appearance"
      description="Saved to your account, so it follows you to any device."
      footer={<SaveIndicator state={save} />}
    >
      <Field label="Theme" htmlFor="pref-theme">
        <Select
          id="pref-theme"
          value={preferences.theme}
          disabled={loading}
          options={labelled(THEMES, { system: 'Match my system', light: 'Light', dark: 'Dark' })}
          onChange={(v) => void set('theme', v)}
        />
      </Field>
      <Field label="Density" hint="How tightly content is packed." htmlFor="pref-density">
        <Select
          id="pref-density"
          value={preferences.density}
          disabled={loading}
          options={labelled(DENSITIES, { comfortable: 'Comfortable', compact: 'Compact' })}
          onChange={(v) => void set('density', v)}
        />
      </Field>
      <Field label="Reduce motion" hint="Turn off animations and transitions.">
        <Toggle
          label="Reduce motion"
          checked={preferences.reduceMotion}
          disabled={loading}
          onChange={(v) => void set('reduceMotion', v)}
        />
      </Field>
      <Field label="Higher contrast" hint="Stronger borders and text contrast.">
        <Toggle
          label="Higher contrast"
          checked={preferences.highContrast}
          disabled={loading}
          onChange={(v) => void set('highContrast', v)}
        />
      </Field>
    </SettingsCard>
  )
}

/* ── privacy & data ───────────────────────────────────────────────────────── */

export function PrivacyCard({ controller }: { controller: PreferencesController }) {
  const { preferences, set, save, loading, loadError } = controller
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const exportData = async () => {
    setExporting(true)
    setExportError(null)
    try {
      const response = await fetch('/api/account/export')
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null
        setExportError(body?.message ?? 'Your data could not be exported.')
        return
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `migrapilot-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch {
      setExportError('Your data could not be exported. Check your connection.')
    } finally {
      setExporting(false)
    }
  }

  if (loadError) return null

  return (
    <SettingsCard
      title="Privacy and data"
      description="What MigraPilot keeps, and for how long."
      footer={<SaveIndicator state={save} />}
    >
      <Field
        label="Save new conversations"
        hint="When off, new conversations are not stored and will not appear in your history."
      >
        <Toggle
          label="Save new conversations"
          checked={preferences.saveHistory}
          disabled={loading}
          onChange={(v) => void set('saveHistory', v)}
        />
      </Field>

      <Field
        label="Memory between conversations"
        hint="What MigraPilot carries from one conversation to the next."
        htmlFor="pref-memory"
      >
        <Select
          id="pref-memory"
          value={preferences.memoryMode}
          disabled={loading}
          options={labelled(MEMORY_MODES, {
            off: 'Nothing',
            session: 'Within a conversation',
            durable: 'Across conversations',
          })}
          onChange={(v) => void set('memoryMode', v)}
        />
      </Field>

      <Field
        label="Delete conversations after"
        hint="Keep forever means nothing is removed unless you remove it."
        htmlFor="pref-retention"
      >
        <Select
          id="pref-retention"
          value={String(preferences.retentionDays)}
          disabled={loading}
          options={[
            { value: '0', label: 'Keep forever' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
            { value: '365', label: '1 year' },
          ]}
          onChange={(v) => void set('retentionDays', Number(v))}
        />
      </Field>

      <div className="border-t border-hairline pt-4">
        <button
          type="button"
          onClick={() => void exportData()}
          disabled={exporting}
          className="inline-flex h-10 items-center gap-2 rounded-field border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4 text-slate-400" />}
          {exporting ? 'Preparing…' : 'Export my data'}
        </button>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-500">
          A JSON file with your conversations and settings. Your name and email stay in your
          MigraTeck account and are not copied into it.
        </p>
        {exportError && (
          <p role="alert" className="mt-2 text-[13px] text-red-600">
            {exportError}
          </p>
        )}
      </div>
    </SettingsCard>
  )
}

/* ── notifications ────────────────────────────────────────────────────────── */

export function NotificationsCard({ controller }: { controller: PreferencesController }) {
  const { preferences, set, save, loading, loadError } = controller
  if (loadError) return null

  return (
    <SettingsCard
      title="Email"
      description="What MigraTeck may send you."
      footer={<SaveIndicator state={save} />}
    >
      <Field
        label="Security alerts"
        hint="New sign-ins and changes to how you sign in. Strongly recommended."
      >
        <Toggle
          label="Security alerts"
          checked={preferences.securityEmails}
          disabled={loading}
          onChange={(v) => void set('securityEmails', v)}
        />
      </Field>
      <Field label="Product updates" hint="Occasional news about new features.">
        <Toggle
          label="Product updates"
          checked={preferences.productEmails}
          disabled={loading}
          onChange={(v) => void set('productEmails', v)}
        />
      </Field>
    </SettingsCard>
  )
}

/* ── plan & usage ─────────────────────────────────────────────────────────── */

export function PlanCard({ signedIn }: { signedIn: boolean }) {
  /*
   * NO INVENTED TIER, NO DECORATIVE UPGRADE BUTTON.
   *
   * MigraPilot has no billing integration, so there is no plan to name and no
   * upgrade path to offer. What IS true and worth saying is the real difference
   * the account makes: signed-out visitors get a metered allowance, signed-in
   * accounts do not. That is a fact the product enforces, so it can be stated.
   */
  return (
    <SettingsCard title="Plan and usage" description="What your account includes today.">
      <div className="rounded-xl border border-hairline px-4 py-3.5">
        <p className="text-[15px] font-semibold text-slate-900">
          {signedIn ? 'Signed-in account' : 'Signed out'}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          {signedIn
            ? 'Your messages are not metered, and your conversations are saved to your account.'
            : 'Signed-out visitors get a limited number of free messages before signing in.'}
        </p>
      </div>
      <p className="mt-4 text-[13px] leading-relaxed text-slate-500">
        Paid plans are not available yet. When they are, they will appear here — there is nothing to
        upgrade to today.
      </p>
    </SettingsCard>
  )
}

/* ── danger zone ──────────────────────────────────────────────────────────── */

export function DangerCard({ onHistoryDeleted }: { onHistoryDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const deleteHistory = async () => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch('/api/account/history', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
      })
      const body = (await response.json().catch(() => null)) as
        | { deleted?: number; remaining?: number; message?: string }
        | null

      if (!response.ok && response.status !== 207) {
        setError(body?.message ?? 'Your history could not be deleted.')
        return
      }
      // The count comes from the server, so a partial delete reports what really
      // happened rather than a cheerful "history cleared".
      setResult(
        body?.remaining
          ? (body.message ?? `${body.deleted ?? 0} deleted, ${body.remaining} could not be.`)
          : `${body?.deleted ?? 0} conversation${body?.deleted === 1 ? '' : 's'} deleted.`,
      )
      setConfirming(false)
      setTyped('')
      onHistoryDeleted()
    } catch {
      setError('Your history could not be deleted. Check your connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsCard
      tone="danger"
      title="Delete conversation history"
      description="Permanently removes every conversation and its messages. Your settings and your MigraTeck account are not affected."
    >
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex h-10 items-center gap-2 rounded-field border border-red-300 bg-white px-4 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4" />
          Delete all conversations
        </button>
      ) : (
        <div className="rounded-xl border border-red-200 bg-red-50/60 p-4">
          <p className="text-sm font-semibold text-red-800">This cannot be undone.</p>
          <p className="mt-1 text-[13px] leading-relaxed text-red-700/80">
            Type <span className="font-mono font-semibold">DELETE</span> to confirm.
          </p>
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            aria-label="Type DELETE to confirm"
            className="mt-3 h-10 w-full rounded-field border border-red-300 bg-white px-3 font-mono text-sm text-slate-800 focus:border-red-500 focus:ring-4 focus:ring-red-500/10 focus:outline-none sm:w-56"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void deleteHistory()}
              disabled={typed !== 'DELETE' || busy}
              className="inline-flex h-10 items-center rounded-field bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-40"
            >
              {busy ? 'Deleting…' : 'Delete everything'}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false)
                setTyped('')
              }}
              className="inline-flex h-10 items-center rounded-field border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Keep my history
            </button>
          </div>
        </div>
      )}

      {result && <p className="mt-3 text-[13px] text-slate-600">{result}</p>}
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-red-600">
          {error}
        </p>
      )}

      {/*
        Account deletion is NOT offered here. It would have to remove the
        MigraAuth account every MigraTeck product shares, and MigraAuth has no
        deletion endpoint yet. A button that deleted only the MigraPilot side
        would leave the account alive while telling the person it was gone.
      */}
      <p className="mt-5 border-t border-red-100 pt-4 text-[13px] leading-relaxed text-slate-500">
        Deleting your whole MigraTeck account — across every product — is not something MigraPilot
        can do on its own yet. Contact support and it will be handled properly rather than partially.
      </p>
    </SettingsCard>
  )
}

/* ── shared ───────────────────────────────────────────────────────────────── */

function SkeletonRows() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {[0, 1, 2].map((row) => (
        <div key={row} className={cn('h-10 animate-pulse rounded-xl bg-slate-100')} />
      ))}
    </div>
  )
}
