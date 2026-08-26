/**
 * Deleting a library asset must not corrupt a conversation.
 *
 * WHY. Removing a picture from the Media Library destroys the artifact. Any
 * message that referred to it still exists and must still be readable. Left
 * alone the browser draws a missing image as a broken icon, which reads as
 * "this is broken" rather than "you deleted this" — an orphan-reference surprise
 * that makes the whole transcript feel unreliable.
 *
 * THE MESSAGE KEEPS ITS REF. Only what is drawn in its place changes, so the
 * record of what the conversation was about stays intact and nothing is
 * rewritten behind the user's back.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = (): string => {
  const raw = readFileSync(join(process.cwd(), 'src/components/chat/Message.tsx'), 'utf8')
  // Comments explain the intent; they must never satisfy the assertion.
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

test('a missing image is detected rather than left as a broken icon', () => {
  const code = source()
  assert.match(code, /onError=\{\(\) => setMissing/, 'a failed load is observed')
})

test('the position says "Media deleted" instead of vanishing', () => {
  /*
   * Silently dropping it would be worse than the broken icon: the message would
   * imply nothing was ever attached, which is a different and false history.
   */
  const code = source()
  assert.match(code, /Media deleted/)
})

test('the viewer only pages across images that still exist', () => {
  // Otherwise the arrows walk into a deleted ref and reproduce the broken state
  // one level deeper, in full screen.
  const code = source()
  assert.match(code, /refs=\{present\}/)
})

test('the deleted state is a real UI branch, not a message rewrite', () => {
  // `refs` is still mapped in full — the record is unchanged, only the rendering
  // differs — so deleting media never edits history.
  const code = source()
  assert.match(code, /refs\.map\(\(ref\) =>/)
  assert.match(code, /missing\.has\(ref\)/)
})
