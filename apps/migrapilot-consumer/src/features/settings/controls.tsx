'use client'

import type { ReactNode } from 'react'
import { Check, Loader2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { SaveState } from './usePreferences'

/**
 * The controls every Settings card is built from.
 *
 * ONE RULE RUNS THROUGH ALL OF THEM: a control shows what the SERVER holds. It
 * may move optimistically, but its resting state is always the saved value, and
 * a refused save visibly returns it. There is no styling here for "looks saved"
 * — saved is a fact reported by the server or it is not claimed at all.
 *
 * They are also all disable-able with a REASON. A disabled control with no
 * explanation is a dead end; one that says why is information.
 */

export function SettingsCard({
  title,
  description,
  children,
  footer,
  tone = 'default',
}: {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  /** `danger` isolates irreversible actions visually as well as positionally. */
  tone?: 'default' | 'danger'
}) {
  return (
    <section
      className={cn(
        'rounded-2xl border bg-raised shadow-card',
        tone === 'danger' ? 'border-red-200' : 'border-hairline',
      )}
    >
      <div className="p-5 sm:p-6">
        <h2
          className={cn(
            'text-[17px] font-semibold tracking-[-0.01em]',
            tone === 'danger' ? 'text-red-700' : 'text-slate-900',
          )}
        >
          {title}
        </h2>
        {description && <p className="mt-1 text-sm leading-relaxed text-slate-500">{description}</p>}
        <div className="mt-5">{children}</div>
      </div>
      {footer && (
        <div className="border-t border-hairline bg-slate-50/60 px-5 py-3.5 sm:px-6">{footer}</div>
      )}
    </section>
  )
}

/** A labelled row. Stacks on narrow screens rather than crushing the control. */
export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-hairline py-4 first:pt-0 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 sm:max-w-[58%]">
        <label htmlFor={htmlFor} className="block text-[15px] font-medium text-slate-800">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">{hint}</p>}
      </div>
      <div className="shrink-0 sm:min-w-[220px]">{children}</div>
    </div>
  )
}

export function Select<T extends string>({
  id,
  value,
  options,
  onChange,
  disabled,
  disabledReason,
}: {
  id?: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  disabled?: boolean
  disabledReason?: string
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      onChange={(event) => onChange(event.target.value as T)}
      className={cn(
        'h-10 w-full rounded-field border border-slate-200 bg-raised px-3 text-[15px] text-slate-800',
        'focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none',
        disabled && 'cursor-not-allowed bg-slate-50 text-slate-400',
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function Toggle({
  id,
  checked,
  onChange,
  label,
  disabled,
  disabledReason,
}: {
  id?: string
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
  disabledReason?: string
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-brand-600' : 'bg-slate-300',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'inline-block h-4.5 w-4.5 transform rounded-full bg-raised shadow transition-transform',
          checked ? 'translate-x-[26px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  )
}

/**
 * What just happened to a save.
 *
 * "Saved" appears only after the server said so. An error stays until the next
 * attempt rather than fading, because a message about lost work that disappears
 * on its own is a message the user may never have read.
 */
export function SaveIndicator({ state, className }: { state: SaveState; className?: string }) {
  if (state.status === 'idle') return null

  if (state.status === 'saving') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-[13px] text-slate-400', className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
      </span>
    )
  }

  if (state.status === 'saved') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-[13px] text-emerald-600', className)}>
        <Check className="h-3.5 w-3.5" /> Saved
      </span>
    )
  }

  return (
    <span
      role="alert"
      className={cn('inline-flex items-start gap-1.5 text-[13px] text-red-600', className)}
    >
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {state.message}
    </span>
  )
}

/**
 * A fact the product cannot currently establish.
 *
 * Used where a read failed. It says so plainly instead of rendering a default
 * that would look like an answer — the difference between "we could not check"
 * and "there is nothing" is the whole point.
 */
export function Unavailable({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-3 text-[13px] leading-relaxed text-slate-500">
      {children}
    </div>
  )
}
