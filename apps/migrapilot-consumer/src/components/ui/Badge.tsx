import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type Tone = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'slate' | 'cyan'

export const toneStyles: Record<Tone, { chip: string; tile: string; text: string; bar: string }> = {
  blue: {
    chip: 'bg-brand-50 text-brand-700 ring-brand-100',
    tile: 'bg-brand-50 text-brand-600',
    text: 'text-brand-600',
    bar: 'bg-brand-600',
  },
  green: {
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    tile: 'bg-emerald-50 text-emerald-600',
    text: 'text-emerald-600',
    bar: 'bg-emerald-500',
  },
  amber: {
    chip: 'bg-amber-50 text-amber-700 ring-amber-100',
    tile: 'bg-amber-50 text-amber-600',
    text: 'text-amber-600',
    bar: 'bg-amber-500',
  },
  red: {
    chip: 'bg-red-50 text-red-700 ring-red-100',
    tile: 'bg-red-50 text-red-600',
    text: 'text-red-600',
    bar: 'bg-red-500',
  },
  purple: {
    chip: 'bg-violet-50 text-violet-700 ring-violet-100',
    tile: 'bg-violet-50 text-violet-600',
    text: 'text-violet-600',
    bar: 'bg-violet-500',
  },
  cyan: {
    chip: 'bg-cyan-50 text-cyan-700 ring-cyan-100',
    tile: 'bg-cyan-50 text-cyan-600',
    text: 'text-cyan-600',
    bar: 'bg-cyan-500',
  },
  slate: {
    chip: 'bg-slate-100 text-slate-600 ring-slate-200',
    tile: 'bg-slate-100 text-slate-500',
    text: 'text-slate-500',
    bar: 'bg-slate-400',
  },
}

export function Badge({
  children,
  tone = 'slate',
  icon,
  className,
}: {
  children: ReactNode
  tone?: Tone
  icon?: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ring-inset',
        toneStyles[tone].chip,
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}

/** Rounded-square icon container used beside list rows and feature cards. */
export function IconTile({
  children,
  tone = 'blue',
  size = 'md',
  className,
}: {
  children: ReactNode
  tone?: Tone
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const sizes = {
    sm: 'h-8 w-8 rounded-lg [&_svg]:h-4 [&_svg]:w-4',
    md: 'h-10 w-10 rounded-xl [&_svg]:h-5 [&_svg]:w-5',
    lg: 'h-14 w-14 rounded-2xl [&_svg]:h-6 [&_svg]:w-6',
  }
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        toneStyles[tone].tile,
        sizes[size],
        className,
      )}
    >
      {children}
    </span>
  )
}
