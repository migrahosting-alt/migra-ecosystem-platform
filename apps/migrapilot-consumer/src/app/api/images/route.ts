/**
 * Image upload — deliberately thin.
 *
 * Every rule that decides whether bytes may be stored lives in
 * `server/files/imageStore.ts` and `server/files/images.ts`: MIME sniffing,
 * dimension bounds, quota, tenancy, atomicity, de-duplication. This route
 * authenticates, checks the SHAPE of the request, and delegates. Duplicating any
 * of that here would create a second answer to the same question, and the two
 * would drift — which is the bug the client-side filename mirror already taught
 * this codebase once.
 *
 * WHAT IT RETURNS IS AN OPAQUE REFERENCE. No path, no storage root, no owner
 * key, no directory bucket. The browser learns an `img_*` id, the facts about
 * the image it just sent, and whether anything can currently read it.
 */

import { requireSession } from '@/server/auth'
import { UnauthenticatedError } from '@/server/auth/authPort'
import { IMAGE_EXTENSIONS, MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS } from '@/server/files/images'
import {
  ImageRejected,
  MAX_IMAGES,
  MAX_IMAGE_LIBRARY_BYTES,
  deleteImage,
  imageUsage,
  listImages,
  saveImage,
} from '@/server/files/imageStore'
import { MAX_IMAGE_BYTES } from '@/server/files/images'
import { visionCapability } from '@/server/files/visionCapability'

export const dynamic = 'force-dynamic'

const fail = (status: number, error: string, message: string): Response =>
  Response.json({ error, message }, { status })

async function guard(): Promise<Response | null> {
  try {
    await requireSession()
    return null
  } catch (error) {
    if (error instanceof UnauthenticatedError) return fail(401, 'unauthenticated', 'Sign in to add images.')
    throw error
  }
}

/**
 * Only what the browser may know.
 *
 * `ownerScope` and the storage layout stay server-side: the id is the only
 * handle a client needs, and anything more is a detail it could come to depend
 * on.
 */
const publicView = (image: Awaited<ReturnType<typeof saveImage>>) => ({
  imageId: image.id,
  mime: image.mime,
  width: image.width,
  height: image.height,
  bytes: image.bytes,
  createdAt: image.createdAt,
  displayName: image.displayName,
})

export async function GET(): Promise<Response> {
  const denied = await guard()
  if (denied) return denied

  const [images, usage, vision] = await Promise.all([listImages(), imageUsage(), visionCapability()])
  return Response.json({
    images: images.map(publicView),
    usage: { count: usage.count, bytes: usage.bytes },
    limits: {
      maxImageBytes: MAX_IMAGE_BYTES,
      maxLibraryBytes: MAX_IMAGE_LIBRARY_BYTES,
      maxImages: MAX_IMAGES,
      maxDimension: MAX_IMAGE_DIMENSION,
      maxPixels: MAX_IMAGE_PIXELS,
      allowedExtensions: IMAGE_EXTENSIONS,
    },
    vision,
  })
}

export async function POST(request: Request): Promise<Response> {
  const denied = await guard()
  if (denied) return denied

  /*
   * A CEILING BEFORE THE BODY IS BUFFERED, where the caller declares one.
   * `formData()` reads the whole request into memory, so a declared length far
   * beyond any acceptable image is refused before that happens. It is not a
   * substitute for the real limit — a client can lie or omit it, and the store
   * still enforces the true bound on the actual bytes — but it costs nothing and
   * turns the obvious case into a cheap rejection.
   */
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES * 1.2) {
    return fail(413, 'too_large', `Images are limited to ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`)
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail(400, 'invalid_body', 'Expected a multipart upload.')
  }

  const entry = form.get('image')
  if (!(entry instanceof File)) return fail(400, 'no_image', 'No image was provided.')

  try {
    const stored = await saveImage(entry.name, await entry.arrayBuffer())
    /*
     * CAPABILITY TRAVELS WITH THE RESULT. "Saved" and "can be read" are separate
     * facts, and a UI that treats the first as the second will promise something
     * the Brain will refuse. The answer comes from the Brain's own registry.
     */
    const vision = await visionCapability()
    return Response.json({ image: publicView(stored), vision }, { status: 201 })
  } catch (error) {
    if (error instanceof ImageRejected) {
      // The store's own code and words: it knows which limit was hit.
      const status = error.code === 'too_large' || error.code === 'dimensions_too_large' ? 413
        : error.code === 'library_full' || error.code === 'too_many_images' ? 507
        : 400
      return fail(status, error.code, error.message)
    }
    /*
     * An unexpected failure is reported as a WRITE failure rather than as a
     * rejection, because the store guarantees it left nothing behind — saying
     * "rejected" would imply the upload was refused on its merits.
     */
    return fail(500, 'write_failed', 'That image could not be saved. Nothing was stored.')
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const denied = await guard()
  if (denied) return denied

  const imageId = new URL(request.url).searchParams.get('imageId')
  if (!imageId) return fail(400, 'no_image_id', 'An image id is required.')

  /*
   * LIBRARY DELETION. Detaching an image from one conversation is a different
   * act and belongs to the conversation — see `imageStore.deleteImage`.
   */
  const removed = await deleteImage(imageId)
  if (!removed) return fail(404, 'not_found', 'That image is not in your library.')
  return Response.json({ deleted: imageId })
}
