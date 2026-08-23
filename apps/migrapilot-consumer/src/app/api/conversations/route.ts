/**
 * The caller's durable conversations.
 *
 * This is what makes a reload show real history instead of a seeded fiction.
 * The list is whatever the Brain holds for THIS principal — the gateway derives
 * the owner scope from the verified session, so there is no parameter through
 * which a browser could ask for someone else's conversations.
 */

import { listConversations } from '@/server/brain/seams'
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'
import type { ConversationSummary } from '@/server/brain/contracts'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  /*
   * A signed-out visitor has conversations too, and this is what makes a reload
   * show them. Their scope is derived from a signed cookie, so the list is
   * theirs and nobody else's — the same property the session path has.
   */
  const resolved = await resolveRequestPrincipal()
  if (!resolved) return Response.json({ conversations: [] })

  const result = await listConversations({ principal: resolved.principal })

  if (result.kind === 'unauthenticated' || result.kind === 'forbidden_for_principal') {
    // Signed out is not an error state for a list: the shell renders an empty
    // sidebar rather than an alarm.
    return Response.json({ conversations: [] })
  }

  if (result.kind !== 'ok') {
    return Response.json(
      { error: 'brain_error', message: 'Your conversations could not be loaded.' },
      { status: result.kind === 'transport_failure' ? 503 : 502 },
    )
  }

  const conversations = (result.value as { conversations?: ConversationSummary[] })?.conversations ?? []

  // Re-shaped deliberately: `ownerScope` and `workspaceScope` come back on the
  // wire and are tenancy material the browser has no use for.
  return Response.json({
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title ?? 'Untitled',
      updatedAt: conversation.updatedAt ?? conversation.createdAt ?? null,
      /*
       * The files this conversation answers from.
       *
       * Included so the durable state is OBSERVABLE from the product itself. Without
       * it, "does the answer agree with what is stored?" can only be guessed from
       * behaviour, and the two could drift for a long time before anyone noticed —
       * which is exactly how grounding-in-a-React-ref survived until a reload exposed
       * it. Filenames the caller already owns; no tenancy material is added.
       */
      groundingFiles: conversation.groundingFiles ?? [],
    })),
  })
}
