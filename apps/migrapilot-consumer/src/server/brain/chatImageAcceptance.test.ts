/**
 * The image-chat behaviours that are proven, locked as one suite.
 *
 * WHY IT IS ONE FILE. Each of these was broken separately, and each was found in
 * the browser rather than by a test: the first turn showed no picture; the
 * historical message lost it on reload while the composer kept it; a resize
 * import took the whole turn down. They are grouped so a change to any part of
 * chat runs all of them, because the last four defects were caused by fixing one
 * of these and silently undoing another.
 *
 * ASSERTED AT THE SEAM AND THE WIRE, never on internal state: what these guard is
 * that the value actually LEAVES this service.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveOperation } from './operations'
import { toMessage } from '@/features/conversations/messages'

const A = 'img_' + 'a'.repeat(32)
const B = 'img_' + 'b'.repeat(32)
const bytes = (name: string) => ({ name, mimeType: 'image/png', dataBase64: 'AAAA', sizeBytes: 3 })

// ── 1. the turn carries the picture to the model ──────────────────────────

test('an image turn sends real bytes to the model, keyed by mime', () => {
  const body = resolveOperation({
    kind: 'chatTurn', prompt: 'What do you see in this image?', imageAttachments: [bytes(A)],
  }).body as Record<string, unknown>
  const attachments = body.attachments as { mimeType: string; dataBase64: string }[]
  assert.equal(attachments.length, 1)
  assert.equal(attachments[0]!.mimeType, 'image/png', 'the Brain keys vision off mimeType')
  assert.ok(attachments[0]!.dataBase64.length > 0)
})

test('the turn is durable, or the thread does not survive a restart', () => {
  const body = resolveOperation({ kind: 'chatTurn', prompt: 'q' }).body as {
    memoryPolicy?: { mode?: string; store?: boolean }
  }
  assert.equal(body.memoryPolicy?.mode, 'durable')
  assert.equal(body.memoryPolicy?.store, true)
})

// ── 2. the picture is recorded ON the message ─────────────────────────────

test('the append the consumer uses carries the refs', () => {
  /*
   * The defect that survived four rounds of investigation: the engine's in-turn
   * append records refs and never runs for a streamed turn, so the picture
   * reached the conversation's active set and nothing else. Every other layer
   * was correct about a column nobody filled.
   */
  const body = resolveOperation({
    kind: 'appendMessage', conversationId: 'c1', role: 'user', content: 'q', imageRefs: [A],
  }).body as { imageRefs?: string[] }
  assert.deepEqual(body.imageRefs, [A])
})

test('history and active context are separate writes to separate places', () => {
  // conversations.image_refs = what a follow-up may use.
  // conversation_messages.image_refs = what one turn actually carried.
  const active = resolveOperation({ kind: 'setConversationImages', conversationId: 'c1', images: [B] })
  assert.match(active.path, /\/conversations\/c1\/images$/)
  assert.deepEqual((active.body as { images: string[] }).images, [B])

  const historical = resolveOperation({
    kind: 'appendMessage', conversationId: 'c1', role: 'user', content: 'q', imageRefs: [A],
  })
  assert.match(historical.path, /\/conversations\/c1\/messages$/)
  assert.deepEqual((historical.body as { imageRefs: string[] }).imageRefs, [A],
    'detaching A from active context must not touch what this turn recorded')
})

// ── 3. reload rebuilds the turn from its own record ───────────────────────

test('a reloaded message renders its own picture, not the thread’s', () => {
  const first = toMessage({ id: 'm1', role: 'user', content: 'about A', createdAt: 1, imageRefs: [A] }, 0)
  const second = toMessage({ id: 'm2', role: 'user', content: 'about B', createdAt: 2, imageRefs: [B] }, 1)
  assert.deepEqual(first.images, [A])
  assert.deepEqual(second.images, [B])
  assert.ok(!first.images!.includes(B))
})

test('a text-only turn claims no picture', () => {
  assert.equal(toMessage({ id: 'm', role: 'user', content: 'hi', createdAt: 1 }, 0).images, undefined)
  const body = resolveOperation({ kind: 'chatTurn', prompt: 'hi' }).body as Record<string, unknown>
  assert.equal('attachments' in body, false, 'a text turn must not look like an image turn')
})

// ── 4. nothing that is not a ref becomes a URL ────────────────────────────

test('only canonical refs ever travel', () => {
  /*
   * The browser turns a ref straight into `/api/images/<ref>`. Anything else is
   * a 404 rendered as a broken icon beside a filename — which reads as "the
   * attachment is there but broken".
   */
  const body = resolveOperation({
    kind: 'setConversationImages', conversationId: 'c1', images: [A, B],
  }).body as { images: string[] }
  for (const ref of body.images) assert.match(ref, /^img_[0-9a-f]{32}$/)
})

// ── 5. order is meaning ───────────────────────────────────────────────────

test('multiple images keep the order they were attached in', () => {
  const body = resolveOperation({
    kind: 'chatTurn', prompt: 'compare them', imageAttachments: [bytes(B), bytes(A)],
  }).body as { attachments: { name: string }[] }
  assert.deepEqual(body.attachments.map((a) => a.name), [B, A])
})
