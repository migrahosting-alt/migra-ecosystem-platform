'use client'

import { ShieldCheck } from 'lucide-react'
import { Modal, ModalCloseButton } from '@/components/ui/Modal'
import { CopyButton } from '@/components/ui/CopyField'
import type { CodingScopeView } from '@/server/brain/contracts'

/**
 * A real proposed scope, read-only.
 *
 * TWO THINGS WERE WRONG BEFORE, and only one was fake data.
 *
 * 1. It rendered `scopeRequest` from `src/data/mock.ts` — an invented approval id, an
 *    invented file list with invented diff counts — under a heading promising the change
 *    would be gated on exactly that list.
 *
 * 2. More seriously, it modelled a governance interaction THAT DOES NOT EXIST. It offered
 *    a per-file checkbox and an "approve N of M files" flow, while `CodingScopeView`
 *    states plainly: exclusions are server-decided and there is no per-file user consent.
 *    Approval binds a whole path set to `pathSetHash`. A UI that lets someone believe they
 *    de-selected a file, when the contract has no such concept, is a governance claim that
 *    could not be honoured.
 *
 * So this now shows what the Brain actually published and nothing more. It does not offer
 * Approve or Reject: there is deliberately no `submitScopeDecision` seam — starting and
 * deciding a run needs a workspace root the browser does not have, and runs are decided in
 * the VS Code extension. Offering the buttons here would fake the one step that matters.
 *
 * `scope` is REQUIRED. There is no default and no fallback, so this dialog cannot be shown
 * without a real approval to show.
 */
export function ScopeApprovalModal({
  open,
  onClose,
  scope,
}: {
  open: boolean
  onClose: () => void
  scope: CodingScopeView
}) {
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
              {scope.approvalState}
            </span>
            <h2
              id="scope-title"
              className="mt-2.5 text-[26px] leading-tight font-bold tracking-[-0.025em] text-slate-900"
            >
              Proposed Coding Change
            </h2>
            <p className="mt-1.5 text-[15px] text-slate-500">
              {scope.proposedPaths.length} file{scope.proposedPaths.length === 1 ? '' : 's'} are
              bound to this approval. The decision is made in the MigraPilot VS Code extension.
            </p>
          </div>
        </div>

        <div className="mt-7 rounded-2xl border border-hairline bg-slate-50/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-slate-500">Path set hash</p>
            <CopyButton value={scope.pathSetHash} />
          </div>
          <code className="mt-1 block truncate font-mono text-[13px] font-semibold text-slate-800">
            {scope.pathSetHash}
          </code>
          <p className="mt-3 text-xs text-slate-500">
            Proposed {scope.proposedAt}
            {scope.approvedAt ? ` · approved ${scope.approvedAt}` : ''} · expires{' '}
            {scope.approvalExpiresAt}
          </p>
        </div>

        <ul className="mt-5 flex flex-col gap-1.5">
          {scope.proposedPaths.map((path) => {
            const rationale = scope.rationales.find((r) => r.path === path)?.rationale
            return (
              <li key={path} className="rounded-xl border border-hairline bg-raised px-4 py-3">
                <p className="truncate font-mono text-[13px] text-slate-800">{path}</p>
                {rationale && <p className="mt-1 text-[13px] text-slate-500">{rationale}</p>}
              </li>
            )
          })}
        </ul>

        {scope.excluded.length > 0 && (
          <div className="mt-5">
            <p className="text-xs font-medium text-slate-500">
              Excluded by the server ({scope.excluded.length})
            </p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {scope.excluded.map((item) => (
                <li
                  key={item.path}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3"
                >
                  <p className="truncate font-mono text-[13px] text-slate-600">{item.path}</p>
                  <p className="mt-1 text-[13px] text-slate-500">{item.reason}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}
