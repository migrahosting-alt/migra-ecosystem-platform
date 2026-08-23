'use client'

import { useCallback, useRef, useState } from 'react'
import { Download, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useChat } from '@/state/ChatProvider'
import { useAnonymousQuota } from '@/features/anonymous/AnonymousQuotaProvider'
import { useDismissable } from '@/lib/hooks'
import { cn } from '@/lib/cn'
import { toTranscript, transcriptFilename } from './transcript'

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
  const { byId, renameConversation, deleteConversation } = useChat()
  /*
   * A SIGNED-OUT VISITOR IS OFFERED ONLY WHAT WORKS FOR THEM.
   *
   * Renaming and deleting are account operations — the gateway refuses them for
   * an anonymous principal by policy, not by accident. Showing the controls
   * anyway would put two 403s in a menu of three items, which is a worse answer
   * than not offering them. Export needs no server at all, so it stays.
   */
  const signedOut = useAnonymousQuota().mode === 'anonymous'
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

  const submitRename = async (event: React.FormEvent) => {
    event.preventDefault()
    const next = inputRef.current?.value ?? ''
    if (!next.trim()) return
    setBusy(true)
    const ok = await renameConversation(conversationId, next)
    setBusy(false)
    if (ok) close()
    else setError('That name could not be saved. Try again.')
  }

  /**
   * The file is built and handed over in the browser.
   *
   * There is nothing to ask a server for: the transcript is exactly the thread
   * already loaded, so a round trip would only add a way for this to fail.
   */
  const exportTranscript = () => {
    const now = new Date()
    const blob = new Blob([toTranscript(conversation, now)], { type: 'text/markdown;charset=utf-8' })
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
            'animate-scale-in absolute z-40 mt-2 w-64 rounded-card border border-hairline bg-white p-1.5 shadow-raised',
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
                  disabled={busy}
                  data-testid="rename-save"
                  className="rounded-field bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
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
              {!signedOut && (
                <button type="button" role="menuitem" data-testid="menu-rename" onClick={() => setRenaming(true)} className={item}>
                  <Pencil className="h-4 w-4 text-slate-400" />
                  Rename
                </button>
              )}
              <button type="button" role="menuitem" data-testid="menu-export" onClick={exportTranscript} className={item}>
                <Download className="h-4 w-4 text-slate-400" />
                Export transcript
              </button>
              {!signedOut && (
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
              )}
              {signedOut && (
                <p className="px-3 py-2 text-[13px] leading-relaxed text-slate-400">
                  Sign in to rename or delete conversations.
                </p>
              )}
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
