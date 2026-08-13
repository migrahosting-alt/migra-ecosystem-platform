import { useEffect, useRef, useState } from 'react'

/** Calls `handler` when a pointer press or Escape lands outside the ref. */
export function useDismissable<T extends HTMLElement>(open: boolean, handler: () => void) {
  const ref = useRef<T>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) handler()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handler()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, handler])

  return ref
}

/**
 * Advances a value toward `target` on an interval — used to animate the live
 * coding run without a backend.
 */
export function useTicker(enabled: boolean, intervalMs: number) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => setTick((value) => value + 1), intervalMs)
    return () => window.clearInterval(id)
  }, [enabled, intervalMs])

  return tick
}

/** Formats elapsed seconds as HH:MM:SS. */
export function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}
