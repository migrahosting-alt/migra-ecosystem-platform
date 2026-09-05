'use client'

import { canAnalyzeStructurally, extensionOf } from '@/features/attachments/capability'
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import { FileText, Lock, Mic, SendHorizontal, Square, X } from 'lucide-react'
import { AttachmentChips } from '@/features/attachments/AttachmentChips'
import { useAttachments } from '@/features/attachments/useAttachments'
import { useVisionAvailability, visionDisabledReason } from '@/features/attachments/useVisionAvailability'
import { useDocumentAvailability, documentDisabledReason } from '@/features/attachments/useDocumentAvailability'
import { ActionHub, type HubAction } from '@/components/chat/ActionHub'
import { IMAGE_ACCEPT, classifyAttachment } from '@/features/attachments/capability'
import { ImageTray } from '@/components/chat/ImageTray'
import type { PublicImage } from '@/app/api/images/route'

/**
 * The canonical reference shape, mirrored here for one purpose: refusing to
 * build a URL out of anything else. A client-side mirror of a server rule is
 * normally a liability — this one only ever REFUSES, so it cannot widen what the
 * server accepts, and it stops a bad ref from reaching an <img> as a broken icon.
 */
const IMAGE_REF = /^img_[0-9a-f]{32}$/

/*
 * 🚨 THE LOCAL IMAGE-MIME LIST IS GONE.
 *
 * It claimed to be the one list "so the three entry points cannot come to
 * disagree about what an image is" — but only paste ever consulted it, and it
 * judged by `item.type`, a field browsers fill in inconsistently. Meanwhile the
 * picker classified from bytes and drop classified not at all. All three now go
 * through `intake`, which asks `classifyAttachment` — extension, MIME AND magic
 * bytes, from the shared capability contract. A fourth hand-written list here
 * would be the drift this slice removes.
 */

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
  streaming = false,
  onStop,
  draft,
  conversationImages,
  conversationFiles,
  onDetachConversationFile,
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
   * A turn is streaming into this conversation right now.
   *
   * The send control becomes Stop while it is — the same slot, because that is
   * where the hand already is, and because it is the only way to make the two
   * states mutually exclusive. Leaving Send live during a stream let a second
   * turn be fired into a conversation already receiving one.
   */
  streaming?: boolean
  /** End the streaming turn. Required for the Stop control to appear at all. */
  onStop?: () => void
  /**
   * Text to load into the composer from outside — an earlier question the user
   * wants to ask again in different words.
   *
   * The `token` is what makes it repeatable: loading the SAME question twice is
   * a real thing to do, and a plain string would look unchanged to React the
   * second time and silently do nothing.
   */
  draft?: { text: string; token: number }
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
  /**
   * Documents currently grounding this conversation — the ACTIVE set.
   *
   * Shown for the same reason the images are: after a reload the user asks a
   * follow-up with nothing attached, and the interface has to make visible WHY
   * that works. An invisible durable set is indistinguishable from the model
   * inventing an answer about a document.
   */
  conversationFiles?: string[]
  /** Stop a document grounding the thread. Does NOT delete it from Files. */
  onDetachConversationFile?: (name: string) => void
}) {
  const [value, setValue] = useState(defaultValue)
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [images, setImages] = useState<{ id: string; name: string }[]>([])
  const [pendingImage, setPendingImage] = useState<{ name: string } | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  /*
   * Refusals carry the NAME of the file that caused them.
   *
   * They used to share one global slot with image errors, which is how a .wav
   * refusal outlived the selection that produced it and sat above an unrelated
   * PDF. Identity is what makes a notice dismissible without guessing.
   */
  const [refusals, setRefusals] = useState<{ name: string; message: string }[]>([])
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

  /*
   * Opting in is all or nothing. A surface that reports `streaming` but hands
   * over no way to stop would lose its send control and gain nothing — so both
   * are required before this composer changes behaviour at all.
   */
  const stoppable = streaming && Boolean(onStop)

  /*
   * Loading a question back in REPLACES the box, and says so by focusing it.
   *
   * Appending would silently merge two questions into one; the user asked to
   * rewrite this one. The cursor lands in the text so the next keystroke edits
   * it rather than starting somewhere unexpected.
   */
  useEffect(() => {
    if (!draft) return
    setValue(draft.text)
    requestAnimationFrame(() => {
      grow()
      const el = textareaRef.current
      el?.focus()
      el?.setSelectionRange(draft.text.length, draft.text.length)
    })
    // Keyed on the token: the same question may be loaded more than once.
  }, [draft?.token])

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (disabled) return
    /*
     * Enter obeys the same rule as the button.
     *
     * Swapping the control would be cosmetic on its own: the keyboard is how
     * most turns are sent, so leaving Enter live would keep the exact defect —
     * a second turn fired into a conversation that is already streaming one,
     * which overwrites the pending id and leaves the first turn unstoppable.
     */
    if (stoppable) return
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
    /*
     * The NAMES, not a claim: the server adds them to the conversation's durable
     * grounding set and decides from that.
     *
     * 🚨 `ready` MEANS SEARCHABLE, AND THAT IS NOT THE ONLY WAY A FILE IS USEFUL.
     *
     * A structured file — an .xlsx — is stored and analysable but never indexed,
     * so it settles at `unsearchable` and this filter dropped it. The server then
     * saw no attachment, chose an empty active set, and never reached the table
     * layer: the workbook uploaded, the chip appeared, and the model answered
     * "if you provide the specific numbers or data, I can help you calculate the
     * total revenue" while holding a file whose Revenue column sums to 474,000.
     *
     * The old comment was true when retrieval was the only use for a file. It is
     * not true now, so the rule is "can this file contribute anything", not "is
     * it searchable". An unsearchable PDF still cannot contribute and is still
     * dropped; an unsearchable workbook can.
     */
    const readyFiles = attachments
      .filter((a) => a.state === 'ready' || canAnalyzeStructurally(extensionOf(a.name)))
      .map((a) => a.name)
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
  /*
   * RETURNS the refusal rather than writing it to a shared slot.
   *
   * Per-file complaints — the size ceiling, the unresizable-dimension rule, a
   * failed upload — used to go to a single `imageError`, so selecting two bad
   * images showed ONE message and the other file disappeared with no
   * explanation. Measured live: a 46.8 MB JPEG and a 4000x3000 WEBP were picked
   * together and only the WEBP was ever mentioned.
   *
   * The document path already learned this and keeps a per-file list; images now
   * feed the SAME list, so each refusal names its file and is dismissed on its
   * own. Returning the message keeps one accumulation point in `intake` — a
   * second writer would race the `setRefusals` that runs after the loop.
   *
   * Turn-level facts stay in the shared slot deliberately: "vision is
   * unavailable" and the per-message image cap are not about any one file, and
   * naming a file for them would be a small lie.
   */
  const uploadImage = useCallback(async (file: File): Promise<{ name: string; message: string } | null> => {
    if (!visionReady) {
      setImageError(visionReason)
      return null
    }
    /*
     * 🚨 NO SECOND GATE HERE. Classification already established that this is an
     * image, from its bytes rather than its declared type — and a browser
     * routinely reports an empty or odd MIME for a perfectly good photo. Judging
     * it again on that field would refuse files the system had just recognised,
     * which is the split-brain this slice exists to remove. The server remains
     * authoritative.
     */
    if (images.length >= MAX_TURN_IMAGES) {
      // Bounded truthfully rather than silently dropping the extras.
      setImageError(`You can attach up to ${MAX_TURN_IMAGES} images to one message.`)
      return null
    }

    setImageError(null)
    const imageName = file.name || 'pasted image'
    setPendingImage({ name: imageName })
    try {
      const form = new FormData()
      form.append('image', file)
      const response = await fetch('/api/images', { method: 'POST', body: form })
      const data = (await response.json().catch(() => null)) as
        | { image?: PublicImage; message?: string; error?: string }
        | null
      if (!response.ok || !data?.image) {
        // The server's own words: it knows which limit was hit and why.
        return { name: imageName, message: data?.message ?? 'That image could not be attached.' }
      }
      /*
       * `imageId`, not `id`. Reading the wrong name here produced
       * `/api/images/undefined` — a 404 rendered into an <img> as a broken icon,
       * with the filename beside it so it still looked like an attachment.
       */
      const ref = data.image.imageId
      if (!IMAGE_REF.test(ref)) {
        return { name: imageName, message: 'That image was stored but came back without a usable reference.' }
      }
      setImages((current) => [...current, { id: ref, name: data.image!.displayName }])
      return null
    } catch {
      return { name: imageName, message: 'That image could not be uploaded.' }
    } finally {
      setPendingImage(null)
    }
  }, [images.length, visionReady, visionReason])

  /**
   * ONE ENTRY POINT. Classify, then dispatch.
   *
   * 🚨 The picker used to decide capability: a JPEG chosen through "Files" was
   * refused as an unsupported document, because the menu entry had already
   * decided what kind of thing you were allowed to be holding. Selection and
   * classification are now separate acts — whatever is chosen is inspected by
   * extension, MIME and BYTES, then sent down its own pipeline.
   *
   * Mixed selections are the point, not an edge case: a PDF and a photo chosen
   * together both attach to the same turn and both reach the model.
   */
  /**
   * 🚨 THE ONE INTAKE. Picker, drop and paste all end up here.
   *
   * They did not. `onPicked` classified by bytes and routed each file to its own
   * pipeline, while `onDrop` sent EVERY dropped file — PDF, CSV, anything — to
   * `uploadImage`, and `onPaste` looked only for clipboard image MIME types. So
   * the same PDF behaved differently depending on whether it was chosen or
   * dragged, which is precisely the split-brain the capability contract exists
   * to prevent: one file, one classification, one answer, regardless of how it
   * entered the composer.
   *
   * Everything below — classification from bytes, refusal wording, pipeline
   * routing, per-file error scoping — is therefore shared by all three.
   */
  const intake = useCallback(async (incoming: File[]) => {
    if (incoming.length === 0) return

    /*
     * 🚨 A NEW SELECTION CLEARS THE OLD COMPLAINT.
     *
     * A refusal about a .wav stayed on screen while a PDF was being attached,
     * so the composer showed a message about a file that was no longer part of
     * anything. Every notice here belongs to the selection that produced it, and
     * a new selection replaces it — never accumulates beside it.
     */
    setRefusals([])
    setImageError(null)

    const documents: File[] = []
    const refused: { name: string; message: string }[] = []
    for (const file of incoming) {
      // The first bytes are the evidence. Read once, here, so no downstream
      // layer has to guess from the name.
      const head = new Uint8Array(await file.slice(0, 512).arrayBuffer())
      const verdict = classifyAttachment(file.name, file.type, head)
      if (!verdict.ok) {
        // Named, because one refusal among four selected files has to say WHICH.
        refused.push({ name: file.name, message: verdict.message })
        continue
      }
      /*
       * Images are awaited one at a time on purpose: each upload checks the
       * per-message cap against the images already attached, and firing them
       * together would let every one of them read the same stale count and pass.
       */
      if (verdict.pipeline === 'image') {
        const refusal = await uploadImage(file)
        if (refusal) refused.push(refusal)
      } else documents.push(file)
    }
    if (refused.length > 0) setRefusals(refused)
    if (documents.length > 0) add(documents as unknown as FileList)
  }, [add, uploadImage])

  const onPicked = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? [])
    // Reset so picking the SAME file twice still fires a change event.
    event.target.value = ''
    await intake(picked)
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
    /*
     * Every pasted FILE, not just the ones whose clipboard MIME looks like an
     * image. The old filter meant a copied PDF pasted into the composer did
     * nothing at all — no attachment, no refusal, no explanation — and it judged
     * by `item.type`, which browsers report inconsistently. `intake` decides
     * from the bytes, the same way it does for the picker and for a drop.
     *
     * Text pastes are untouched: they carry no files, so this falls straight
     * through to the textarea's own handling.
     */
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (files.length === 0) return
    event.preventDefault()
    void intake(files)
  }, [intake])

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
     * 🚨 THROUGH THE SAME INTAKE AS THE PICKER.
     *
     * This used to call `uploadImage` on every dropped file, so a dragged PDF
     * was pushed at the image endpoint and refused as "not an image" — while the
     * identical PDF chosen through the paperclip attached correctly. Dropping
     * and picking are two ways of naming a file, not two kinds of file.
     */
    void intake(files)
  }, [intake])

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
  const documents = useDocumentAvailability()
  const documentsReason = documentDisabledReason(documents)
  const documentsReady = documents?.ready === true

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
      /*
       * 🚨 OFFERED ONLY WHERE IT WORKS. This row was live for signed-out
       * visitors while every document operation behind it needs an account:
       * picking a file produced a 401, a chip saying "Sign in to manage files",
       * and a Retry that could never succeed. Its neighbour above was already
       * gated — one row apart, one honest and one not.
       */
      ...(documentsReady ? {} : { unavailableReason: documentsReason }),
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

      <AttachmentChips
        attachments={attachments}
        onRemove={remove}
        onRetry={retry}
        // The general picker, not the image one: a file that was refused could
        // have been either kind, and reopening the narrower dialog would hide
        // half of what the user might reach for next.
        onChooseAnother={() => fileInputRef.current?.click()}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onPicked}
        /*
         * 🚨 NO `accept`, DELIBERATELY.
         *
         * An accept list makes the native dialog read "Custom Files" — a label
         * describing our internal category boundaries to someone who should
         * never have to learn them — and it filters the chooser before anything
         * has been classified. Without it the dialog says "All Files", the user
         * picks what they actually have, and the system decides what it is.
         *
         * HTML offers no way to NAME a filter group, so "All Files" is the
         * closest honest label available.
         */
      />
      {/*
        * The Photos shortcut is a FILTER over the same handler — same
        * classification, same dispatch, same refusals. It narrows the chooser
        * for convenience; it never narrows what the system accepts.
        */}
      <input
        ref={imageInputRef}
        type="file"
        multiple
        accept={IMAGE_ACCEPT}
        className="hidden"
        onChange={onPicked}
      />

      {conversationFiles && conversationFiles.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-500">
            Grounded in — ask a follow-up without attaching again
          </span>
          {conversationFiles.map((name) => (
            <span
              key={name}
              className="inline-flex max-w-full items-center gap-1.5 rounded-field border border-hairline bg-white px-2.5 py-1"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
              <span className="truncate text-[13px] text-slate-700" title={name}>{name}</span>
              <button
                type="button"
                onClick={() => onDetachConversationFile?.(name)}
                className="rounded-full p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                /* "Stop using", not "delete": the file stays in the library, and
                   the turn that attached it keeps its own record. */
                aria-label={`Stop using ${name} in this conversation`}
                title="Stop using in this conversation"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
            </span>
          ))}
        </div>
      )}

      {conversationImages && conversationImages.length > 0 && (
        <ImageTray
          label="In this conversation — ask a follow-up without attaching it again"
          images={conversationImages.map((ref) => ({ id: ref, name: 'Attached image' }))}
          onRemove={(ref) => onDetachConversationImage?.(ref)}
        />
      )}

      {/*
        * Each refusal names its file and is dismissed on its own. One shared slot
        * is how a .wav complaint ended up sitting above an unrelated PDF.
        */}
      {refusals.map((r) => (
        <div
          key={r.name}
          role="status"
          className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[12.5px] text-amber-900"
        >
          <span className="min-w-0 flex-1">
            <strong className="font-semibold">{r.name}</strong> — {r.message}
          </span>
          <button
            type="button"
            onClick={() => setRefusals((current) => current.filter((x) => x.name !== r.name))}
            className="shrink-0 rounded px-1 text-amber-700 underline hover:text-amber-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-500"
          >
            dismiss
          </button>
        </div>
      ))}

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
          {/*
            ONE SLOT, TWO STATES — never both. The turn is either being sent or
            being stopped, and rendering Send beside a running stream is what
            allowed a second turn to be fired into it.

            🚨 THREE THINGS KEEP STOP FROM SENDING A MESSAGE, and the first two
            alone were not enough — measured in a real browser, not reasoned
            about. Clicking Stop with anything typed in the box SENT IT as a new
            turn: `onStop` aborts, the rejection lands on the microtask
            checkpoint at the end of the click handler, React clears `pending`
            and re-renders — and because both branches render a `<button>` in
            the same position, React PATCHED the very node being clicked from
            `type="button"` to `type="submit"`. The browser then ran the click's
            default action against a submit button and posted the composer.

              1. `type="button"` — correct, and defeated by the patch above.
              2. Distinct `key`s, so React REPLACES the node instead of
                 retyping it. The clicked element is gone before the default
                 action, and a disconnected button has no form to submit.
              3. `preventDefault()` — the guarantee that does not depend on
                 reconciliation timing at all.
          */}
          {stoppable ? (
            <button
              key="stop"
              type="button"
              aria-label="Stop generating"
              title="Stop generating"
              onClick={(event) => {
                event.preventDefault()
                onStop?.()
              }}
              className="inline-flex h-10 w-10 items-center justify-center rounded-field border border-slate-300 bg-raised text-slate-700 transition-all hover:border-slate-400 hover:bg-slate-50 active:scale-95"
            >
              <Square className="h-[15px] w-[15px]" fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button
              key="send"
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
          )}
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
