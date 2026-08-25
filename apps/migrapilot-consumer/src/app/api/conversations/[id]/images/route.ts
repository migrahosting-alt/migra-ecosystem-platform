/**
 * Replace the images a conversation is about.
 *
 * PUT, not DELETE-one: the whole set is sent, so a retry or a race cannot leave a
 * thread about a picture nobody chose, and "what is this conversation about" has
 * one answer at any moment. The same discipline the grounding set uses.
 *
 * REFS ONLY. The browser sends `img_*` and the Brain stores `img_*`; bytes never
 * enter this path, and the scope comes from the authenticated session rather than
 * anything in the request.
 */

import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'
import { setConversationImages } from '@/server/brain/seams'
import { isImageId } from '@/server/files/images'

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

  const body = (await request.json().catch(() => null)) as { images?: unknown } | null
  const images = body?.images
  if (!Array.isArray(images) || images.some((r) => typeof r !== 'string')) {
    return Response.json(
      { error: 'invalid_body', message: 'An `images` array of image refs is required.' },
      { status: 400 },
    )
  }
  /*
   * Validated HERE as well as in the Brain. This is the last place before durable
   * state that knows what an image ref looks like, and a value that is not one
   * could never resolve to bytes on any later turn.
   */
  if (images.some((r) => !isImageId(r as string))) {
    return Response.json(
      { error: 'invalid_ref', message: 'Every entry must be an image reference.' },
      { status: 400 },
    )
  }

  const { id } = await context.params
  const result = await setConversationImages(id, images as string[], { principal: resolved.principal })
  if (result.kind !== 'ok') {
    return Response.json({ error: 'brain_error' }, { status: 502 })
  }
  return Response.json({ ok: true, images })
}
