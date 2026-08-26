/**
 * A picture is an answer.
 *
 * WHY THIS EXISTS. The server completed an image-generation turn: FLUX produced
 * a 201KB PNG, it was stored under a canonical ref, the assistant message that
 * owns it was written, and `done` was emitted — the trace read
 * `outcome=ok, answer_stored=10ms`. The BROWSER then threw it away and said "the
 * answer was cut off before it finished, so it was not saved".
 *
 * The last condition in the delivery path judged success by TEXT alone, and a
 * generation turn has none. The same mistake had already been found and fixed on
 * the server (`producedOutput`); its twin in the client was missed, so the whole
 * feature failed at the final step in the one place a user could see it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = (): string => {
  const raw = readFileSync(join(process.cwd(), 'src/state/ChatProvider.tsx'), 'utf8')
  // Comments explain the intent and must never satisfy the assertion.
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

test('a completed turn is delivered when it produced a picture and no text', () => {
  const code = source()
  assert.match(
    code,
    /if\s*\(done\s*&&\s*\(streamed\.trim\(\)\s*\|\|\s*generated\.length\s*>\s*0\)\)/,
    'the success condition must accept an image-only answer',
  )
})

test('a saved-but-unattached turn is judged the same way', () => {
  // The `not_saved` branch keeps a real answer on screen and marks it. An
  // image-only answer must reach that branch too, rather than being discarded.
  const code = source()
  assert.match(code, /if\s*\(notSaved\s*&&\s*\(streamed\.trim\(\)\s*\|\|\s*generated\.length\s*>\s*0\)\)/)
})

test('no condition judges a delivered answer by text alone', () => {
  /*
   * The regression guard. Every place this file decides whether an answer exists
   * must consider images too — a new `streamed.trim()` test added later would
   * reintroduce exactly this defect.
   */
  const code = source()
  const decisions = [...code.matchAll(/streamed\.trim\(\)/g)]
  assert.ok(decisions.length >= 2, 'the conditions still exist')
  for (const match of decisions) {
    const window = code.slice(match.index, match.index + 60)
    assert.match(
      window,
      /generated\.length/,
      `a text-only success test remains near index ${match.index}: ${window.replace(/\s+/g, ' ')}`,
    )
  }
})
