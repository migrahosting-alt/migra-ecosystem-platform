/**
 * Paste, drop and click-to-view.
 *
 * THE RULE THESE ENFORCE: there is exactly ONE upload path. Validation, quota,
 * scope, the canonical ref and every failure message live on the server, and a
 * second client implementation is how one of them quietly stops matching.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8')
const composer = read('components/chat/Composer.tsx')
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

test('there is no modal image viewer at all', () => {
  /*
   * Two competing ways to look at an image is one too many. The modal is gone
   * rather than disabled: an overlay, a backdrop and a close button that still
   * exist in the tree are a second mechanism waiting to be re-entered.
   */
  const m = code(message)
  for (const gone of ['ImageViewer', 'role="dialog"', 'aria-modal', 'backdrop', 'onClose']) {
    assert.ok(!m.includes(gone), `${gone} must not be in the transcript path`)
  }
  assert.equal(existsSync(join(process.cwd(), 'src/components/chat/ImageViewer.tsx')), false,
    'the modal component must be deleted, not left unused')
})

test('a click expands the image inline, and another collapses it', () => {
  const m = code(message)
  assert.match(m, /onClick=\{\(\) => toggle\(ref\)\}/)
  assert.match(m, /if \(next\.has\(ref\)\) next\.delete\(ref\)/, 'the same click closes it')
  assert.match(m, /aria-expanded=\{open\}/, 'the state is announced, not just drawn')
})

test('expanded is bounded by content width and viewport height, never cropped', () => {
  /*
   * `object-contain` in both states, and no width that could exceed the column —
   * a very large picture stays usable and the page never scrolls sideways.
   */
  const m = code(message)
  assert.match(m, /open \? 'max-h-\[70vh\] w-full max-w-full' : 'max-h-64 w-auto max-w-full'/)
  assert.match(m, /object-contain/)
  assert.doesNotMatch(m, /object-cover/)
})

test('each image toggles independently', () => {
  // Opening one in a two-image message must not collapse the other it is being
  // compared against.
  assert.match(code(message), /useState<ReadonlySet<string>>/)
})

test('expansion is not persisted, but the picture is', () => {
  /*
   * Expansion is a way of LOOKING at the transcript, not part of it. A reload
   * returns every message to its preview; what has to survive is the image ref,
   * which comes from the message's own record.
   */
  const m = code(message)
  assert.match(m, /useState<ReadonlySet<string>>\(\(\) => new Set\(\)\)/, 'starts collapsed every time')
  assert.match(m, /src=\{`\/api\/images\/\$\{ref\}`\}/, 'the ref still comes from the message')
})

test('two messages never mix their images', () => {
  // Each turn maps only over its own refs; there is no shared or conversation
  // level list feeding the transcript.
  const m = code(message)
  assert.match(m, /message\.images\.map\(\(ref\) =>/)
  assert.doesNotMatch(m, /conversation\.imageRefs/)
})

test('transcript images stay draggable and expand on click', () => {
  const m = code(message)
  assert.match(m, /draggable/, 'dragging out must carry the real authorised URL')
  assert.match(m, /onClick=\{\(\) => toggle\(ref\)\}/)
  assert.match(m, /focus-visible:ring/, 'the control must be reachable by keyboard')
})
