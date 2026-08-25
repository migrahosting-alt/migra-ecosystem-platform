/**
 * The picture must be on the bubble the moment it is sent.
 *
 * Not after a round trip, not after a reload — immediately, because that is when
 * the user looks. Both entry points are asserted: a conversation STARTED with an
 * image, and an image sent into an existing one. The first was missing while the
 * second worked, so a fresh conversation — exactly how someone attaches their
 * first image — showed text only, and every later turn in the same thread looked
 * correct. That asymmetry is what made it read as a persistence bug.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const provider = readFileSync(join(process.cwd(), 'src/state/ChatProvider.tsx'), 'utf8')
const code = provider.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** The optimistic message literal built by each entry point. */
function optimisticBlock(after: string): string {
  const at = code.indexOf(after)
  assert.ok(at > 0, `${after} must exist`)
  const slice = code.slice(at, at + 900)
  const start = slice.indexOf("role: 'user'")
  assert.ok(start > 0, `${after} must build a user message`)
  return slice.slice(start, start + 420)
}

test('a conversation STARTED with an image shows it immediately', () => {
  const block = optimisticBlock('const startConversation')
  assert.match(block, /options\?\.images\?\.length \? \{ images: options\.images \}/,
    'the first turn must carry its refs onto the bubble')
})

test('an image sent into an existing conversation shows it immediately', () => {
  const block = optimisticBlock('const sendMessage')
  assert.match(block, /options\?\.images\?\.length \? \{ images: options\.images \}/)
})

test('both entry points forward the refs to the server, not just to the screen', () => {
  /*
   * Screen and server are separate failures. Showing the picture without sending
   * it produces an answer about nothing; sending without showing produces the
   * bug this file exists for.
   */
  const calls = [...code.matchAll(/appendReply\([^)]*\)/g)].map((m) => m[0])
  assert.ok(calls.length >= 2, `expected both entry points to submit, found ${calls.length}`)
  for (const call of calls) {
    assert.match(call, /options\?\.images \?\? \[\]/, `refs must reach the server: ${call}`)
  }
})
