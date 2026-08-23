/**
 * Deleting conversation history.
 *
 * IRREVERSIBLE, SO IT REPORTS HONESTLY. The count returned is what was actually
 * removed, not what was attempted. If some conversations could not be deleted
 * the response says so and names how many remain — a "history cleared" message
 * over a partial delete is the kind of lie a person only discovers when
 * something they thought was gone turns up.
 *
 * Preferences are NOT touched. Deleting what you said is not the same as
 * resetting how you like the product to behave, and conflating them would
 * silently undo settings the user never asked to lose.
 */

import { deleteConversation, listConversations } from '@/server/brain/seams'
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'
import type { ConversationSummary } from '@/server/brain/contracts'

export const dynamic = 'force-dynamic'

export async function DELETE(request: Request): Promise<Response> {
  const resolved = await resolveRequestPrincipal()
  if (!resolved) {
    return Response.json({ error: 'unauthenticated', message: 'Sign in to manage your history.' }, { status: 401 })
  }
  const principal = resolved.principal

  /*
   * A TYPED CONFIRMATION, checked on the SERVER.
   *
   * A client-side "are you sure?" is a rendering choice; anything that can call
   * this route can skip it. The irreversible action requires the word here, so
   * the guarantee does not depend on which screen made the request.
   */
  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = null
  }
  if ((body as { confirm?: unknown })?.confirm !== 'DELETE') {
    return Response.json(
      { error: 'confirmation_required', message: 'This action needs an explicit confirmation.' },
      { status: 400 },
    )
  }

  const listed = await listConversations({ principal })
  if (listed.kind !== 'ok') {
    return Response.json(
      { error: 'unavailable', message: 'Your conversations could not be read, so nothing was deleted.' },
      { status: 503 },
    )
  }

  const conversations = (listed.value as { conversations?: ConversationSummary[] })?.conversations ?? []
  let deleted = 0
  const failed: string[] = []

  for (const conversation of conversations) {
    const result = await deleteConversation(conversation.id, { principal })
    // Already gone counts as deleted: the user asked for absence, and absence is
    // what they have.
    if (result.kind === 'ok' || result.kind === 'not_found') deleted += 1
    else failed.push(conversation.id)
  }

  if (failed.length > 0) {
    return Response.json(
      {
        error: 'partial',
        deleted,
        remaining: failed.length,
        message: `${deleted} conversations were deleted. ${failed.length} could not be, and are still here.`,
      },
      { status: 207 },
    )
  }

  return Response.json({ deleted, remaining: 0 })
}
