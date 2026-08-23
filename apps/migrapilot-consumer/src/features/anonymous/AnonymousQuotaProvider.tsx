'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import type { AnonymousChatQuota } from '@migrapilot/shared-types/anonymous-quota'

/**
 * The visitor's free-message allowance, as the SERVER sees it.
 *
 * THERE IS NO COUNTER IN THIS FILE. Every number rendered anywhere in the app
 * arrives from the Brain's ledger — either read from `/api/anonymous/quota`, or
 * carried on a turn's own response after that turn's reservation was taken and
 * settled. Nothing here decrements anything.
 *
 * That is not fastidiousness. A count the browser maintained would be wrong the
 * moment a second tab sent a turn, wrong after a refresh, wrong after a failed
 * turn was refunded, and resettable by anyone who opened devtools — four ways to
 * give away free inference while displaying a limit. The number and the decision
 * have to come from the same place, and the decision has to live where the spend
 * is recorded.
 *
 * `applyServerQuota` looks like a setter and is not: it accepts a quota object
 * the SERVER computed and attached to a turn response. Feeding it a locally
 * derived value would reintroduce exactly the counter this avoids.
 */

export type QuotaMode = 'loading' | 'anonymous' | 'authenticated' | 'unavailable'

interface AnonymousQuotaValue {
  mode: QuotaMode
  /**
   * The allowance, or null when it could not be read.
   *
   * Null is NOT zero and is not a full allowance. An unknown count renders as
   * unknown; the send attempt is still refused server-side by the reservation,
   * which is the authority.
   */
  quota: AnonymousChatQuota | null
  /** Re-read the authoritative allowance. */
  refresh: () => void
  /** Accept a quota the server attached to a turn response. Never a local guess. */
  applyServerQuota: (quota: AnonymousChatQuota) => void
}

const AnonymousQuotaContext = createContext<AnonymousQuotaValue | null>(null)

interface QuotaWire {
  mode?: 'anonymous' | 'authenticated' | 'unavailable'
  quota?: AnonymousChatQuota | null
  /** A signed-in browser still carrying signed-out work that was never moved. */
  pendingClaim?: boolean
}

export function AnonymousQuotaProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<QuotaMode>('loading')
  const [quota, setQuota] = useState<AnonymousChatQuota | null>(null)
  const router = useRouter()
  /** Guards the self-healing claim so a slow response cannot start a second one. */
  const claiming = useRef(false)

  const read = useCallback(async () => {
    try {
      const response = await fetch('/api/anonymous/quota', { cache: 'no-store' })
      if (!response.ok) return
      const wire = (await response.json()) as QuotaWire
      setMode(wire.mode ?? 'unavailable')
      setQuota(wire.quota ?? null)

      /*
       * SELF-HEALING CLAIM.
       *
       * A signed-in browser that still holds an anonymous cookie has work the
       * sign-in did not move — the callback is where that normally happens, and
       * this is how the app notices when it did not. Without this the visitor's
       * conversations would sit in a scope their account cannot read, with an
       * empty sidebar and no way to recover them.
       *
       * Safe to repeat: the Brain refuses a second claim of the same anonymous
       * session, and the cookie is revoked once the transfer is done.
       */
      if (wire.mode === 'authenticated' && wire.pendingClaim && !claiming.current) {
        claiming.current = true
        const claimed = await fetch('/api/anonymous/claim', { method: 'POST' })
          .then((r) => (r.ok ? (r.json() as Promise<{ claimed?: string[] }>) : null))
          .catch(() => null)
        // Re-render the server components so the sidebar shows the moved threads.
        if (claimed?.claimed?.length) router.refresh()
      }
    } catch {
      // A failed read leaves the last known state alone. Inventing "0 left" would
      // block a visitor who has turns; inventing a full allowance would promise
      // turns they do not have.
    }
  }, [router])

  useEffect(() => {
    void read()
  }, [read])

  /*
   * Re-read when the tab comes back.
   *
   * This is what makes a second tab honest: two tabs share one server-side
   * allowance, and the one left in the background is showing a number that
   * another tab has since spent. Refreshing on focus is not a decoration — the
   * stale tab is the one a person is about to type into.
   */
  useEffect(() => {
    const onFocus = () => void read()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [read])

  const applyServerQuota = useCallback((next: AnonymousChatQuota) => {
    setQuota(next)
    setMode('anonymous')
  }, [])

  const value = useMemo<AnonymousQuotaValue>(
    () => ({ mode, quota, refresh: () => void read(), applyServerQuota }),
    [mode, quota, read, applyServerQuota],
  )

  return <AnonymousQuotaContext.Provider value={value}>{children}</AnonymousQuotaContext.Provider>
}

/**
 * The allowance, for any client component.
 *
 * Returns an inert value outside the provider rather than throwing: a screen
 * rendered in isolation should not crash, and "not anonymous" is the safe
 * reading — it shows no allowance and blocks nothing.
 */
export function useAnonymousQuota(): AnonymousQuotaValue {
  const context = useContext(AnonymousQuotaContext)
  return (
    context ?? {
      mode: 'loading',
      quota: null,
      refresh: () => undefined,
      applyServerQuota: () => undefined,
    }
  )
}

/** True when the composer must refuse to send. Server state only. */
export function isExhausted(value: Pick<AnonymousQuotaValue, 'mode' | 'quota'>): boolean {
  return value.mode === 'anonymous' && value.quota !== null && value.quota.exhausted
}
