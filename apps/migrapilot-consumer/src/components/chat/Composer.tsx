'use client'

import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { ImageIcon, Lock, Mic, Paperclip, SendHorizontal } from 'lucide-react'
import { AttachmentChips } from '@/features/attachments/AttachmentChips'
import { useAttachments } from '@/features/attachments/useAttachments'
import { micDisabledReason, useMicAvailability } from '@/features/voice/useMicAvailability'
import { cn } from '@/lib/cn'

/**
 * THE CONTROLS IN HERE ARE REAL, OR THEY ARE VISIBLY OFF.
 *
 * The paperclip, the mic and the image button were all `type="button"` with no handler —
 * three affordances promising capabilities the composer did not have. The paperclip now
 * runs the whole path (see `useAttachments`): pick, validate, upload to the caller's own
 * library, index it, and mark the turn grounded so the Brain answers FROM the file.
 *
 * The mic and the image button are DISABLED, with the reason in their tooltip, because
 * there is no speech pipeline and no image ingest behind them. A control that is enabled
 * and does nothing is the thing being removed here; leaving one in place while fixing its
 * neighbour would defeat the point.
 */

const toolButton =
  'inline-flex h-10 w-10 items-center justify-center rounded-field border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700'

export function Composer({
  onSubmit,
  placeholder = 'Ask anything or give MigraPilot a task...',
  variant = 'default',
  autoFocus,
  defaultValue = '',
  className,
  highlighted,
}: {
  /** `meta.grounded` is true when the turn carries a searchable attachment. */
  onSubmit?: (value: string, meta?: { grounded?: boolean }) => void
  placeholder?: string
  /** "media" adds image/mic affordances inline, as on the media review screen. */
  variant?: 'default' | 'media' | 'research'
  autoFocus?: boolean
  defaultValue?: string
  className?: string
  /** Renders the resting state already focused, as in the research mockup. */
  highlighted?: boolean
}) {
  const [value, setValue] = useState(defaultValue)
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { attachments, limits, add, remove, retry, clear, busy, groundable } = useAttachments()
  /*
   * THE MIC IS GATED ON THE SHARED CAPABILITY, not on a local guess.
   *
   * The consumer asks the Brain whether speech is available; it never reaches into the
   * Command Center's whisper runtime. Until the Brain implements the operation this reports
   * `incompatible` and the control stays off with that reason shown — which is the correct
   * answer, and a visibly different one from "switched off".
   */
  const mic = useMicAvailability()
  const micReady = mic?.state === 'ready'
  const micReason = micDisabledReason(mic)

  const grow = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`
  }

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    // Never send while an attachment is still uploading or indexing: the turn would be
    // answered without the file the user attached it for.
    if (busy) return
    onSubmit?.(trimmed, groundable ? { grounded: true } : undefined)
    setValue('')
    clear()
    requestAnimationFrame(grow)
  }

  const onPicked = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) add(event.target.files)
    // Reset so picking the SAME file twice still fires a change event.
    event.target.value = ''
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const active = focused || highlighted

  return (
    <form
      onSubmit={submit}
      className={cn(
        'rounded-2xl border bg-white p-3.5 transition-all duration-200',
        active
          ? 'border-brand-400 ring-4 ring-brand-500/10'
          : 'border-slate-200 shadow-card hover:border-slate-300',
        className,
      )}
    >
      <AttachmentChips attachments={attachments} onRemove={remove} onRetry={retry} />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onPicked}
        {...(limits ? { accept: limits.allowedExtensions.join(',') } : {})}
      />

      <textarea
        ref={textareaRef}
        rows={variant === 'research' ? 2 : 1}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label="Message MigraPilot"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          setValue(event.target.value)
          grow()
        }}
        className="scroll-slim block max-h-42 w-full resize-none bg-transparent px-1.5 pt-1 text-[15px] leading-relaxed text-slate-800 placeholder:text-slate-400 focus:outline-none"
      />

      <div className="mt-2.5 flex items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          {variant === 'media' ? (
            <>
              <button
                type="button"
                disabled={!micReady}
                title={micReady ? 'Record a voice note' : micReason}
                className={cn(toolButton, !micReady && 'cursor-not-allowed opacity-40')}
                aria-label={micReady ? 'Record voice note' : `Record voice note (unavailable: ${micReason})`}
              >
                <Mic className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={toolButton}
                aria-label="Attach a file"
              >
                <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </button>
              <button
                type="button"
                disabled
                title="Image attachments aren't supported yet — only text and code documents can be read."
                className={cn(toolButton, 'cursor-not-allowed opacity-40')}
                aria-label="Attach an image (not available yet)"
              >
                <ImageIcon className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={toolButton}
              aria-label="Attach a file"
            >
              <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.9} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          {variant !== 'media' && (
            <button
              type="button"
              disabled={!micReady}
              title={micReady ? 'Dictate' : micReason}
              className={cn(toolButton, !micReady && 'cursor-not-allowed opacity-40')}
              aria-label={micReady ? 'Dictate' : `Dictate (unavailable: ${micReason})`}
            >
              <Mic className="h-[18px] w-[18px]" strokeWidth={1.9} />
            </button>
          )}
          <button
            type="submit"
            aria-label="Send message"
            className="inline-flex h-10 w-10 items-center justify-center rounded-field bg-brand-600 text-white shadow-brand transition-all hover:bg-brand-700 active:scale-95 disabled:opacity-40 disabled:shadow-none"
            disabled={!value.trim() || busy}
            title={busy ? 'Waiting for your attachment to finish' : undefined}
          >
            <SendHorizontal className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        </div>
      </div>
    </form>
  )
}

export function ComposerDisclaimer({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        'flex items-center justify-center gap-2 text-[13px] text-slate-400',
        className,
      )}
    >
      <Lock className="h-3.5 w-3.5" strokeWidth={2} />
      MigraPilot can make mistakes. Check important info.
    </p>
  )
}
