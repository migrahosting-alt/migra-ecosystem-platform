'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { outcomeOfIndex, outcomeOfUpload } from './outcome'
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
  /** Stored and searchable. The Brain can answer from it. */
  | 'ready'
  /** Stored but NOT searchable — an honest half-success, never shown as ready. */
  | 'unsearchable'
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

  /** Upload one already-registered attachment, then index the library. */
  const send = useCallback(
    async (id: string, file: File) => {
      patch(id, { state: 'uploading', reason: undefined })

      let payload: Parameters<typeof outcomeOfUpload>[0]
      try {
        const body = new FormData()
        body.append('file', file)
        const response = await fetch('/api/files', { method: 'POST', body })
        payload = await response.json()
      } catch {
        patch(id, { state: 'failed', reason: 'The upload could not reach the server.' })
        return
      }

      // The decision is made by the tested pure mapper, not inline here, so the rule that
      // ships is the rule that is checked.
      const uploaded = outcomeOfUpload(payload)
      if (uploaded.state !== 'indexing') {
        patch(id, { state: uploaded.state, reason: 'reason' in uploaded ? uploaded.reason : undefined })
        return
      }
      patch(id, { state: 'indexing', name: uploaded.name, bytes: uploaded.bytes })

      try {
        const response = await fetch('/api/files/index', { method: 'POST' })
        const indexed = outcomeOfIndex(response.ok, await response.json())
        patch(id, {
          state: indexed.state,
          reason: 'reason' in indexed ? indexed.reason : undefined,
        })
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
            { id, name: file.name, bytes: file.size, state: 'failed', reason: rejection.message },
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
      const file = originals.current.get(id)
      if (!file) {
        patch(id, { state: 'failed', reason: 'The original file is no longer available. Attach it again.' })
        return
      }
      void send(id, file)
    },
    [patch, send],
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
  }, [])

  const busy = attachments.some((a) => a.state === 'uploading' || a.state === 'indexing')
  /** Only a searchable attachment can ground an answer. */
  const groundable = attachments.some((a) => a.state === 'ready')

  return { attachments, limits, add, remove, retry, clear, busy, groundable }
}
