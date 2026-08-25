import 'server-only'

import { decode as decodeJpeg, encode as encodeJpeg } from 'jpeg-js'
import { PNG } from 'pngjs'

import type { ImageMime } from '@/server/files/images'

/**
 * The copy of an image a vision model is asked to look at.
 *
 * WHY THIS IS PURE JAVASCRIPT. The obvious implementation is sharp, and sharp
 * cannot run here. Its prebuilt Linux binaries require the x86-64-v2
 * microarchitecture; the production VM reports "Common KVM processor" and
 * exposes neither SSE4.2 nor AVX2, so sharp's own `_isUsingX64V2()` guard
 * refuses the native binding and falls through to its WebAssembly build, which
 * then fails with "Wasm SIMD unsupported" — an error carrying no `code`, which
 * crashes sharp's error formatter and takes the importing module down with it.
 * That is how a resize optimisation once broke the turn it was optimising.
 *
 * A clean reinstall does not fix it; only changing the hypervisor's CPU model
 * would, and a production restart is too much to spend on an image resize. So
 * the dependency is gone. jpeg-js and pngjs are pure JavaScript: no binary, no
 * instruction-set requirement, and identical behaviour on a workstation and on
 * that VM — which also means the path exercised by the tests is the path that
 * actually runs in production, rather than the one that only runs in dev.
 */

/**
 * The longest edge the model is asked to look at.
 *
 * MEASURED, NOT GUESSED. A 4032x3024 phone photo took 28.4s to first token on
 * the live path; capped to 1568px it took 3.56s, to 1024px 1.94s, to 768px
 * 1.69s. Prefill on a vision model scales with image tokens, and a
 * full-resolution photo is thousands of them — that difference was the whole of
 * the "almost a minute" report, not the network, not the proxy, not model load.
 *
 * 1024 is the balance point: an order of magnitude faster while still legible
 * for the case this feature exists for, reading a screenshot. Text smaller than
 * that was never going to survive the model's own tiling anyway.
 *
 * THE STORED IMAGE IS NOT TOUCHED. This resizes only the copy handed to the
 * model. The library keeps the original bytes, its content hash stays valid, and
 * the picture the user sees in the transcript is still their real one.
 */
export const MODEL_IMAGE_MAX_EDGE = 1024

/**
 * The largest image this will decode into memory.
 *
 * Decoding is the one step whose cost is set by the ATTACKER'S number rather
 * than ours: a few hundred kilobytes of compressed pixels can expand to
 * hundreds of megabytes of RGBA. Intake already caps uploads at 40M pixels, so
 * this ceiling is never reached by a stored image; it exists so that this
 * function is safe on its own terms rather than because of a limit enforced
 * somewhere else. Above it the original bytes are used: slower, and still an
 * answer.
 */
export const MAX_DECODE_PIXELS = 40_000_000

/** RGBA, 4 bytes per pixel, row-major. */
interface Raster {
  data: Uint8Array
  width: number
  height: number
}

export interface ModelImage {
  bytes: Buffer
  mime: ImageMime
  /** True when these are the stored bytes unchanged, for logging and tests. */
  original: boolean
}

/**
 * EXIF orientation, read from the JPEG itself.
 *
 * WHY IT CANNOT BE IGNORED. Phones store the sensor readout and a rotation flag
 * rather than rotated pixels. Browsers apply that flag, so the user sees their
 * photo upright — but re-encoding drops the EXIF block, and a model handed the
 * raw pixels would be reading a sideways picture while the user looks at an
 * upright one and wonders why the answer is nonsense. The rotation is applied
 * to the pixels here so that what the model sees matches what the user sees.
 */
export function readJpegOrientation(bytes: Uint8Array): number {
  // SOI, then APP segments. Anything that is not a well-formed APP1/Exif header
  // simply yields 1; a malformed marker is not worth a thrown error.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return 1
    const marker = bytes[offset + 1]!
    // Standalone markers carry no length; SOS means the entropy-coded scan has
    // begun and no more metadata follows.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    if (marker === 0xda || marker === 0xd9) return 1
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!
    if (length < 2 || offset + 2 + length > bytes.length) return 1
    if (marker === 0xe1) {
      const found = orientationFromExif(bytes, offset + 4, offset + 2 + length)
      if (found !== null) return found
    }
    offset += 2 + length
  }
  return 1
}

function orientationFromExif(bytes: Uint8Array, start: number, end: number): number | null {
  // "Exif\0\0" then a TIFF header.
  const header = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]
  if (start + header.length + 8 > end) return null
  for (let i = 0; i < header.length; i += 1) if (bytes[start + i] !== header[i]) return null

  const tiff = start + header.length
  const byteOrder = (bytes[tiff]! << 8) | bytes[tiff + 1]!
  // "II" little-endian, "MM" big-endian. Anything else is not a TIFF header.
  const little = byteOrder === 0x4949
  if (!little && byteOrder !== 0x4d4d) return null

  const u16 = (at: number) =>
    little ? bytes[at]! | (bytes[at + 1]! << 8) : (bytes[at]! << 8) | bytes[at + 1]!
  const u32 = (at: number) =>
    little
      ? (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0
      : ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0

  if (u16(tiff + 2) !== 42) return null
  const ifd = tiff + u32(tiff + 4)
  if (ifd + 2 > end) return null

  const count = u16(ifd)
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > end) return null
    // 0x0112 = Orientation, stored as a SHORT in the first half of the value field.
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8)
      return value >= 1 && value <= 8 ? value : 1
    }
  }
  return null
}

/** Orientations 5-8 exchange the axes, so the displayed image is the transpose. */
const swapsAxes = (orientation: number): boolean => orientation >= 5 && orientation <= 8

/**
 * Displayed coordinates back to stored coordinates.
 *
 * Every EXIF orientation is a signed permutation of the axes, so a rectangle
 * maps to a rectangle and the box filter below can stay a simple rectangular
 * average rather than resampling a rotated quadrilateral.
 */
function toSource(
  orientation: number,
  x: number,
  y: number,
  sw: number,
  sh: number,
): { sx: number; sy: number } {
  switch (orientation) {
    case 2: return { sx: sw - 1 - x, sy: y }
    case 3: return { sx: sw - 1 - x, sy: sh - 1 - y }
    case 4: return { sx: x, sy: sh - 1 - y }
    case 5: return { sx: y, sy: x }
    case 6: return { sx: y, sy: sh - 1 - x }
    case 7: return { sx: sw - 1 - y, sy: sh - 1 - x }
    case 8: return { sx: sw - 1 - y, sy: x }
    default: return { sx: x, sy: y }
  }
}

/**
 * Area-average downsampling.
 *
 * A BOX FILTER, NOT NEAREST-NEIGHBOUR. At the ratios that matter here — 4032px
 * down to 1024px is nearly 4:1 — sampling one pixel in sixteen throws away
 * fifteen and turns the fine strokes of rendered text into noise, which is
 * exactly the content someone attaching a screenshot is asking about. Averaging
 * the whole source rectangle keeps that text readable.
 *
 * ALPHA IS PREMULTIPLIED BEFORE AVERAGING, because averaging colour and opacity
 * independently lets a fully transparent pixel drag real colour into its
 * neighbours — a transparent black border would darken every edge it touches.
 */
export function resample(src: Raster, orientation: number, maxEdge: number): Raster {
  const displayW = swapsAxes(orientation) ? src.height : src.width
  const displayH = swapsAxes(orientation) ? src.width : src.height

  const scale = Math.min(1, maxEdge / Math.max(displayW, displayH))
  const width = Math.max(1, Math.round(displayW * scale))
  const height = Math.max(1, Math.round(displayH * scale))

  const out = new Uint8Array(width * height * 4)

  for (let ty = 0; ty < height; ty += 1) {
    const y0 = Math.floor((ty * displayH) / height)
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * displayH) / height))
    for (let tx = 0; tx < width; tx += 1) {
      const x0 = Math.floor((tx * displayW) / width)
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * displayW) / width))

      // Both corners are mapped and then normalised: the transform may reverse
      // either axis, so the mapped corners are not necessarily in order.
      const a = toSource(orientation, x0, y0, src.width, src.height)
      const b = toSource(orientation, x1 - 1, y1 - 1, src.width, src.height)
      const sx0 = Math.min(a.sx, b.sx)
      const sx1 = Math.max(a.sx, b.sx)
      const sy0 = Math.min(a.sy, b.sy)
      const sy1 = Math.max(a.sy, b.sy)

      let r = 0
      let g = 0
      let bl = 0
      let alpha = 0
      let n = 0
      for (let sy = sy0; sy <= sy1; sy += 1) {
        let i = (sy * src.width + sx0) * 4
        for (let sx = sx0; sx <= sx1; sx += 1) {
          const av = src.data[i + 3]!
          r += src.data[i]! * av
          g += src.data[i + 1]! * av
          bl += src.data[i + 2]! * av
          alpha += av
          n += 1
          i += 4
        }
      }

      const o = (ty * width + tx) * 4
      if (alpha === 0) {
        // Fully transparent: no colour information survives, and inventing one
        // would show through anything composited underneath.
        out[o] = 0
        out[o + 1] = 0
        out[o + 2] = 0
        out[o + 3] = 0
      } else {
        out[o] = Math.round(r / alpha)
        out[o + 1] = Math.round(g / alpha)
        out[o + 2] = Math.round(bl / alpha)
        out[o + 3] = Math.round(alpha / n)
      }
    }
  }

  return { data: out, width, height }
}

function decode(bytes: Buffer, mime: ImageMime): Raster | null {
  if (mime === 'image/jpeg') {
    const raw = decodeJpeg(bytes, {
      useTArray: true,
      // jpeg-js reports its own decoded size against this before allocating.
      maxMemoryUsageInMB: 512,
      // A truncated JPEG still decodes to everything before the damage, which is
      // a better answer than refusing an image the user can plainly see.
      tolerantDecoding: true,
    })
    return { data: raw.data, width: raw.width, height: raw.height }
  }
  if (mime === 'image/png') {
    const png = PNG.sync.read(bytes)
    return { data: png.data, width: png.width, height: png.height }
  }
  // GIF and WebP have no dependable pure-JavaScript decoder of this size, so
  // they are passed through at full resolution rather than half-handled. They
  // are a small minority of what is attached, and a slow correct answer beats a
  // corrupted fast one.
  return null
}

function encode(raster: Raster, mime: ImageMime): Buffer {
  if (mime === 'image/png') {
    const png = new PNG({ width: raster.width, height: raster.height })
    png.data = Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.byteLength)
    return PNG.sync.write(png)
  }
  // Quality 85: above the point where JPEG artefacts start eating thin glyph
  // strokes, below the point where the file stops shrinking usefully.
  return Buffer.from(
    encodeJpeg(
      {
        data: Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.byteLength),
        width: raster.width,
        height: raster.height,
      },
      85,
    ).data,
  )
}

/**
 * FORMAT IS PRESERVED. A screenshot arrives as PNG because its text is sharp,
 * and re-encoding it as JPEG to save bytes would blur the very characters the
 * user is asking about.
 *
 * A DOWNSCALE FAILURE IS NEVER A TURN FAILURE. Every path out of here that
 * cannot produce a smaller image returns the stored bytes: slower, and still
 * correct. This is an optimisation, and an optimisation that can break the
 * thing it optimises is worse than no optimisation at all.
 */
export function downscaleForModel(
  bytes: Buffer,
  mime: ImageMime,
  width: number,
  height: number,
): ModelImage {
  const keep: ModelImage = { bytes, mime, original: true }

  if (Math.max(width, height) <= MODEL_IMAGE_MAX_EDGE) return keep
  if (width * height > MAX_DECODE_PIXELS) return keep

  try {
    const raster = decode(bytes, mime)
    if (!raster) return keep
    // The dimensions recorded at intake are what the caller sized its decision
    // on; a decoder disagreeing means the two are describing different images.
    if (raster.width * raster.height > MAX_DECODE_PIXELS) return keep
    if (raster.data.length < raster.width * raster.height * 4) return keep

    const orientation = mime === 'image/jpeg' ? readJpegOrientation(bytes) : 1
    const resized = resample(raster, orientation, MODEL_IMAGE_MAX_EDGE)
    const encoded = encode(resized, mime)

    // A "smaller" copy that is larger than the original helps nobody, and the
    // point of this whole path is fewer bytes and fewer image tokens.
    return encoded.byteLength < bytes.byteLength
      ? { bytes: encoded, mime, original: false }
      : keep
  } catch {
    return keep
  }
}
