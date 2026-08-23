/**
 * One conversation: rename it, or delete it.
 *
 * The Brain has served both since Phase 1 and the product could reach neither,
 * so every thread a person started was permanent and stuck with whatever title
 * was cut from its first line. That is not a missing nicety — a chat history you
 * cannot curate stops being useful at about thirty entries, and a thread you
 * cannot delete is a thing you cannot take back.
 *
 * DELETE IS THE DANGEROUS ONE, so it is the one with the least room to be
 * ambiguous: the id comes from the path, tenancy is derived server-side, and a
 * conversation belonging to someone else is a 404 — not a 403, which would
 * confirm that the id exists.
 *
 * Both are ACCOUNT operations. A signed-out visitor is refused here for the same
 * reason the gateway refuses them: managing a durable history is what an account
 * is for, and the audience table says so in one place rather than each route
 * guessing. The UI does not offer the controls to a visitor, so the refusal is a
 * backstop rather than a dead end someone walks into.
 */

import { deleteConversation, renameConversation } from '@/server/brain/seams'
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'
import type { ConversationSummary } from '@/server/brain/contracts'

export const dynamic = 'force-dynamic'

const fail = (status: number, error: string, message: string): Response =>
  Response.json({ error, message }, { status })

/** One mapping for both verbs, so rename and delete cannot drift apart. */
function refusal(kind: string): { status: number; error: string; message: string } {
  switch (kind) {
    case 'unauthenticated':
      return { status: 401, error: 'unauthenticated', message: 'Sign in to manage your conversations.' }
    case 'forbidden_for_principal':
      return {
        status: 403,
        error: 'requires_account',
        message: 'Renaming and deleting conversations needs an account.',
      }
    case 'not_found':
      return { status: 404, error: 'not_found', message: 'That conversation no longer exists.' }
    case 'invalid_operation':
      return { status: 400, error: 'invalid_request', message: 'That is not a valid conversation.' }
    case 'transport_failure':
    case 'timeout':
      return { status: 503, error: 'brain_unreachable', message: 'The assistant service is unreachable right now.' }
    default:
      return { status: 502, error: 'brain_error', message: 'That change could not be saved.' }
  }
}

export async function PATCH(
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

  const raw = (body as { title?: unknown })?.title
  const title = typeof raw === 'string' ? raw.trim() : ''
  if (!title) {
    // An empty title would render as a blank row in the sidebar — a conversation
    // the user can no longer identify. Refusing is kinder than accepting it.
    return fail(400, 'invalid_title', 'A conversation needs a name.')
  }
  if (title.length > 200) {
    return fail(400, 'invalid_title', 'That name is too long — keep it under 200 characters.')
  }

  const result = await renameConversation(id, title, { principal: resolved.principal })
  if (result.kind !== 'ok') {
    const r = refusal(result.kind)
    return fail(r.status, r.error, r.message)
  }

  const renamed = result.value as ConversationSummary
  return Response.json({ id, title: renamed?.title ?? title })
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params

  const resolved = await resolveRequestPrincipal()
  if (!resolved) return fail(401, 'unauthenticated', 'Sign in to manage your conversations.')

  const result = await deleteConversation(id, { principal: resolved.principal })
  if (result.kind !== 'ok') {
    /*
     * A conversation that is ALREADY gone is a success, not a failure. Deleting
     * twice — a double click, a retry after a dropped response — must leave the
     * user where they wanted to be rather than showing an error about a thread
     * that is exactly as absent as they asked for.
     */
    if (result.kind === 'not_found') return Response.json({ id, deleted: true })
    const r = refusal(result.kind)
    return fail(r.status, r.error, r.message)
  }

  return Response.json({ id, deleted: true })
}
