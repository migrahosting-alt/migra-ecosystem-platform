'use client'

import { useEffect, useState } from 'react'
import type { VisionCapability } from '@/server/files/visionCapability'

/**
 * Whether an image may be offered for attachment at all.
 *
 * Starts as `null` (unknown) and the control stays DISABLED until the Brain
 * answers. Defaulting to enabled while the answer is in flight would offer a
 * capability that may not exist — the same over-claim the qualification
 * governance exists to prevent, reproduced in the UI.
 *
 * THE ANSWER COMES FROM THE BRAIN'S DURABLE DECISIONS, never from a constant
 * here. A model is installed but unusable until a human has approved an exact
 * digest against `vision.general`, and revoking that approval must close this
 * control on the next check rather than at the next deploy.
 */
export function useVisionAvailability(): VisionCapability | null {
  const [vision, setVision] = useState<VisionCapability | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/images')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { vision?: VisionCapability } | null) => {
        if (!cancelled && data?.vision) setVision(data.vision)
      })
      .catch(() => {
        // A failed probe is not permission. Leaving it null keeps the control off.
      })
    return () => {
      cancelled = true
    }
  }, [])

  return vision
}

/**
 * The single sentence explaining why an image cannot be attached.
 *
 * Empty string when it CAN — a disabled control needs a reason, an enabled one
 * needs no excuse.
 */
export function visionDisabledReason(vision: VisionCapability | null): string {
  if (!vision) return 'Checking whether images can be read…'
  switch (vision.state) {
    case 'ready':
      return ''
    case 'unknown':
      return 'We could not check whether images can be read right now.'
    default:
      return vision.message
  }
}

/**
 * What to tell someone before they ask for something the model cannot do.
 *
 * Vision being ready does NOT mean counting is. The model reads an invoice
 * perfectly and miscounts what is on it, every run, with no hedge — so a UI that
 * treated `state: 'ready'` as permission to promise "count these" would be
 * offering the one operation the qualification explicitly excluded. Returns null
 * when there is nothing to warn about.
 */
export function visionCaveat(vision: VisionCapability | null): string | null {
  if (!vision || vision.state !== 'ready') return null
  if (vision.objectCounting.qualified) return null
  return 'I can describe and read this image, but I cannot give you an exact count of things in it.'
}
