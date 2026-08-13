'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { StatusOrb } from '@/components/ui/Progress'
import { FileTypeIcon, extensionOf } from '@/components/ui/FileTypeIcon'
import { uploadedFiles } from '@/data/mock'
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

export function AssistantStatusPanel() {
  return (
    <RailCard title="Assistant Status">
      <p className="flex items-center gap-2 text-[15px] font-semibold text-emerald-600">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
        Online
      </p>
      <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
        MigraPilot is ready to help you today.
      </p>
      <StatusOrb className="mt-4">
        <Check className="h-8 w-8" strokeWidth={3} />
      </StatusOrb>
    </RailCard>
  )
}

export function RecentFilesPanel() {
  return (
    <RailCard title="Recent Files" action={<RailLink href="/files">View all</RailLink>}>
      <ul className="flex flex-col gap-1">
        {uploadedFiles.map((file) => (
          <li key={file.id}>
            <Link
              href="/files"
              className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-slate-50"
            >
              <FileTypeIcon name={file.name} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-800">
                  {file.name}
                </span>
                <span className="block text-xs text-slate-400 uppercase">
                  {extensionOf(file.name)} • {file.size}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </RailCard>
  )
}

/** Row with an icon tile, a title/subtitle stack and a trailing chevron. */
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
