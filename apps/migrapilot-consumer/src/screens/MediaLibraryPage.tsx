'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, ImageOff, Loader2, RefreshCw, Search, Sparkles, Trash2, Upload } from 'lucide-react'
import { Workspace } from '@/components/layout/AppShell'
import { RailCard } from '@/components/rail/RailPanels'
import { Button } from '@/components/ui/Button'
import { ImageViewer } from '@/components/chat/ImageViewer'
import { cn } from '@/lib/cn'

/**
 * The Media Library.
 *
 * ONE HOME FOR EVERY ARTIFACT, whether the user chose it or MigraPilot made it.
 * A generated picture is not a by-product of a chat turn that happens to sit on
 * a disk somewhere — it is the user's, listed beside their uploads, openable,
 * downloadable and deletable on the same terms.
 *
 * PROVENANCE IS SHOWN, NOT INFERRED. "Generated" is a fact recorded on the image
 * when it was made, carrying the pipeline and the prompt; an upload says nothing
 * rather than guessing. That difference is displayed because it is the first
 * thing a person wants to know when looking at a grid of their own pictures.
 *
 * EVERY NUMBER HERE IS REAL. Counts, sizes and dates come from the store. An
 * empty library says it is empty; a library that could not be READ says that
 * instead, because "you have nothing" and "we could not look" are different
 * facts and must never render the same way.
 */

interface LibraryImage {
  imageId: string
  mime: string
  width: number
  height: number
  bytes: number
  createdAt: number
  displayName: string
  provenance?: { origin: 'upload' | 'generated'; model?: string; prompt?: string }
}

interface Library {
  images: LibraryImage[]
  usage: { count: number; bytes: number }
  libraryReadable: boolean
  libraryError?: string
  limits?: { maxImages: number; maxLibraryBytes: number }
}

type Filter = 'all' | 'generated' | 'upload'

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const formatDate = (ms: number): string =>
  new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })

export function MediaLibraryPage() {
  const [library, setLibrary] = useState<Library | null>(null)
  const [loading, setLoading] = useState(true)
  /** Null when the library could not be fetched at all — distinct from empty. */
  const [unreachable, setUnreachable] = useState(false)
  const [signedOut, setSignedOut] = useState(false)
  /*
   * Success needs saying, not just failure.
   *
   * Deleting an image removed the tile and announced NOTHING — the only
   * feedback in this screen was for the failure path. For anyone not watching
   * the exact tile that vanished, and for a screen reader, the action had no
   * observable outcome at all. Announced in a live region so it is heard, and
   * cleared on the next action so it cannot go stale.
   */
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [viewing, setViewing] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/images', { headers: { accept: 'application/json' } })
      if (response.status === 401) {
        setSignedOut(true)
        setUnreachable(false)
        setLibrary(null)
        return
      }
      if (!response.ok) {
        setUnreachable(true)
        setLibrary(null)
        return
      }
      setSignedOut(false)
      setUnreachable(false)
      setLibrary((await response.json()) as Library)
    } catch {
      setUnreachable(true)
      setLibrary(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const remove = async (imageId: string) => {
    setDeleting(imageId)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/images/${encodeURIComponent(imageId)}`, { method: 'DELETE' })
      if (!response.ok) {
        // The server refused, so the grid must not pretend otherwise.
        setError('That image could not be deleted. It is still in your library.')
        return
      }
      await load()
      // Only after the server confirmed AND the grid reloaded: the message
      // describes what happened, not what was attempted.
      setNotice('Media deleted')
    } catch {
      setError('That image could not be deleted. It is still in your library.')
    } finally {
      setDeleting(null)
    }
  }

  const images = library?.images ?? []
  const shown = useMemo(() => {
    const term = query.trim().toLowerCase()
    return images
      .filter((image) => {
        if (filter === 'generated') return image.provenance?.origin === 'generated'
        if (filter === 'upload') return image.provenance?.origin !== 'generated'
        return true
      })
      .filter((image) => {
        if (!term) return true
        // Searches what the user can actually see or asked for: the name and,
        // for a generated image, the prompt that produced it.
        return (
          image.displayName.toLowerCase().includes(term) ||
          (image.provenance?.prompt ?? '').toLowerCase().includes(term)
        )
      })
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [images, filter, query])

  const generatedCount = images.filter((i) => i.provenance?.origin === 'generated').length

  return (
    <>
      <Workspace
        rail={
          <RailCard title="Library">
            {library?.libraryReadable === false ? (
              <p className="text-[13px] leading-relaxed text-amber-700">{library.libraryError}</p>
            ) : (
              <>
                <p className="text-[13px] leading-relaxed text-slate-500">
                  Everything you have added or MigraPilot has made for you.
                </p>
                <dl className="mt-3 space-y-2 text-[13px]">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Items</dt>
                    <dd className="font-semibold text-slate-800">{library?.usage.count ?? 0}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Generated</dt>
                    <dd className="font-semibold text-slate-800">{generatedCount}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Storage used</dt>
                    <dd className="font-semibold text-slate-800">{formatBytes(library?.usage.bytes ?? 0)}</dd>
                  </div>
                </dl>
              </>
            )}
            <div className="mt-4">
              <Button variant="secondary" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                Refresh
              </Button>
            </div>
          </RailCard>
        }
        contentClassName="mx-auto flex min-h-full w-full max-w-[1000px] flex-col px-6 py-7 sm:px-8"
      >
        <header>
          <h1 className="text-[26px] font-semibold tracking-tight text-slate-900">Media Library</h1>
          <p className="mt-1 text-[15px] text-slate-500">
            Images you have added and images MigraPilot has generated, in one place.
          </p>
        </header>

        {signedOut ? (
          <EmptyState
            icon={<ImageOff className="h-6 w-6 text-slate-400" />}
            title="Sign in to see your library"
            body="Your media belongs to your account, so there is nothing to show for a signed-out visitor."
          />
        ) : unreachable ? (
          <EmptyState
            icon={<ImageOff className="h-6 w-6 text-amber-500" />}
            title="Your library could not be read"
            body="This is a problem on our side, not an empty library. Nothing has been lost — try again in a moment."
          />
        ) : (
          <>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <div className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by name or prompt"
                  aria-label="Search your media"
                  className="h-10 w-full rounded-field border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800 focus:border-brand-400 focus:ring-4 focus:ring-brand-500/10 focus:outline-none"
                />
              </div>
              <div className="flex gap-1.5" role="group" aria-label="Filter by origin">
                {(
                  [
                    ['all', 'All'],
                    ['generated', 'Generated'],
                    ['upload', 'Uploaded'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    aria-pressed={filter === value}
                    className={cn(
                      'rounded-field px-3 py-2 text-sm font-semibold transition-colors',
                      filter === value
                        ? 'bg-brand-600 text-white'
                        : 'border border-slate-200 text-slate-600 hover:bg-slate-50',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <p role="alert" className="mt-4 text-[13.5px] text-red-600">
                {error}
              </p>
            )}

            {notice && !error && (
              <p role="status" className="mt-4 text-[13.5px] text-slate-600">
                {notice}
              </p>
            )}

            {loading && images.length === 0 ? (
              <div className="mt-10 flex items-center gap-2 text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading your library…</span>
              </div>
            ) : shown.length === 0 ? (
              <EmptyState
                icon={<Upload className="h-6 w-6 text-slate-400" />}
                title={images.length === 0 ? 'Nothing here yet' : 'Nothing matches that'}
                body={
                  images.length === 0
                    ? 'Attach a photo in a chat, or ask MigraPilot to create an image, and it will appear here.'
                    : 'Try a different search or filter.'
                }
              />
            ) : (
              <ul className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {shown.map((image, index) => (
                  <li
                    key={image.imageId}
                    className="group overflow-hidden rounded-card border border-hairline bg-raised shadow-card"
                  >
                    <button
                      type="button"
                      onClick={() => setViewing(index)}
                      className="block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                      aria-label={`Open ${image.displayName}`}
                    >
                      {/* Contained, never cropped: a thumbnail that cuts the
                          picture misrepresents what is stored. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/images/${image.imageId}`}
                        alt={image.displayName}
                        className="h-36 w-full bg-slate-50 object-contain transition group-hover:opacity-95"
                      />
                    </button>
                    <div className="border-t border-hairline p-3">
                      <p className="truncate text-[13.5px] font-semibold text-slate-800" title={image.displayName}>
                        {image.displayName}
                      </p>
                      <p className="mt-0.5 text-[12px] text-slate-500">
                        {image.width}×{image.height} · {formatBytes(image.bytes)} · {formatDate(image.createdAt)}
                      </p>
                      {image.provenance?.origin === 'generated' && (
                        <p
                          className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11.5px] font-semibold text-brand-700"
                          title={image.provenance.prompt ?? undefined}
                        >
                          <Sparkles className="h-3 w-3 shrink-0" />
                          <span className="truncate">Generated</span>
                        </p>
                      )}
                      <div className="mt-2.5 flex gap-1.5">
                        <a
                          href={`/api/images/${image.imageId}`}
                          download={image.displayName}
                          className="inline-flex items-center gap-1 rounded-field border border-slate-200 px-2 py-1 text-[12px] font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Save
                        </a>
                        <button
                          type="button"
                          onClick={() => void remove(image.imageId)}
                          disabled={deleting === image.imageId}
                          className="inline-flex items-center gap-1 rounded-field border border-slate-200 px-2 py-1 text-[12px] font-semibold text-slate-600 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {deleting === image.imageId ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Workspace>

      {viewing !== null && shown[viewing] && (
        <ImageViewer
          refs={shown.map((image) => image.imageId)}
          startIndex={viewing}
          alt="Image from your library"
          onClose={() => setViewing(null)}
        />
      )}
    </>
  )
}

function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="mt-10 rounded-card border border-dashed border-slate-200 bg-slate-50/50 p-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-card">
        {icon}
      </div>
      <h2 className="mt-4 text-[17px] font-semibold text-slate-800">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-[14px] leading-relaxed text-slate-500">{body}</p>
    </div>
  )
}
