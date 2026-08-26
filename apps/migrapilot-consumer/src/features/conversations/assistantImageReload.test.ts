/**
 * A generated picture survives a reload.
 *
 * WHY. The image was delivered live, stored under a canonical ref, and durably
 * attached to the assistant message — and then vanished on the next hard
 * refresh. `toMessage`, which rebuilds the thread from durable history, mapped
 * `imageRefs` for USER turns only. The assistant branch dropped them and always
 * emitted a paragraph.
 *
 * That is the same rule missed three times: in the server's `producedOutput`, in
 * the client's delivery condition, and here. "A picture is an answer" has to hold
 * at every place that decides what an assistant turn contains.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { toMessage } from './messages'

const REF = 'img_5113d7e58cbfe6e037defc49aa33091f'

test('an assistant turn carrying only an image keeps it on reload', () => {
  const message = toMessage(
    { id: 'm1', role: 'assistant', content: '', createdAt: Date.now(), imageRefs: [REF] },
    0,
  )
  assert.deepEqual(message.images, [REF], 'the ref reaches the rebuilt message')
  assert.deepEqual(message.blocks, [], 'and no empty paragraph is invented for it')
})

test('an assistant turn with words AND a picture keeps both', () => {
  const message = toMessage(
    { id: 'm2', role: 'assistant', content: 'Here it is.', createdAt: Date.now(), imageRefs: [REF] },
    0,
  )
  assert.deepEqual(message.images, [REF])
  assert.deepEqual(message.blocks, [{ type: 'paragraph', text: 'Here it is.' }])
})

test('a user attachment still survives, which was already true', () => {
  const message = toMessage(
    { id: 'm3', role: 'user', content: 'what is this?', createdAt: Date.now(), imageRefs: [REF] },
    0,
  )
  assert.deepEqual(message.images, [REF])
})

test('ORDER is preserved, because it is meaning', () => {
  // "Compare the first with the second" is a different question if they swap.
  const refs = [REF, 'img_' + 'b'.repeat(32), 'img_' + 'c'.repeat(32)]
  const message = toMessage(
    { id: 'm4', role: 'assistant', content: '', createdAt: Date.now(), imageRefs: refs },
    0,
  )
  assert.deepEqual(message.images, refs)
})

test('a turn with no images gains no empty image list', () => {
  const message = toMessage(
    { id: 'm5', role: 'assistant', content: 'text only', createdAt: Date.now() },
    0,
  )
  assert.equal(message.images, undefined)
  assert.deepEqual(message.blocks, [{ type: 'paragraph', text: 'text only' }])
})
