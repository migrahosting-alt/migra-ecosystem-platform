/**
 * Serve one stored image back to the person who owns it.
 *
 * WHY THIS EXISTS. A composer that shows a filename and calls it an attachment is
 * asking the user to trust that the right picture was picked. A thumbnail is the
 * only honest confirmation, and it needs the bytes.
 *
 * SCOPE COMES FROM THE SESSION, NEVER THE URL. `readImageBytes` reads inside the
 * authenticated caller's own directory and re-checks the stored hash, so this
 * route cannot be pointed at someone else's library by editing an id — and a file
 * that changed underneath its metadata is not served at all.
 *
 * NOT FOUND COVERS EVERY REASON. Deleted, never stored, someone else's, or
 * failing its hash: all 404. Distinguishing them would tell a caller whether an
 * id exists in another account.
 */

import { requireSession } from '@/server/auth'
import { UnauthenticatedError } from '@/server/auth/authPort'
import { isImageId } from '@/server/files/images'
import { deleteImage, readImageBytes } from '@/server/files/imageStore'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession()
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return Response.json({ error: 'unauthenticated' }, { status: 401 })
    }
    throw error
  }

  const { id } = await context.params
  // Refused before the store is asked: anything not of this shape did not come
  // from here, and looking it up invites a path to be read as a name.
  if (!isImageId(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const found = await readImageBytes(id)
  if (!found) return Response.json({ error: 'not_found' }, { status: 404 })

  return new Response(new Uint8Array(found.bytes), {
    headers: {
      'content-type': found.meta.mime,
      'content-length': String(found.bytes.byteLength),
      /*
       * Immutable because the id IS the content hash: these bytes cannot change
       * without becoming a different id. `private` because the image belongs to
       * one account and must never be held in a shared cache.
       */
      'cache-control': 'private, max-age=31536000, immutable',
      'content-disposition': 'inline',
      // The bytes are user-supplied; never let a browser re-interpret the type.
      'x-content-type-options': 'nosniff',
    },
  })
}


/**
 * Remove one image from the caller's library.
 *
 * DELETING FROM THE LIBRARY IS NOT DETACHING FROM A CONVERSATION. Those are
 * different acts with different consequences, and conflating them would make
 * "remove this from the message" quietly destroy an image used elsewhere. This
 * is the destructive one: the bytes, the derived model copy and the record all
 * go, and a message that referenced the ref will stop resolving it.
 *
 * SCOPE COMES FROM THE SESSION, exactly as it does for reads: `deleteImage`
 * works inside the authenticated caller's own directory, so this cannot be
 * pointed at another account's library by editing an id.
 *
 * A MISSING IMAGE IS 404, NOT SUCCESS. Reporting "deleted" for something that
 * was never there tells the caller their delete worked on someone else's id.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireSession()
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return Response.json({ error: 'unauthenticated' }, { status: 401 })
    }
    throw error
  }

  const { id } = await context.params
  if (!isImageId(id)) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const removed = await deleteImage(id)
  if (!removed) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  return Response.json({ ok: true, imageId: id })
}
