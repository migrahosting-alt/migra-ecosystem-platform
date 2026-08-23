import 'server-only'

/**
 * The allowance around ONE chat turn.
 *
 * ORDER IS THE FEATURE:
 *
 *   reserve  →  persist the user's message  →  run the model  →  settle
 *
 * Reserving FIRST is what makes this a limit rather than a receipt. A count
 * taken after generation has already paid for the inference it was supposed to
 * prevent, and it loses every race — two tabs, a double-click, a refresh
 * mid-stream — each lost race being one more free turn of real compute.
 *
 * Settling LAST, on what actually happened, is what keeps it fair. A served
 * answer stays paid for even if the user disliked it; infrastructure failing
 * before any useful output returns the allowance, because charging someone for
 * our own outage teaches them the product is both broken and stingy.
 *
 * Authenticated callers are not metered at all. This module answers
 * `not_metered` for them rather than reserving a zero — a signed-in user has no
 * quota row, and inventing one would make signing in look like a downgrade.
 */

import { randomUUID } from 'node:crypto'
import type { AnonymousChatQuota } from '@migrapilot/shared-types/anonymous-quota'
import type { Principal } from '../tenancy/principal'
import { anonymousQuota, reserveAnonymousTurn, settleAnonymousTurn } from '../brain/seams'
import type { BrainResult } from '../brain/gateway'

/** Why a turn may proceed, or may not. */
export type TurnAllowance =
  /** Signed in. No allowance applies. */
  | { kind: 'not_metered' }
  /** One turn is held. It MUST be settled. */
  | { kind: 'reserved'; reservationId: string; quota: AnonymousChatQuota }
  /** Out of turns. The model is never asked. */
  | { kind: 'exhausted'; quota: AnonymousChatQuota }
  /**
   * The allowance could not be established. NOT the same as exhausted, and not
   * an excuse to serve a turn: answering when the ledger is unreachable hands
   * out free inference every time PostgreSQL hiccups.
   */
  | { kind: 'unavailable'; status: number; error: string; message: string }

/**
 * A settlement outcome the caller can render.
 *
 * `quota` is re-read from the Brain rather than computed here. A number this
 * process derived would be a client-side counter wearing a server's clothes,
 * and it would be wrong the moment another tab settled a turn of its own.
 */
export interface TurnSettlement {
  settled: 'consume' | 'release' | 'none'
  quota: AnonymousChatQuota | null
}

const NOT_METERED: TurnAllowance = { kind: 'not_metered' }

/**
 * Hold one turn for a signed-out visitor.
 *
 * The reservation id is minted HERE and returned, so the caller settles the
 * reservation it actually took. Letting the Brain mint one and reading it back
 * would leave a window in which a hold exists that this process cannot name —
 * and an unnameable hold is one the visitor pays for until it expires.
 */
export async function reserveTurnFor(
  principal: Principal,
  conversationId?: string,
): Promise<TurnAllowance> {
  if (principal.kind !== 'anonymous') return NOT_METERED

  const reservationId = randomUUID()
  const result = await reserveAnonymousTurn(reservationId, conversationId, { principal })

  if (result.kind === 'ok') {
    const quota = result.value.quota
    if (result.value.ok) return { kind: 'reserved', reservationId, quota }
    // Defensive: a 200 that is not `ok` is not a shape the Brain emits today,
    // and treating it as permission would be the one wrong reading.
    return { kind: 'exhausted', quota }
  }

  // 429 is the exhausted answer and carries the quota. It is deliberately not a
  // 403: the visitor is not forbidden, they are out of turns, and signing in
  // changes that — which is a different sentence and a different button.
  if (result.kind === 'brain_error' && result.status === 429) {
    const quota = quotaFrom(result.body)
    if (quota) return { kind: 'exhausted', quota }
  }

  return { kind: 'unavailable', ...unavailableReason(result) }
}

/**
 * Close a reservation, and report the authoritative remaining count.
 *
 * IDEMPOTENT BY DESIGN. The Brain answers 409 when a reservation is no longer
 * held — already settled, or never taken — and that is treated as success here.
 * A retried settle must not charge twice, and it must not fail a turn whose
 * only remaining job is to tell the user how many they have left.
 */
export async function settleTurnFor(
  principal: Principal,
  input: { reservationId: string; producedOutput: boolean; failure?: string },
): Promise<TurnSettlement> {
  if (principal.kind !== 'anonymous') return { settled: 'none', quota: null }

  const result = await settleAnonymousTurn(input, { principal })
  const settled: TurnSettlement['settled'] = input.producedOutput ? 'consume' : 'release'

  if (result.kind !== 'ok' && !(result.kind === 'conflict')) {
    // The settlement failed for a reason other than "already settled". Nothing
    // is invented: the caller gets no quota rather than a guess, and an
    // unsettled hold expires on its own instead of being charged forever.
    console.warn(
      '[anonymous] settle failed',
      JSON.stringify({ kind: result.kind, producedOutput: input.producedOutput }),
    )
    return { settled, quota: null }
  }

  return { settled, quota: await currentQuota(principal) }
}

/** The visitor's allowance, straight from the Brain. Null when unavailable. */
export async function currentQuota(principal: Principal): Promise<AnonymousChatQuota | null> {
  if (principal.kind !== 'anonymous') return null
  const result = await anonymousQuota({ principal })
  return result.kind === 'ok' ? (result.value.quota ?? null) : null
}

/** The quota the Brain attached to a refusal body, if it really is one. */
function quotaFrom(body: unknown): AnonymousChatQuota | null {
  const parsed =
    typeof body === 'string'
      ? (() => {
          try {
            return JSON.parse(body) as { quota?: unknown }
          } catch {
            return null
          }
        })()
      : (body as { quota?: unknown } | null)

  const quota = parsed?.quota as AnonymousChatQuota | undefined
  return quota && typeof quota.remaining === 'number' ? quota : null
}

/**
 * Why the allowance could not be established, in the user's terms.
 *
 * Each cause is kept distinct because they lead somewhere different: storage
 * being down is temporary and not the visitor's fault, while a build that
 * cannot speak to this Brain is an operator problem no amount of retrying
 * fixes.
 */
function unavailableReason(result: BrainResult<unknown>): {
  status: number
  error: string
  message: string
} {
  switch (result.kind) {
    case 'transport_failure':
    case 'timeout':
      return {
        status: 503,
        error: 'quota_unavailable',
        message:
          'Free messages could not be checked right now, so nothing was sent. Try again shortly.',
      }
    case 'not_found':
      return {
        status: 503,
        error: 'quota_unsupported',
        message:
          'Chatting without an account is not available on this server yet. Sign in to continue.',
      }
    default: {
      const status = 'status' in result ? result.status : 0
      if (status === 503) {
        return {
          status: 503,
          error: 'quota_unavailable',
          message:
            'Free messages could not be checked right now, so nothing was sent. Nothing was lost. Try again shortly.',
        }
      }
      return {
        status: 502,
        error: 'quota_unavailable',
        message: 'Free messages could not be checked right now, so nothing was sent.',
      }
    }
  }
}
