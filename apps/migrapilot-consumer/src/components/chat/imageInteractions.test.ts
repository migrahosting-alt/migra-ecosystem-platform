/**
 * Paste, drop and click-to-view.
 *
 * THE RULE THESE ENFORCE: there is exactly ONE upload path. Validation, quota,
 * scope, the canonical ref and every failure message live on the server, and a
 * second client implementation is how one of them quietly stops matching.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Every .tsx under a directory, so the layer scan cannot miss a new surface. */
function listTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return listTsx(full)
    return full.endsWith('.tsx') ? [full] : []
  })
}

const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8')
const composer = read('components/chat/Composer.tsx')
const message = read('components/chat/Message.tsx')
const viewer = read('components/chat/ImageViewer.tsx')
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

test('the viewer is portalled to the body, outside the chat subtree', () => {
  /*
   * THE STRUCTURAL DEFECT. Rendered inside the message, the viewer sat inside
   * the chat's scroll container: the sticky composer — later in DOM order within
   * that same container — painted on top of it, and `position: fixed` measured
   * against the nearest ancestor establishing a containing block rather than the
   * viewport. That produced an image sized past the page, a horizontal
   * scrollbar, and the composer floating over the picture.
   */
  const v = code(viewer)
  assert.match(v, /createPortal\(/, 'it must escape the chat stacking context')
  assert.match(v, /document\.body,\s*\)/, 'and mount at the viewport root')
})

test('the layer is fixed to the viewport and cannot overflow sideways', () => {
  const v = code(viewer)
  assert.match(v, /fixed inset-0/)
  assert.match(v, /overflow-hidden/, 'the layer itself must never add a scrollbar')
})

test('nothing in the app can paint above the viewer', () => {
  /*
   * Asserted against the real z-index landscape rather than a hoped-for one: if
   * any chat surface starts using a higher layer, this fails instead of the
   * composer silently reappearing over an image.
   */
  const v = code(viewer)
  const viewerLayer = Number(/z-\[(\d+)\]/.exec(v)?.[1] ?? '0')
  assert.ok(viewerLayer > 50, `viewer layer ${viewerLayer} must exceed every app layer`)

  const appLayers = ['components', 'screens', 'features'].flatMap((dir) =>
    listTsx(join(process.cwd(), 'src', dir))
      .filter((f) => !f.endsWith('ImageViewer.tsx'))
      .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/z-\[?(\d+)\]?/g)].map((m) => Number(m[1]))),
  )
  const highest = Math.max(0, ...appLayers)
  assert.ok(highest < viewerLayer, `an app surface uses z-${highest}, at or above the viewer`)
})

test('page scrolling is locked while the viewer is open', () => {
  const v = code(viewer)
  assert.match(v, /document\.body\.style\.overflow = 'hidden'/)
  assert.match(v, /document\.body\.style\.overflow = previous/, 'and restored exactly')
})

test('the image is bounded by the viewport, not by a parent', () => {
  /*
   * Explicit viewport units with room for the controls. A portalled layer has no
   * parent worth measuring against, so percentages of one would be meaningless.
   */
  const v = code(viewer)
  assert.match(v, /maxWidth: 'calc\(100vw - 4rem\)'/)
  assert.match(v, /maxHeight: 'calc\(100vh - 6rem\)'/)
  assert.match(v, /width: 'auto'/)
  assert.match(v, /height: 'auto'/)
  assert.match(v, /object-contain/)
})

test('the whole image fits, with no cropping and nothing to scroll', () => {
  /*
   * Open-to-view, not zoom-to-100%. The picture is bounded to the viewport, so
   * it is never cropped on open and there is never anything off-screen.
   */
  const v = code(viewer)
  assert.match(v, /rounded-lg object-contain/)
  assert.doesNotMatch(v, /overflow-auto|scroll-slim/)
  assert.doesNotMatch(v, /object-cover/)
})

test('the conversation is dimmed behind, not replaced', () => {
  const v = code(viewer)
  assert.match(v, /fixed inset-0/, 'it opens over the chat rather than navigating away')
  assert.match(v, /bg-slate-950\/90/, 'dark enough that nothing behind competes')
})

test('there are no zoom or editor controls', () => {
  const v = code(viewer)
  for (const gone of ['ZoomIn', 'ZoomOut', 'RotateCcw', 'setZoom', 'Reset zoom', 'scale']) {
    assert.ok(!v.includes(gone), `${gone} must not be in the viewer`)
  }
})

test('a single image shows only the image and a close control', () => {
  // Arrows and a "1 / 1" on one picture is chrome for its own sake.
  assert.match(code(viewer), /const many = refs\.length > 1/)
  assert.match(code(viewer), /aria-label="Close image viewer"/)
})

test('multiple images get previous, next and a small counter', () => {
  const v = code(viewer)
  assert.match(v, /aria-label="Previous image"/)
  assert.match(v, /aria-label="Next image"/)
  assert.match(v, /\{index \+ 1\} \/ \{refs\.length\}/)
  assert.match(v, /event\.key === 'ArrowRight'/)
  assert.match(v, /event\.key === 'ArrowLeft'/)
})

test('Esc and the backdrop close it; the image itself does not', () => {
  const v = code(viewer)
  assert.match(v, /event\.key === 'Escape'/)
  assert.match(v, /onClick=\{onClose\}/)
  assert.match(v, /onClick=\{stop\}/, 'clicking the picture must not close it')
})

test('closing returns to the exact message, in the same place on screen', () => {
  /*
   * Focus alone is not enough: `focus()` scrolls the element into view at
   * whatever position the browser picks, so a long conversation can land
   * somewhere the reader did not leave it.
   */
  const v = code(viewer)
  assert.match(v, /scrollY\.current = window\.scrollY/, 'the position is captured on open')
  assert.match(v, /focus\(\{ preventScroll: true \}\)/)
  assert.match(v, /window\.scrollTo\(\{ top: scrollY\.current/)
})

test('there is exactly one image-view behaviour', () => {
  // Inline expansion and a lightbox at the same time is two mechanisms, and one
  // of them will drift.
  const m = code(message)
  assert.ok(!m.includes('toggle(ref)'), 'inline expansion must be gone')
  assert.ok(!m.includes('aria-expanded'), 'no expand/collapse state remains')
  /*
   * The INTENT, not the literal expression. The index now maps into the images
   * that still exist, because a deleted asset must not be pageable — pinning the
   * old `setViewing(index)` made that correct change look like a regression.
   */
  assert.match(m, /onClick=\{\(\) => setViewing\(/, 'clicking opens the viewer')
})

test('transcript images stay draggable and open on click', () => {
  const m = code(message)
  assert.match(m, /draggable/, 'dragging out must carry the real authorised URL')
  assert.match(m, /onClick=\{\(\) => setViewing\(/)
  assert.match(m, /focus-visible:ring/, 'the control must be reachable by keyboard')
})
