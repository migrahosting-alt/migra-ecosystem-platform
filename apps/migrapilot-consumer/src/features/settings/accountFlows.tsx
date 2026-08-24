'use client'

import { useState } from 'react'
import QRCode from 'qrcode'
import { AlertTriangle, Check, Copy, Loader2, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * The multi-step account flows: changing your email, two-step verification, and
 * closing the account.
 *
 * THEY LIVE TOGETHER BECAUSE THEY SHARE ONE RULE: each has a point of no return,
 * and each must be honest about exactly where that point is. An email is not
 * changed until a code proves the new address. Recovery codes are shown once and
 * never again. Closing an account deletes conversations first and says so.
 *
 * NOTHING SECRET IS RETAINED. The setup key and recovery codes exist only in the
 * response that created them and in the DOM that displays them. They are not put
 * in application state that outlives the step, not written to storage, and not
 * logged.
 */

const field =
  'h-10 w-full rounded-field border border-slate-200 bg-raised px-3 text-[15px] text-slate-800 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none'
const primary =
  'h-10 shrink-0 rounded-field bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-40'
const secondary =
  'h-10 shrink-0 rounded-field border border-slate-300 bg-raised px-4 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 disabled:opacity-40'

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-2 flex items-start gap-1.5 text-[13px] leading-relaxed text-red-600">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {children}
    </p>
  )
}

/* ── email change ─────────────────────────────────────────────────────────── */

/**
 * Two steps, and the first one changes nothing.
 *
 * The screen says so explicitly while the code is outstanding, because a form
 * that has visibly "submitted" a new address reads as done — and someone who
 * stops there would believe their address had changed when it had not.
 */
export function EmailChangeFlow({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const reset = () => {
    setOpen(false)
    setEmail('')
    setChallengeId(null)
    setSentTo(null)
    setCode('')
    setError(null)
  }

  const request = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/account/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const body = (await response.json().catch(() => null)) as
        | { challengeId?: string; sentTo?: string; message?: string }
        | null
      if (!response.ok) {
        setError(body?.message ?? 'That change could not be started.')
        return
      }
      setChallengeId(body?.challengeId ?? null)
      setSentTo(body?.sentTo ?? null)
    } catch {
      setError('That change could not be started. Check your connection.')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/account/email', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeId, code }),
      })
      const body = (await response.json().catch(() => null)) as { message?: string } | null
      if (!response.ok) {
        setError(body?.message ?? 'That code could not be confirmed.')
        return
      }
      setDone(true)
      reset()
      onChanged()
    } catch {
      setError('That code could not be confirmed. Check your connection.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="mt-3">
        <button type="button" onClick={() => { setOpen(true); setDone(false) }} className={secondary}>
          Change email address
        </button>
        {done && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-emerald-600">
            <Check className="h-3.5 w-3.5" /> Your email address was changed.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-xl border border-hairline bg-slate-50/60 p-4">
      {challengeId === null ? (
        <form onSubmit={request}>
          <label htmlFor="new-email" className="block text-[15px] font-medium text-slate-800">
            New email address
          </label>
          <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">
            We will send a code there to confirm it is yours. Your current address keeps working
            until you enter it.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              id="new-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              data-testid="new-email-input"
              className={cn(field, 'sm:max-w-[320px]')}
            />
            <button type="submit" disabled={busy} data-testid="new-email-send" className={primary}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
            <button type="button" onClick={reset} className={secondary}>
              Cancel
            </button>
          </div>
          {error && <Problem>{error}</Problem>}
        </form>
      ) : (
        <form onSubmit={confirm}>
          <label htmlFor="email-code" className="block text-[15px] font-medium text-slate-800">
            Enter the code we sent to {sentTo ?? 'your new address'}
          </label>
          {/*
            SAID PLAINLY WHILE IT IS STILL TRUE. Someone who abandons the flow
            here must not walk away believing their address changed.
          */}
          <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">
            Your email address has <strong className="font-semibold">not</strong> changed yet.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              id="email-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="123456"
              data-testid="email-code-input"
              className={cn(field, 'sm:max-w-[180px]')}
            />
            <button type="submit" disabled={busy} data-testid="email-code-confirm" className={primary}>
              {busy ? 'Confirming…' : 'Confirm change'}
            </button>
            <button type="button" onClick={reset} className={secondary}>
              Cancel
            </button>
          </div>
          {error && <Problem>{error}</Problem>}
        </form>
      )}
    </div>
  )
}

/* ── two-step verification ────────────────────────────────────────────────── */

/**
 * Enrolment.
 *
 * THE QR IS RENDERED IN THE BROWSER, from the otpauth URI, so the secret is
 * never turned into an image by a server that would then have it in a response
 * buffer or a cache. The setup key is shown alongside it because scanning is not
 * always possible — a desktop authenticator, or a camera that will not focus.
 *
 * RECOVERY CODES ARE SHOWN BEFORE THE CONFIRMATION STEP, deliberately. After
 * MigraAuth stores their hashes nothing can display them again, so the moment to
 * put them in front of someone is while they still have the screen open — not
 * after a success message that invites them to navigate away.
 */
export function MfaEnrollment({ onEnrolled }: { onEnrolled: () => void }) {
  const [step, setStep] = useState<'idle' | 'setup' | 'confirming'>('idle')
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [setupKey, setSetupKey] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const begin = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/account/mfa', { method: 'POST' })
      const body = (await response.json().catch(() => null)) as {
        challengeId?: string
        setupKey?: string
        otpauthUri?: string
        recoveryCodes?: string[]
        message?: string
      } | null
      if (!response.ok) {
        setError(body?.message ?? 'Two-step verification could not be set up.')
        return
      }
      setChallengeId(body?.challengeId ?? null)
      setSetupKey(body?.setupKey ?? null)
      setRecoveryCodes(body?.recoveryCodes ?? [])
      if (body?.otpauthUri) {
        // Rendered locally; the URI never leaves this tab again.
        setQr(await QRCode.toDataURL(body.otpauthUri, { margin: 1, width: 190 }).catch(() => ''))
      }
      setStep('setup')
    } catch {
      setError('Two-step verification could not be set up. Check your connection.')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/account/mfa', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, challengeId }),
      })
      const body = (await response.json().catch(() => null)) as { message?: string } | null
      if (!response.ok) {
        setError(body?.message ?? 'That code could not be confirmed.')
        return
      }
      /*
       * The secrets are dropped from state the moment they are no longer needed.
       * They are already unrecoverable server-side; keeping them in a live
       * component only widens where they exist.
       */
      setSetupKey(null)
      setQr(null)
      setRecoveryCodes([])
      setStep('idle')
      setCode('')
      onEnrolled()
    } catch {
      setError('That code could not be confirmed. Check your connection.')
    } finally {
      setBusy(false)
    }
  }

  if (step === 'idle') {
    return (
      <div className="mt-3">
        <button type="button" onClick={() => void begin()} disabled={busy} data-testid="mfa-enroll" className={primary}>
          {busy ? 'Preparing…' : 'Turn on two-step verification'}
        </button>
        {error && <Problem>{error}</Problem>}
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-xl border border-hairline bg-slate-50/60 p-4">
      <p className="text-[15px] font-medium text-slate-800">
        Scan this with your authenticator app
      </p>

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            alt="QR code for your authenticator app"
            className="h-[190px] w-[190px] shrink-0 rounded-lg border border-slate-200 bg-raised"
          />
        ) : (
          <div className="flex h-[190px] w-[190px] shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-raised text-[13px] text-slate-400">
            Use the setup key
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-relaxed text-slate-500">
            Cannot scan? Enter this setup key in your app instead.
          </p>
          <code
            data-testid="mfa-setup-key"
            className="mt-1.5 block rounded-field border border-slate-200 bg-raised px-3 py-2 font-mono text-[13px] break-all text-slate-700"
          >
            {setupKey}
          </code>

          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-900">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              Save your recovery codes now
            </p>
            {/*
              THE ONE TIME THESE EXIST. MigraAuth keeps only hashes after this
              response, so there is no "show them again" and the screen must not
              imply otherwise.
            */}
            <p className="mt-1 text-[13px] leading-relaxed text-amber-800">
              These are shown once and cannot be shown again. Each one signs you in if you lose your
              authenticator.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[13px] text-amber-900">
              {recoveryCodes.map((c) => (
                <span key={c} data-testid="mfa-recovery-code">
                  {c}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(recoveryCodes.join('\n'))
                setCopied(true)
              }}
              className="mt-2.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-amber-900 hover:text-amber-950"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy codes'}
            </button>
          </div>
        </div>
      </div>

      <form onSubmit={confirm} className="mt-4 border-t border-hairline pt-4">
        <label htmlFor="mfa-code" className="block text-[15px] font-medium text-slate-800">
          Enter the 6-digit code from your app to finish
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="mfa-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="123456"
            data-testid="mfa-confirm-input"
            className={cn(field, 'sm:max-w-[180px]')}
          />
          <button type="submit" disabled={busy} data-testid="mfa-confirm" className={primary}>
            {busy ? 'Confirming…' : 'Confirm and turn on'}
          </button>
          <button type="button" onClick={() => { setStep('idle'); setSetupKey(null); setQr(null); setRecoveryCodes([]) }} className={secondary}>
            Cancel
          </button>
        </div>
        {error && <Problem>{error}</Problem>}
      </form>
    </div>
  )
}

/**
 * Turning it off.
 *
 * WHAT IT ASKS FOR DEPENDS ON WHAT THE ACCOUNT HAS. An account created through
 * Google or GitHub has no password, so demanding one would be asking for
 * something that does not exist — which is exactly the trap this replaced, where
 * such accounts could never disable MFA at all.
 */
export function MfaDisable({
  hasPassword,
  onDisabled,
}: {
  hasPassword: boolean
  onDisabled: () => void
}) {
  const [open, setOpen] = useState(false)
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const disable = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/account/mfa', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        // A password-holder may still prefer a code; anything not matching a
        // password is offered as a code, and the server tries both.
        body: JSON.stringify(hasPassword ? { password: secret, code: secret } : { code: secret }),
      })
      const body = (await response.json().catch(() => null)) as { message?: string } | null
      if (!response.ok) {
        setError(body?.message ?? 'Two-step verification could not be turned off.')
        return
      }
      setSecret('')
      setOpen(false)
      onDisabled()
    } catch {
      setError('That could not be done. Check your connection.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} data-testid="mfa-disable-open" className={cn(secondary, 'mt-3')}>
        Turn off two-step verification
      </button>
    )
  }

  return (
    <form onSubmit={disable} className="mt-4 rounded-xl border border-hairline bg-slate-50/60 p-4">
      <label htmlFor="mfa-disable-secret" className="block text-[15px] font-medium text-slate-800">
        Confirm it is you
      </label>
      <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">
        {hasPassword
          ? 'Enter your password, a code from your authenticator, or a recovery code.'
          : 'Enter a code from your authenticator app, or one of your recovery codes.'}
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          id="mfa-disable-secret"
          type={hasPassword ? 'password' : 'text'}
          required
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          data-testid="mfa-disable-input"
          className={cn(field, 'sm:max-w-[280px]')}
        />
        <button type="submit" disabled={busy} data-testid="mfa-disable-confirm" className={primary}>
          {busy ? 'Turning off…' : 'Turn off'}
        </button>
        <button type="button" onClick={() => { setOpen(false); setSecret(''); setError(null) }} className={secondary}>
          Cancel
        </button>
      </div>
      {error && <Problem>{error}</Problem>}
    </form>
  )
}

/* ── closing the account ──────────────────────────────────────────────────── */

/**
 * The end of everything, and it says exactly what that means.
 *
 * THE LIST IS SPECIFIC ON PURPOSE. "This cannot be undone" is true of the
 * delete-history control too; what distinguishes this one is which things stop
 * existing. Naming them is the difference between a warning someone reads and
 * one they click past.
 */
export function CloseAccountFlow() {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/account/close', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
      })
      const body = (await response.json().catch(() => null)) as { message?: string } | null
      if (!response.ok) {
        setError(body?.message ?? 'Your account could not be closed.')
        return
      }
      // Closed accounts have nowhere signed-in to return to.
      window.location.href = '/'
    } catch {
      setError('Your account could not be closed. Check your connection.')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="close-account-open"
        className="mt-3 h-10 rounded-field border border-red-300 bg-raised px-4 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"
      >
        Close my MigraTeck account
      </button>
    )
  }

  return (
    <div className="mt-4 rounded-xl border border-red-200 bg-red-50/60 p-4">
      <p className="text-[15px] font-semibold text-red-800">Close your MigraTeck account?</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-red-800">
        <li>Every conversation and message in MigraPilot is deleted first.</li>
        <li>You are signed out everywhere and cannot sign in again.</li>
        <li>Your connected Google and GitHub sign-ins are detached.</li>
        <li>Your email address is released, so you could sign up again later.</li>
      </ul>
      <label htmlFor="close-confirm" className="mt-3 block text-[13px] font-medium text-red-800">
        Type DELETE to confirm
      </label>
      <input
        id="close-confirm"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        data-testid="close-account-input"
        className="mt-1.5 h-10 w-full max-w-[220px] rounded-field border border-red-300 bg-raised px-3 text-[15px] text-slate-800 focus:border-red-400 focus:ring-4 focus:ring-red-500/10 focus:outline-none"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void close()}
          disabled={typed !== 'DELETE' || busy}
          data-testid="close-account-confirm"
          className="inline-flex h-10 items-center gap-2 rounded-field bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-40"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? 'Closing…' : 'Close my account'}
        </button>
        <button type="button" onClick={() => { setOpen(false); setTyped(''); setError(null) }} className={secondary}>
          Keep my account
        </button>
      </div>
      {error && <Problem>{error}</Problem>}
    </div>
  )
}
