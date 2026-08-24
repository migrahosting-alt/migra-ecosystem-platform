'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type TabItem<T extends string> = { id: T; label: string; icon?: ReactNode }

/** Pill tabs — used for "All Projects / Starred / Recent" style filters. */
export function PillTabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} role="tablist">
      {items.map((item) => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13px] font-semibold transition-colors',
              active
                ? 'bg-brand-50 text-brand-text ring-1 ring-brand-200/70 ring-inset'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
            )}
          >
            {item.icon}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

/** Underline tabs — used inside rail panels such as the media library. */
export function UnderlineTabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-1 border-b border-hairline', className)} role="tablist">
      {items.map((item) => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={cn(
              '-mb-px border-b-2 px-3 pb-2.5 text-[13px] font-semibold transition-colors',
              active
                ? 'border-brand-600 text-brand-text'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

/** Bordered segmented chips — the "All / Web / Docs / Files" research scope row. */
export function ChipTabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2.5', className)} role="tablist">
      {items.map((item) => {
        const active = item.id === value
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-lg border px-3.5 text-[13px] font-semibold transition-colors',
              active
                ? 'border-brand-200 bg-brand-50 text-brand-text'
                : 'border-slate-200 bg-raised text-slate-600 hover:border-slate-300 hover:bg-slate-50',
            )}
          >
            {item.icon}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
