/**
 * What the Action Hub is allowed to claim.
 *
 * These are about the two ways a menu lies: offering something that does
 * nothing, and hiding something that is merely unavailable right now.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8')
const hub = read('components/chat/ActionHub.tsx')
const composer = read('components/chat/Composer.tsx')
const tray = read('components/chat/ImageTray.tsx')

test('an unavailable action is disabled with a reason, never hidden', () => {
  /*
   * Hiding it is its own lie: "MigraPilot cannot read images" and "cannot read
   * them right now" are different facts, and the second one is temporary.
   */
  assert.match(hub, /disabled=\{blocked\}/)
  assert.match(hub, /action\.unavailableReason \?\? action\.hint/,
    'the reason must REPLACE the hint, not sit beside it')
  assert.doesNotMatch(hub, /actions\.filter\(/, 'entries must not be filtered out of the menu')
})

test('a blocked action cannot fire even if the click lands', () => {
  // Relying on `disabled` alone leaves the handler reachable by keyboard and by
  // anything that dispatches a synthetic click.
  assert.match(hub, /if \(blocked\) return/)
})

test('both actions are real, and each opens its own picker', () => {
  assert.match(composer, /label: 'Photos & images'/)
  assert.match(composer, /label: 'Files & documents'/)
  assert.match(composer, /onSelect: \(\) => imageInputRef\.current\?\.click\(\)/)
  assert.match(composer, /onSelect: \(\) => fileInputRef\.current\?\.click\(\)/)
})

test('the Photos entry is a filter over the one attachment system', () => {
  /*
   * It used to hard-code a MIME list, which is how the image and document
   * pickers came to disagree — a JPEG chosen through Files was refused as an
   * unsupported document. The shortcut now narrows the CHOOSER using the
   * canonical image list and sends what it finds through the same handler as
   * every other entry point.
   */
  assert.match(composer, /accept=\{IMAGE_ACCEPT\}/, 'the filter comes from the contract')
  assert.match(composer, /onChange=\{onPicked\}/, 'and lands in the shared handler')
})

test('the general attach entry does not filter before classification', () => {
  // No `accept` on the general input: the native dialog reads "All Files" rather
  // than "Custom Files", and nothing is excluded before the system has looked at
  // it. Selection and classification are separate acts.
  const general = composer.slice(composer.indexOf('ref={fileInputRef}'))
  const untilClose = general.slice(0, general.indexOf('/>'))
  assert.doesNotMatch(untilClose, /accept=/, 'the general picker must not pre-filter')
})

test('the menu is dismissible without a mouse', () => {
  assert.match(hub, /event\.key === 'Escape'/)
})

test('nothing renders as a finished image until it is stored', () => {
  /*
   * The pending tile is visibly not a picture. Optimistically showing a local
   * preview would claim the upload succeeded before the server had accepted it.
   */
  assert.match(tray, /pending &&/)
  assert.match(tray, /animate-spin/)
  assert.doesNotMatch(tray, /URL\.createObjectURL/)
})

test('a failure shows the server’s own words', () => {
  // The server knows which limit was hit; "upload failed" hides whether the file
  // was too large, too many pixels, or not an image at all.
  // `fail()` returns { error, message } as STRINGS — reading `error.message`
  // returned undefined and swallowed the server's reason behind the fallback.
  assert.match(composer, /data\?\.message \?\? 'That image could not be attached\.'/)
  assert.match(tray, /role="alert"/)
})

test('the remove control is reachable on touch, not only on hover', () => {
  assert.match(tray, /max-md:opacity-100/)
})

test('the durable set is labelled as what it is', () => {
  // An unlabelled thumbnail strip after a reload looks like a pending upload.
  assert.match(composer, /In this conversation — ask a follow-up without attaching it again/)
})

test('thumbnails are fetched by opaque ref, never embedded', () => {
  for (const source of [tray, read('components/chat/Message.tsx')]) {
    assert.match(source, /\/api\/images\/\$\{/)
    assert.doesNotMatch(source, /data:image\//, 'bytes must not be inlined into the transcript')
  }
})

test('the composer reads the canonical ref field, and refuses anything else', () => {
  /*
   * THE BROKEN THUMBNAIL. It read `image.id` — not a field on that response — so
   * the ref was `undefined`, the src became `/api/images/undefined`, and a 404
   * rendered into an <img> as a broken icon with the filename beside it, still
   * looking like a successful attachment.
   */
  assert.match(composer, /const ref = data\.image\.imageId/)
  assert.doesNotMatch(composer, /data\.image!?\.id\b/, 'there is no `id` field on that response')
  // Typed AND guarded: a ref that is not canonical never becomes a URL.
  assert.match(composer, /IMAGE_REF\.test\(ref\)/)
  assert.match(composer, /\^img_\[0-9a-f\]\{32\}\$/)
})

test('the response shape is imported, not re-declared from memory', () => {
  // A loose inline cast is what let the wrong field name compile.
  assert.match(composer, /import type \{ PublicImage \} from '@\/app\/api\/images\/route'/)
})

test('previews are contained, never cropped', () => {
  /*
   * `object-cover` filled the tile by cutting the picture down to its middle.
   * The worst case is the one this feature exists for: a tall screenshot whose
   * error message sits in the half that got cropped away, with no sign to the
   * user that anything was removed.
   */
  /*
   * Comments are stripped first. The prose above explains why cover is wrong and
   * therefore CONTAINS the word — a scan over the raw file matches the
   * explanation and fails on a correct implementation.
   */
  const codeOnly = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const [name, source] of [['tray', tray], ['transcript', read('components/chat/Message.tsx')]] as const) {
    const code = codeOnly(source)
    assert.match(code, /object-contain/, `${name} must contain the image`)
    assert.doesNotMatch(code, /object-cover/, `${name} must not crop it`)
  }
})

test('the transcript keeps the image in its own shape', () => {
  // Bounded by a max height rather than forced into a square, so a portrait
  // stays a portrait and the record matches what was actually sent.
  const message = read('components/chat/Message.tsx')
  /*
   * The PROPERTIES, not one exact height. What must never regress is that the
   * image is bounded on one axis and free on the other; the chosen bound is a
   * design decision that moved once already (a generated 1024px image needs more
   * room than a thumbnail) and pinning the literal class turned that into a
   * false failure.
   */
  assert.match(message, /max-h-\d+ w-auto max-w-full/)
})
