'use client'

import { useCallback, useRef, useState } from 'react'
import { Download, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useRenameApproval } from './useRenameApproval'
import { useChat } from '@/state/ChatProvider'
import { useDismissable } from '@/lib/hooks'
import { cn } from '@/lib/cn'
import { toTranscript, transcriptFilename } from './transcript'
import { fetchMessages } from './messages'

/**
 * What you can do to a conversation.
 *
 * This replaces a `MoreHorizontal` glyph that was rendered `aria-hidden` beside
 * every row in History — a control-shaped thing with no menu behind it. Three
 * items, and all three are real:
 *
 *   Rename    PATCH, optimistic, rolled back if the server refuses
 *   Export    the transcript, as a file, built from what is on screen
 *   Delete    DELETE, confirmed first, and only removed once the server agrees
 *
 * DELETE ASKS. It is the one irreversible action in the product, it sits one
 * pixel from Export in a menu people open by accident, and there is no undo
 * behind it. The confirmation is inline rather than a modal so the answer stays
 * next to the thing being answered about.
 */
export function ConversationMenu({
  conversationId,
  className,
  onDeleted,
  align = 'right',
}: {
  conversationId: string
  className?: string
  /** Called after the server confirms the delete — e.g. to leave the page. */
  onDeleted?: () => void
  align?: 'left' | 'right'
}) {
  const { byId, applyRenamedTitle, deleteConversation } = useChat()
  const approval = useRenameApproval(conversationId)
  /*
   * THE SIGN-IN GATE IS GONE, because the policy it mirrored is gone.
   *
   * This menu used to hide Rename and Delete from a signed-out visitor and say
   * "Sign in to rename or delete conversations." That was the honest reflection
   * of a server policy at the time: the gateway refused both operations for an
   * anonymous principal, so offering them would have put two 403s in a menu of
   * three items.
   *
   * The policy was the thing that was wrong. A visitor's conversations live in
   * the visitor's own scope, and row-level security is what keeps them there —
   * so renaming or deleting one never leaves that boundary, and erasing what you
   * typed is precisely the control a signed-out person is most likely to want.
   * `deleteConversation` and `renameConversation` are now open to both audiences
   * in OPERATION_AUDIENCE, so the menu offers them to everyone.
   *
   * If either is ever closed to visitors again, this gate comes back with it —
   * a menu item that 403s is worse than one that is absent.
   */
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    setRenaming(false)
    setConfirming(false)
    setError(null)
  }, [])
  const menuRef = useDismissable<HTMLDivElement>(open, close)

  const conversation = byId(conversationId)
  if (!conversation) return null

  /**
   * Saving no longer renames. It PROPOSES.
   *
   * The mutation goes through the approval round-trip: the backend runs every
   * gate, returns the exact action it would perform, and nothing changes until
   * the user reads that sentence and says yes.
   */
  const submitRename = async (event: React.FormEvent) => {
    event.preventDefault()
    const next = inputRef.current?.value ?? ''
    if (!next.trim()) return
    setError(null)
    await approval.propose(next)
  }

  /*
   * The list is refreshed from the SERVER after a confirmed rename, rather than
   * patched optimistically. The old path applied the new title immediately and
   * rolled back on refusal, which cannot represent "we do not know whether it
   * landed" — the one state this flow exists to be honest about.
   */
  const onApprove = async () => {
    await approval.approveRename()
  }

  /** Reflect a title the server CONFIRMED, then close. Never before. */
  if (approval.phase.kind === 'done') {
    applyRenamedTitle(conversationId, approval.phase.title)
    approval.reset()
    close()
  }

  /**
   * The file is assembled and handed over in the browser.
   *
   * IT FETCHES THE THREAD WHEN IT DOES NOT HAVE ONE. Messages load when a
   * conversation is OPENED, so from History the provider holds titles and
   * nothing else — and the first live export produced a file containing a
   * heading and "this conversation has no messages yet" for a conversation with
   * plenty. The screen was not wrong; the export was reading a cache nobody had
   * asked to fill.
   */
  const exportTranscript = async () => {
    setBusy(true)
    setError(null)
    try {
      const messages = conversation.messages.length
        ? conversation.messages
        : await fetchMessages(conversationId)

      const now = new Date()
      const blob = new Blob([toTranscript({ ...conversation, messages }, now)], {
        type: 'text/markdown;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = transcriptFilename(conversation, now)
      document.body.appendChild(link)
      link.click()
      link.remove()
      // Revoked on the next tick: revoking synchronously can beat the download.
      setTimeout(() => URL.revokeObjectURL(url), 0)
      close()
    } catch {
      // Better to say nothing was exported than to hand over an empty file that
      // looks like a conversation with nothing in it.
      setError('The transcript could not be read. Nothing was downloaded.')
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    setBusy(true)
    const ok = await deleteConversation(conversationId)
    setBusy(false)
    if (ok) {
      close()
      onDeleted?.()
    } else {
      setError('That conversation could not be deleted. It is still here.')
      setConfirming(false)
    }
  }

  const item =
    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50'

  return (
    <div className={cn('relative', className)} ref={menuRef}>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => !value)
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Conversation options"
        data-testid="conversation-menu"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
      >
        <MoreHorizontal className="h-4.5 w-4.5" />
      </button>

      {open && (
        <div
          role="menu"
          /*
           * STOP PROPAGATION, NEVER THE DEFAULT.
           *
           * Propagation is what has to stop: this menu sits inside a row that
           * navigates on click. `preventDefault` was here too, and it silently
           * cancelled the ONE default action the menu depends on — submitting
           * the rename form. Every menu item is `type="button"`, so nothing else
           * noticed: the menu opened, the form appeared, the field accepted
           * text, Save reported no error, and no request was ever sent. Found by
           * operating the control on production, not by any test of the route.
           */
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'animate-scale-in absolute z-40 mt-2 w-64 rounded-card border border-hairline bg-raised p-1.5 shadow-raised',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {renaming ? (
            <form onSubmit={submitRename} className="p-1.5">
              <label htmlFor={`rename-${conversationId}`} className="block text-xs font-semibold text-slate-500">
                Conversation name
              </label>
              <input
                id={`rename-${conversationId}`}
                ref={inputRef}
                defaultValue={conversation.title}
                autoFocus
                maxLength={200}
                data-testid="rename-input"
                className="mt-1.5 h-9 w-full rounded-field border border-slate-200 px-2.5 text-sm text-slate-800 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none"
              />
              <div className="mt-2.5 flex justify-end gap-2">
                <button type="button" onClick={close} className="rounded-field px-3 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-100">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={approval.phase.kind === 'proposing'}
                  data-testid="rename-save"
                  className="rounded-field bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {approval.phase.kind === 'proposing' ? 'Checking…' : 'Save'}
                </button>
              </div>

              {/*
                THE APPROVAL STEP. The action text is rendered EXACTLY as the
                backend composed it — it describes the normalized mutation that
                will actually run, and rewriting it here would let the screen
                promise something different from what executes.
              */}
              {approval.phase.kind === 'needs_approval' && (
                <div className="mt-3 rounded-field border border-brand-200 bg-brand-50/60 p-2.5" data-testid="rename-approval">
                  <p className="text-[13px] leading-snug text-slate-800">{approval.phase.action}</p>
                  <div className="mt-2.5 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => void approval.declineRename()}
                      data-testid="rename-decline"
                      className="rounded-field px-3 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-100"
                    >
                      Don’t rename
                    </button>
                    <button
                      type="button"
                      onClick={() => void onApprove()}
                      data-testid="rename-approve"
                      className="rounded-field bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      Rename
                    </button>
                  </div>
                </div>
              )}

              {approval.phase.kind === 'dispatching' && (
                /* Disabled the instant it is pressed — a guard against a double
                   click, NOT the correctness mechanism. Correctness is the
                   single-use token the server spends before it acts. */
                <p className="mt-3 text-[13px] text-slate-500" data-testid="rename-dispatching">
                  Renaming…
                </p>
              )}

              {approval.phase.kind === 'blocked' && (
                <p className="mt-3 text-[13px] leading-snug text-red-600" data-testid="rename-blocked">
                  {approval.phase.message}
                </p>
              )}

              {approval.phase.kind === 'unknown' && (
                /*
                  🚨 NO RETRY BUTTON. The rename was dispatched and could not be
                  confirmed; offering "Try again" invites repeating an action
                  that may already have happened. For a rename that is untidy —
                  the same button on a send or a charge is a duplicate.
                */
                <div className="mt-3 rounded-field border border-amber-300 bg-amber-50 p-2.5" data-testid="rename-unknown">
                  <p className="text-[13px] leading-snug text-amber-800">{approval.phase.message}</p>
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={close}
                      className="rounded-field px-3 py-1.5 text-sm font-semibold text-amber-800 hover:bg-amber-100"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </form>
          ) : confirming ? (
            <div className="p-2">
              <p className="text-sm font-semibold text-slate-800">Delete this conversation?</p>
              <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
                Its messages go with it, and this cannot be undone.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setConfirming(false)} className="rounded-field px-3 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-100">
                  Keep
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  disabled={busy}
                  data-testid="delete-confirm"
                  className="rounded-field bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {busy ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <button type="button" role="menuitem" data-testid="menu-rename" onClick={() => setRenaming(true)} className={item}>
                <Pencil className="h-4 w-4 text-slate-400" />
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="menu-export"
                onClick={() => void exportTranscript()}
                disabled={busy}
                className={item}
              >
                <Download className="h-4 w-4 text-slate-400" />
                {busy ? 'Preparing…' : 'Export transcript'}
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="menu-delete"
                onClick={() => setConfirming(true)}
                className={cn(item, 'hover:bg-red-50 hover:text-red-600')}
              >
                <Trash2 className="h-4 w-4 text-slate-400" />
                Delete
              </button>
            </>
          )}

          {error && (
            <p role="alert" className="mt-1 px-3 pb-1.5 text-[13px] text-red-600">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
