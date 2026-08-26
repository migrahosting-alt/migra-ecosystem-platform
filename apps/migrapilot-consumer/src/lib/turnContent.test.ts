/**
 * The invariant, and the guard that stops it being re-encoded.
 *
 * A rule spread across five files is five chances to encode its opposite. This
 * one was got wrong in all five before it had a home.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { artifactRefs, hasDeliverableContent, hasText } from './turnContent'

const REF = 'img_' + 'a'.repeat(32)

test('a turn with words is deliverable', () => {
  assert.equal(hasDeliverableContent({ content: 'Port-au-Prince.' }), true)
})

test('a turn with only a picture is deliverable — the whole point', () => {
  assert.equal(hasDeliverableContent({ content: '', imageRefs: [REF] }), true)
  assert.equal(hasDeliverableContent({ imageRefs: [REF] }), true)
})

test('a turn with neither is NOT deliverable', () => {
  /*
   * This distinction is what lets a half-written turn be withheld while a
   * finished picture is delivered. Losing it would render empty bubbles.
   */
  assert.equal(hasDeliverableContent({ content: '' }), false)
  assert.equal(hasDeliverableContent({ content: '   ' }), false)
  assert.equal(hasDeliverableContent({}), false)
  assert.equal(hasDeliverableContent({ content: null, imageRefs: null }), false)
})

test('only canonical refs count as artifacts', () => {
  // A malformed ref becomes `/api/images/<junk>`, which 404s and renders as a
  // broken icon — worse than being treated as absent.
  assert.deepEqual(artifactRefs({ imageRefs: ['nope', 42, null, REF] }), [REF])
  assert.equal(hasDeliverableContent({ content: '', imageRefs: ['nope'] }), false)
})

test('whitespace is not text', () => {
  assert.equal(hasText({ content: '\n\t  ' }), false)
  assert.equal(hasText({ content: ' a ' }), true)
})

/* ---- the guard ---- */

function sourcesUnder(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourcesUnder(full, found)
    else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) found.push(full)
  }
  return found
}

test('no file re-encodes "does this turn have content" for itself', () => {
  /*
   * The regression guard for the pattern, not for one instance. Any NEW
   * `content.length > 0` or `content.trim()` used to decide whether a message
   * exists reintroduces exactly the defect that took five fixes.
   *
   * `src/app/api/chat/route.ts` is the one legitimate exception and is named
   * explicitly: that is the BUFFERED route, and image generation requires
   * streaming, so a buffered answer with no text really is a failed turn.
   */
  const allowed = new Set(['src/app/api/chat/route.ts', 'src/lib/turnContent.ts'])
  const offenders: string[] = []

  for (const file of sourcesUnder(join(process.cwd(), 'src'))) {
    const relative = file.replace(process.cwd() + '/', '')
    if (allowed.has(relative)) continue
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    if (/\bcontent\.length\s*>\s*0|\bcontent\.trim\(\)\.length|\.content\.trim\(\)\s*\)/.test(code)) {
      offenders.push(relative)
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these decide message validity themselves — use hasDeliverableContent: ${offenders.join(', ')}`,
  )
})
