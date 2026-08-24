import 'server-only'

import { createHash } from 'node:crypto'

/**
 * Image intake rules — pure, so the parts that must never be wrong are testable
 * without a filesystem.
 *
 * WHY IMAGES ARE NOT JUST ANOTHER ALLOWED EXTENSION. The text library exists to
 * be READ by the RAG indexer; its allowlist is "what the indexer can turn into
 * useful chunks", which is why PDF and Office are refused there. An image is the
 * opposite kind of object: it must reach a vision model as BYTES and must never
 * enter the text chunk path at all. Sharing one allowlist would have made
 * "allowed" mean two different things.
 *
 * THE EXTENSION IS NOT THE AUTHORITY. A file named `.png` carrying a zip is
 * still a zip, and handing it to a vision model as an image is a decoding bug at
 * best. Every accepted image is confirmed by its MAGIC BYTES, and the sniffed
 * type must also agree with the extension — a `.png` holding real JPEG bytes is
 * rejected rather than silently renamed, because a mismatch means something
 * upstream is wrong and guessing which half to trust hides it.
 */

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

/** The only image types accepted at intake. */
export const IMAGE_EXTENSIONS = ['gif', 'jpeg', 'jpg', 'png', 'webp'] as const

/** Images are bounded separately: a photo is legitimately larger than a text note. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024

const EXTENSION_MIME: Record<string, ImageMime> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

const startsWith = (bytes: Uint8Array, sig: readonly number[], offset = 0): boolean =>
  sig.every((b, i) => bytes[offset + i] === b)

/**
 * What the bytes ACTUALLY are, or null.
 *
 * Signatures only — no decoding, no library. This runs on every upload and must
 * not become an attack surface of its own; reading twelve bytes cannot be made
 * to execute anything.
 */
export function sniffImageMime(data: Uint8Array): ImageMime | null {
  if (data.length < 12) return null

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  // JPEG: FF D8 FF
  if (startsWith(data, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  // GIF87a / GIF89a
  if (startsWith(data, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'
  // WEBP: "RIFF" .... "WEBP" — the size field between them is not fixed, so both
  // halves are checked at their own offsets rather than as one run.
  if (startsWith(data, [0x52, 0x49, 0x46, 0x46]) && startsWith(data, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp'
  }
  return null
}

export interface ImageRejection {
  code: 'unsupported_type' | 'not_an_image' | 'type_mismatch' | 'too_large' | 'empty_file'
  message: string
}

export interface AcceptedImage {
  mime: ImageMime
  extension: string
  /** Canonical, opaque, content-addressed. Never a path, never a client name. */
  id: string
  /** What is written to disk: `<id>.<ext>`. */
  storedName: string
  sha256: string
  bytes: number
}

/**
 * A canonical id derived from CONTENT.
 *
 * Content-addressing gives three things at once: an identifier the client cannot
 * choose, natural de-duplication when the same photo is attached twice, and a
 * hash already available for provenance logging. The `img_` prefix makes the ref
 * self-describing in a log line, and the fixed shape means a resolver can reject
 * anything malformed before it touches the filesystem.
 */
export function imageIdFor(sha256: string): string {
  return `img_${sha256.slice(0, 32)}`
}

/** Strict shape check for a ref arriving from a client. */
export const IMAGE_ID_PATTERN = /^img_[0-9a-f]{32}$/

export function isImageId(value: unknown): value is string {
  return typeof value === 'string' && IMAGE_ID_PATTERN.test(value)
}

export function extensionOfImage(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * Decide whether these bytes may be stored as an image, and under what identity.
 *
 * Returns a rejection rather than throwing: the caller reports the server's own
 * words to the user, and every branch here has a reason worth reading.
 */
export function acceptImage(
  rawName: string,
  data: Uint8Array,
): { ok: true; image: AcceptedImage } | { ok: false; rejection: ImageRejection } {
  const extension = extensionOfImage(rawName)
  const declared = EXTENSION_MIME[extension]

  if (!declared) {
    return {
      ok: false,
      rejection: {
        code: 'unsupported_type',
        message: `Images must be ${IMAGE_EXTENSIONS.map((e) => `.${e}`).join(', ')}.`,
      },
    }
  }
  if (data.byteLength === 0) {
    return { ok: false, rejection: { code: 'empty_file', message: 'That image is empty.' } }
  }
  if (data.byteLength > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      rejection: {
        code: 'too_large',
        message: `Images are limited to ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`,
      },
    }
  }

  const sniffed = sniffImageMime(data)
  if (!sniffed) {
    return {
      ok: false,
      rejection: {
        code: 'not_an_image',
        message: 'That file is not a readable image. Try PNG, JPEG, GIF or WebP.',
      },
    }
  }

  /*
   * A MISMATCH IS REFUSED, NOT CORRECTED. Trusting the bytes and renaming the
   * file would quietly accept a mislabelled upload; trusting the name would hand
   * a vision model something it cannot decode. Either way something upstream is
   * wrong, and the only honest answer is to say so.
   */
  if (sniffed !== declared) {
    return {
      ok: false,
      rejection: {
        code: 'type_mismatch',
        message: `That file is named .${extension} but its contents are ${sniffed.replace('image/', '')}. Rename it to match, or re-export it.`,
      },
    }
  }

  const sha256 = createHash('sha256').update(data).digest('hex')
  const id = imageIdFor(sha256)
  // Stored under the CANONICAL name. The client's filename is kept only as
  // display metadata elsewhere; it never decides where bytes land.
  const canonicalExtension = sniffed === 'image/jpeg' ? 'jpg' : sniffed.replace('image/', '')

  return {
    ok: true,
    image: { mime: sniffed, extension: canonicalExtension, id, storedName: `${id}.${canonicalExtension}`, sha256, bytes: data.byteLength },
  }
}
