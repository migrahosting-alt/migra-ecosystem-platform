'use client'

import { useCallback, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import { Lock, Mic, SendHorizontal } from 'lucide-react'
import { AttachmentChips } from '@/features/attachments/AttachmentChips'
import { DOCUMENT_PICKER_ACCEPT } from '@/features/attachments/filename'
import { useAttachments } from '@/features/attachments/useAttachments'
import { useVisionAvailability, visionDisabledReason } from '@/features/attachments/useVisionAvailability'
import { ActionHub, type HubAction } from '@/components/chat/ActionHub'
import { ImageTray } from '@/components/chat/ImageTray'
import type { PublicImage } from '@/app/api/images/route'

/**
 * The canonical reference shape, mirrored here for one purpose: refusing to
 * build a URL out of anything else. A client-side mirror of a server rule is
 * normally a liability — this one only ever REFUSES, so it cannot widen what the
 * server accepts, and it stops a bad ref from reaching an <img> as a broken icon.
 */
const IMAGE_REF = /^img_[0-9a-f]{32}$/

/**
 * What the picker offers and what paste and drop accept — one list, so the three
 * entry points cannot come to disagree about what an image is.
 */
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const ACCEPTED_LABEL = 'PNG, JPEG, GIF or WebP'

/** Bounded and stated, rather than silently dropping the extras. */
const MAX_TURN_IMAGES = 4
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
  conversationImages,
  onDetachConversationImage,
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
  /**
   * Images this conversation is ALREADY about, from the Brain's durable set.
   *
   * Rendered separately from what is about to be sent, because they are a
   * different fact: these survived a reload and are the reason a follow-up needs
   * no new upload. Showing them is what makes that behaviour legible instead of
   * looking like the model remembering something it was never told.
   */
  conversationImages?: string[]
  /** Detach an image from the whole thread, not just this turn. */
  onDetachConversationImage?: (ref: string) => void
}) {
  const [value, setValue] = useState(defaultValue)
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [images, setImages] = useState<{ id: string; name: string }[]>([])
  const [pendingImage, setPendingImage] = useState<{ name: string } | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const imageBusy = pendingImage !== null
  // `limits` is no longer read here: the picker offers the DOCUMENT category
  // rather than today's server allowlist, and the server stays authoritative for
  // what it will actually accept.
  const { attachments, add, remove, retry, clear, busy } = useAttachments()
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
  /**
   * The ONE upload path.
   *
   * The picker, a clipboard paste and a drop all call this. A second
   * implementation would drift: validation, quota, scope, the canonical ref and
   * every failure message live on the server, and a parallel path is how one of
   * them quietly stops matching.
   */
  const uploadImage = useCallback(async (file: File) => {
    if (!visionReady) {
      setImageError(visionReason)
      return
    }
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      // Refused before the upload: a HEIC that the server will reject anyway has
      // wasted the transfer and taught the user nothing.
      setImageError(`That file type is not supported. Use ${ACCEPTED_LABEL}.`)
      return
    }
    if (images.length >= MAX_TURN_IMAGES) {
      // Bounded truthfully rather than silently dropping the extras.
      setImageError(`You can attach up to ${MAX_TURN_IMAGES} images to one message.`)
      return
    }

    setImageError(null)
    setPendingImage({ name: file.name || 'pasted image' })
    try {
      const form = new FormData()
      form.append('image', file)
      const response = await fetch('/api/images', { method: 'POST', body: form })
      const data = (await response.json().catch(() => null)) as
        | { image?: PublicImage; message?: string; error?: string }
        | null
      if (!response.ok || !data?.image) {
        // The server's own words: it knows which limit was hit and why.
        setImageError(data?.message ?? 'That image could not be attached.')
        return
      }
      /*
       * `imageId`, not `id`. Reading the wrong name here produced
       * `/api/images/undefined` — a 404 rendered into an <img> as a broken icon,
       * with the filename beside it so it still looked like an attachment.
       */
      const ref = data.image.imageId
      if (!IMAGE_REF.test(ref)) {
        setImageError('That image was stored but came back without a usable reference.')
        return
      }
      setImages((current) => [...current, { id: ref, name: data.image!.displayName }])
    } catch {
      setImageError('That image could not be uploaded.')
    } finally {
      setPendingImage(null)
    }
  }, [images.length, visionReady, visionReason])

  const onImagePicked = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) await uploadImage(file)
  }

  /**
   * Ctrl+V with an image on the clipboard.
   *
   * DETERMINISTIC, NOT ACCIDENTAL. If the clipboard carries an image it is
   * attached and the default paste is prevented — copying an image from a page
   * usually also puts its URL on the clipboard as text, and letting both through
   * would drop a URL into the box the user did not type. If there is no image,
   * nothing here runs and text pastes exactly as before.
   */
  const onPaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items ?? [])
    const imageItem = items.find(
      (item) => item.kind === 'file' && ACCEPTED_IMAGE_TYPES.includes(item.type),
    )
    if (!imageItem) return
    const file = imageItem.getAsFile()
    if (!file) return
    event.preventDefault()
    void uploadImage(file)
  }, [uploadImage])

  /**
   * Drag from the desktop onto the composer.
   *
   * `dragCounter` rather than a boolean: dragenter/dragleave fire for every
   * child element crossed, so a plain flag flickers off the moment the pointer
   * moves over the textarea inside the drop zone.
   */
  const dragCounter = useRef(0)
  const [dragging, setDragging] = useState(false)

  const hasImageDrag = (event: DragEvent) =>
    Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === 'file')

  const onDragEnter = useCallback((event: DragEvent<HTMLFormElement>) => {
    if (!hasImageDrag(event)) return
    event.preventDefault()
    dragCounter.current += 1
    setDragging(true)
  }, [])

  const onDragOver = useCallback((event: DragEvent<HTMLFormElement>) => {
    if (!hasImageDrag(event)) return
    // Without this the browser navigates away to the dropped file.
    event.preventDefault()
  }, [])

  const onDragLeave = useCallback((event: DragEvent<HTMLFormElement>) => {
    if (!hasImageDrag(event)) return
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) setDragging(false)
  }, [])

  const onDrop = useCallback((event: DragEvent<HTMLFormElement>) => {
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length === 0) return
    event.preventDefault()
    dragCounter.current = 0
    setDragging(false)
    /*
     * Sequential, not parallel: each upload checks the per-message cap against
     * the images already attached, and firing them at once would let every one
     * of them see the same stale count and all pass.
     */
    void (async () => {
      for (const file of files) await uploadImage(file)
    })()
  }, [uploadImage])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  /*
   * Both actions are REAL. Images can be unavailable — no vision model is
   * approved, or the Brain cannot be reached — and that shows as a disabled row
   * carrying the server's own reason, never as a hidden entry or a click that
   * quietly does nothing.
   */
  const hubActions: HubAction[] = [
    {
      id: 'image',
      label: 'Photos & images',
      hint: 'Ask about a photo, a screenshot, or a chart.',
      icon: 'image',
      ...(visionReady ? {} : { unavailableReason: visionReason }),
      onSelect: () => imageInputRef.current?.click(),
    },
    {
      id: 'file',
      label: 'Files & documents',
      hint: 'Attach a document, data file, or code for MigraPilot to read.',
      icon: 'file',
      onSelect: () => fileInputRef.current?.click(),
    },
  ]

  const active = focused || highlighted

  return (
    <form
      onSubmit={submit}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'relative rounded-2xl border bg-raised p-3.5 transition-all duration-200',
        active
          ? 'border-brand-400 ring-4 ring-brand-500/10'
          : 'border-slate-200 shadow-card hover:border-slate-300',
        dragging && 'border-brand-500 ring-4 ring-brand-500/20',
        className,
      )}
    >
      {/*
        The drop target says what will happen, and covers the composer so the
        pointer cannot land on a child that is not listening. `pointer-events-none`
        keeps it from stealing the drop itself.
      */}
      {dragging && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand-400 bg-brand-50/85"
        >
          <span className="text-[14px] font-medium text-brand-700">
            Drop an image to attach it
          </span>
        </div>
      )}
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
        /*
         * The DOCUMENT picker, not a list of today's supported extensions. A
         * dialog built from the server's allowlist reads as "Custom Files" and
         * makes PDF look nonexistent rather than not-yet-supported. The server
         * refuses what it cannot read, with a reason — see DOCUMENT_PICKER_ACCEPT.
         */
        accept={DOCUMENT_PICKER_ACCEPT}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={onImagePicked}
      />

      {conversationImages && conversationImages.length > 0 && (
        <ImageTray
          label="In this conversation — ask a follow-up without attaching it again"
          images={conversationImages.map((ref) => ({ id: ref, name: 'Attached image' }))}
          onRemove={(ref) => onDetachConversationImage?.(ref)}
        />
      )}

      <ImageTray
        images={images}
        pending={pendingImage}
        error={imageError}
        onRemove={(id) => setImages((current) => current.filter((i) => i.id !== id))}
        onDismissError={() => setImageError(null)}
      />

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
        onPaste={onPaste}
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
          {variant === 'media' && (
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
          )}

          {/*
            ONE ENTRY POINT, TWO NAMED ACTIONS. The paperclip used to open a file
            picker directly, so a user holding a photo had no way to discover that
            MigraPilot could read it — the capability shipped governed and
            qualified, and stayed invisible.
          */}
          <ActionHub
            disabled={disabled}
            disabledReason={disabledReason}
            actions={hubActions}
          />
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
