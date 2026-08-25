import 'server-only'

import { readImageBytes } from '@/server/files/imageStore'
import { isImageId } from '@/server/files/images'

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

    attachments.push({
      name: ref,
      mimeType: found.meta.mime,
      dataBase64: found.bytes.toString('base64'),
      sizeBytes: found.bytes.byteLength,
    })
  }

  return { attachments, dropped }
}
