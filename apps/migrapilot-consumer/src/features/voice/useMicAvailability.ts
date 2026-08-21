'use client'

import { useEffect, useState } from 'react'
import type { MicAvailability } from '@/server/brain/view'

/**
 * Whether the microphone may be offered at all.
 *
 * Starts as `null` (unknown) and the control stays DISABLED until the Brain answers.
 * Defaulting to enabled while the answer is in flight would offer a capability that might
 * not exist — the same over-claim the whole voice contract is built to prevent.
 */
export function useMicAvailability(): MicAvailability | null {
  const [availability, setAvailability] = useState<MicAvailability | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/speech/capability')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: MicAvailability | null) => {
        if (!cancelled && data) setAvailability(data)
      })
      .catch(() => {
        // A failed probe is not permission. Leaving it null keeps the mic disabled.
      })
    return () => {
      cancelled = true
    }
  }, [])

  return availability
}

/** The single sentence the UI shows for why a mic cannot be used. */
export function micDisabledReason(availability: MicAvailability | null): string {
  if (!availability) return 'Checking whether voice input is available…'
  if (availability.state === 'disabled') {
    switch (availability.cause) {
      case 'incompatible':
        return `Voice input is not available: ${availability.reason}`
      case 'unreachable':
        return 'Voice input is temporarily unavailable — MigraPilot could not be reached.'
      case 'signed_out':
        return 'Sign in to use voice input.'
      default:
        return availability.reason
    }
  }
  return ''
}
