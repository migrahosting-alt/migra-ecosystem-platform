'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Lock,
  ShieldCheck,
  X,
} from 'lucide-react'
import { Modal, ModalCloseButton } from '@/components/ui/Modal'
import { FileTypeIcon } from '@/components/ui/FileTypeIcon'
import { CopyButton } from '@/components/ui/CopyField'
import { Button } from '@/components/ui/Button'
import { scopeRequest } from '@/data/mock'
import { cn } from '@/lib/cn'

/**
 * The approval gate: no file is written until the user signs off on an exact,
 * hash-bound file list. Rejecting or approving both close the dialog and are
 * described to the user as auditable events.
 */
export function ScopeApprovalModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [approved, setApproved] = useState(() =>
    Object.fromEntries(scopeRequest.files.map((file) => [file.path, file.approved])),
  )

  const approvedCount = Object.values(approved).filter(Boolean).length

  return (
    <Modal open={open} onClose={onClose} labelledBy="scope-title">
      <div className="relative p-7 sm:p-8">
        <ModalCloseButton onClose={onClose} />

        <div className="flex items-start gap-5">
          <span className="hidden h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-brand-50 sm:inline-flex">
            <ShieldCheck className="h-8 w-8 text-brand-600" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 pr-8">
            <span className="inline-flex items-center rounded-md bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
              Governed Change
            </span>
            <h2
              id="scope-title"
              className="mt-2.5 text-[26px] leading-tight font-bold tracking-[-0.025em] text-slate-900"
            >
              Proposed Coding Change
            </h2>
            <p className="mt-1.5 text-[15px] text-slate-500">
              Review and approve the scope before any changes are made.
            </p>
          </div>
        </div>

        <div className="mt-7 rounded-2xl border border-hairline bg-slate-50/60 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-[17px] font-semibold text-slate-900">Scope Summary</h3>
              <p className="mt-1 text-sm text-slate-500">
                MigraPilot is requesting approval to modify the following files.
              </p>
            </div>
            <span className="shrink-0 text-sm font-medium text-slate-500">
              {scopeRequest.files.length} files
            </span>
          </div>

          <ul className="mt-4 flex flex-col gap-3">
            {scopeRequest.files.map((file) => {
              const isOpen = expanded === file.path
              const isApproved = approved[file.path]

              return (
                <li key={file.path} className="rounded-xl border border-hairline bg-white">
                  <div className="flex items-start gap-3.5 p-4">
                    <FileTypeIcon name={file.path} size="md" className="mt-0.5" />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-slate-900">
                        {file.path}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-slate-500">
                        <span className="font-medium text-slate-600">Evidence:</span>{' '}
                        {file.evidence}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() =>
                          setApproved((current) => ({ ...current, [file.path]: !isApproved }))
                        }
                        aria-pressed={isApproved}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors',
                          isApproved
                            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
                        )}
                      >
                        {isApproved ? (
                          <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.4} />
                        ) : (
                          <X className="h-3.5 w-3.5" strokeWidth={2.4} />
                        )}
                        {isApproved ? 'Approved' : 'Excluded'}
                      </button>
                      <button
                        onClick={() => setExpanded(isOpen ? null : file.path)}
                        aria-label={isOpen ? 'Hide details' : 'Show details'}
                        aria-expanded={isOpen}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                      >
                        <ChevronDown
                          className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')}
                        />
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <p className="animate-fade border-t border-hairline px-4 py-3.5 text-sm leading-relaxed text-slate-600">
                      {file.detail}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>

          <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200/70 bg-amber-50/70 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" strokeWidth={2.2} />
            <div>
              <p className="text-sm font-semibold text-slate-800">
                Only the files listed above are approved.
              </p>
              <p className="mt-0.5 text-sm text-slate-500">
                Any changes outside this scope require a new approval.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-hairline bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Approval ID (Scope Hash)</p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <code className="truncate font-mono text-sm font-semibold text-slate-800">
                  {scopeRequest.approvalId}
                </code>
                <CopyButton value={scopeRequest.approvalId} label="Copy approval ID" />
              </div>
            </div>
            <div className="rounded-xl border border-hairline bg-white p-4">
              <p className="text-xs font-medium text-slate-500">Expires</p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-slate-800">
                  {scopeRequest.expires}
                </span>
                <Clock className="h-4 w-4 shrink-0 text-slate-400" />
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Button variant="secondary" size="lg" onClick={onClose} className="text-red-600">
              <X className="h-4.5 w-4.5" strokeWidth={2.4} />
              Reject
            </Button>
            <Button
              size="lg"
              disabled={approvedCount === 0}
              onClick={() => {
                onClose()
                router.push('/runs/active')
              }}
            >
              <ShieldCheck className="h-4.5 w-4.5" strokeWidth={2.2} />
              Approve Scope
            </Button>
          </div>

          <p className="mt-3.5 flex items-center justify-center gap-2 text-[13px] text-slate-400">
            <Lock className="h-3.5 w-3.5" strokeWidth={2} />
            Your decision is logged and auditable.
          </p>
        </div>
      </div>
    </Modal>
  )
}
