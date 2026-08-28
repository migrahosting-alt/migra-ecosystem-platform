'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { FeedbackState, Rating } from '@/components/chat/FeedbackControls'

/**
 * The conversation's feedback, loaded once and owned here.
 *
 * 🚨 CANONICAL STATE, NOT LOCAL STATE. Every selected thumb on screen comes from
 * a record the server returned. That is the difference between this and what it
 * replaced: the old buttons remembered your click in the browser and forgot it on
 * reload, which made them look like they worked.
 *
 * LOADED PER CONVERSATION, NOT PER MESSAGE. A transcript renders every turn at
 * once; asking once for the whole conversation beats forty requests that each
 * answer one.
 *
 * THE MAP IS ONLY UPDATED AFTER THE SERVER AGREES. An optimistic update here
 * would recreate the original defect in a subtler form — a thumb that looks saved
 * while the write failed. The cost is a visible moment of latency, which is the
 * honest representation of a thing that is being written down.
 */

interface FeedbackApi {
  get(messageId: string): FeedbackState | undefined
  busy(messageId: string): boolean
  problem(messageId: string): string | null
  vote(messageId: string, rating: Rating, turn?: TurnProvenance): Promise<void>
  retract(messageId: string): Promise<void>
  detail(messageId: string, reason: string, note?: string): Promise<void>
}

/** What was true about the turn, captured at vote time because it cannot be
 *  recovered afterwards. Never user content. */
export interface TurnProvenance {
  requestId?: string
  modelId?: string
  providerId?: string
  turnContext?: Record<string, unknown>
}

const Ctx = createContext<FeedbackApi | null>(null)

export function FeedbackProvider({
  conversationId,
  children,
}: {
  conversationId: string | null
  children: React.ReactNode
}) {
  const [map, setMap] = useState<Record<string, FeedbackState>>({})
  const [busyIds, setBusyIds] = useState<Record<string, true>>({})
  const [problems, setProblems] = useState<Record<string, string>>({})

  useEffect(() => {
    setMap({})
    setProblems({})
    if (!conversationId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/feedback?conversationId=${encodeURIComponent(conversationId)}`, {
          credentials: 'same-origin',
        })
        if (!res.ok) return
        const data = (await res.json()) as { feedback?: { messageId: string; rating: Rating; reason?: string; detail?: string }[] }
        if (cancelled) return
        const next: Record<string, FeedbackState> = {}
        for (const f of data.feedback ?? []) {
          next[f.messageId] = { rating: f.rating, ...(f.reason ? { reason: f.reason } : {}), ...(f.detail ? { detail: f.detail } : {}) }
        }
        setMap(next)
      } catch {
        // A conversation whose feedback cannot be loaded still renders. Showing
        // no selection is honest here: we do not know what was recorded, and
        // guessing would be the same lie in the other direction.
      }
    })()
    return () => { cancelled = true }
  }, [conversationId])

  const mark = useCallback((messageId: string, on: boolean) => {
    setBusyIds((b) => {
      const next = { ...b }
      if (on) next[messageId] = true
      else delete next[messageId]
      return next
    })
  }, [])

  const write = useCallback(async (
    messageId: string,
    body: Record<string, unknown>,
    optimisticFailureMessage: string,
  ): Promise<FeedbackState | undefined> => {
    if (!conversationId) return undefined
    mark(messageId, true)
    setProblems((p) => { const n = { ...p }; delete n[messageId]; return n })
    try {
      const res = await fetch('/api/feedback', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ conversationId, messageId, ...body }),
      })
      const data = (await res.json()) as { feedback?: FeedbackState; message?: string }
      if (!res.ok || !data.feedback) {
        setProblems((p) => ({ ...p, [messageId]: data.message ?? optimisticFailureMessage }))
        return undefined
      }
      const state: FeedbackState = {
        rating: data.feedback.rating,
        ...(data.feedback.reason ? { reason: data.feedback.reason } : {}),
        ...(data.feedback.detail ? { detail: data.feedback.detail } : {}),
      }
      setMap((m) => ({ ...m, [messageId]: state }))
      return state
    } catch {
      setProblems((p) => ({ ...p, [messageId]: optimisticFailureMessage }))
      return undefined
    } finally {
      mark(messageId, false)
    }
  }, [conversationId, mark])

  const api = useMemo<FeedbackApi>(() => ({
    get: (id) => map[id],
    busy: (id) => Boolean(busyIds[id]),
    problem: (id) => problems[id] ?? null,
    vote: async (id, rating, turn) => {
      await write(id, { rating, ...(turn ?? {}) }, 'Your feedback could not be saved.')
    },
    detail: async (id, reason, note) => {
      // Carries the rating explicitly: a reason without one would be a reason
      // attached to nothing, and the server refuses it.
      await write(id, { rating: 'down', reason, ...(note ? { detail: note } : {}) },
        'That detail could not be saved.')
    },
    retract: async (id) => {
      if (!conversationId) return
      mark(id, true)
      setProblems((p) => { const n = { ...p }; delete n[id]; return n })
      try {
        const res = await fetch('/api/feedback', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ conversationId, messageId: id }),
        })
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { message?: string }
          setProblems((p) => ({ ...p, [id]: data.message ?? 'Your feedback could not be withdrawn.' }))
          return
        }
        // Removed from the map only after the server confirms, so a failed
        // withdrawal leaves the thumb where it actually still is.
        setMap((m) => { const n = { ...m }; delete n[id]; return n })
      } catch {
        setProblems((p) => ({ ...p, [id]: 'Your feedback could not be withdrawn.' }))
      } finally {
        mark(id, false)
      }
    },
  }), [map, busyIds, problems, write, conversationId, mark])

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

/** Undefined outside a provider, so a message rendered elsewhere degrades to no
 *  controls rather than throwing. */
export function useFeedback(): FeedbackApi | null {
  return useContext(Ctx)
}
