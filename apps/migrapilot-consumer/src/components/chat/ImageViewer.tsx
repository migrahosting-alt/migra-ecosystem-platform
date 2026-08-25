'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Click an image, see the image.
 *
 * DELIBERATELY PLAIN. An earlier version had zoom steps, a percentage readout, a
 * reset control and a lightly-blurred backdrop that kept the conversation
 * readable behind it — which put assistant text inside the image-viewing
 * experience and made a simple "look closer" feel like an editor. Everything
 * that was not needed to see the picture is gone.
 *
 * THE BACKDROP IS DARK ON PURPOSE. Translucent enough to keep the page's shape,
 * opaque enough that nothing behind competes with what is being looked at.
 *
 * NO SCROLLBARS. The image is bounded to fit inside the viewport, so there is
 * never anything off-screen to scroll to.
 *
 * THE SAME AUTHORISED URL as the transcript: scope from the session, hash
 * re-checked on read. No second endpoint that could drift from the one with the
 * checks, and nothing copied into a blob or data URI that would escape them.
 */

export function ImageViewer({ refs, startIndex = 0, alt, onClose }: {
  /** Every image on the message, so the arrows have somewhere to go. */
  refs: readonly string[]
  startIndex?: number
  alt: string
  onClose: () => void
}) {
  const [index, setIndex] = useState(startIndex)
  const restoreFocus = useRef<Element | null>(null)
  const touchStartX = useRef<number | null>(null)

  const many = refs.length > 1

  const go = useCallback((delta: number) => {
    setIndex((current) => (current + delta + refs.length) % refs.length)
  }, [refs.length])

  useEffect(() => {
    restoreFocus.current = document.activeElement

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowRight' && many) go(1)
      else if (event.key === 'ArrowLeft' && many) go(-1)
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

  const stop = (event: React.MouseEvent) => event.stopPropagation()

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      onTouchStart={(e) => { touchStartX.current = e.touches[0]?.clientX ?? null }}
      onTouchEnd={(e) => {
        if (!many || touchStartX.current === null) return
        const delta = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current
        if (Math.abs(delta) > 60) go(delta < 0 ? 1 : -1)
        touchStartX.current = null
      }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/90 p-4"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close image viewer"
        title="Close (Esc)"
        className={cn(control, 'absolute right-3 top-3')}
      >
        <X className="h-[18px] w-[18px]" />
      </button>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={refs[index]}
        src={`/api/images/${refs[index]}`}
        alt={alt}
        // Draggable and savable as an ordinary image, because this IS the real
        // asset at its authorised URL.
        draggable
        onClick={stop}
        className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain"
      />

      {many && (
        <>
          <button
            type="button"
            onClick={(e) => { stop(e); go(-1) }}
            aria-label="Previous image"
            title="Previous (←)"
            className={cn(control, 'absolute left-3 top-1/2 h-10 w-10 -translate-y-1/2')}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={(e) => { stop(e); go(1) }}
            aria-label="Next image"
            title="Next (→)"
            className={cn(control, 'absolute right-3 top-1/2 h-10 w-10 -translate-y-1/2')}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <p className="mt-3 text-[13px] tabular-nums text-white/70" onClick={stop}>
            {index + 1} / {refs.length}
          </p>
        </>
      )}
    </div>
  )
}

const control =
  'inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60'
