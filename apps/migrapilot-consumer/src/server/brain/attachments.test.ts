/**
 * The turn-attachment contract.
 *
 * Shaped for more than one image before more than one is accepted, because "one
 * image" baked into a transport becomes a breaking change across the consumer,
 * the contract, the Brain and every persisted turn at once.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateAttachments, needsVision, MAX_TURN_ATTACHMENTS } from './attachments'

const ref = (n: number) => `img_${String(n).padStart(32, '0')}`

test('absent attachments are an empty list, not an error', () => {
  for (const input of [undefined, null]) {
    const out = validateAttachments(input)
    assert.ok(out.ok)
    if (out.ok) assert.deepEqual(out.attachments, [])
  }
})

test('the order the user chose survives', () => {
  /*
   * "Compare the first with the second" is only answerable if the sequence
   * arrives intact — so this is a list, and nothing sorts it in flight.
   */
  const out = validateAttachments([
    { ref: ref(3), kind: 'image' },
    { ref: ref(1), kind: 'image' },
    { ref: ref(2), kind: 'image' },
  ])
  assert.ok(out.ok)
  if (out.ok) assert.deepEqual(out.attachments.map((a) => a.ref), [ref(3), ref(1), ref(2)])
})

test('purpose defaults to subject and reference is preserved', () => {
  /*
   * The same image can be the thing being asked about or the thing a result is
   * judged against. Generation workflows need to tell those apart, so the
   * distinction is carried now rather than added as a second breaking change.
   */
  const out = validateAttachments([
    { ref: ref(1), kind: 'image' },
    { ref: ref(2), kind: 'image', purpose: 'reference' },
  ])
  assert.ok(out.ok)
  if (out.ok) {
    assert.equal(out.attachments[0]?.purpose, 'subject')
    assert.equal(out.attachments[1]?.purpose, 'reference')
  }
})

test('a ref is validated against the ID SHAPE, not merely "is a string"', () => {
  for (const hostile of [
    '../../etc/passwd',
    '/var/lib/migrapilot/images/x.png',
    'img_' + 'z'.repeat(32),
    'img_' + 'a'.repeat(31),
    'file:///etc/passwd',
    '', null, undefined, 42, {}, [],
  ]) {
    const out = validateAttachments([{ ref: hostile as string, kind: 'image' }])
    assert.equal(out.ok, false, `${String(hostile)} must not pass`)
    if (!out.ok) assert.equal(out.rejection.code, 'invalid_ref')
  }
})

test('the same image twice is refused, not silently collapsed', () => {
  /*
   * Collapsing would change the order the user chose, and a follow-up about
   * "the second one" would then answer about a list they never sent.
   */
  const out = validateAttachments([{ ref: ref(1), kind: 'image' }, { ref: ref(1), kind: 'image' }])
  assert.equal(out.ok, false)
  if (!out.ok) assert.equal(out.rejection.code, 'duplicate_ref')
})

test('the count is bounded, because each attachment is context and cost', () => {
  const many = Array.from({ length: MAX_TURN_ATTACHMENTS + 1 }, (_, i) => ({ ref: ref(i + 1), kind: 'image' as const }))
  const out = validateAttachments(many)
  assert.equal(out.ok, false)
  if (!out.ok) {
    assert.equal(out.rejection.code, 'too_many')
    assert.match(out.rejection.message, new RegExp(String(MAX_TURN_ATTACHMENTS)))
  }
  // Exactly at the bound is allowed.
  assert.ok(validateAttachments(many.slice(0, MAX_TURN_ATTACHMENTS)).ok)
})

test('an unknown media kind is refused rather than assumed to be an image', () => {
  const out = validateAttachments([{ ref: ref(1), kind: 'audio' as unknown as 'image' }])
  assert.equal(out.ok, false)
  if (!out.ok) assert.equal(out.rejection.code, 'unsupported_kind')
})

test('a non-list is refused', () => {
  for (const bad of ['img_' + 'a'.repeat(32), { ref: ref(1) }, 7]) {
    assert.equal(validateAttachments(bad).ok, false)
  }
})

test('needsVision reflects the payload, not a flag someone set', () => {
  assert.equal(needsVision([]), false)
  assert.equal(needsVision([{ ref: ref(1), kind: 'image', purpose: 'subject' }]), true)
})

test('the chat operation sends attachments only when there are some', async () => {
  const { resolveOperation } = await import('./operations')
  const withNone = resolveOperation({ kind: 'chatTurn', prompt: 'hello' })
  assert.ok(!('attachments' in (withNone.body as Record<string, unknown>)),
    'an empty list must not be sent — the Brain distinguishes absent from empty')

  const withSome = resolveOperation({
    kind: 'chatTurn',
    prompt: 'what is this?',
    attachments: [{ ref: ref(1), kind: 'image', purpose: 'subject' }],
  })
  const body = withSome.body as { attachments?: { ref: string }[] }
  assert.equal(body.attachments?.length, 1)
  assert.equal(body.attachments?.[0]?.ref, ref(1))
})
