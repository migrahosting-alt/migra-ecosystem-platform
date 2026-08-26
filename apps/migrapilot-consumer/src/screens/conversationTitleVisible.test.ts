/**
 * A rename you cannot see.
 *
 * WHY THIS EXISTS. Rename was reported as broken. It was not: the PATCH returned
 * 200, `/api/conversations` reported the new title, and the History page showed
 * it under both Today and Recent. What the chat view did was display the
 * conversation's name NOWHERE — so from inside the conversation, where the
 * rename control lives, the result was invisible and indistinguishable from a
 * dead control.
 *
 * The rail must therefore show the title it offers to change.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (file: string): string => {
  const source = readFileSync(join(process.cwd(), 'src', file), 'utf8')
  // Comments explain the intent; they must never satisfy the assertion.
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

test('the rail that renames a conversation also shows its name', () => {
  const page = read('screens/ChatPage.tsx')
  assert.match(page, /title=\{conversation\.title\}/, 'the real title is passed in, not a placeholder')
  assert.match(page, /\{title\s*&&/, 'and rendered when present')
})

test('the title is rendered as text, never truncated out of existence', () => {
  const page = read('screens/ChatPage.tsx')
  // A long title must not blow out the rail, but it must still be readable in full
  // on hover rather than silently cut.
  assert.match(page, /truncate/, 'bounded in the rail')
  assert.match(page, /title=\{title\}/, 'full name available on hover')
})
