/**
 * Wire messages becoming transcript messages.
 *
 * The property under test: a message's pictures come from ITS OWN record, never
 * from whatever the conversation happens to be about today.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toMessage } from './messages'

test('a reloaded user message carries its own images, not the thread’s', () => {
  /*
   * THE DEFECT. The image was persisted at the conversation level and the
   * transcript rendered it from memory, so after a reload the sent message
   * showed its text and nothing else — the system remembered what the thread was
   * about while losing what each turn had carried.
   */
  const A = 'img_' + 'a'.repeat(32)
  const B = 'img_' + 'b'.repeat(32)
  const first = toMessage(
    { id: 'm1', role: 'user', content: 'What do you see in this image?', createdAt: 1, imageRefs: [A] }, 0)
  const second = toMessage(
    { id: 'm2', role: 'user', content: 'And this one?', createdAt: 2, imageRefs: [B] }, 1)

  assert.deepEqual(first.images, [A])
  assert.deepEqual(second.images, [B])
  assert.ok(!first.images!.includes(B), 'one message must not inherit the other’s picture')
})

test('order survives the mapping', () => {
  const A = 'img_' + 'a'.repeat(32)
  const B = 'img_' + 'b'.repeat(32)
  const m = toMessage({ id: 'm', role: 'user', content: 'compare', createdAt: 1, imageRefs: [B, A] }, 0)
  assert.deepEqual(m.images, [B, A])
})

test('a text-only message claims no images', () => {
  const m = toMessage({ id: 'm', role: 'user', content: 'hello', createdAt: 1 }, 0)
  assert.equal(m.images, undefined)
})
