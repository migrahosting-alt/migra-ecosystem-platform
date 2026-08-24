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
import {
  acceptImage,
  sniffImageMime,
  isImageId,
  imageIdFor,
  IMAGE_EXTENSIONS,
  MAX_IMAGE_BYTES,
} from './images'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 9, 9, 9])
const GIF = new Uint8Array([...Buffer.from('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0, 7, 7, 7])
const WEBP = new Uint8Array([...Buffer.from('RIFF'), 0x1a, 0, 0, 0, ...Buffer.from('WEBP'), ...Buffer.from('VP8 ')])

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
