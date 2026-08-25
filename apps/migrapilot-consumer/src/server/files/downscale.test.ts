/**
 * The copy the model looks at.
 *
 * WHY THIS EXISTS. Backend benchmarks said 0.65s to first token; the real browser
 * took close to a minute. The benchmark used an 84 KB fixture and a real user
 * attaches a phone photo. Measured on the live path: 4032x3024 took 28.4s to
 * first token, the same picture at 1024px took 1.94s. Prefill scales with image
 * tokens, and that gap was the entire complaint.
 *
 * THESE TESTS BUILD AND CHECK REAL PIXELS. The version of this file they replace
 * used sharp to make the fixture and sharp to resize it, then asserted the result
 * was small — it exercised sharp and never once called our code.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decode as decodeJpeg, encode as encodeJpeg } from 'jpeg-js'
import { PNG } from 'pngjs'

import {
  MAX_DECODE_PIXELS,
  MODEL_IMAGE_MAX_EDGE,
  downscaleForModel,
  readJpegOrientation,
  resample,
} from './downscale'

type Paint = (x: number, y: number) => [number, number, number, number]

function raster(width: number, height: number, paint: Paint): Uint8Array {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y)
      const i = (y * width + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    }
  }
  return data
}

const jpeg = (w: number, h: number, paint: Paint): Buffer =>
  Buffer.from(encodeJpeg({ data: Buffer.from(raster(w, h, paint)), width: w, height: h }, 92).data)

function png(w: number, h: number, paint: Paint): Buffer {
  const image = new PNG({ width: w, height: h })
  image.data = Buffer.from(raster(w, h, paint))
  return PNG.sync.write(image)
}

/** Sample a decoded RGBA raster at a fractional position. */
const at = (data: Uint8Array, w: number, x: number, y: number) => {
  const i = (y * w + x) * 4
  return [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!]
}

const near = (actual: number[], expected: number[], tolerance: number, what: string) => {
  for (let c = 0; c < expected.length; c += 1) {
    assert.ok(
      Math.abs(actual[c]! - expected[c]!) <= tolerance,
      `${what}: channel ${c} was ${actual[c]}, expected about ${expected[c]}`,
    )
  }
}

const SOLID: Paint = () => [68, 119, 170, 255]

test('the cap is a measured constant, not a preference', () => {
  // 28.4s -> 1.94s on the live path. Changing this changes latency, so it is
  // pinned rather than left to drift.
  assert.equal(MODEL_IMAGE_MAX_EDGE, 1024)
})

test('an image already within the cap is passed through untouched', () => {
  const small = jpeg(800, 600, SOLID)
  const out = downscaleForModel(small, 'image/jpeg', 800, 600)
  assert.equal(out.original, true)
  // Not "equivalent" — the same bytes. Re-encoding something that needs no
  // resize would degrade it for no gain.
  assert.ok(out.bytes.equals(small))
})

test('a phone photo is reduced to the cap and keeps its aspect ratio', () => {
  const big = jpeg(2048, 1536, SOLID)
  const out = downscaleForModel(big, 'image/jpeg', 2048, 1536)

  assert.equal(out.original, false)
  assert.equal(out.mime, 'image/jpeg')
  assert.ok(out.bytes.byteLength < big.byteLength)

  const decoded = decodeJpeg(out.bytes, { useTArray: true })
  assert.equal(Math.max(decoded.width, decoded.height), MODEL_IMAGE_MAX_EDGE)
  assert.equal(decoded.width, 1024)
  assert.equal(decoded.height, 768)
})

test('a PNG screenshot stays a PNG, because its text is why it was sent', () => {
  const shot = png(1600, 1200, SOLID)
  const out = downscaleForModel(shot, 'image/png', 1600, 1200)

  assert.equal(out.original, false)
  assert.equal(out.mime, 'image/png')
  // The real signature, not the declared type.
  assert.deepEqual([...out.bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
  const decoded = PNG.sync.read(out.bytes)
  assert.equal(Math.max(decoded.width, decoded.height), MODEL_IMAGE_MAX_EDGE)
})

test('the picture survives: quadrants stay in their corners', () => {
  // The test that catches a mirrored, rotated or channel-swapped resample. Four
  // unmistakable colours, checked after a real 2:1 reduction.
  const red: [number, number, number, number] = [220, 30, 30, 255]
  const green: [number, number, number, number] = [30, 200, 30, 255]
  const blue: [number, number, number, number] = [30, 30, 220, 255]
  const white: [number, number, number, number] = [245, 245, 245, 255]

  const shot = png(2048, 2048, (x, y) =>
    y < 1024 ? (x < 1024 ? red : green) : x < 1024 ? blue : white,
  )
  const out = downscaleForModel(shot, 'image/png', 2048, 2048)
  const decoded = PNG.sync.read(out.bytes)
  assert.equal(decoded.width, 1024)
  assert.equal(decoded.height, 1024)

  near(at(decoded.data, 1024, 256, 256), red, 2, 'top-left stays red')
  near(at(decoded.data, 1024, 768, 256), green, 2, 'top-right stays green')
  near(at(decoded.data, 1024, 256, 768), blue, 2, 'bottom-left stays blue')
  near(at(decoded.data, 1024, 768, 768), white, 2, 'bottom-right stays white')
})

test('it averages the area it discards instead of sampling one pixel of it', () => {
  /*
   * A one-pixel checkerboard reduced 2:1. A box filter returns mid-grey
   * everywhere; nearest-neighbour returns pure black or pure white. This is the
   * difference between readable and unreadable rendered text at these ratios,
   * which is the entire case this feature exists for.
   */
  const board = png(2048, 2048, (x, y) => ((x + y) % 2 === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]))
  const decoded = PNG.sync.read(downscaleForModel(board, 'image/png', 2048, 2048).bytes)

  for (const [x, y] of [[10, 10], [512, 300], [1000, 1010]] as const) {
    near(at(decoded.data, 1024, x, y), [128, 128, 128], 2, `checker at ${x},${y} is averaged`)
  }
})

test('a transparent region does not bleed its colour into the visible edge', () => {
  // Fully transparent pixels carrying green: averaging colour and alpha
  // independently would tint the red half at the boundary.
  const image = png(2048, 8, (x) => (x < 1024 ? [220, 20, 20, 255] : [0, 255, 0, 0]))
  const decoded = PNG.sync.read(downscaleForModel(image, 'image/png', 2048, 8).bytes)

  const boundary = at(decoded.data, decoded.width, 511, 2)
  assert.ok(boundary[3]! > 250, 'the opaque side stays opaque')
  assert.ok(boundary[1]! < 40, `green bled into the opaque edge: ${boundary.join(',')}`)
})

test('formats without a dependable pure-JS decoder are passed through, not mangled', () => {
  for (const mime of ['image/gif', 'image/webp'] as const) {
    const bytes = Buffer.from('not really decodable but declared large')
    const out = downscaleForModel(bytes, mime, 4000, 3000)
    assert.equal(out.original, true, `${mime} is passed through`)
    assert.ok(out.bytes.equals(bytes))
  }
})

test('an unreadable image costs latency, never the answer', () => {
  // The failure that took production down was a resize path that could throw.
  const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(4096, 0x7a)])
  const out = downscaleForModel(corrupt, 'image/jpeg', 4032, 3024)
  assert.equal(out.original, true)
  assert.ok(out.bytes.equals(corrupt))
})

test('an image too large to decode is refused before it is allocated', () => {
  const bytes = jpeg(64, 64, SOLID)
  const pixels = MAX_DECODE_PIXELS + 1
  const out = downscaleForModel(bytes, 'image/jpeg', pixels, 1)
  assert.equal(out.original, true)
})

test('a downscale that would grow the file is not used', () => {
  // Noise defeats JPEG, so the re-encode can be larger than a well-compressed
  // original. Sending more bytes than we were given is never the right answer.
  let seed = 1
  const noise = png(1100, 1100, () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    const v = seed % 256
    return [v, (v * 7) % 256, (v * 13) % 256, 255]
  })
  const out = downscaleForModel(noise, 'image/png', 1100, 1100)
  assert.ok(out.bytes.byteLength <= noise.byteLength)
})

/* ---- EXIF orientation ---- */

function withExif(image: Buffer, orientation: number, littleEndian = true): Buffer {
  const tiff = Buffer.alloc(14)
  if (littleEndian) {
    tiff.write('II', 0, 'ascii')
    tiff.writeUInt16LE(42, 2)
    tiff.writeUInt32LE(8, 4)
    tiff.writeUInt16LE(1, 8) // one entry
    tiff.writeUInt16LE(0x0112, 10)
    tiff.writeUInt16LE(3, 12) // SHORT
  } else {
    tiff.write('MM', 0, 'ascii')
    tiff.writeUInt16BE(42, 2)
    tiff.writeUInt32BE(8, 4)
    tiff.writeUInt16BE(1, 8)
    tiff.writeUInt16BE(0x0112, 10)
    tiff.writeUInt16BE(3, 12)
  }
  const rest = Buffer.alloc(12)
  if (littleEndian) {
    rest.writeUInt32LE(1, 0)
    rest.writeUInt16LE(orientation, 4)
  } else {
    rest.writeUInt32BE(1, 0)
    rest.writeUInt16BE(orientation, 4)
  }
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff, rest])
  const header = Buffer.alloc(4)
  header.writeUInt16BE(0xffe1, 0)
  header.writeUInt16BE(payload.length + 2, 2)
  // After SOI, before everything the encoder wrote.
  return Buffer.concat([image.subarray(0, 2), header, payload, image.subarray(2)])
}

test('EXIF orientation is read in both byte orders', () => {
  const image = jpeg(32, 16, SOLID)
  assert.equal(readJpegOrientation(withExif(image, 6)), 6)
  assert.equal(readJpegOrientation(withExif(image, 8, false)), 8)
})

test('an image with no EXIF, or damaged EXIF, is simply upright', () => {
  assert.equal(readJpegOrientation(jpeg(32, 16, SOLID)), 1)
  assert.equal(readJpegOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00])), 1)
  assert.equal(readJpegOrientation(Buffer.from([0x89, 0x50, 0x4e, 0x47])), 1)
  assert.equal(readJpegOrientation(Buffer.alloc(0)), 1)
})

test('rotation puts the pixel where the viewer already sees it', () => {
  // Orientation 6 is a quarter turn clockwise, so the stored bottom-left corner
  // is displayed at the top-left.
  const source = {
    data: raster(4, 2, (x, y) => (x === 0 && y === 1 ? [255, 0, 0, 255] : [0, 0, 0, 255])),
    width: 4,
    height: 2,
  }
  const out = resample(source, 6, 64)
  assert.equal(out.width, 2, 'the axes are exchanged')
  assert.equal(out.height, 4)
  near(at(out.data, out.width, 0, 0), [255, 0, 0, 255], 1, 'stored bottom-left displays top-left')
})

test('a rotated phone photo reaches the model the way the user sees it', () => {
  // Landscape sensor readout, flagged portrait. Ignoring the flag would hand the
  // model a sideways picture while the browser shows an upright one.
  const upright = withExif(jpeg(2048, 1536, SOLID), 6)
  const out = downscaleForModel(upright, 'image/jpeg', 2048, 1536)

  assert.equal(out.original, false)
  const decoded = decodeJpeg(out.bytes, { useTArray: true })
  assert.ok(decoded.height > decoded.width, `expected portrait, got ${decoded.width}x${decoded.height}`)
  assert.equal(Math.max(decoded.width, decoded.height), MODEL_IMAGE_MAX_EDGE)
})

test('no native image dependency is reachable from this path', () => {
  /*
   * sharp cannot load on the production VM: its prebuilt Linux binaries require
   * x86-64-v2 and the hypervisor exposes a generic CPU without SSE4.2, so it
   * refuses its own binding and falls through to a WebAssembly build that needs
   * SIMD the CPU also lacks. Importing it once took the whole turn down. This
   * fails if it comes back.
   */
  const manifest = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> }
  assert.equal(manifest.dependencies?.sharp, undefined, 'sharp must not be a dependency')
})
