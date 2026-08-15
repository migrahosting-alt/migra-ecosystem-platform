'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/cn'

export function RailCard({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <Card className={cn('p-5', className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {typeof title === 'string' ? (
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">{title}</h2>
          ) : (
            title
          )}
          {action}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </Card>
  )
}

export function RailLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="shrink-0 text-[13px] font-semibold text-brand-600 transition-colors hover:text-brand-700"
    >
      {children}
    </Link>
  )
}

/* AssistantStatusPanel and RecentFilesPanel were REMOVED 2026-08-15.
 * They rendered a hardcoded "Online" status and three invented documents
 * (Migration Plan.pdf etc.) to signed-out visitors on a public site. Neither was
 * backed by anything real. Reinstate only when a genuine Brain health probe and
 * a real per-principal file list exist. Do not restore the mock versions. */

export function ActionRow({
  icon,
  title,
  subtitle,
  onClick,
  to,
  trailing,
  className,
}: {
  icon: ReactNode
  title: string
  subtitle?: string
  onClick?: () => void
  to?: string
  trailing?: ReactNode
  className?: string
}) {
  const body = (
    <>
      {icon}
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-semibold text-brand-700">{title}</span>
        {subtitle && (
          <span className="mt-0.5 block text-xs leading-snug text-slate-500">{subtitle}</span>
        )}
      </span>
      {trailing}
    </>
  )

  const classes = cn(
    'flex w-full items-center gap-3 rounded-xl border border-hairline bg-white p-3 transition-colors hover:border-brand-200 hover:bg-brand-50/50',
    className,
  )

  if (to) {
    return (
      <Link href={to} className={classes}>
        {body}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={classes}>
      {body}
    </button>
  )
}
