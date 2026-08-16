/**
 * The durable messages of one conversation.
 *
 * Reopening a conversation reads from the Brain, so what the user sees after a
 * reload is what was actually stored — not what a client happened to keep in
 * memory.
 *
 * A conversation belonging to another principal is a 404 here, not a 403: the
 * Brain scopes by owner, so a foreign id is genuinely not found for this
 * caller, and saying "forbidden" would confirm the id exists.
 */

import { listMessages } from '@/server/brain/seams'
import type { ConversationMessage } from '@/server/brain/contracts'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params

  const result = await listMessages(id)

  if (result.kind === 'unauthenticated') {
    return Response.json({ error: 'unauthenticated', message: 'Sign in to view this conversation.' }, { status: 401 })
  }

  if (result.kind === 'not_found') {
    return Response.json({ error: 'not_found', message: 'That conversation no longer exists.' }, { status: 404 })
  }

  if (result.kind === 'invalid_operation') {
    return Response.json({ error: 'invalid_request', message: result.detail }, { status: 400 })
  }

  if (result.kind !== 'ok') {
    return Response.json(
      { error: 'brain_error', message: 'That conversation could not be loaded.' },
      { status: result.kind === 'transport_failure' ? 503 : 502 },
    )
  }

  const messages = (result.value as { messages?: ConversationMessage[] })?.messages ?? []

  return Response.json({
    messages: messages
      // A turn still being written has no content worth rendering yet.
      .filter((message) => typeof message.content === 'string' && message.content.length > 0)
      .map((message) => ({
        id: message.id ?? null,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt ?? null,
      })),
  })
}
