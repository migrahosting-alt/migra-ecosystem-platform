/**
 * THE CONVERSATION'S PROJECT, as the consumer sees it.
 *
 *   GET    → what this conversation is using, or why it is using nothing
 *   POST   → connect one, by id
 *   DELETE → stop using it
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE BODY IS `{ projectId }` AND THERE IS NOWHERE TO PUT ANYTHING ELSE
 *
 * No root path, no permission, no authority kind. A client that could send
 * those would be granting itself access, and the Brain would be trusting a
 * claim rather than resolving a grant. Everything about what the caller may do
 * is looked up server-side, on every use.
 *
 * ---------------------------------------------------------------------------
 * THE NEGATIVE STATES ARE FIVE DIFFERENT FACTS
 *
 * They are easy to collapse into "no projects" and each collapse sends the user
 * somewhere useless:
 *
 *   nothing available    → a truthful empty state; there is nothing to choose
 *   access revoked       → ask for access; RECONNECTING WILL FAIL THE SAME WAY
 *   project deleted      → connect a different one; asking for access is futile
 *   backend unreachable  → try again; the user's access is fine and saying
 *                          "no projects" would be a lie about their entitlement
 *   not signed in        → sign in; an empty state here would suggest they have
 *                          no projects when we simply do not know who they are
 *
 * Only the Brain can tell the first three apart, so this route passes its
 * decision through and speaks for itself ONLY about the last two — which are
 * the two things the Brain could not know.
 * ---------------------------------------------------------------------------
 */

import { callBrain } from '@/server/brain/gateway'
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'

export const dynamic = 'force-dynamic'

const fail = (status: number, error: string, message: string, remedy?: string): Response =>
  Response.json({ connected: false, error, message, ...(remedy ? { remedy } : {}) }, { status })

/** The two things the consumer alone knows. Everything else is the Brain's. */
const UNAUTHENTICATED = () =>
  fail(401, 'unauthenticated', 'Sign in to connect a project.', 'sign-in')

const UNREACHABLE = () =>
  fail(
    503,
    'brain_unavailable',
    // NOT "no projects available" — that would be a claim about their
    // entitlement, and we do not know it right now.
    'The assistant service is unreachable right now, so your projects could not be loaded. Try again shortly.',
    'retry',
  )

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params
  const resolved = await resolveRequestPrincipal()
  if (!resolved) return UNAUTHENTICATED()

  const result = await callBrain(
    { kind: 'conversationProject', conversationId: id },
    { principal: resolved.principal },
  )
  if (result.kind !== 'ok') {
    if (result.kind === 'transport_failure' || result.kind === 'timeout') return UNREACHABLE()
    if (result.kind === 'forbidden_for_principal') {
      return fail(403, 'forbidden', 'You do not have access to this conversation.', 'request-read-access')
    }
    return fail(502, 'brain_error', 'Your project could not be checked.', 'retry')
  }
  // Passed through as decided: connected/message/remedy are the Brain's words.
  return Response.json(result.value)
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params
  const resolved = await resolveRequestPrincipal()
  if (!resolved) return UNAUTHENTICATED()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, 'invalid_body', 'Choose a project to connect.')
  }
  const projectId = (body as { projectId?: unknown })?.projectId
  if (typeof projectId !== 'string' || !projectId) {
    return fail(400, 'invalid_request', 'Choose a project to connect.')
  }

  const result = await callBrain(
    { kind: 'connectProject', conversationId: id, projectId },
    { principal: resolved.principal },
  )
  if (result.kind !== 'ok') {
    if (result.kind === 'transport_failure' || result.kind === 'timeout') return UNREACHABLE()
    /*
     * A 403 from the Brain is a REAL ANSWER about entitlement, not a fault. It
     * carries the wording and the remedy, so it is passed through rather than
     * replaced with a generic failure that would hide "ask for access".
     */
    if (result.kind === 'brain_error' && result.status === 403) {
      return Response.json(result.body, { status: 403 })
    }
    if (result.kind === 'forbidden_for_principal') {
      return fail(403, 'forbidden', 'You do not have access to that project.', 'request-read-access')
    }
    return fail(502, 'brain_error', 'That project could not be connected.', 'retry')
  }
  return Response.json(result.value)
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params
  const resolved = await resolveRequestPrincipal()
  if (!resolved) return UNAUTHENTICATED()

  const result = await callBrain(
    { kind: 'disconnectProject', conversationId: id },
    { principal: resolved.principal },
  )
  if (result.kind !== 'ok') {
    if (result.kind === 'transport_failure' || result.kind === 'timeout') return UNREACHABLE()
    return fail(502, 'brain_error', 'That project could not be disconnected.', 'retry')
  }
  return Response.json(result.value)
}
