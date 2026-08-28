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

// ── attribution has to survive the reload ───────────────────────────────────
//
// "From your files: report.pdf" rendered during a turn and was gone the moment
// the page reloaded — for every format, because the assistant branch below
// dropped fileRefs exactly as it once dropped imageRefs. The persisted
// conversation was less truthful than the live one.

test('an answer keeps its sources when rebuilt from the wire', () => {
  const m = toMessage(
    { id: 'a1', role: 'assistant', content: 'Port-au-Prince led the quarter.', createdAt: 1,
      fileRefs: ['quarterly-report.docx'] },
    0,
  )
  assert.equal(m.role, 'assistant')
  assert.deepEqual(m.citedFiles, ['quarterly-report.docx'], 'attribution survives the rebuild')
})

test('a source deleted since the turn is marked, not silently linked', () => {
  const m = toMessage(
    { id: 'a2', role: 'assistant', content: 'It said 1,904,000.', createdAt: 1,
      fileRefs: ['gone.pdf', 'still-here.pdf'], missingFileRefs: ['gone.pdf'] },
    0,
  )
  assert.deepEqual(m.citedFiles, ['gone.pdf', 'still-here.pdf'], 'the record is immutable')
  assert.deepEqual(m.missingCitedFiles, ['gone.pdf'], 'and the one that is gone is flagged')
})

test('an answer with no sources gains no attribution', () => {
  const m = toMessage({ id: 'a3', role: 'assistant', content: 'Paris.', createdAt: 1 }, 0)
  assert.equal(m.citedFiles, undefined, 'a plain answer must not claim a source')
  assert.equal(m.missingCitedFiles, undefined)
})

test('a user message still shows attachments, not attribution', () => {
  // The two roles use the same wire field for different meanings: what the turn
  // CARRIED versus what the answer was DRAWN FROM. Conflating them would label
  // the question with "From your files".
  const m = toMessage(
    { id: 'u1', role: 'user', content: 'what does it say?', createdAt: 1, fileRefs: ['a.pdf'] },
    0,
  )
  assert.deepEqual((m as { files?: string[] }).files, ['a.pdf'])
  assert.equal((m as { citedFiles?: string[] }).citedFiles, undefined)
})
