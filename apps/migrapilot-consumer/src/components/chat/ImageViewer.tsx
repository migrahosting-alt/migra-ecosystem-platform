'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, X } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * A lightbox for the images on one message.
 *
 * IT FITS BY DEFAULT. The whole picture is inside the viewport the moment it
 * opens — no scrollbars, no panning, nothing cut off. Scrolling only becomes
 * possible after the user has chosen to zoom past the fit, which is the only
 * point at which there is anything off-screen to reach.
 *
 * IT SITS OVER THE CHAT, NOT INSTEAD OF IT. The backdrop is dimmed rather than
 * opaque and the controls are small, so this reads as a closer look at something
 * in the conversation rather than a separate application.
 *
 * THE SAME AUTHORISED URL. `/api/images/<ref>`, exactly what the transcript
 * loads: scope from the session, hash re-checked on read. No second endpoint
 * that could drift from the one with the checks, and nothing copied into a blob
 * or data URI that would escape them.
 */

const ZOOM_STEPS = [1, 1.5, 2, 3] as const

export function ImageViewer({ refs, startIndex = 0, alt, onClose }: {
  /** Every image on the message, so the arrows have somewhere to go. */
  refs: readonly string[]
  startIndex?: number
  alt: string
  onClose: () => void
}) {
  const [index, setIndex] = useState(startIndex)
  const [zoom, setZoom] = useState(0)
  const restoreFocus = useRef<Element | null>(null)
  const touchStartX = useRef<number | null>(null)

  const many = refs.length > 1
  const scale = ZOOM_STEPS[zoom]!
  const zoomed = zoom > 0

  const go = useCallback((delta: number) => {
    setIndex((current) => (current + delta + refs.length) % refs.length)
    // A new picture starts fitted; carrying a zoom across would open the next
    // one already cropped.
    setZoom(0)
  }, [refs.length])

  useEffect(() => {
    restoreFocus.current = document.activeElement

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowRight' && many) go(1)
      else if (event.key === 'ArrowLeft' && many) go(-1)
      else if (event.key === '+' || event.key === '=') setZoom((z) => Math.min(z + 1, ZOOM_STEPS.length - 1))
      else if (event.key === '-') setZoom((z) => Math.max(z - 1, 0))
      else if (event.key === '0') setZoom(0)
    }
    document.addEventListener('keydown', onKey)

    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
      /*
       * Back to the image that was clicked. Without this a keyboard user lands
       * at the top of the document after closing, having lost their place in a
       * conversation they were reading.
       */
      if (restoreFocus.current instanceof HTMLElement) restoreFocus.current.focus()
    }
  }, [onClose, go, many])

  const stop = (event: React.MouseEvent | React.TouchEvent) => event.stopPropagation()

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/70 p-4 backdrop-blur-[2px]"
    >
      {/* ── controls: small, top-right, out of the picture's way ───────── */}
      <div className="absolute right-3 top-3 flex items-center gap-1.5" onClick={stop}>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(z - 1, 0))}
          disabled={zoom === 0}
          aria-label="Zoom out"
          title="Zoom out (−)"
          className={cn(control, zoom === 0 && 'cursor-not-allowed opacity-40')}
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="min-w-[3rem] text-center text-[12px] tabular-nums text-white/80">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(z + 1, ZOOM_STEPS.length - 1))}
          disabled={zoom === ZOOM_STEPS.length - 1}
          aria-label="Zoom in"
          title="Zoom in (+)"
          className={cn(control, zoom === ZOOM_STEPS.length - 1 && 'cursor-not-allowed opacity-40')}
        >
          <Plus className="h-4 w-4" />
        </button>
        {zoomed && (
          <button type="button" onClick={() => setZoom(0)} aria-label="Reset zoom" title="Fit to screen (0)" className={control}>
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
        <button type="button" onClick={onClose} aria-label="Close image viewer" title="Close (Esc)" className={control}>
          <X className="h-[18px] w-[18px]" />
        </button>
      </div>

      {/* ── the picture ─────────────────────────────────────────────────── */}
      <div
        onClick={stop}
        onTouchStart={(e) => { touchStartX.current = e.touches[0]?.clientX ?? null }}
        onTouchEnd={(e) => {
          // Swipe only when fitted: once zoomed, a horizontal drag is panning.
          if (!many || zoomed || touchStartX.current === null) return
          const delta = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current
          if (Math.abs(delta) > 60) go(delta < 0 ? 1 : -1)
          touchStartX.current = null
        }}
        className={cn(
          'flex items-center justify-center',
          // Scrollable ONLY when zoomed past the fit — otherwise there is
          // nothing off-screen and a scrollbar would be noise.
          zoomed ? 'scroll-slim max-h-[85vh] max-w-[90vw] overflow-auto' : 'max-h-[85vh] max-w-[90vw]',
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={refs[index]}
          src={`/api/images/${refs[index]}`}
          alt={alt}
          // Draggable and savable as an ordinary image, because this IS the real
          // asset at its authorised URL.
          draggable
          onClick={() => setZoom((z) => (z === 0 ? 1 : 0))}
          style={zoomed ? { width: `${scale * 100}%`, maxWidth: 'none' } : undefined}
          className={cn(
            'rounded-lg',
            zoomed
              ? 'cursor-zoom-out'
              : 'max-h-[85vh] max-w-[90vw] object-contain cursor-zoom-in',
          )}
        />
      </div>

      {/* ── gallery: arrows either side, counter beneath ─────────────────── */}
      {many && (
        <>
          <button
            type="button"
            onClick={(e) => { stop(e); go(-1) }}
            aria-label="Previous image"
            title="Previous (←)"
            className={cn(control, 'absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10')}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={(e) => { stop(e); go(1) }}
            aria-label="Next image"
            title="Next (→)"
            className={cn(control, 'absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10')}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <p className="mt-3 text-[13px] tabular-nums text-white/80" onClick={stop}>
            {index + 1} / {refs.length}
          </p>
        </>
      )}
    </div>
  )
}

const control =
  'inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60'
