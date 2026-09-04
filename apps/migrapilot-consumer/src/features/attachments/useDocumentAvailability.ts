'use client'

import { useEffect, useState } from 'react'

/**
 * Whether a document may be offered for attachment at all.
 *
 * 🚨 THE DEFECT THIS CLOSES, measured in the real product. The composer's action
 * menu offered "Files & documents — Attach a document, data file, or code for
 * MigraPilot to read" fully enabled to a signed-out visitor, while every
 * document operation behind it is authenticated-only. Choosing a file produced
 * `POST /api/files -> 401`, a chip reading "Sign in to manage files", and a
 * **Retry** button for a failure retrying can never fix.
 *
 * Its neighbour in the same menu — "Photos & images" — was already gated and
 * reads "Sign in to attach images". One row apart, one honest and one not.
 *
 * Deliberately the same shape as `useVisionAvailability`: probe, fail closed,
 * and hand the surface a sentence rather than a verdict it has to interpret.
 */
export interface DocumentAvailability {
  ready: boolean
  /** Empty when documents CAN be attached. A disabled control needs a reason. */
  reason: string
}

/** `null` means the probe has not answered — checking, not unavailable. */
export function useDocumentAvailability(): DocumentAvailability | null {
  const [availability, setAvailability] = useState<DocumentAvailability | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/files', { credentials: 'same-origin' })
      .then((response) => {
        if (cancelled) return
        // A 401 is an ANSWER, not a failed probe — and it is the actionable one.
        if (response.status === 401) {
          setAvailability({ ready: false, reason: 'Sign in to attach documents.' })
          return
        }
        setAvailability(
          response.ok
            ? { ready: true, reason: '' }
            : { ready: false, reason: 'Documents cannot be attached right now.' },
        )
      })
      .catch(() => {
        /*
         * A probe that FAILED is not a probe still running. Leaving it null would
         * render "Checking…" forever, which is the mistake the vision hook has a
         * comment about; fail closed, and say so.
         */
        if (!cancelled) setAvailability({ ready: false, reason: 'We could not check whether documents can be attached.' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return availability
}

/** The one sentence for why a document cannot be attached. Empty when it can. */
export function documentDisabledReason(availability: DocumentAvailability | null): string {
  if (!availability) return 'Checking whether documents can be attached…'
  return availability.ready ? '' : availability.reason
}
