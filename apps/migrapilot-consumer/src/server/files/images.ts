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

export interface ImageDimensions {
  width: number
  height: number
}

/**
 * Pixel dimensions, read from the HEADER only.
 *
 * WHY DIMENSIONS ARE A LIMIT AT ALL. Byte size does not bound pixel count: a
 * 2 MB PNG can be 30000×30000, which is a decompression bomb for anything that
 * later decodes it — and a vision model tiles by pixels, so an enormous image is
 * also an enormous inference bill in tokens. Refusing at intake is the only
 * place it costs nothing.
 *
 * NO DECODER IS USED. Each format states its size in a fixed, documented place
 * near the start; reading those few bytes cannot execute anything, which is the
 * whole point of not reaching for an image library on an upload path.
 */
export function readImageDimensions(data: Uint8Array, mime: ImageMime): ImageDimensions | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

  if (mime === 'image/png') {
    // IHDR is the first chunk: width/height are big-endian at 16 and 20.
    if (data.length < 24) return null
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) }
  }

  if (mime === 'image/gif') {
    // Logical screen descriptor, little-endian, immediately after the 6-byte header.
    if (data.length < 10) return null
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }

  if (mime === 'image/jpeg') {
    /*
     * JPEG has no fixed offset: the size lives in a Start-Of-Frame marker that
     * appears after a variable run of other segments. So the marker chain is
     * walked, bounded by the buffer — a malformed file must end the scan, never
     * spin on it.
     */
    let offset = 2
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) { offset += 1; continue }
      const marker = data[offset + 1] ?? 0
      // SOF0..SOF15, excluding the non-frame markers DHT(C4), JPG(C8), DAC(CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: view.getUint16(offset + 5, false), width: view.getUint16(offset + 7, false) }
      }
      const segmentLength = view.getUint16(offset + 2, false)
      if (segmentLength < 2) return null
      offset += 2 + segmentLength
    }
    return null
  }

  if (mime === 'image/webp') {
    // Three container variants, each stating size differently.
    if (data.length < 30) return null
    const fourcc = String.fromCharCode(...data.slice(12, 16))
    if (fourcc === 'VP8X') {
      // 24-bit little-endian, stored as (dimension - 1).
      const w = (data[24]! | (data[25]! << 8) | (data[26]! << 16)) + 1
      const h = (data[27]! | (data[28]! << 8) | (data[29]! << 16)) + 1
      return { width: w, height: h }
    }
    if (fourcc === 'VP8 ') {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    }
    if (fourcc === 'VP8L') {
      const bits = view.getUint32(21, true)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    return null
  }

  return null
}

/** Beyond this in either direction is refused at intake. */
export const MAX_IMAGE_DIMENSION = 12000
/** Total pixels, which bounds cost even when neither side is extreme. */
export const MAX_IMAGE_PIXELS = 40_000_000

export interface ImageRejection {
  code:
    | 'unsupported_type'
    | 'not_an_image'
    | 'type_mismatch'
    | 'too_large'
    | 'empty_file'
    | 'unreadable_dimensions'
    | 'dimensions_too_large'
  message: string
}

export interface AcceptedImage {
  mime: ImageMime
  width: number
  height: number
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

  /*
   * Dimensions are read AFTER the type is confirmed, because the parser is
   * chosen by the sniffed type. An image whose header cannot be read is refused
   * rather than stored unbounded: "we could not tell how big this is" is not a
   * reason to accept it.
   */
  const dimensions = readImageDimensions(data, sniffed)
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return {
      ok: false,
      rejection: { code: 'unreadable_dimensions', message: 'That image could not be read. It may be damaged.' },
    }
  }
  if (
    dimensions.width > MAX_IMAGE_DIMENSION ||
    dimensions.height > MAX_IMAGE_DIMENSION ||
    dimensions.width * dimensions.height > MAX_IMAGE_PIXELS
  ) {
    return {
      ok: false,
      rejection: {
        code: 'dimensions_too_large',
        message: `That image is ${dimensions.width}×${dimensions.height}. Images are limited to ${MAX_IMAGE_DIMENSION}px per side.`,
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
    image: {
      mime: sniffed,
      width: dimensions.width,
      height: dimensions.height,
      extension: canonicalExtension,
      id,
      storedName: `${id}.${canonicalExtension}`,
      sha256,
      bytes: data.byteLength,
    },
  }
}
