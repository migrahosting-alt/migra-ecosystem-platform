/**
 * Image refs, from the browser to the wire.
 *
 * WHY THIS FILE EXISTS AT ALL. `operations.ts` carries a comment about
 * `groundingFiles` being declared at one end and silently dropped at the next:
 * excess properties are not checked through a spread, so the omission compiled,
 * the tests passed, and retrieval quietly ranked over the whole library. Images
 * cross the same four layers. These assert the SERIALIZED body, not the types —
 * a type is not evidence that a value survived.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveOperation } from './operations'

const IMG_A = 'img_' + 'a'.repeat(32)
const IMG_B = 'img_' + 'b'.repeat(32)

const bytes = (name: string) => ({
  name, mimeType: 'image/png', dataBase64: 'AAAA', sizeBytes: 3,
})

test('resolved image bytes reach the wire as `attachments`', () => {
  const resolved = resolveOperation({
    kind: 'chatTurn', prompt: 'What do you see?', stream: true,
    imageAttachments: [bytes(IMG_A)],
  })
  const body = resolved.body as Record<string, unknown>
  // The Brain keys vision off `attachments[].mimeType`; anything else is invisible to it.
  assert.ok(Array.isArray(body.attachments), 'the field must survive the hop')
  assert.equal((body.attachments as unknown[]).length, 1)
  assert.deepEqual((body.attachments as Record<string, unknown>[])[0], {
    name: IMG_A, mimeType: 'image/png', dataBase64: 'AAAA', sizeBytes: 3,
  })
})

test('order is preserved, because order is meaning', () => {
  // "Compare the first with the second" is a different question if they swap.
  const resolved = resolveOperation({
    kind: 'chatTurn', prompt: 'compare them', imageAttachments: [bytes(IMG_B), bytes(IMG_A)],
  })
  const names = (resolved.body as { attachments: { name: string }[] }).attachments.map((a) => a.name)
  assert.deepEqual(names, [IMG_B, IMG_A])
})

test('a turn with no images sends no attachments key at all', () => {
  const resolved = resolveOperation({ kind: 'chatTurn', prompt: 'hello' })
  assert.equal('attachments' in (resolved.body as object), false,
    'an empty array would tell every log and audit line this turn had images')
})

test('an empty resolution is the same as none', () => {
  const resolved = resolveOperation({ kind: 'chatTurn', prompt: 'hello', imageAttachments: [] })
  assert.equal('attachments' in (resolved.body as object), false)
})

test('the durable image set is sent as opaque refs, never sanitised as filenames', () => {
  const resolved = resolveOperation({
    kind: 'setConversationImages', conversationId: 'c1', images: [IMG_A, IMG_B],
  })
  assert.equal(resolved.method, 'PUT')
  assert.match(resolved.path, /\/api\/ai\/conversations\/c1\/images$/)
  /*
   * Refs pass through unmapped. Running them through the filename sanitiser
   * would be treating an id as a name — the confusion the separate field exists
   * to prevent.
   */
  assert.deepEqual((resolved.body as { images: string[] }).images, [IMG_A, IMG_B])
})

test('an empty image set is a real fact and must still be sent', () => {
  // "I removed the picture" is not the same as "there never was one", and the
  // thread has to be able to stop being about an image.
  const resolved = resolveOperation({ kind: 'setConversationImages', conversationId: 'c1', images: [] })
  assert.deepEqual((resolved.body as { images: string[] }).images, [])
})

test('images and grounding files travel as separate fields', () => {
  // Merged into one list, the server would have to guess which store a name
  // belonged to, and they reconcile against different ones.
  const resolved = resolveOperation({
    kind: 'chatTurn', prompt: 'q', groundingFiles: ['notes.md'], imageAttachments: [bytes(IMG_A)],
  })
  const body = resolved.body as Record<string, unknown>
  assert.deepEqual(body.groundingFiles, ['notes.md'])
  assert.equal((body.attachments as unknown[]).length, 1)
})
