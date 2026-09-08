'use client'

/**
 * PICK A FILE YOU HAVE ALREADY UPLOADED.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE GAP THIS CLOSES
 *
 * The Files page stored uploads correctly and Chat could not reach them. Both
 * paperclip rows opened the operating system's picker, so using a document
 * already sitting on the server meant finding the original on disk and sending
 * the bytes a second time. The product's own promise — upload once, reuse
 * across conversations — was not true.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT DO
 *
 * It does not upload, copy, move or re-index bytes, and it holds no opinion
 * about readiness. It sends the chosen NAMES to `useAttachments`, which puts
 * them through the same path a fresh upload takes. A library pick and an
 * upload therefore produce the same attachment, and the turn cannot tell which
 * one happened — which is the point. A parallel "library attachment" would be
 * a second answer to "what is this turn grounded in".
 *
 * The listing is the caller's own directory, resolved server-side from the
 * session. Nothing here names a path, and there is nothing to put one in.
 */

import { useCallback, useEffect, useState } from 'react'
import { FileText, Loader2, Search, X } from 'lucide-react'

export interface LibraryFile {
  name: string
  bytes: number
  processing?: { readable: boolean; polling: boolean; description: string }
}

const readableSize = (bytes: number): string =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

export function FileLibraryPicker({
  onPick,
  onClose,
  attachedNames,
}: {
  onPick: (files: readonly LibraryFile[]) => void
  onClose: () => void
  /** Names already on this turn, so the list can say so instead of duplicating. */
  attachedNames: readonly string[]
}) {
  const [files, setFiles] = useState<LibraryFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/api/files')
        if (!response.ok) {
          /*
           * The server's refusal, kept as a refusal. A 401 here is a real
           * answer — the library belongs to an account — and rendering it as an
           * empty list would say "you have no files", which is a different and
           * false claim.
           */
          setError(
            response.status === 401
              ? 'Sign in to use files you have already uploaded.'
              : 'Your files could not be loaded.',
          )
          return
        }
        const data = (await response.json()) as { files?: LibraryFile[] }
        if (!cancelled) setFiles(data.files ?? [])
      } catch {
        if (!cancelled) setError('Your files could not be loaded. Check your connection and try again.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const choose = useCallback(
    (file: LibraryFile) => {
      onPick([file])
      onClose()
    },
    [onPick, onClose],
  )

  const term = query.trim().toLowerCase()
  const shown = (files ?? []).filter((f) => !term || f.name.toLowerCase().includes(term))

  return (
    <div
      className="absolute bottom-full left-0 z-20 mb-2 w-[min(28rem,calc(100vw-2rem))] rounded-card border border-hairline bg-white p-2 shadow-card"
      role="dialog"
      aria-label="Your files"
      data-testid="file-library"
    >
      <div className="flex items-center gap-2 px-1 pb-2">
        <p className="flex-1 text-[13px] font-semibold text-slate-700">Your files</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.5} />
        </button>
      </div>

      {files && files.length > 6 && (
        <div className="mb-1 flex items-center gap-2 rounded-field border border-hairline px-2 py-1">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your files"
            aria-label="Search your files"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400"
          />
        </div>
      )}

      {!files && !error && (
        <p className="flex items-center gap-2 px-1 py-2 text-[13px] text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} aria-hidden />
          Loading your files…
        </p>
      )}

      {error && (
        <p className="px-1 py-2 text-[13px] leading-snug text-slate-600" role="status">
          {error}
        </p>
      )}

      {/*
        An empty library and a filtered-to-nothing search are DIFFERENT facts.
        Showing "no files yet" to someone whose search simply missed would tell
        them their uploads are gone.
      */}
      {files?.length === 0 && (
        <p className="px-1 py-2 text-[13px] leading-snug text-slate-600" data-testid="library-empty">
          You have not uploaded any files yet. Anything you attach here will be waiting next time.
        </p>
      )}
      {files && files.length > 0 && shown.length === 0 && (
        <p className="px-1 py-2 text-[13px] leading-snug text-slate-600">No files match “{query}”.</p>
      )}

      {shown.length > 0 && (
        <ul className="max-h-64 overflow-y-auto">
          {shown.map((file) => {
            const attached = attachedNames.includes(file.name)
            /*
             * A document still being read is offered but LABELLED. Hiding it
             * would look like the upload was lost; presenting it as ready would
             * be the "uploaded is not answerable" confusion again.
             */
            const stillReading = file.processing?.polling === true
            return (
              <li key={file.name}>
                <button
                  type="button"
                  onClick={() => choose(file)}
                  disabled={attached}
                  data-testid="library-file"
                  className="flex w-full items-center gap-2 rounded-field px-2 py-1.5 text-left transition-colors hover:bg-brand-50/60 disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700" title={file.name}>
                    {file.name}
                  </span>
                  <span className="shrink-0 text-[12px] text-slate-400">
                    {attached ? 'Attached' : stillReading ? 'Still reading' : readableSize(file.bytes)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
