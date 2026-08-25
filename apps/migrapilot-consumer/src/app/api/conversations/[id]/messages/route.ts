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
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'
import type { ConversationMessage } from '@/server/brain/contracts'

export const dynamic = 'force-dynamic'

/** `img_` followed by 32 hex characters. Anything else never becomes a URL. */
const IMAGE_REF = /^img_[0-9a-f]{32}$/
const canonicalRefs = (refs: string[] | undefined): string[] =>
  (refs ?? []).filter((r) => typeof r === 'string' && IMAGE_REF.test(r))

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params

  /*
   * Resolved once, and honoured for signed-out visitors too — this is what a
   * reload reads to put an anonymous thread back on screen.
   *
   * An OLD anonymous cookie fails here in exactly the right way: once a
   * conversation has been claimed its rows live under the account's scope, so a
   * replayed cookie derives a scope the Brain finds nothing in, and the answer
   * is a 404 that does not distinguish "gone" from "not yours".
   */
  const resolved = await resolveRequestPrincipal()
  if (!resolved) {
    return Response.json({ error: 'unauthenticated', message: 'Sign in to view this conversation.' }, { status: 401 })
  }

  const result = await listMessages(id, { principal: resolved.principal })

  if (result.kind === 'unauthenticated') {
    return Response.json({ error: 'unauthenticated', message: 'Sign in to view this conversation.' }, { status: 401 })
  }

  if (result.kind === 'forbidden_for_principal') {
    return Response.json({ error: 'requires_account', message: result.detail }, { status: 403 })
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
        /*
         * This projection is an ALLOWLIST, so a field added upstream is dropped
         * here silently — the exact way `groundingFiles` was lost once already.
         * The transcript's pictures come from the message's own record and
         * nowhere else, so this line is what makes them survive a reload.
         */
        /*
         * Filtered to the canonical shape at the LAST hop before the browser.
         * The client turns a ref straight into `/api/images/<ref>`, so anything
         * else becomes a request that 404s and renders as a broken icon beside a
         * filename — which a user reads as "the attachment is there but broken".
         */
        ...(canonicalRefs(message.imageRefs).length
          ? { imageRefs: canonicalRefs(message.imageRefs) }
          : {}),
      })),
  })
}
