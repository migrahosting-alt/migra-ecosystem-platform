'use client'

import { useEffect, useState } from 'react'
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
import type { SaveState } from './usePreferences'
import {
  CloseAccountFlow,
  EmailChangeFlow,
  MfaDisable,
  MfaEnrollment,
} from './accountFlows'
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

export function IdentityCard({ controller }: { controller: AccountController }) {
  const account = controller.account
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
        {/*
          THE REMEDY WAS RIGHT; THE REASON WAS INVENTED. This used to say the
          sign-in "predates a security update", which named a cause the app has
          no way to know. The condition is simply that this app can no longer
          renew its access to your MigraTeck account — the session ended, or the
          token could not be refreshed. Seen live after a session was revoked in
          testing, where the confident wrong explanation was the only misleading
          thing on the page.
        */}
        <Unavailable>
          MigraPilot can no longer renew its access to your MigraTeck account, so your account
          details cannot be read. Signing in again restores it — nothing has been lost.
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
        THE NAME IS NOW EDITABLE HERE, AND STILL LIVES IN ONE PLACE. The earlier
        version linked out instead, on the reasoning that an editable field would
        need somewhere to save it and the only correct destination is MigraAuth.
        The destination was the right conclusion; the link was the wrong remedy —
        it sent people to another product to change their own name. `PATCH /v1/me`
        now exists, this writes straight through to it, and no copy is kept.

        A NAME AND AN ADDRESS ARE NOT THE SAME WEIGHT, which is why they are
        separate blocks rather than two fields in a row. This one saves on submit.
        The address below cannot: it is an identity change, so it moves only
        after a code proves the new mailbox.
      */}
      <div className="mt-6 border-t border-hairline pt-5">
        <DisplayNameField controller={controller} current={profile.displayName} />
      </div>

      {/*
        EMAIL IS NOW EDITABLE TOO — but through a flow, not a field. The earlier
        note said it was changed elsewhere; that was true only because no
        verified-change flow existed. One does now, and it keeps the property
        that made the restriction right in the first place: the address does not
        move until a code proves the new mailbox.
      */}
      <div className="mt-5 border-t border-hairline pt-5">
        <p className="text-[15px] font-medium text-slate-800">Email address</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">
          Used to sign in and to reach you. Changing it needs a code sent to the new address.
        </p>
        <EmailChangeFlow onChanged={controller.reload} />
      </div>
    </SettingsCard>
  )
}

/**
 * The one editable identity field.
 *
 * Deliberately NOT optimistic. Everywhere else in Settings a control may move
 * first and reconcile after, because the value is the app's own. A name is the
 * account's, MigraAuth normalises it (trimmed; all-whitespace clears it), and
 * showing the typed text as saved would disagree with the next reload. So it
 * saves, re-reads, and shows what was actually stored.
 */
function DisplayNameField({
  controller,
  current,
}: {
  controller: AccountController
  current: string | null
}) {
  const [value, setValue] = useState(current ?? '')
  const [state, setState] = useState<SaveState>({ status: 'idle' })

  // Follows the server when a reload brings a different value — otherwise this
  // field would keep showing a stale edit after any other change re-read.
  useEffect(() => {
    setValue(current ?? '')
  }, [current])

  const dirty = value.trim() !== (current ?? '')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!dirty) return
    setState({ status: 'saving' })
    const trimmed = value.trim()
    const result = await controller.saveDisplayName(trimmed.length > 0 ? trimmed : null)
    setState(
      result.ok
        ? { status: 'saved', at: Date.now() }
        : { status: 'error', message: result.message ?? 'Your name could not be saved.' },
    )
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="display-name" className="block text-[15px] font-medium text-slate-800">
        Display name
      </label>
      <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">
        How you are addressed across MigraTeck. Leave it empty to go by your email address.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          id="display-name"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={120}
          placeholder="Your name"
          data-testid="display-name-input"
          className="h-10 w-full rounded-field border border-slate-200 bg-raised px-3 text-[15px] text-slate-800 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none sm:max-w-[320px]"
        />
        <button
          type="submit"
          disabled={!dirty || state.status === 'saving'}
          data-testid="display-name-save"
          className="h-10 shrink-0 rounded-field bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-40"
        >
          {state.status === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </div>
      <SaveIndicator state={state} className="mt-2" />
    </form>
  )
}

/* ── connected accounts ───────────────────────────────────────────────────── */

const PROVIDER_LABEL: Record<string, string> = { google: 'Google', github: 'GitHub' }

export function ConnectedAccountsCard({ controller }: { controller: AccountController }) {
  const account = controller.account
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (account.status !== 'ready') return null

  const providers = account.providers
  const security = account.security
  const linked = new Set(providers?.map((p) => p.provider) ?? [])
  const addable = Object.keys(PROVIDER_LABEL).filter((id) => !linked.has(id))

  const unlink = async (provider: string) => {
    setBusy(provider)
    setError(null)
    const result = await controller.unlinkProvider(provider)
    if (!result.ok) setError(result.message ?? 'That sign-in method could not be removed.')
    setBusy(null)
  }

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
              <div className="flex shrink-0 items-center gap-3">
                <span className="hidden text-[13px] text-slate-400 sm:inline">
                  Added {new Date(p.linked_at).toLocaleDateString()}
                </span>
                {/*
                  DISABLED WITH A REASON, NEVER HIDDEN. When this is the only way
                  in, the control stays visible and says why it cannot be used —
                  removing it entirely would leave someone wondering whether the
                  feature exists. The refusal is still MigraAuth's: this only
                  explains it earlier. `can_unlink_a_provider` unknown (a failed
                  security read) is treated as "cannot", because offering to
                  remove a sign-in method on a guess is the one direction with a
                  permanent cost.
                */}
                <button
                  type="button"
                  onClick={() => void unlink(p.provider)}
                  disabled={busy !== null || !security?.can_unlink_a_provider}
                  title={
                    security?.can_unlink_a_provider
                      ? undefined
                      : security
                        ? 'This is the only way to sign in to your account.'
                        : 'Your sign-in methods could not be checked just now.'
                  }
                  data-testid={`unlink-${p.provider}`}
                  className="rounded-field border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:bg-transparent disabled:hover:text-slate-700"
                >
                  {busy === p.provider ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/*
        THE SAFEGUARD EXPLAINS ITSELF, IN PLACE.
        A disabled button with a tooltip states a RULE; it does not tell anyone
        what to do about it, and tooltips are unreachable on touch — which is
        most of the people who would hit this. So when removal is blocked the
        card says why AND names the two ways out, next to the control.

        IT ALSO SAYS WHAT THIS IS NOT. "You cannot remove your only sign-in
        method" is easily read as "you cannot leave", so the note points at
        account closure explicitly and separately. Blocking a removal protects
        access; closing an account ends it. Conflating them would make a safety
        feature look like a trap.
      */}
      {providers !== null && providers.length > 0 && security && !security.can_unlink_a_provider && (
        <div className="mt-3 rounded-xl border border-hairline bg-slate-50 px-4 py-3">
          <p className="text-[13px] leading-relaxed text-slate-700">
            <strong className="font-semibold">
              This is the only way to sign in, so it cannot be removed.
            </strong>{' '}
            Add a second method first — connect another account below, or set a password on your
            MigraTeck account — and then this can be removed.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <a
              href="https://auth.migrateck.com/sessions"
              className="inline-flex h-9 items-center rounded-field border border-slate-300 bg-raised px-3 text-[13px] font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
            >
              Set a password
            </a>
          </div>
          <p className="mt-2.5 text-[13px] leading-relaxed text-slate-500">
            Trying to close your account entirely? That is a separate action, under
            <a href="#danger" className="font-semibold text-brand-text hover:text-brand-text-hover">
              {' '}
              Delete history
            </a>
            .
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[13px] leading-relaxed text-red-600">
          {error}
        </p>
      )}

      {/*
        ADDING A PROVIDER IS A REDIRECT, NOT A FETCH. It has to leave for Google
        or GitHub and come back through MigraAuth's callback, so this is a link
        to the real social flow with a return to this page — not a button that
        would have to pretend it could finish the job here.
      */}
      {addable.length > 0 && providers !== null && (
        <div className="mt-4 flex flex-wrap gap-2">
          {addable.map((id) => (
            <a
              key={id}
              href={`https://auth.migrateck.com/api/v1/social/${id}/start?return_to=${encodeURIComponent(
                'https://chat.migrateck.com/settings',
              )}`}
              data-testid={`link-${id}`}
              className="inline-flex h-10 items-center rounded-field border border-slate-300 bg-raised px-4 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
            >
              Add {PROVIDER_LABEL[id]}
            </a>
          ))}
        </div>
      )}

      <p className="mt-4 text-[13px] leading-relaxed text-slate-500">
        Your last remaining sign-in method cannot be removed, so you can never be locked out.
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

  const security = controller.account.status === 'ready' ? controller.account.security : null

  return (
    <SettingsCard
      title="Security"
      description="How your account is protected, and where it is signed in."
    >
      {/*
        REPORTED, NOT ASSUMED. Both facts come from MigraAuth
        (`GET /v1/me/security`); when that read fails the card says it could not
        check rather than rendering `false`, which would tell someone two-step
        verification is off when it may be on — the single most dangerous thing
        this card could get wrong.
      */}
      <div className="mb-5 flex flex-col gap-2.5 border-b border-hairline pb-5">
        {security === null ? (
          <Unavailable>
            Your password and two-step verification status could not be checked just now.
          </Unavailable>
        ) : (
          <>
            <SecurityFact
              label="Two-step verification"
              on={security.mfa_enabled}
              onText="On — a code is required when you sign in"
              offText="Off"
            />
            <SecurityFact
              label="Password"
              on={security.has_password}
              onText={
                security.password_updated_at
                  ? `Set — last changed ${new Date(security.password_updated_at).toLocaleDateString()}`
                  : 'Set'
              }
              /*
                NOT A DEFICIENCY, AND NOT PHRASED AS ONE. An account created
                through Google or GitHub has no password and does not need one;
                calling that "missing" would push people toward adding a
                credential they never asked for. It matters only because a
                password is a second way in — which is what the line says.
              */
              offText="Not set — you sign in with a connected account"
            />
          </>
        )}
        {/*
          TWO-STEP VERIFICATION IS MANAGED HERE NOW. The previous line sent
          people to another product for it, which was accurate only while this
          app had no flow of its own. It has one, so the control lives beside the
          fact it changes.

          The PASSWORD link stays: setting or changing one is a MigraAuth flow
          with its own reset-token handling, and duplicating that here would
          duplicate a credential path rather than surface one.
        */}
        {security !== null &&
          (security.mfa_enabled ? (
            <MfaDisable hasPassword={security.has_password} onDisabled={controller.reload} />
          ) : (
            <MfaEnrollment onEnrolled={controller.reload} />
          ))}

        <p className="mt-3 text-[13px] leading-relaxed text-slate-500">
          Your password is managed in your MigraTeck account.{' '}
          <a
            href="https://auth.migrateck.com/sessions"
            className="font-semibold text-brand-text hover:text-brand-text-hover"
          >
            Manage password
          </a>
        </p>
      </div>

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
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-field border border-slate-300 bg-raised px-4 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
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
          className="inline-flex h-10 items-center gap-2 rounded-field border border-slate-300 bg-raised px-4 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
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
      <UsageFigures />

      {/*
        WHY THERE IS NO SUBSCRIPTION HERE, stated rather than left as an absence.
        MigraAuth's billing endpoints are org-scoped — each requires an
        `x-org-id` and resolves entitlements for an organisation. A consumer has
        no organisation, so there is no subscription, entitlement or invoice that
        belongs to them, and inventing an org to query would fabricate a billing
        relationship. When a consumer plan exists it will appear here.
      */}
      <p className="mt-4 text-[13px] leading-relaxed text-slate-500">
        Paid plans are not available yet. When they are, they will appear here — there is nothing to
        upgrade to today.
      </p>
    </SettingsCard>
  )
}

/**
 * Real counts, read from the conversations this account actually holds.
 *
 * Loading and failure are distinct states. A failed read says so; it never falls
 * back to zeros, because a confident "0 conversations" shown to someone with
 * hundreds is the kind of wrong number that makes every other figure suspect.
 */
function UsageFigures() {
  const [usage, setUsage] = useState<
    | { status: 'loading' }
    | {
        status: 'ready'
        conversations: number
        messages: number
        messagesFromYou: number
        unreadableConversations: number
      }
    | { status: 'unavailable'; message: string }
  >({ status: 'loading' })

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const response = await fetch('/api/account/usage', { cache: 'no-store' })
        const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
        if (!live) return
        if (!response.ok) {
          setUsage({
            status: 'unavailable',
            message: (body?.['message'] as string) ?? 'Your usage could not be read just now.',
          })
          return
        }
        setUsage({
          status: 'ready',
          conversations: Number(body?.['conversations'] ?? 0),
          messages: Number(body?.['messages'] ?? 0),
          messagesFromYou: Number(body?.['messagesFromYou'] ?? 0),
          unreadableConversations: Number(body?.['unreadableConversations'] ?? 0),
        })
      } catch {
        if (live) setUsage({ status: 'unavailable', message: 'Your usage could not be read just now.' })
      }
    })()
    return () => {
      live = false
    }
  }, [])

  if (usage.status === 'loading') return <div className="mt-4"><SkeletonRows /></div>
  if (usage.status === 'unavailable') {
    return <div className="mt-4"><Unavailable>{usage.message}</Unavailable></div>
  }

  return (
    <div className="mt-4">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <UsageFigure label="Conversations" value={usage.conversations} />
        <UsageFigure label="Messages" value={usage.messages} />
        <UsageFigure label="Sent by you" value={usage.messagesFromYou} />
      </div>
      {usage.unreadableConversations > 0 && (
        <p className="mt-2.5 text-[13px] leading-relaxed text-amber-700">
          {usage.unreadableConversations} conversation
          {usage.unreadableConversations === 1 ? '' : 's'} could not be read, so these totals are
          lower than the real figure.
        </p>
      )}
    </div>
  )
}

function UsageFigure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-hairline px-4 py-3">
      <p className="text-[22px] leading-none font-semibold tracking-[-0.02em] text-slate-900">
        {value.toLocaleString()}
      </p>
      <p className="mt-1.5 text-[13px] text-slate-500">{label}</p>
    </div>
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
          className="inline-flex h-10 items-center gap-2 rounded-field border border-red-300 bg-raised px-4 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"
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
            className="mt-3 h-10 w-full rounded-field border border-red-300 bg-raised px-3 font-mono text-sm text-slate-800 focus:border-red-500 focus:ring-4 focus:ring-red-500/10 focus:outline-none sm:w-56"
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
              className="inline-flex h-10 items-center rounded-field border border-slate-300 bg-raised px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
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
        ACCOUNT DELETION IS OFFERED NOW, and the reason it was not is worth
        keeping: it would have to remove the MigraAuth account every MigraTeck
        product shares, and MigraAuth had no deletion endpoint — so a button here
        would have deleted only the MigraPilot side while telling the person the
        account was gone. `POST /v1/me/close` exists now, so the button does what
        it says.

        The route deletes conversations FIRST and only then closes the account,
        because closing first would revoke the authority needed to reach them and
        strand the content with nobody left who could delete it.
      */}
      <div className="mt-5 border-t border-red-100 pt-4">
        <p className="text-[15px] font-semibold text-slate-900">Close your MigraTeck account</p>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
          Ends your access to every MigraTeck product, not just MigraPilot.
        </p>
        <CloseAccountFlow />
      </div>
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

/**
 * One reported security fact.
 *
 * Green for on, plain slate for off — deliberately NOT red or amber. "Password
 * not set" is a normal state for a provider-only account, and dressing it as a
 * warning would invent a problem the person does not have. Only real problems
 * get warning colours.
 */
function SecurityFact({
  label,
  on,
  onText,
  offText,
}: {
  label: string
  on: boolean
  onText: string
  offText: string
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
      <span className="text-[15px] font-medium text-slate-800">{label}</span>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 text-[13px] sm:text-right',
          on ? 'text-emerald-700' : 'text-slate-500',
        )}
      >
        {on && <Check className="h-3.5 w-3.5 shrink-0" />}
        {on ? onText : offText}
      </span>
    </div>
  )
}
