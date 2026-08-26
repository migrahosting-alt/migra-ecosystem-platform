/**
 * Replace the documents a conversation is grounded in.
 *
 * WHY THIS EXISTS. A user could attach a document to a conversation and then
 * never remove it: images had `detachConversationImage`, documents had nothing,
 * so the only way to stop a file grounding future answers was to delete it from
 * the library entirely — losing the document to get rid of the context.
 *
 * PUT, NOT DELETE-ONE, mirroring the images route: the whole set is sent, so a
 * retry or a race cannot leave a conversation grounded in something nobody
 * chose, and "what is this conversation about" has exactly one answer.
 *
 * DETACHING IS NOT DELETING, and it is not history either. The file stays in the
 * library, and the message that attached it keeps its own record — the
 * transcript must not rewrite itself to match today's context.
 */

import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'
import { setConversationGrounding } from '@/server/brain/seams'

export const dynamic = 'force-dynamic'

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const resolved = await resolveRequestPrincipal()
  if (!resolved) {
    return Response.json(
      { error: 'unauthenticated', message: 'Sign in to manage your conversations.' },
      { status: 401 },
    )
  }

  const body = (await request.json().catch(() => null)) as { files?: unknown } | null
  const files = body?.files
  if (!Array.isArray(files) || files.some((f) => typeof f !== 'string')) {
    return Response.json(
      { error: 'invalid_body', message: 'A `files` array of file names is required.' },
      { status: 400 },
    )
  }
  /*
   * A NAME, NOT A PATH. Validated here as well as in the Brain: this is the last
   * place before durable state that knows what a library file name looks like,
   * and anything with a separator did not come from a file library.
   */
  if (files.some((f) => (f as string).trim().length === 0 || /[\\/]/.test(f as string))) {
    return Response.json(
      { error: 'invalid_ref', message: 'Every entry must be a library file name.' },
      { status: 400 },
    )
  }

  const { id } = await context.params
  const result = await setConversationGrounding(id, files as string[], { principal: resolved.principal })
  if (result.kind !== 'ok') {
    return Response.json({ error: 'brain_error' }, { status: 502 })
  }
  return Response.json({ ok: true, files })
}
