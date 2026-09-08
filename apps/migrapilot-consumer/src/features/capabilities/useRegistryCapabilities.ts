'use client'

/**
 * The engine-executed capabilities this browser may be offered.
 *
 * ---------------------------------------------------------------------------
 * IT ASKS ONLY WHEN SOMETHING NEEDS ASKING
 *
 * The caller passes the capability ids the catalog actually declares. With none
 * — which is the state today, because no catalog entry is engine-executed yet —
 * this makes no request at all and reports `null`.
 *
 * That is not an optimisation, it is the same honesty rule the rest of this
 * slice follows. A hook that fired a request nothing consumes would be a cost
 * with no reader; one that returned `[]` without asking would be claiming to
 * know something it never looked up.
 *
 * When Migra Search is registered, the catalog names its id, this starts
 * resolving, and the row appears. The seam is here; the traffic arrives with
 * the capability.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE BROWSER NEVER TALKS TO THE ENGINE DIRECTLY
 *
 * The fetch goes to the consumer's own route, which resolves the principal
 * server-side and asks the Brain in the caller's scope. A browser reaching the
 * engine would be a client deciding its own scope — the boundary every other
 * capability in this product already refuses to cross.
 */

import { useEffect, useState } from 'react'

import type { RegistryCapability } from './resolveCapabilities'

export function useRegistryCapabilities(ids: readonly string[]): RegistryCapability[] | null {
  const [capabilities, setCapabilities] = useState<RegistryCapability[] | null>(null)
  // Joined so the effect re-runs when the SET changes, not on every render that
  // rebuilds the array — the catalog is constructed fresh each pass.
  const key = [...ids].sort().join(',')

  useEffect(() => {
    if (!key) {
      setCapabilities(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/api/capabilities', { credentials: 'same-origin' })
        if (!response.ok) {
          /*
           * A refusal is NOT an empty capability set. Empty says "you have
           * none"; null says "we do not know". The resolver invents no rows for
           * either, but only one of them is a claim about the user.
           */
          if (!cancelled) setCapabilities(null)
          return
        }
        const data = (await response.json()) as { capabilities?: RegistryCapability[] }
        if (!cancelled) setCapabilities(data.capabilities ?? [])
      } catch {
        if (!cancelled) setCapabilities(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [key])

  return capabilities
}
