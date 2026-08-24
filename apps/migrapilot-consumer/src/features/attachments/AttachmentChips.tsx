'use client'

import { AlertTriangle, CheckCircle2, Loader2, RotateCw, X } from 'lucide-react'
import { FileTypeIcon } from '@/components/ui/FileTypeIcon'
import type { Attachment } from './useAttachments'
import { cn } from '@/lib/cn'

/**
 * What the user can see about each attachment.
 *
 * The five states are shown distinctly on purpose. "Uploading", "indexing", "ready",
 * "stored but not searchable" and "failed" are five different facts, and the one that
 * matters most is the fourth: a file the Brain cannot search is NOT ready, and rounding it
 * up to a tick would promise an answer that cannot be grounded in it.
 */
const label = (attachment: Attachment): string => {
  switch (attachment.state) {
    case 'uploading':
      return 'Uploading…'
    case 'indexing':
      return 'Making it searchable…'
    case 'ready':
      return 'Ready — MigraPilot can read this'
    case 'unsearchable':
      return attachment.reason ?? 'Stored, but not searchable'
    case 'failed':
      return attachment.reason ?? 'Failed'
  }
}

const readableBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`

export function AttachmentChips({
  attachments,
  onRemove,
  onRetry,
}: {
  attachments: Attachment[]
  onRemove: (id: string) => void
  onRetry: (id: string) => void
}) {
  if (attachments.length === 0) return null

  return (
    <ul className="mb-2.5 flex flex-col gap-1.5">
      {attachments.map((attachment) => {
        const bad = attachment.state === 'failed'
        const warn = attachment.state === 'unsearchable'
        const working = attachment.state === 'uploading' || attachment.state === 'indexing'
        return (
          <li
            key={attachment.id}
            className={cn(
              'flex items-center gap-2.5 rounded-xl border px-3 py-2',
              bad
                ? 'border-red-200 bg-red-50/60'
                : warn
                  ? 'border-amber-200 bg-amber-50/60'
                  : 'border-slate-200 bg-slate-50/70',
            )}
          >
            <span className="shrink-0">
              {working ? (
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
              ) : bad ? (
                <AlertTriangle className="h-4 w-4 text-red-600" />
              ) : warn ? (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              )}
            </span>

            <span className="hidden shrink-0 sm:block">
              <FileTypeIcon name={attachment.name} />
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-slate-800">
                {attachment.name}
              </span>
              <span
                className={cn(
                  'block truncate text-[12px]',
                  bad ? 'text-red-700' : warn ? 'text-amber-800' : 'text-slate-500',
                )}
              >
                {label(attachment)}
                {!bad && ` · ${readableBytes(attachment.bytes)}`}
              </span>
            </span>

            {bad && (
              <button
                type="button"
                onClick={() => onRetry(attachment.id)}
                aria-label={`Retry ${attachment.name}`}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-raised px-2 text-[12px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                <RotateCw className="h-3.5 w-3.5" />
                Retry
              </button>
            )}

            <button
              type="button"
              onClick={() => onRemove(attachment.id)}
              aria-label={`Remove ${attachment.name}`}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
