'use client'

import { cn } from '@/lib/cn'
import { toneStyles, type Tone } from './Badge'

export function ProgressBar({
  value,
  tone = 'blue',
  className,
  barClassName,
  label,
}: {
  value: number
  tone?: Tone
  /** Applied to the track — use this for sizing and spacing. */
  className?: string
  /** Applied to the filled portion. */
  barClassName?: string
  label?: string
}) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80', className)}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500 ease-out',
          toneStyles[tone].bar,
          barClassName,
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/** Circular check badge with an orbiting ring — the "all good" illustration. */
export function StatusOrb({
  tone = 'blue',
  className,
  children,
}: {
  tone?: 'blue' | 'green'
  className?: string
  children?: React.ReactNode
}) {
  const fill = tone === 'green' ? 'from-emerald-400 to-emerald-600' : 'from-brand-400 to-brand-600'
  const ring = tone === 'green' ? 'border-emerald-200/70' : 'border-brand-200/70'
  const dot = tone === 'green' ? 'bg-emerald-400' : 'bg-emerald-400'
  return (
    <div className={cn('relative flex h-28 w-full items-center justify-center', className)}>
      <div
        className={cn('absolute h-14 w-40 rotate-[-14deg] rounded-[50%] border-2', ring)}
        aria-hidden
      />
      <div
        className={cn(
          'relative flex h-16 w-16 items-center justify-center rounded-full bg-linear-to-br text-white shadow-lg',
          fill,
        )}
      >
        {children}
      </div>
      <span
        className={cn(
          'absolute top-1/2 left-1/2 ml-[52px] h-3 w-3 -translate-y-1/2 rounded-full',
          dot,
        )}
        aria-hidden
      />
    </div>
  )
}
