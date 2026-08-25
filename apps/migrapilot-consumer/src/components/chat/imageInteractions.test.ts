/**
 * Paste, drop and click-to-view.
 *
 * THE RULE THESE ENFORCE: there is exactly ONE upload path. Validation, quota,
 * scope, the canonical ref and every failure message live on the server, and a
 * second client implementation is how one of them quietly stops matching.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8')
const composer = read('components/chat/Composer.tsx')
const viewer = read('components/chat/ImageViewer.tsx')
const message = read('components/chat/Message.tsx')
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('picker, paste and drop all go through the same upload', () => {
  const c = code(composer)
  // Exactly one place posts to the images endpoint.
  const posts = [...c.matchAll(/fetch\('\/api\/images', \{ method: 'POST'/g)]
  assert.equal(posts.length, 1, `expected one upload implementation, found ${posts.length}`)
  for (const caller of ['onImagePicked', 'onPaste', 'onDrop']) {
    assert.match(c, new RegExp(`${caller}[\\s\\S]{0,700}uploadImage\\(`), `${caller} must reuse it`)
  }
})

test('one list decides what counts as an image', () => {
  // Three entry points with three opinions is how they come to disagree.
  const c = code(composer)
  assert.match(c, /const ACCEPTED_IMAGE_TYPES = \['image\/png', 'image\/jpeg', 'image\/gif', 'image\/webp'\]/)
  assert.match(c, /ACCEPTED_IMAGE_TYPES\.includes\(file\.type\)/, 'upload checks it')
  assert.match(c, /ACCEPTED_IMAGE_TYPES\.includes\(item\.type\)/, 'paste checks it')
})

test('a paste with no image leaves text alone', () => {
  /*
   * `preventDefault` only after an image item is found. Calling it earlier would
   * break ordinary Ctrl+V, which is a far more common action than pasting a
   * screenshot.
   */
  const c = code(composer)
  const paste = c.slice(c.indexOf('const onPaste'), c.indexOf('const onPaste') + 700)
  assert.match(paste, /if \(!imageItem\) return[\s\S]*event\.preventDefault\(\)/,
    'the early return must come before preventDefault')
})

test('the drop target does not flicker across child elements', () => {
  // dragenter/dragleave fire for every child crossed; a boolean flag turns off
  // the moment the pointer moves over the textarea inside the zone.
  const c = code(composer)
  assert.match(c, /dragCounter\.current \+= 1/)
  assert.match(c, /dragCounter\.current === 0\) setDragging\(false\)/)
})

test('a drop uploads sequentially so the per-message cap is real', () => {
  // Fired in parallel, every upload reads the same stale count and all pass.
  const c = code(composer)
  assert.match(c, /for \(const file of files\) await uploadImage\(file\)/)
  assert.match(c, /MAX_TURN_IMAGES = 4/)
  assert.match(c, /You can attach up to \$\{MAX_TURN_IMAGES\} images/, 'the bound is stated, not silent')
})

test('the viewer loads the same authorised URL as the transcript', () => {
  /*
   * No separate "full size" endpoint that could drift from the one with the
   * scope and hash checks, and nothing copied into a blob or data URI that would
   * escape them.
   */
  assert.match(code(viewer), /src=\{`\/api\/images\/\$\{refs\[index\]\}`\}/)
  assert.doesNotMatch(code(viewer), /createObjectURL|data:image\//)
})

test('the whole image fits, with nothing to scroll', () => {
  const v = code(viewer)
  assert.match(v, /max-h-\[85vh\] max-w-\[90vw\] rounded-lg object-contain/)
  assert.doesNotMatch(v, /overflow-auto|scroll-slim/, 'a bounded image has nothing off-screen')
})

test('nothing behind the viewer competes with the image', () => {
  /*
   * An earlier backdrop was light and blurred, which kept the conversation
   * readable behind the picture — putting assistant text inside the
   * image-viewing experience.
   */
  const v = code(viewer)
  assert.match(v, /bg-slate-950\/90/)
  assert.doesNotMatch(v, /backdrop-blur/)
})

test('there are no editor-like controls', () => {
  // Zoom steps, a percentage readout and a reset button made "look closer" feel
  // like a tool. Close, and navigation when there is somewhere to go.
  const v = code(viewer)
  for (const gone of ['ZoomIn', 'ZoomOut', 'RotateCcw', 'setZoom', 'Reset zoom']) {
    assert.ok(!v.includes(gone), `${gone} must not be in the viewer`)
  }
})

test('multiple images navigate without leaving the viewer', () => {
  const v = code(viewer)
  assert.match(v, /aria-label="Previous image"/)
  assert.match(v, /aria-label="Next image"/)
  assert.match(v, /\{index \+ 1\} \/ \{refs\.length\}/, 'the counter says where you are')
  assert.match(v, /event\.key === 'ArrowRight'/)
  assert.match(v, /event\.key === 'ArrowLeft'/)
  assert.match(v, /\(current \+ delta \+ refs\.length\) % refs\.length/, 'navigation wraps')
})

test('a single image gets no arrows and no counter', () => {
  // One picture with a "1 / 1" and two dead arrows is chrome for its own sake.
  assert.match(code(viewer), /const many = refs\.length > 1/)
})

test('the backdrop closes, the image does not', () => {
  const v = code(viewer)
  assert.match(v, /onClick=\{onClose\}/)
  assert.match(v, /onClick=\{stop\}/, 'clicking the picture itself must not close it')
})

test('the viewer closes on Escape and gives focus back', () => {
  const v = code(viewer)
  assert.match(v, /event\.key === 'Escape'/)
  assert.match(v, /restoreFocus\.current instanceof HTMLElement/,
    'a keyboard user must not be stranded at the top of the document')
  assert.match(v, /role="dialog"/)
  assert.match(v, /aria-modal="true"/)
})

test('the page behind the viewer does not scroll', () => {
  assert.match(code(viewer), /document\.body\.style\.overflow = 'hidden'/)
})

test('transcript images stay draggable and open on click', () => {
  const m = code(message)
  assert.match(m, /draggable/, 'dragging out must carry the real authorised URL')
  assert.match(m, /onClick=\{\(\) => setViewing\(index\)\}/, 'the index opens the gallery at that image')
  assert.match(m, /focus-visible:ring/, 'the control must be reachable by keyboard')
})
