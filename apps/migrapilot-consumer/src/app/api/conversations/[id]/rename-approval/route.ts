/**
 * The rename APPROVAL ROUND-TRIP, as the consumer sees it.
 *
 *   POST { step: 'propose' }   → the exact normalized action text + an opaque token
 *   POST { step: 'decline' }   → nothing is changed, ever
 *   POST { step: 'dispatch' }  → the Brain re-checks every gate, then renames once
 *
 * ---------------------------------------------------------------------------
 * THIS ROUTE REINTERPRETS NOTHING
 *
 * The Brain already decided what happened and said it in a sentence meant for a
 * person. Rewriting that here would give the product two opinions about the same
 * event, and the one further from the decision would eventually win. So the
 * Brain's `status` and `message` pass through, and this file adds only what the
 * consumer alone knows: whether the caller is signed in, and whether the Brain
 * was reachable at all.
 *
 * 🚨 202 IS PRESERVED, NOT NORMALISED. The Brain answers 202 when a rename was
 * dispatched and could not be confirmed. Collapsing that into 200 would read as
 * done, and into 5xx would read as safe to retry; both are lies about a state
 * whose whole point is that we do not know. The status is carried through
 * unchanged.
 * ---------------------------------------------------------------------------
 */

import { callBrain } from '@/server/brain/gateway'
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'

export const dynamic = 'force-dynamic'

const fail = (status: number, error: string, message: string): Response =>
  Response.json({ error, message }, { status })

type Step = 'propose' | 'decline' | 'dispatch'

const STEPS: Step[] = ['propose', 'decline', 'dispatch']

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params

  const resolved = await resolveRequestPrincipal()
  if (!resolved) return fail(401, 'unauthenticated', 'Sign in to manage your conversations.')

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, 'invalid_body', 'Expected a JSON body.')
  }

  const { step, title: rawTitle, approvalToken } = (body ?? {}) as {
    step?: unknown
    title?: unknown
    approvalToken?: unknown
  }

  if (typeof step !== 'string' || !STEPS.includes(step as Step)) {
    return fail(400, 'invalid_request', 'That is not a valid approval step.')
  }
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : ''
  if (!title) return fail(400, 'invalid_title', 'A conversation needs a name.')
  if (title.length > 200) {
    return fail(400, 'invalid_title', 'That name is too long — keep it under 200 characters.')
  }
  if (step !== 'propose' && typeof approvalToken !== 'string') {
    return fail(400, 'invalid_request', 'That approval is no longer available.')
  }

  const operation =
    step === 'propose'
      ? ({ kind: 'proposeRename', conversationId: id, title } as const)
      : step === 'decline'
        ? ({ kind: 'declineRename', approvalToken: approvalToken as string, conversationId: id, title } as const)
        : ({ kind: 'dispatchRename', approvalToken: approvalToken as string, conversationId: id, title } as const)

  const result = await callBrain(operation, { principal: resolved.principal })

  if (result.kind !== 'ok') {
    /*
     * The Brain could not be reached or refused at the transport level. This is
     * the ONLY place the consumer speaks for itself, because it is the only
     * thing the Brain could not tell us.
     */
    if (result.kind === 'transport_failure' || result.kind === 'timeout') {
      return fail(503, 'brain_unreachable', 'The assistant service is unreachable right now.')
    }
    if (result.kind === 'not_found') {
      return fail(404, 'not_found', 'That conversation no longer exists.')
    }
    return fail(502, 'brain_error', 'That change could not be completed.')
  }

  /*
   * Pass the decision through as it was made, INCLUDING the 202. `callBrain`
   * reports ok for any 2xx, so the unknown state is recovered from the payload's
   * own status rather than from a code this layer would have to re-derive.
   */
  const payload = result.value as { status?: string } & Record<string, unknown>
  const httpStatus = payload?.status === 'unknown' ? 202 : 200
  return Response.json(payload, { status: httpStatus })
}
