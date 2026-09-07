/**
 * The rename approval round-trip, in the browser.
 *
 * ---------------------------------------------------------------------------
 * THE UI DOES NOT REINTERPRET THE DECISION
 *
 * Every refusal here carries the sentence the Brain wrote. Expired, mismatched,
 * already-used and no-longer-permitted are DIFFERENT facts, and the backend
 * already distinguishes them; re-deriving that from a status code would give the
 * product a second opinion, and the one further from the decision would drift.
 *
 * So this hook holds state and nothing else. It never composes a refusal, never
 * guesses why, and never turns one outcome into another.
 *
 * ---------------------------------------------------------------------------
 * 🚨 `unknown` IS NOT AN ERROR STATE WITH A RETRY BUTTON
 *
 * When a rename was dispatched and could not be confirmed, offering "Try again"
 * invites the user to repeat an action that may already have happened. For a
 * rename that is merely untidy; the same button on a send or a charge is a
 * duplicate. The state exists so the UI can say "check it" instead, and it
 * carries `canRetry: false` so no caller has to remember that.
 * ---------------------------------------------------------------------------
 */

'use client'

import { useCallback, useState } from 'react'

export type ApprovalPhase =
  | { kind: 'idle' }
  | { kind: 'proposing' }
  /** The exact normalized action, as the backend described it. Render verbatim. */
  | { kind: 'needs_approval'; action: string; token: string }
  | { kind: 'dispatching' }
  | { kind: 'done'; title: string }
  /**
   * Refused before anything was dispatched. A retry is safe, so a caller MAY
   * offer one — the refusal itself decides whether that makes sense.
   */
  | { kind: 'blocked'; message: string; canRetry: true }
  /** Dispatched, unconfirmed. Never retried automatically. */
  | { kind: 'unknown'; message: string; canRetry: false }

interface Payload {
  status?: string
  action?: string
  approvalToken?: string
  message?: string
  conversation?: { id: string; title: string }
}

const UNREACHABLE = 'The assistant service is unreachable right now. Nothing was changed.'

async function step(
  conversationId: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; payload: Payload }> {
  try {
    const res = await fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/rename-approval`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    )
    const payload = (await res.json().catch(() => ({}))) as Payload
    return { ok: res.ok, status: res.status, payload }
  } catch {
    return { ok: false, status: 0, payload: {} }
  }
}

export function useRenameApproval(conversationId: string) {
  const [phase, setPhase] = useState<ApprovalPhase>({ kind: 'idle' })
  const [pendingTitle, setPendingTitle] = useState('')

  const reset = useCallback(() => setPhase({ kind: 'idle' }), [])

  const propose = useCallback(
    async (title: string) => {
      const trimmed = title.trim()
      if (!trimmed) return
      setPendingTitle(trimmed)
      setPhase({ kind: 'proposing' })

      const { ok, payload } = await step(conversationId, { step: 'propose', title: trimmed })
      if (!ok) {
        setPhase({ kind: 'blocked', message: payload.message ?? UNREACHABLE, canRetry: true })
        return
      }
      if (payload.status === 'needs_approval' && payload.action && payload.approvalToken) {
        setPhase({ kind: 'needs_approval', action: payload.action, token: payload.approvalToken })
        return
      }
      // Anything else is a refusal the backend already worded.
      setPhase({
        kind: 'blocked',
        message: payload.message ?? 'That rename cannot run.',
        canRetry: true,
      })
    },
    [conversationId],
  )

  /** The user said no. Nothing is dispatched, and the token is rejected. */
  const declineRename = useCallback(async () => {
    if (phase.kind !== 'needs_approval') return
    const token = phase.token
    setPhase({ kind: 'idle' })
    await step(conversationId, { step: 'decline', approvalToken: token, title: pendingTitle })
  }, [conversationId, phase, pendingTitle])

  /**
   * The user approved. Dispatched exactly once.
   *
   * The phase moves to `dispatching` FIRST, which is what disables the button —
   * a guard against a double click, not a correctness mechanism. Correctness is
   * the single-use token, which the backend spends before it acts.
   */
  const approveRename = useCallback(async () => {
    if (phase.kind !== 'needs_approval') return
    const token = phase.token
    setPhase({ kind: 'dispatching' })

    const { ok, status, payload } = await step(conversationId, {
      step: 'dispatch',
      approvalToken: token,
      title: pendingTitle,
    })

    if (status === 202 || payload.status === 'unknown') {
      setPhase({
        kind: 'unknown',
        message:
          payload.message ??
          'We couldn’t confirm whether the change completed. Check the conversation before trying again.',
        canRetry: false,
      })
      return
    }
    if (!ok) {
      setPhase({ kind: 'blocked', message: payload.message ?? UNREACHABLE, canRetry: true })
      return
    }
    if (payload.status === 'done' && payload.conversation) {
      setPhase({ kind: 'done', title: payload.conversation.title })
      return
    }
    setPhase({
      kind: 'blocked',
      message: payload.message ?? 'That rename did not go through.',
      canRetry: true,
    })
  }, [conversationId, phase, pendingTitle])

  return { phase, propose, approveRename, declineRename, reset }
}
