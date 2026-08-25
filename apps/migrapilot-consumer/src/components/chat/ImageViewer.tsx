'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, ZoomIn, ZoomOut } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * A full-size look at an attached image.
 *
 * THE THUMBNAIL IS NOT THE IMAGE. A 20-square tile is enough to confirm the
 * right photo was picked and not enough to read a screenshot, which is the case
 * this whole feature exists for — so the picture has to be openable at its real
 * size.
 *
 * THE SAME AUTHORISED URL. It loads `/api/images/<ref>`, exactly what the
 * transcript uses: scope from the session, hash re-checked on read. There is no
 * separate "full size" endpoint that could drift from the one with the checks,
 * and nothing is copied into a blob or data URI that would escape them.
 */

export function ImageViewer({ src, alt, onClose }: {
  src: string
  alt: string
  onClose: () => void
}) {
  const [zoomed, setZoomed] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef<Element | null>(null)

  useEffect(() => {
    restoreFocus.current = document.activeElement
    closeRef.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)

    // The page behind must not scroll while a full-screen layer is open.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
      // Focus goes back where it came from, or a keyboard user is stranded at
      // the top of the document after closing.
      if (restoreFocus.current instanceof HTMLElement) restoreFocus.current.focus()
    }
  }, [onClose])

  const stop = useCallback((event: React.MouseEvent) => event.stopPropagation(), [])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 sm:p-8"
    >
      <div className="absolute right-3 top-3 flex items-center gap-2 sm:right-5 sm:top-5">
        <button
          type="button"
          onClick={(e) => { stop(e); setZoomed((v) => !v) }}
          aria-label={zoomed ? 'Fit image to screen' : 'Zoom to full size'}
          title={zoomed ? 'Fit to screen' : 'Zoom to full size'}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-white/20"
        >
          {zoomed ? <ZoomOut className="h-[18px] w-[18px]" /> : <ZoomIn className="h-[18px] w-[18px]" />}
        </button>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close image viewer"
          title="Close (Esc)"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-white/20"
        >
          <X className="h-[18px] w-[18px]" />
        </button>
      </div>

      {/*
        Scrolls when zoomed rather than overflowing the viewport, so a tall
        screenshot can actually be read on a phone.
      */}
      <div
        onClick={stop}
        className={cn('max-h-full max-w-full', zoomed && 'scroll-slim overflow-auto')}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          // Draggable and downloadable as an ordinary image: the browser's own
          // save and drag-out behaviour works because this is the real asset at
          // its authorised URL, not a canvas copy or an object URL.
          draggable
          className={cn(
            'rounded-lg',
            zoomed
              ? 'max-w-none cursor-zoom-out'
              : 'max-h-[85vh] max-w-full object-contain cursor-zoom-in',
          )}
          onClick={() => setZoomed((v) => !v)}
        />
      </div>
    </div>
  )
}
