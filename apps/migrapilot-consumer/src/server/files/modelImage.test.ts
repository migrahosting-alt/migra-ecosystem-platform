/**
 * The copy the model looks at.
 *
 * WHY THIS EXISTS. Backend benchmarks said 0.65s to first token; the real browser
 * took close to a minute. The benchmark used an 84 KB fixture and a real user
 * attaches a phone photo. Measured on the live path: 4032x3024 at 8.6 MB took
 * 28.4s to first token, the same picture at 1024px took 1.94s. Prefill scales
 * with image tokens, and that gap was the entire complaint.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { MODEL_IMAGE_MAX_EDGE } from './resolveTurnImages'

const photo = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#4477aa' } }).jpeg().toBuffer()

test('the cap is small enough to matter and large enough to read', () => {
  // Stated as a measured constant, not a preference: 28.4s -> 1.94s.
  assert.equal(MODEL_IMAGE_MAX_EDGE, 1024)
})

test('a phone photo is reduced to the cap, keeping its aspect ratio', async () => {
  const big = await photo(4032, 3024)
  const out = await sharp(big)
    .resize({ width: MODEL_IMAGE_MAX_EDGE, height: MODEL_IMAGE_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 }).toBuffer()
  const meta = await sharp(out).metadata()
  assert.equal(meta.width, 1024)
  assert.equal(meta.height, 768, 'aspect ratio preserved — nothing is cropped')
  assert.ok(out.byteLength < big.byteLength)
})

test('an image already within the cap is passed through untouched', async () => {
  /*
   * Re-encoding a small image degrades it for no gain, and for a screenshot the
   * loss lands exactly on the text the user is asking about.
   */
  const small = await photo(800, 600)
  const meta = await sharp(small).metadata()
  assert.ok(Math.max(meta.width!, meta.height!) <= MODEL_IMAGE_MAX_EDGE)
})

test('a wide screenshot keeps its width budget rather than being squared off', async () => {
  const wide = await photo(3840, 1080)
  const out = await sharp(wide)
    .resize({ width: MODEL_IMAGE_MAX_EDGE, height: MODEL_IMAGE_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .jpeg().toBuffer()
  const meta = await sharp(out).metadata()
  assert.equal(meta.width, 1024)
  assert.equal(meta.height, 288, 'fit:inside bounds the LONGEST edge, it does not letterbox')
})

test('PNG stays PNG, so screenshot text is not re-compressed', async () => {
  const png = await sharp({ create: { width: 2000, height: 1200, channels: 3, background: '#ffffff' } })
    .png().toBuffer()
  const out = await sharp(png)
    .resize({ width: MODEL_IMAGE_MAX_EDGE, height: MODEL_IMAGE_MAX_EDGE, fit: 'inside' })
    .png({ compressionLevel: 6 }).toBuffer()
  assert.equal((await sharp(out).metadata()).format, 'png')
})
