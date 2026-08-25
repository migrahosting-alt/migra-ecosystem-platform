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
/**
 * A probe that failed is NOT a probe still running.
 *
 * This used to leave the state `null` on failure, which the UI renders as
 * "Checking whether images can be read…" — a spinner that never finishes, shown
 * indefinitely. In production the probe was 500ing and the control sat greyed
 * out behind that message while the capability was live and qualified. Failing
 * closed is right; describing the failure as an unfinished check is not.
 */
export function useVisionAvailability(): VisionCapability | null {
  const [vision, setVision] = useState<VisionCapability | null>(null)

  useEffect(() => {
    let cancelled = false
    const unreachable = (): VisionCapability => ({
      state: 'unknown',
      model: null,
      installed: 0,
      message: 'We could not check whether images can be read right now.',
      digest: null,
      objectCounting: { qualified: false, model: null },
    })

    const signedOut = (): VisionCapability => ({
      state: 'signed_out',
      model: null,
      installed: 0,
      message: 'Sign in to attach images.',
      digest: null,
      objectCounting: { qualified: false, model: null },
    })

    void fetch('/api/images')
      .then(async (response) => {
        // A 401 is an ANSWER, not a failed probe: images need an account, and
        // saying so is both true and actionable.
        if (response.status === 401) return { vision: signedOut() }
        if (!response.ok) return null
        return (await response.json()) as { vision?: VisionCapability } | null
      })
      .then((data) => {
        if (cancelled) return
        // `unknown` either way — still disabled, but honestly described.
        setVision(data?.vision ?? unreachable())
      })
      .catch(() => {
        if (!cancelled) setVision(unreachable())
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
    case 'signed_out':
      return 'Sign in to attach images.'
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
