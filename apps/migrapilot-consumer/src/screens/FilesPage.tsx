'use client'

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  CheckCircle2,
  CloudUpload,
  FileText,
  Loader2,
  MessageCircle,
  RefreshCw,
  TriangleAlert,
  Trash2,
} from 'lucide-react'
import { Workspace } from '@/components/layout/AppShell'
import { ActionRow, RailCard } from '@/components/rail/RailPanels'
import { Button } from '@/components/ui/Button'
import { IconTile } from '@/components/ui/Badge'
import { FileTypeIcon } from '@/components/ui/FileTypeIcon'
import { cn } from '@/lib/cn'

/*
 * Every value on this page is measured.
 *
 * What this replaced: a mock-seeded file list, an upload that discarded the
 * file and displayed "8 pages" after a 1400ms timer, an "Analyze" button that
 * was a 1200ms timer setting a flag, and an insights panel of invented topics
 * and key points about documents nothing had read — on a public site.
 *
 * There is deliberately no "Detected Topics", no page count, and no export:
 * nothing produces them. An empty library says it is empty.
 */

interface StoredFile {
  name: string
  bytes: number
  updatedAt: number
  /**
   * What a background reader is doing with this file, when one is.
   *
   * 🚨 THE SERVER WAS ALREADY SENDING THIS AND THE PAGE THREW IT AWAY. During
   * live acceptance a 12-page scan was being OCR'd — the API reported
   * "Reading text — page 7 of 24" — while this page showed the filename and its
   * size and nothing else. After a reload, which is exactly when a user checks,
   * a document being read was indistinguishable from one sitting idle.
   */
  processing?: {
    state: string
    description: string
    readable: boolean
    polling: boolean
    failureReason?: string
  }
}

interface Limits {
  maxFileBytes: number
  maxLibraryBytes: number
  maxFiles: number
  allowedExtensions: string[]
}

interface IndexState {
  indexed: boolean
  /** Indexed is not the same as reachable: only an approved index is grounded on. */
  searchable?: boolean
  state?: string | null
  stats?: Record<string, unknown> | null
  message?: string
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/** Only counts the Brain actually reported. Anything absent stays absent. */
function indexedCount(stats: Record<string, unknown> | null | undefined): number | null {
  for (const key of ['files', 'documents', 'fileCount', 'documentCount', 'chunks']) {
    const value = stats?.[key]
    if (typeof value === 'number') return value
  }
  return null
}

export function FilesPage() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const [files, setFiles] = useState<StoredFile[]>([])
  const [limits, setLimits] = useState<Limits | null>(null)
  const [usedBytes, setUsedBytes] = useState(0)
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState<'uploading' | 'indexing' | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  /*
   * 🚨 DELETING A FILE IS IRREVERSIBLE AND REACHES BACKWARDS.
   *
   * It used to happen on a single click, with no confirmation, while deleting a
   * CONVERSATION — the less destructive of the two — asks first and is described
   * as "delete it for good". The asymmetry was backwards.
   *
   * A file is not only this page's row. Every past conversation that was
   * answered from it keeps citing it, and once the bytes are gone those turns
   * render their source as deleted and can never be checked again. §38 measured
   * the follow-on: a later question about a removed file was answered from a
   * DIFFERENT document until that was fixed. One stray click should not be able
   * to do that silently.
   *
   * Armed per file name, so arming one row disarms any other — two rows offering
   * to confirm at once is how the wrong one gets clicked.
   */
  const [armedForDelete, setArmedForDelete] = useState<string | null>(null)
  const [index, setIndex] = useState<IndexState>({ indexed: false })

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/files')
      if (!response.ok) return
      const body = (await response.json()) as { files: StoredFile[]; limits: Limits; usedBytes: number }
      setFiles(body.files)
      setLimits(body.limits)
      setUsedBytes(body.usedBytes)
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshIndex = useCallback(async () => {
    const response = await fetch('/api/files/index')
    if (!response.ok) return
    setIndex((await response.json()) as IndexState)
  }, [])

  useEffect(() => {
    void refresh()
    void refreshIndex()
  }, [refresh, refreshIndex])

  /*
   * Keep asking while a background reader is working.
   *
   * Rendering the state once at load would show "page 7 of 24" frozen for the
   * rest of the job, which is its own small untruth — the number is right and
   * stops being right a second later. THE SERVER decides when to stop: `polling`
   * is the job saying it has not reached a terminal state, so no timer here has
   * to guess how long OCR takes.
   */
  useEffect(() => {
    if (!files.some((f) => f.processing?.polling)) return
    const timer = window.setInterval(() => { void refresh() }, 5000)
    return () => window.clearInterval(timer)
  }, [files, refresh])

  const upload = useCallback(
    async (incoming: FileList | null) => {
      if (!incoming?.length) return
      setBusy('uploading')
      setProblems([])

      const form = new FormData()
      for (const file of Array.from(incoming)) form.append('file', file)

      try {
        const response = await fetch('/api/files', { method: 'POST', body: form })
        const body = (await response.json().catch(() => null)) as {
          rejected?: { name: string; message: string }[]
          message?: string
        } | null

        // Rejections are named. A file silently missing from the list afterwards
        // is the same failure the old page had, just quieter.
        if (body?.rejected?.length) {
          setProblems(body.rejected.map((r) => `${r.name}: ${r.message}`))
        } else if (!response.ok) {
          setProblems([body?.message ?? 'That upload failed.'])
        }
        await refresh()
      } catch {
        setProblems(['That upload could not be sent.'])
      } finally {
        setBusy(null)
      }
    },
    [refresh],
  )

  const remove = useCallback(
    async (name: string) => {
      setProblems([])
      /*
       * A PARTIAL DELETE MUST NOT RENDER AS A CLEAN ONE.
       *
       * The bytes go first and the indexed content is purged second. When that second
       * half fails the route answers 207 with searchPurged:false — and 207 is a 2xx, so
       * `response.ok` is TRUE. This handler previously ignored the response entirely, so
       * the row simply vanished and the user was told nothing: they would believe the
       * document was gone while its contents could still be quoted back at them with a
       * citation. Deletion is exactly where a silent half-success is least acceptable.
       */
      type DeleteOutcome = { searchPurged?: boolean; message?: string }
      let outcome: DeleteOutcome | null = null
      try {
        const response = await fetch(`/api/files?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
        outcome = (await response.json().catch(() => null)) as DeleteOutcome | null
        if (!response.ok) {
          setProblems([outcome?.message ?? `${name} could not be deleted.`])
        } else if (outcome?.searchPurged === false) {
          setProblems([
            outcome.message ??
              `${name} was removed from your library, but its indexed content could not be ` +
                `cleared and may still appear in answers. Re-index to finish removing it.`,
          ])
        }
      } catch {
        setProblems([`${name} could not be deleted — the server could not be reached.`])
      }

      await refresh()
      /*
       * ASK, rather than assume nothing is searchable.
       *
       * This used to `setIndex({ indexed: false })`, reasoning that the library
       * had changed so the previous reading was stale. The reasoning was right
       * and the remedy replaced a stale truth with a definite falsehood: the
       * panel read "Searchable — Not yet" immediately after deleting ONE file,
       * while the other thirteen were still indexed and answerable. Measured on
       * staging 2026-09-26 — deleting one file showed "Not yet", and a reload of
       * the same page showed "Searchable — 13 entries".
       *
       * The delete route purges the index before it answers, so the server
       * already knows the post-delete truth and only had to be asked. When the
       * purge half-failed, `problems` above says so; that caveat belongs in a
       * warning, not in a blanket claim that the library cannot be searched.
       */
      await refreshIndex()
    },
    [refresh, refreshIndex],
  )

  const runIndex = useCallback(async () => {
    setBusy('indexing')
    setProblems([])
    try {
      const response = await fetch('/api/files/index', { method: 'POST' })
      const body = (await response.json().catch(() => null)) as (IndexState & { message?: string }) | null
      if (!response.ok) {
        setProblems([body?.message ?? 'Your files could not be indexed.'])
        return
      }
      // Indexed-but-not-searchable is a real outcome and is reported, not hidden.
      if (body && body.indexed && !body.searchable && body.message) setProblems([body.message])
      setIndex(body ?? { indexed: false })
    } catch {
      setProblems(['Indexing could not be started.'])
    } finally {
      setBusy(null)
    }
  }, [])

  const count = indexedCount(index.stats)

  return (
    <Workspace
      contentClassName="mx-auto w-full max-w-[880px] px-6 py-7 sm:px-8"
      rail={
        <>
          <RailCard title="Library">
            <p className="flex items-center gap-2.5 text-sm font-semibold text-slate-700">
              <FileText className="h-[18px] w-[18px] text-slate-400" strokeWidth={1.9} />
              {files.length} {files.length === 1 ? 'file' : 'files'}
            </p>

            <dl className="mt-4 flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">Storage used</dt>
                <dd className="truncate font-semibold text-slate-800">
                  {sizeLabel(usedBytes)}
                  {limits ? ` of ${sizeLabel(limits.maxLibraryBytes)}` : ''}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-slate-500">Searchable</dt>
                <dd className="truncate font-semibold text-slate-800">
                  {/* Never guessed: only what the index actually reported. */}
                  {index.searchable ? (count === null ? 'Yes' : `${count}`) : 'Not yet'}
                </dd>
              </div>
            </dl>
          </RailCard>

          <RailCard title="Quick Actions">
            <div className="flex flex-col gap-3">
              <ActionRow
                icon={
                  <IconTile tone="blue">
                    <MessageCircle strokeWidth={2} />
                  </IconTile>
                }
                title="Ask about these files"
                subtitle={
                  /*
                   * "Attach", not "ask". The library does not ground a chat on its
                   * own — a conversation is grounded by the files attached to it,
                   * and this card previously implied the whole library was already
                   * readable. A user acted on that and received a confident,
                   * invented answer about a document nobody had opened.
                   */
                  index.searchable
                    ? 'Attach a file in chat, then ask — answers cite the documents you attached'
                    : 'Index your files first'
                }
                trailing={<ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />}
                onClick={() => {
                  /*
                   * Takes the user somewhere to ask, rather than auto-sending a
                   * broad "summarise everything" prompt.
                   *
                   * Retrieval grounding matches a question against document
                   * chunks above a relevance floor. A multi-topic summary
                   * request matches nothing strongly, so the flagship button
                   * reliably produced a refusal. A specific question — "when
                   * does the freeze begin?" — retrieves and is answered with a
                   * citation. So the button opens a grounded chat and lets the
                   * user ask the thing they actually want to know.
                   */
                  router.push('/?grounded=files')
                }}
              />
            </div>
          </RailCard>
        </>
      }
    >
      <h1 className="text-[26px] leading-tight font-bold tracking-[-0.025em] text-slate-900">Your files</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-slate-500">
        Upload and index documents so you can attach them to conversations and ask MigraPilot
        about them.
      </p>

      <div
        onDragOver={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault()
          setDragging(false)
          void upload(event.dataTransfer.files)
        }}
        className={cn(
          'mt-6 flex flex-col items-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors',
          dragging ? 'border-brand-400 bg-brand-50/50' : 'border-hairline bg-raised',
        )}
      >
        <CloudUpload className="h-8 w-8 text-slate-300" strokeWidth={1.6} />
        <p className="mt-3 text-[15px] font-semibold text-slate-800">Drop files here</p>
        <p className="mt-1 text-[13px] text-slate-500">
          {/*
            * 🚨 THIS SENTENCE WAS FALSE, AND SAID SO ON THE PAGE THAT DISPROVED IT.
            *
            * "PDF and Office files are not supported yet" was true when written
            * and stayed on screen after PDFs shipped — the list directly beneath
            * it showed indexed PDFs while the caption denied they could exist. A
            * scanned 245-page book was read and answered from during acceptance
            * with this text sitting above it.
            *
            * The size comes from the server's own limits, as before; the claim
            * about types now matches what the capability contract accepts.
            */}
          Documents, data and code up to {limits ? sizeLabel(limits.maxFileBytes) : '25 MB'}, including PDFs.
          Large scanned PDFs are read in the background and become searchable when that finishes.
        </p>
        <Button className="mt-5" variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy !== null}>
          Browse files
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={limits ? limits.allowedExtensions.map((extension) => `.${extension}`).join(',') : undefined}
          onChange={(event) => {
            void upload(event.target.files)
            event.target.value = ''
          }}
        />
      </div>

      {problems.length > 0 && (
        <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
          {problems.map((problem) => (
            <p key={problem} className="flex items-start gap-2 text-[13px] leading-relaxed text-amber-900">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" strokeWidth={2} />
              {problem}
            </p>
          ))}
        </div>
      )}

      <div className="mt-7">
        {loading ? (
          <p className="text-[15px] text-slate-500">Loading your files…</p>
        ) : files.length === 0 ? (
          <p className="text-[15px] text-slate-500">You have not uploaded any files yet.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {files.map((file) => (
              <li
                key={file.name}
                className="flex items-center gap-3.5 rounded-xl border border-hairline bg-raised px-4 py-3"
              >
                <FileTypeIcon name={file.name} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-slate-800">{file.name}</span>
                  <span
                    className={cn(
                      'block truncate text-[13px]',
                      file.processing && !file.processing.readable && file.processing.polling
                        ? 'text-slate-600'
                        : file.processing && !file.processing.readable
                          ? 'text-amber-700'
                          : 'text-slate-500',
                    )}
                  >
                    {/*
                      * The job's OWN words — "Reading text — page 7 of 24" beats
                      * any generic reassurance, and it is the difference between
                      * a user who waits and one who assumes the product hung.
                      * A file with no record is an ordinary document: absent
                      * means "never needed background reading", not "unknown".
                      */}
                    {file.processing && !file.processing.readable
                      ? `${file.processing.failureReason ?? file.processing.description} · ${sizeLabel(file.bytes)}`
                      : sizeLabel(file.bytes)}
                  </span>
                </span>
                {armedForDelete === file.name ? (
                  /*
                   * Confirm and Cancel, both reachable. A confirmation with no
                   * way out is a trap rather than a safeguard: a person who
                   * armed the wrong row must be able to leave without deleting
                   * anything.
                   */
                  <span className="inline-flex items-center gap-1">
                    <button
                      aria-label={`Confirm deleting ${file.name} permanently`}
                      onClick={() => {
                        setArmedForDelete(null)
                        void remove(file.name)
                      }}
                      className="inline-flex h-9 items-center rounded-lg bg-red-600 px-2.5 text-[13px] font-medium text-white transition-colors hover:bg-red-700"
                    >
                      Delete for good
                    </button>
                    <button
                      aria-label={`Keep ${file.name}`}
                      onClick={() => setArmedForDelete(null)}
                      className="inline-flex h-9 items-center rounded-lg px-2.5 text-[13px] text-slate-600 transition-colors hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    aria-label={`Delete ${file.name}`}
                    onClick={() => setArmedForDelete(file.name)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {files.length > 0 && (
        <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-hairline pt-6">
          <Button size="lg" onClick={() => void runIndex()} disabled={busy !== null}>
            {busy === 'indexing' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Indexing…
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" /> {index.searchable ? 'Re-index files' : 'Index files'}
              </>
            )}
          </Button>
          {index.searchable && busy === null && (
            <p className="flex items-center gap-2 text-[13px] font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
              Searchable{count === null ? '' : ` — ${count} entries`}
            </p>
          )}
        </div>
      )}
    </Workspace>
  )
}
