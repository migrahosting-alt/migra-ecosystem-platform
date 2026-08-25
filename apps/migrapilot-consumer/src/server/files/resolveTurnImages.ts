import 'server-only'

import sharp from 'sharp'

import { readImageBytes } from '@/server/files/imageStore'
import { isImageId } from '@/server/files/images'

/**
 * The longest edge the model is asked to look at.
 *
 * MEASURED, NOT GUESSED. A 12MP phone photo (4032x3024, 8.6 MB) took 28.4s to
 * first token on the live path; the same picture capped to 1568px took 3.56s,
 * to 1024px 1.94s, to 768px 1.69s. Prefill on a vision model scales with image
 * tokens, and a full-resolution photo is thousands of them — that difference was
 * the whole of the "it takes almost a minute" report, not the network, not the
 * proxy, and not model load.
 *
 * 1024 is the balance point: about fifteen times faster than the original while
 * still legible for the case this feature exists for, reading a screenshot. Text
 * far below that size was never going to survive the model's own tiling anyway.
 *
 * THE STORED IMAGE IS NOT TOUCHED. This resizes only the copy handed to the
 * model; the library keeps the original bytes, its hash stays valid, and the
 * thumbnail the user sees is still their real picture.
 */
export const MODEL_IMAGE_MAX_EDGE = 1024

/**
 * Turn opaque image refs into bytes the Brain may hand to a model.
 *
 * WHERE THE TRUST BOUNDARY SITS. The browser sends `img_*` and nothing else — no
 * filename, no path, no bytes. The scope comes from the authenticated session,
 * `readImageBytes` reads only inside that scope's own directory, and it re-checks
 * the stored hash before returning: a file that changed underneath its metadata
 * is not the image the record describes, and attaching a model's answer to the
 * wrong provenance is worse than failing.
 *
 * ORDER IS PRESERVED because it is meaning. "Compare the first with the second"
 * is a different question if the two arrive swapped, and the model sees only the
 * sequence it is given.
 *
 * BYTES ARE TRANSPORT, REFS ARE IDENTITY. What travels here lives for one turn.
 * What persists on the conversation is the ref, which still resolves tomorrow.
 */

export interface ResolvedTurnImage {
  /** The ref itself, used as the attachment name — never the user's filename. */
  name: string
  mimeType: string
  dataBase64: string
  sizeBytes: number
}

export type ImageResolutionFailure = 'not_an_image_ref' | 'not_found'

export interface TurnImageResolution {
  attachments: ResolvedTurnImage[]
  /** Refs that no longer resolve, so the caller can drop them from the thread. */
  dropped: { ref: string; reason: ImageResolutionFailure }[]
}

export async function resolveTurnImages(refs: readonly string[]): Promise<TurnImageResolution> {
  const attachments: ResolvedTurnImage[] = []
  const dropped: { ref: string; reason: ImageResolutionFailure }[] = []

  for (const ref of refs) {
    if (!isImageId(ref)) {
      // Refused rather than looked up: anything not of this shape did not come
      // from this store, and asking the store about it invites a path to be
      // interpreted as a name.
      dropped.push({ ref, reason: 'not_an_image_ref' })
      continue
    }

    const found = await readImageBytes(ref)
    if (!found) {
      /*
       * Deleted, never stored, belonging to someone else, or failing its hash
       * check — all the same answer here on purpose. Distinguishing them would
       * tell a caller whether an id exists in someone else's library.
       */
      dropped.push({ ref, reason: 'not_found' })
      continue
    }

    const prepared = await forModel(found.bytes, found.meta.mime, found.meta.width, found.meta.height)
    attachments.push({
      name: ref,
      mimeType: prepared.mime,
      dataBase64: prepared.bytes.toString('base64'),
      sizeBytes: prepared.bytes.byteLength,
    })
  }

  return { attachments, dropped }
}

/**
 * The copy the model sees.
 *
 * FORMAT IS PRESERVED. A screenshot arrives as PNG because its text is sharp,
 * and re-encoding it as JPEG to save bytes would blur the very characters the
 * user is asking about. Small images are passed through untouched rather than
 * re-encoded, so nothing is degraded for no gain.
 *
 * A RESIZE FAILURE IS NOT A TURN FAILURE. If sharp cannot read it, the original
 * bytes go as they are: slower, and still correct.
 */
async function forModel(
  bytes: Buffer,
  mime: string,
  width: number,
  height: number,
): Promise<{ bytes: Buffer; mime: string }> {
  if (Math.max(width, height) <= MODEL_IMAGE_MAX_EDGE) return { bytes, mime }
  try {
    const pipeline = sharp(bytes).resize({
      width: MODEL_IMAGE_MAX_EDGE,
      height: MODEL_IMAGE_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    const resized =
      mime === 'image/png'
        ? await pipeline.png({ compressionLevel: 6 }).toBuffer()
        : mime === 'image/webp'
          ? await pipeline.webp({ quality: 88 }).toBuffer()
          : await pipeline.jpeg({ quality: 88 }).toBuffer()
    // A "smaller" copy that is larger than the original helps nobody.
    return resized.byteLength < bytes.byteLength ? { bytes: resized, mime } : { bytes, mime }
  } catch {
    return { bytes, mime }
  }
}
