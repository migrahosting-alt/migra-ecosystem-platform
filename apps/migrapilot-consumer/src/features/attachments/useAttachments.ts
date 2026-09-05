'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { isPermanentRejection, outcomeOfIndex, outcomeOfUpload } from './outcome'
import { rejectionFor } from './filename'

/**
 * Attachments, end to end and for real.
 *
 * The paperclip used to be decoration: a `type="button"` with no handler, next to a chat
 * that could not receive a file. This hook runs the whole path the control implies —
 * pick → validate → upload → persist → index → attach → the Brain can actually read it —
 * and reports each step truthfully, including the ways it fails.
 *
 * NOTHING IS SIMULATED. Upload is `POST /api/files`, which writes to the caller's own
 * directory and enforces extension, per-file size, library size and file-count limits
 * server-side. Indexing is `POST /api/files/index`, which is the step that makes a file
 * answerable — and which reports `searchable: false` when a file was read but could not be
 * made searchable. That distinction is kept all the way to the chip: "uploaded" and
 * "answerable" are different facts, and a file the Brain cannot search must never look ready.
 */

export type AttachmentState =
  /** Bytes are on their way to the server. */
  | 'uploading'
  /** Stored, now being made searchable. It is NOT usable for grounding yet. */
  | 'indexing'
  /**
   * Stored and being READ by a background job — a large PDF extracted page by
   * page. Minutes, not milliseconds, and still not usable for grounding.
   * Distinct from `indexing` because it resolves by polling, not by the response
   * to the request that started it.
   */
  | 'processing'
  /** Stored and searchable. The Brain can answer from it. */
  | 'ready'
  /** Stored but NOT searchable — an honest half-success, never shown as ready. */
  | 'unsearchable'
  /** Stored and analysable as a table, but not prose-indexed. A workbook. */
  | 'structured'
  /** Rejected or failed. `reason` is the server's own words. */
  | 'failed'

export interface Attachment {
  /** Client-side id: a name can be replaced, so the name is not a stable key. */
  id: string
  /** The name the SERVER stored it under, which may differ from the picked name. */
  name: string
  bytes: number
  state: AttachmentState
  reason?: string
  /**
   * Whether offering Retry would be honest. Only meaningful when `state` is
   * `'failed'`; see `PERMANENT_REJECTIONS` in `outcome.ts` for where the line
   * sits and why a too-large file must never be offered a second attempt.
   */
  retryable?: boolean
}

export interface AttachmentLimits {
  maxFileBytes: number
  maxLibraryBytes: number
  maxFiles: number
  allowedExtensions: string[]
}

let sequence = 0
const nextId = () => `att_${(sequence += 1)}`


export function useAttachments() {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [limits, setLimits] = useState<AttachmentLimits | null>(null)
  /** Kept so a failed upload can be retried without asking the user to pick again. */
  const originals = useRef(new Map<string, File>())
  /** Attachments with a poll in flight, so a re-render cannot start a second one. */
  const watching = useRef(new Set<string>())

  /**
   * Limits come from the server, never from constants copied into the client. If they
   * cannot be fetched the client simply does not pre-validate — the server still enforces
   * every rule, so the worst case is a slower rejection, not a wrong one.
   */
  useEffect(() => {
    let cancelled = false
    void fetch('/api/files')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.limits) setLimits(data.limits as AttachmentLimits)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const patch = useCallback((id: string, next: Partial<Attachment>) => {
    setAttachments((current) => current.map((a) => (a.id === id ? { ...a, ...next } : a)))
  }, [])

  /**
   * Follow a background read to its terminal state.
   *
   * 🚨 THE SERVER DECIDES WHEN TO STOP, NOT A TIMER HERE. `polling: false` is the
   * job saying it has reached a terminal state; inventing a client-side deadline
   * would mark a document failed while it was still being read — and a 400-page
   * book legitimately takes minutes.
   *
   * The interval is deliberately unhurried. This is a job measured in minutes, so
   * asking every two seconds would add hundreds of requests to learn nothing
   * sooner. A ceiling on attempts exists only so a browser left open overnight
   * against a job that died without writing a terminal state does not poll for
   * ever; reaching it reports honestly rather than guessing an outcome.
   */
  const watch = useCallback((id: string, fileName: string) => {
    if (watching.current.has(id)) return
    watching.current.add(id)

    let attempts = 0
    const MAX_ATTEMPTS = 240 // ~20 minutes at 5s

    const tick = async () => {
      if (!watching.current.has(id)) return
      attempts += 1
      try {
        const response = await fetch('/api/files')
        const data = (await response.json()) as {
          files?: { name: string; processing?: { readable: boolean; polling: boolean; description: string; failureReason?: string } }[]
        }
        const record = data.files?.find((f) => f.name === fileName)
        const status = record?.processing

        if (status && !status.polling) {
          watching.current.delete(id)
          /*
           * READABLE IS THE FACT THAT MATTERS. A finished job is not the same as
           * a usable document — the reader can complete having recovered
           * nothing — so the terminal state is taken from what the server says
           * about readability, never from the job merely having stopped.
           */
          patch(id, status.readable
            ? { state: 'ready', reason: undefined }
            : { state: 'unsearchable', reason: status.failureReason ?? status.description })
          return
        }
        // Still going: keep the user informed with the job's own words.
        if (status?.description) patch(id, { state: 'processing', reason: status.description })
      } catch {
        // A failed poll is not a failed job. Try again; the attempt ceiling is
        // what stops this, not one bad response.
      }

      if (attempts >= MAX_ATTEMPTS) {
        watching.current.delete(id)
        patch(id, {
          state: 'unsearchable',
          reason: 'This document is still being read. Check your Files page for its progress.',
        })
        return
      }
      window.setTimeout(() => void tick(), 5000)
    }

    window.setTimeout(() => void tick(), 5000)
  }, [patch])

  /** Upload one already-registered attachment, then index the library. */
  const send = useCallback(
    async (id: string, file: File) => {
      patch(id, { state: 'uploading', reason: undefined })

      let payload: Parameters<typeof outcomeOfUpload>[0]
      /*
       * 🚨 "COULD NOT REACH THE SERVER" USED TO MEAN ANY THROWN EXCEPTION.
       *
       * The old catch wrapped BOTH the fetch and response.json(), so a server
       * that answered perfectly well — with a 413 and an HTML error page from
       * the proxy — was reported as unreachable. A 35 MB PDF failed with
       * "The upload could not reach the server" while the server had in fact
       * classified it and said exactly what was wrong.
       *
       * The two failures are now separate, because they call for different
       * things from the user: a network problem is worth retrying, and a file
       * that is too large never will be.
       */
      let response: Response
      try {
        const body = new FormData()
        body.append('file', file)
        response = await fetch('/api/files', { method: 'POST', body })
      } catch {
        // Genuinely no answer: DNS, offline, connection reset. Worth retrying.
        patch(id, {
          state: 'failed',
          reason: 'The upload could not reach the server.',
          retryable: true,
        })
        return
      }

      try {
        payload = await response.json()
      } catch {
        /*
         * The server answered, but not with JSON — which is what a proxy does
         * when it rejects a request before the app ever sees it. Report what it
         * actually said rather than inventing a network fault.
         *
         * A 413 HERE IS THE PROXY, NOT THE APP. The app's own size check returns
         * JSON; an HTML 413 means the request was cut off upstream, before any
         * MigraPilot code ran. It is still terminal for these bytes — the
         * transport will refuse them every time — so it gets the same no-retry
         * treatment as the app's own too-large rejection.
         */
        patch(id, {
          state: 'failed',
          reason: response.status === 413
            ? 'That file is too large to upload.'
            : `The server refused the upload (error ${response.status}).`,
          retryable: response.status !== 413,
        })
        return
      }

      // The decision is made by the tested pure mapper, not inline here, so the rule that
      // ships is the rule that is checked.
      const uploaded = outcomeOfUpload(payload)
      if (uploaded.state !== 'indexing') {
        patch(id, {
          state: uploaded.state,
          reason: 'reason' in uploaded ? uploaded.reason : undefined,
          ...('retryable' in uploaded ? { retryable: uploaded.retryable } : {}),
        })
        return
      }
      patch(id, { state: 'indexing', name: uploaded.name, bytes: uploaded.bytes })

      try {
        const response = await fetch('/api/files/index', { method: 'POST' })
        // The SERVER's stored name, not the picked one — they can differ.
        const indexed = outcomeOfIndex(response.ok, await response.json(), uploaded.name)
        patch(id, {
          state: indexed.state,
          reason: 'reason' in indexed ? indexed.reason : undefined,
        })
        /*
         * A background read resolves LATER, so the chip has to keep asking.
         * Without this it would sit on "Reading this document…" forever — the
         * same dead-end as the state it replaced, just a friendlier one.
         */
        if (indexed.state === 'processing') watch(id, uploaded.name)
      } catch {
        patch(id, {
          state: 'unsearchable',
          reason: 'The file is stored, but indexing could not reach the server.',
        })
      }
    },
    [patch],
  )

  const add = useCallback(
    (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const id = nextId()
        originals.current.set(id, file)

        // Immediate, local pre-check so an obvious rejection does not need a round trip.
        // It MIRRORS the server and never replaces it — and it lives in `filename.ts` with
        // tests that compare it against the server's own extractor over real filenames,
        // because the last version of this check disagreed with the server about what the
        // extension of "pilot-upload-test.json" even was, and rejected every upload.
        const rejection = rejectionFor(file, limits)
        if (rejection) {
          setAttachments((c) => [
            ...c,
            {
              id,
              name: file.name,
              bytes: file.size,
              state: 'failed',
              reason: rejection.message,
              // Decided by the same rule the server's own rejections go through,
              // so a size refusal caught in the browser and one caught on disk
              // offer the user the same (absent) button.
              retryable: !isPermanentRejection(rejection.code),
            },
          ])
          continue
        }

        setAttachments((c) => [...c, { id, name: file.name, bytes: file.size, state: 'uploading' }])
        void send(id, file)
      }
    },
    [limits, send],
  )

  const retry = useCallback(
    (id: string) => {
      /*
       * Refuses a retry the UI would not have offered. The button is hidden for
       * a terminal failure, but hiding a control is a presentation decision and
       * this is the rule — a keyboard path, a stale render or a future caller
       * must not be able to re-send bytes that provably cannot pass.
       */
      const attachment = attachments.find((a) => a.id === id)
      if (attachment?.state === 'failed' && attachment.retryable === false) return

      const file = originals.current.get(id)
      if (!file) {
        patch(id, {
          state: 'failed',
          reason: 'The original file is no longer available. Attach it again.',
          retryable: false,
        })
        return
      }
      void send(id, file)
    },
    [attachments, patch, send],
  )

  /**
   * Remove. A stored attachment is deleted from the library for real; one that never
   * landed is only dropped from the list, because deleting it would 404.
   */
  const remove = useCallback(
    async (id: string) => {
      const attachment = attachments.find((a) => a.id === id)
      const stored = attachment && attachment.state !== 'uploading' && attachment.state !== 'failed'
      setAttachments((current) => current.filter((a) => a.id !== id))
      originals.current.delete(id)
      // Stops any background-read poll for this chip. The job on the server
      // continues — removing an attachment is not a reason to abandon work
      // already underway — but nothing is left asking about a chip that is gone.
      watching.current.delete(id)
      if (stored && attachment) {
        try {
          await fetch(`/api/files?name=${encodeURIComponent(attachment.name)}`, { method: 'DELETE' })
        } catch {
          /* The chip is gone from the composer either way; the library page is the
             authority on what is actually stored, and it re-reads from the server. */
        }
      }
    },
    [attachments],
  )

  const clear = useCallback(() => {
    setAttachments([])
    originals.current.clear()
    watching.current.clear()
  }, [])

  /*
   * `processing` is deliberately NOT busy.
   *
   * Busy holds the composer, and a background read takes minutes — locking
   * someone out of their own chat because a large PDF is being indexed would
   * trade one broken capability for a worse one. The chip states plainly that
   * the document is still being read, and `groundable` below refuses to let it
   * ground anything until it truly can, which is where the honesty has to live.
   */
  const busy = attachments.some((a) => a.state === 'uploading' || a.state === 'indexing')
  /** Only a searchable attachment can ground an answer — never one still being read. */
  // A workbook grounds a table answer, so it counts. `ready` alone meant the
  // composer treated an analysable file as nothing to ground on.
  const groundable = attachments.some((a) => a.state === 'ready' || a.state === 'structured')

  return { attachments, limits, add, remove, retry, clear, busy, groundable }
}
