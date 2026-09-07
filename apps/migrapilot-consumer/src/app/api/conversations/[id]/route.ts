/**
 * One conversation: delete it. (Renaming moved behind the approval round-trip.)
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

import { deleteConversation } from '@/server/brain/seams'
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'

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

/**
 * 🚨 DIRECT RENAME IS REFUSED. Renaming goes through the approval round-trip.
 *
 * This route renamed a conversation on request, with no confirmation and no
 * consent. That is a fine API and a hole in the governance contract the product
 * now claims: the UI asks the user to approve an exact mutation, and this path
 * performed the same mutation without asking anyone. A consent boundary that
 * only one client honours is not a boundary — it is a convention.
 *
 * So there is ONE rename authority in the product, and it is
 * `POST /api/conversations/:id/rename-approval`. Keeping this verb alive as a
 * shortcut would preserve exactly the bypass that was closed.
 *
 * 410, not 404: the endpoint EXISTED and was deliberately withdrawn. A 404 would
 * suggest a wrong URL and send a caller looking for a typo, and the response
 * names the replacement so the fix is obvious rather than archaeological.
 */
export async function PATCH(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  await context.params
  return Response.json(
    {
      error: 'rename_requires_approval',
      message:
        'Renaming a conversation needs your approval. Propose the change first, then confirm it.',
      use: 'POST /api/conversations/:id/rename-approval',
    },
    { status: 410 },
  )
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
