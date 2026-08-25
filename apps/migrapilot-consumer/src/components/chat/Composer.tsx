'use client'

import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react'
import { ImageIcon, Lock, Mic, Paperclip, SendHorizontal } from 'lucide-react'
import { AttachmentChips } from '@/features/attachments/AttachmentChips'
import { acceptAttribute } from '@/features/attachments/filename'
import { useAttachments } from '@/features/attachments/useAttachments'
import { useVisionAvailability, visionDisabledReason } from '@/features/attachments/useVisionAvailability'
import { micDisabledReason, useMicAvailability } from '@/features/voice/useMicAvailability'
import { VoicePanel } from '@/features/voice/VoicePanel'
import { useVoiceRecorder } from '@/features/voice/useVoiceRecorder'
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
 *
 * `disabled` follows the same rule. It is a convenience — the server refuses the turn
 * either way — but a composer that accepts a paragraph and only then says "you are out of
 * free messages" has wasted the user's typing to tell them something it already knew.
 */

const toolButton =
  'inline-flex h-10 w-10 items-center justify-center rounded-field border border-slate-200 bg-raised text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700'

export function Composer({
  onSubmit,
  placeholder = 'Ask anything or give MigraPilot a task...',
  variant = 'default',
  autoFocus,
  defaultValue = '',
  className,
  highlighted,
  disabled = false,
  disabledReason,
}: {
  /**
   * `meta.attachments` names the searchable files this turn attached, if any.
   * `meta.images` carries content-addressed IMAGE IDS — never filenames, so the
   * reference still resolves when the conversation is reloaded.
   */
  onSubmit?: (value: string, meta?: { attachments?: string[]; images?: string[] }) => void
  placeholder?: string
  /** "media" adds image/mic affordances inline, as on the media review screen. */
  variant?: 'default' | 'media' | 'research'
  autoFocus?: boolean
  defaultValue?: string
  className?: string
  /** Renders the resting state already focused, as in the research mockup. */
  highlighted?: boolean
  /**
   * The composer may not send.
   *
   * A CONVENIENCE, not the enforcement — the server refuses the turn regardless,
   * which is what actually stops the inference. This exists so a visitor who is
   * out of free messages sees that immediately instead of typing a paragraph and
   * being told afterwards.
   */
  disabled?: boolean
  /** Shown in the tooltip. A disabled control with no reason is a dead end. */
  disabledReason?: string
}) {
  const [value, setValue] = useState(defaultValue)
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [images, setImages] = useState<{ id: string; name: string }[]>([])
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const { attachments, limits, add, remove, retry, clear, busy } = useAttachments()
  /*
   * THE MIC IS GATED ON THE SHARED CAPABILITY, not on a local guess.
   *
   * The consumer asks the Brain whether speech is available; it never reaches into the
   * Command Center's whisper runtime. Until the Brain implements the operation this reports
   * `incompatible` and the control stays off with that reason shown — which is the correct
   * answer, and a visibly different one from "switched off".
   */
  const mic = useMicAvailability()
  /*
   * THE IMAGE BUTTON IS GATED THE SAME WAY THE MIC IS.
   *
   * It was hardcoded `disabled` with "image attachments aren't supported yet",
   * which was true when written and would have stayed on the screen after the
   * capability shipped. Now it asks: a model must be approved for
   * `vision.general` against an exact digest before this opens, and a revocation
   * closes it again on the next check.
   */
  const vision = useVisionAvailability()
  const visionReady = vision?.state === 'ready'
  const visionReason = visionDisabledReason(vision)
  const micReady = mic?.state === 'ready'
  const micReason = micDisabledReason(mic)
  const voice = useVoiceRecorder()
  const recording = voice.state === 'recording' || voice.state === 'requesting'

  /**
   * A transcript is INSERTED, never sent.
   *
   * It lands in the textarea for the user to read, edit and send themselves. Even a clean
   * `ok` transcript goes through them: a fluent sentence is not proof the system heard what
   * they said, and the one irreversible step — sending it as their words — stays a human
   * action.
   */
  const acceptTranscript = (text: string) => {
    setValue((current) => (current.trim() ? `${current.trim()} ${text}` : text))
    voice.discard()
    requestAnimationFrame(() => {
      grow()
      textareaRef.current?.focus()
    })
  }

  const grow = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`
  }

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (disabled) return
    const trimmed = value.trim()
    if (!trimmed) return
    // Never send while an attachment is still uploading or indexing: the turn would be
    // answered without the file the user attached it for.
    if (busy) return
    // Same rule for an image still uploading: the turn would be answered without it.
    if (imageBusy) return
    // Sending while audio is still being captured or transcribed would send the turn
    // WITHOUT the words the user is in the middle of speaking.
    if (recording || voice.state === 'transcribing') return
    // The NAMES, not a claim: the server adds them to the conversation's durable
    // grounding set and decides from that. Only `ready` files are sent — one that is
    // stored but not searchable cannot ground anything and must not pretend to.
    const readyFiles = attachments.filter((a) => a.state === 'ready').map((a) => a.name)
    const imageIds = images.map((i) => i.id)
    const meta = {
      ...(readyFiles.length > 0 ? { attachments: readyFiles } : {}),
      ...(imageIds.length > 0 ? { images: imageIds } : {}),
    }
    onSubmit?.(trimmed, Object.keys(meta).length > 0 ? meta : undefined)
    setValue('')
    clear()
    setImages([])
    setImageError(null)
    requestAnimationFrame(grow)
  }

  const onPicked = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) add(event.target.files)
    // Reset so picking the SAME file twice still fires a change event.
    event.target.value = ''
  }

  /*
   * Images go to the image library, not the document attachment path.
   *
   * They are stored under a content-addressed id and referenced by that id, so a
   * conversation reloaded tomorrow still points at the same bytes — which is what
   * makes "ask a follow-up without re-attaching" possible at all. A filename
   * would not survive the reload, and would not be an identity the Brain could
   * verify.
   */
  const onImagePicked = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setImageError(null)
    setImageBusy(true)
    try {
      const form = new FormData()
      form.append('image', file)
      const response = await fetch('/api/images', { method: 'POST', body: form })
      const data = (await response.json().catch(() => null)) as
        | { image?: { id: string; displayName: string }; error?: { message?: string } }
        | null
      if (!response.ok || !data?.image) {
        // The server's own words: it knows which limit was hit and why.
        setImageError(data?.error?.message ?? 'That image could not be attached.')
        return
      }
      setImages((current) => [...current, { id: data.image!.id, name: data.image!.displayName }])
    } catch {
      setImageError('That image could not be uploaded.')
    } finally {
      setImageBusy(false)
    }
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
        'rounded-2xl border bg-raised p-3.5 transition-all duration-200',
        active
          ? 'border-brand-400 ring-4 ring-brand-500/10'
          : 'border-slate-200 shadow-card hover:border-slate-300',
        className,
      )}
    >
      <VoicePanel
        state={voice.state}
        error={voice.error}
        result={voice.result}
        level={voice.level}
        onStop={voice.stop}
        onCancel={voice.cancel}
        onAccept={acceptTranscript}
        onDiscard={voice.discard}
        onRetry={() => void voice.start()}
      />

      <AttachmentChips attachments={attachments} onRemove={remove} onRetry={retry} />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onPicked}
        {...(limits ? { accept: acceptAttribute(limits.allowedExtensions) } : {})}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={onImagePicked}
      />

      {(images.length > 0 || imageBusy || imageError) && (
        <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
          {images.map((image) => (
            <span
              key={image.id}
              className="inline-flex items-center gap-1.5 rounded-md border border-black/10 bg-black/[0.03] px-2 py-1 text-xs dark:border-white/15 dark:bg-white/[0.06]"
            >
              <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.9} />
              <span className="max-w-[14rem] truncate">{image.name}</span>
              <button
                type="button"
                onClick={() => setImages((current) => current.filter((i) => i.id !== image.id))}
                aria-label={`Remove ${image.name}`}
                className="opacity-60 hover:opacity-100"
              >
                ×
              </button>
            </span>
          ))}
          {imageBusy && <span className="text-xs opacity-60">Uploading image…</span>}
          {/* The server's own words. A generic "upload failed" hides which limit was hit. */}
          {imageError && <span className="text-xs text-red-600 dark:text-red-400">{imageError}</span>}
        </div>
      )}

      <textarea
        ref={textareaRef}
        rows={variant === 'research' ? 2 : 1}
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={disabled ? (disabledReason ?? placeholder) : placeholder}
        title={disabled ? disabledReason : undefined}
        aria-label="Message MigraPilot"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          setValue(event.target.value)
          grow()
        }}
        className={cn(
          'scroll-slim block max-h-42 w-full resize-none bg-transparent px-1.5 pt-1 text-[15px] leading-relaxed text-slate-800 placeholder:text-slate-400 focus:outline-none',
          disabled && 'cursor-not-allowed',
        )}
      />

      <div className="mt-2.5 flex items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          {variant === 'media' ? (
            <>
              <button
                type="button"
                disabled={!micReady}
                onClick={() => (recording ? voice.stop() : void voice.start())}
                title={micReady ? (recording ? 'Stop recording' : 'Record a voice note') : micReason}
                className={cn(toolButton, !micReady && 'cursor-not-allowed opacity-40', recording && 'border-red-300 text-red-600')}
                aria-label={micReady ? (recording ? 'Stop recording' : 'Record voice note') : `Record voice note (unavailable: ${micReason})`}
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
                disabled={!visionReady}
                onClick={() => imageInputRef.current?.click()}
                title={visionReady ? 'Attach an image' : visionReason}
                className={cn(toolButton, !visionReady && 'cursor-not-allowed opacity-40')}
                aria-label={visionReady ? 'Attach an image' : `Attach an image (unavailable: ${visionReason})`}
              >
                <ImageIcon className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
              title={disabled ? disabledReason : undefined}
              className={cn(toolButton, disabled && 'cursor-not-allowed opacity-40')}
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
              onClick={() => (recording ? voice.stop() : void voice.start())}
              title={micReady ? (recording ? 'Stop recording' : 'Dictate') : micReason}
              className={cn(toolButton, !micReady && 'cursor-not-allowed opacity-40', recording && 'border-red-300 text-red-600')}
              aria-label={micReady ? (recording ? 'Stop recording' : 'Dictate') : `Dictate (unavailable: ${micReason})`}
            >
              <Mic className="h-[18px] w-[18px]" strokeWidth={1.9} />
            </button>
          )}
          <button
            type="submit"
            aria-label="Send message"
            className="inline-flex h-10 w-10 items-center justify-center rounded-field bg-brand-600 text-white shadow-brand transition-all hover:bg-brand-700 active:scale-95 disabled:opacity-40 disabled:shadow-none"
            disabled={disabled || !value.trim() || busy}
            title={
              disabled ? disabledReason : busy ? 'Waiting for your attachment to finish' : undefined
            }
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
