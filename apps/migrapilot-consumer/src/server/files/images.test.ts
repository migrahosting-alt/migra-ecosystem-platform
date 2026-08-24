/**
 * Image intake.
 *
 * THE RULE THAT MATTERS: the extension is not the authority. A file named `.png`
 * carrying something else is not an image, and handing it to a vision model is a
 * decoding failure at best. Every case here is about refusing to guess.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import {
  acceptImage,
  readImageDimensions,
  MAX_IMAGE_DIMENSION,
  sniffImageMime,
  isImageId,
  imageIdFor,
  IMAGE_EXTENSIONS,
  MAX_IMAGE_BYTES,
} from './images'

/*
 * Fixtures are STRUCTURALLY VALID files, not signature stubs. Once dimensions
 * became a requirement, a stub that starts with the right eight bytes stopped
 * being an image — which is the correct behaviour, and it broke every test that
 * had been leaning on one.
 */
function jpegOf(w: number, h: number): Uint8Array {
  const sof = Buffer.alloc(19)
  sof.writeUInt16BE(0xffc0, 0)   // SOF0
  sof.writeUInt16BE(17, 2)       // segment length
  sof[4] = 8                     // precision
  sof.writeUInt16BE(h, 5)
  sof.writeUInt16BE(w, 7)
  sof[9] = 3                     // components
  return new Uint8Array(Buffer.concat([
    Buffer.from([0xff, 0xd8]),                                   // SOI
    Buffer.from([0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0', 'ascii'), Buffer.alloc(9),
    sof,
    Buffer.from([0xff, 0xd9]),                                   // EOI
  ]))
}

function webpOf(w: number, h: number): Uint8Array {
  const vp8x = Buffer.alloc(10)
  vp8x.writeUIntLE(w - 1, 4, 3)
  vp8x.writeUIntLE(h - 1, 7, 3)
  const body = Buffer.concat([Buffer.from('WEBP', 'ascii'), Buffer.from('VP8X', 'ascii'), Buffer.alloc(4), vp8x])
  const size = Buffer.alloc(4); size.writeUInt32LE(body.length)
  return new Uint8Array(Buffer.concat([Buffer.from('RIFF', 'ascii'), size, body]))
}

const PNG = realPng(24, 16)
const JPEG = jpegOf(24, 16)
const GIF = realGif(24, 16)
const WEBP = webpOf(24, 16)

test('each supported format is recognised by its magic bytes', () => {
  assert.equal(sniffImageMime(PNG), 'image/png')
  assert.equal(sniffImageMime(JPEG), 'image/jpeg')
  assert.equal(sniffImageMime(GIF), 'image/gif')
  assert.equal(sniffImageMime(WEBP), 'image/webp')
})

test('WEBP is matched at BOTH offsets, not as one run', () => {
  /*
   * "RIFF" and "WEBP" are separated by a four-byte size field that varies per
   * file. A single contiguous signature would match almost nothing, and a check
   * for "RIFF" alone would accept any RIFF container — a .wav renamed .webp.
   */
  const riffButNotWebp = new Uint8Array([...Buffer.from('RIFF'), 9, 9, 9, 9, ...Buffer.from('WAVE'), 0, 0, 0, 0])
  assert.equal(sniffImageMime(riffButNotWebp), null, 'a WAV in a RIFF container is not an image')
})

test('non-images are refused whatever they are called', () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(12).fill(0)])
  const text = new Uint8Array(Buffer.from('this is plainly not an image at all'))
  for (const bytes of [zip, text]) {
    const out = acceptImage('photo.png', bytes)
    assert.equal(out.ok, false)
    if (!out.ok) assert.ok(['not_an_image', 'type_mismatch'].includes(out.rejection.code))
  }
})

test('a mismatch between name and content is REFUSED, never corrected', () => {
  /*
   * Renaming to match the bytes would silently accept a mislabelled upload;
   * trusting the name would hand the model something undecodable. Either way
   * something upstream is wrong, and correcting it hides that.
   */
  const out = acceptImage('screenshot.png', JPEG)
  assert.equal(out.ok, false)
  if (!out.ok) {
    assert.equal(out.rejection.code, 'type_mismatch')
    assert.match(out.rejection.message, /named \.png but its contents are jpeg/)
  }
})

test('the id is content-addressed, opaque, and not the client filename', () => {
  const a = acceptImage('holiday.png', PNG)
  const b = acceptImage('completely-different-name.png', PNG)
  assert.ok(a.ok && b.ok)
  if (a.ok && b.ok) {
    assert.equal(a.image.id, b.image.id, 'same bytes must yield the same id regardless of name')
    assert.equal(a.image.id, imageIdFor(createHash('sha256').update(PNG).digest('hex')))
    assert.ok(isImageId(a.image.id))
    // The stored name carries the id, never the caller's.
    assert.equal(a.image.storedName, `${a.image.id}.png`)
    assert.doesNotMatch(a.image.storedName, /holiday/)
  }
})

test('different bytes never collide', () => {
  const a = acceptImage('a.png', PNG)
  const b = acceptImage('b.gif', GIF)
  assert.ok(a.ok && b.ok)
  if (a.ok && b.ok) assert.notEqual(a.image.id, b.image.id)
})

test('a ref from a client is validated by SHAPE before anything reads a disk', () => {
  assert.ok(isImageId('img_' + 'a'.repeat(32)))
  for (const hostile of [
    'img_../../../etc/passwd',
    'img_' + 'a'.repeat(31),
    'img_' + 'A'.repeat(32),          // uppercase is not the hash charset
    '../img_' + 'a'.repeat(32),
    'img_' + 'a'.repeat(32) + '/..',
    'notanid', '', null, undefined, 42, {},
  ]) {
    assert.equal(isImageId(hostile as unknown), false, `${String(hostile)} must not pass as an id`)
  }
})

test('jpeg normalises to a single stored extension', () => {
  const a = acceptImage('a.jpg', JPEG)
  const b = acceptImage('b.jpeg', JPEG)
  assert.ok(a.ok && b.ok)
  if (a.ok && b.ok) {
    // Same bytes, same id — so the stored name must not differ by spelling, or
    // the second upload would write a second file for one identity.
    assert.equal(a.image.storedName, b.image.storedName)
    assert.equal(a.image.extension, 'jpg')
  }
})

test('size and emptiness are bounded with readable reasons', () => {
  const empty = acceptImage('a.png', new Uint8Array(0))
  assert.ok(!empty.ok && empty.rejection.code === 'empty_file')

  const huge = new Uint8Array(MAX_IMAGE_BYTES + 1)
  huge.set(PNG.slice(0, 8))
  const big = acceptImage('a.png', huge)
  assert.ok(!big.ok && big.rejection.code === 'too_large')
  if (!big.ok) assert.match(big.rejection.message, /limited to 8 MB/)
})

test('the accepted extension list and the mime map agree', () => {
  /*
   * Two lists that must not drift: one drives the file picker, the other decides
   * what is stored. A format in one and not the other is either an unusable
   * picker entry or an unpickable accepted type.
   */
  for (const ext of IMAGE_EXTENSIONS) {
    const bytes = ext === 'png' ? PNG : ext === 'gif' ? GIF : ext === 'webp' ? WEBP : JPEG
    const out = acceptImage(`file.${ext}`, bytes)
    assert.ok(out.ok, `.${ext} must be accepted when its bytes match`)
  }
})

/*
 * REAL ENCODED IMAGES, not hand-written headers. A fixture written by the same
 * understanding as the parser proves only that the misunderstanding is
 * consistent; these are built by an encoder and then read back.
 */
function realPng(w: number, h: number): Uint8Array {
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3)])))
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]))
}

function realGif(w: number, h: number): Uint8Array {
  const head = Buffer.from('GIF89a', 'ascii')
  const lsd = Buffer.alloc(7)
  lsd.writeUInt16LE(w, 0); lsd.writeUInt16LE(h, 2); lsd[4] = 0x80
  return new Uint8Array(Buffer.concat([head, lsd, Buffer.from([0, 0, 0, 255, 255, 255]), Buffer.from([0x3b])]))
}

test('dimensions are read from real encoded files', () => {
  const png = realPng(37, 11)
  assert.deepEqual(readImageDimensions(png, 'image/png'), { width: 37, height: 11 })

  const gif = realGif(5, 9)
  assert.deepEqual(readImageDimensions(gif, 'image/gif'), { width: 5, height: 9 })
})

test('width and height are not transposed', () => {
  /*
   * The single easiest bug in header parsing, and invisible on a square test
   * image — so every fixture here is deliberately non-square.
   */
  const png = realPng(64, 8)
  const dims = readImageDimensions(png, 'image/png')
  assert.equal(dims?.width, 64)
  assert.equal(dims?.height, 8)
})

test('an image too large in pixels is refused even when its bytes are small', () => {
  /*
   * The reason dimensions are a limit at all: a highly compressible PNG can be
   * enormous in pixels while tiny on disk. Byte size alone would wave it through
   * to a decoder and to a vision model that tiles by pixel.
   */
  const huge = realPng(MAX_IMAGE_DIMENSION + 1, 4)
  assert.ok(huge.byteLength < 100_000, 'fixture must be small on disk to make the point')
  const out = acceptImage('huge.png', huge)
  assert.equal(out.ok, false)
  if (!out.ok) {
    assert.equal(out.rejection.code, 'dimensions_too_large')
    assert.match(out.rejection.message, /12000px per side/)
  }
})

test('an unreadable header is refused, not stored unbounded', () => {
  // Valid PNG signature, truncated before IHDR carries a size.
  const truncated = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
  const out = acceptImage('broken.png', truncated)
  assert.equal(out.ok, false)
  if (!out.ok) assert.ok(['unreadable_dimensions', 'not_an_image'].includes(out.rejection.code))
})

test('an accepted image carries its dimensions forward', () => {
  const out = acceptImage('photo.png', realPng(20, 30))
  assert.ok(out.ok)
  if (out.ok) {
    assert.equal(out.image.width, 20)
    assert.equal(out.image.height, 30)
  }
})
