/**
 * The Migra model families this surface may offer.
 *
 * Read from the ONE canonical catalog the Brain owns. This hook deliberately
 * holds no list of its own: names, descriptions and availability all arrive from
 * the server, so the consumer cannot describe Migra Forge differently from the
 * way the VS Code extension describes it.
 */

'use client'

import { useCallback, useEffect, useState } from 'react'

/** A family as the canonical contract reports it. */
export interface MigraFamilyView {
  id: string
  displayName: string
  tagline: string
  description: string
  recommended: boolean
  /** Live: is there a qualified, runnable path for this family right now? */
  available: boolean
  /** Did that path rest on a durable approval, or only on capability matching? */
  governed: boolean
  unavailableReason?: string
  /** INTERNAL provenance. Never rendered as the user's choice. */
  selectedBackend?: string
  /** What the availability decision rested on — a capability or a grant. */
  basis?: string
}

export type FamiliesState =
  | { phase: 'loading' }
  /** The catalog could not be read. NOT the same as "no families exist". */
  | { phase: 'error'; message: string }
  | { phase: 'ready'; families: MigraFamilyView[]; catalogRevision: string }

/** Where the user's choice is remembered between visits. */
export const FAMILY_STORAGE_KEY = 'migrapilot.modelFamily'

/**
 * Restore a remembered choice, but only if it is still offered AND still
 * available.
 *
 * A family can be selectable one day and blocked the next — a model is retired,
 * a qualification is revoked. Restoring a stored id without re-checking would
 * silently resurrect a selection the system can no longer honour, and the first
 * sign would be a failed turn.
 */
export function restoreSelection(
  stored: string | null,
  families: MigraFamilyView[],
): string | undefined {
  if (!stored) return undefined
  const match = families.find((f) => f.id === stored)
  if (!match || !match.available) return undefined
  return match.id
}

/** The default the product recommends, when nothing is remembered. */
export function defaultSelection(families: MigraFamilyView[]): string | undefined {
  const recommended = families.find((f) => f.recommended && f.available)
  if (recommended) return recommended.id
  // No recommended family is available: do NOT silently promote another one.
  // Selecting nothing lets the caller fall back to the server's own routing,
  // which is governed, rather than this UI inventing a substitute.
  return undefined
}

export function useModelFamilies(): FamiliesState & { reload: () => void } {
  const [state, setState] = useState<FamiliesState>({ phase: 'loading' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/model-families', { cache: 'no-store' })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string }
          if (!cancelled) {
            setState({
              phase: 'error',
              message: body.message ?? 'The model catalog could not be read.',
            })
          }
          return
        }
        const data = (await res.json()) as { families: MigraFamilyView[]; catalogRevision: string }
        if (!cancelled) {
          setState({ phase: 'ready', families: data.families ?? [], catalogRevision: data.catalogRevision })
        }
      } catch {
        if (!cancelled) setState({ phase: 'error', message: 'The model catalog could not be reached.' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { ...state, reload }
}
