/**
 * Reopening a conversation, through the endpoint the BROWSER actually calls.
 *
 * WHY THIS EXISTS SEPARATELY. The Brain's own history route was already proven
 * to serve `imageRefs`, and the client hydration function was proven to keep
 * them — but the browser does not call the Brain. It calls THIS route, which
 * projects an ALLOWLIST of fields, and a field missing from that list is dropped
 * silently with nothing failing. That is one untested layer between two proven
 * ones, and it is exactly where a picture would disappear.
 *
 * The fixture is the REAL production response shape, and every assertion is on
 * this route's serialized JSON — never on a store the writer used.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.APP_SESSION_SECRET = 'messages-route-test-secret-value'

import { GET } from './route'
import { setAuthPort, resetAuthPort } from '@/server/auth'
import type { AppSession, AuthPort } from '@/server/auth/authPort'

const A = 'img_' + 'a'.repeat(32)
const B = 'img_' + 'b'.repeat(32)

const session: AppSession = {
  sessionId: 'sess-1', authUserId: 'auth-user-AAA', email: 'user@example.test',
  permissions: [], createdAt: Date.now(), expiresAt: Date.now() + 3_600_000,
}
setAuthPort({
  getSession: async () => session,
  buildLoginRedirect: async () => 'https://auth.example.test/authorize',
  buildSignupRedirect: async () => 'https://auth.example.test/signup',
  buildLogoutRedirect: () => 'https://auth.example.test/logout',
  handleCallback: async () => {},
  clearSession: async () => {},
} as AuthPort)

/**
 * The Brain answering exactly as production does.
 *
 * Captured from a live post-schema-19 conversation, so the shape is what the
 * consumer really receives rather than what it is assumed to receive.
 */
const BRAIN_HISTORY = {
  messages: [
    { id: 'm1', conversationId: 'c1', role: 'user', content: 'What do you see in this image?',
      status: 'complete', createdAt: 1, durable: true, imageRefs: [A] },
    { id: 'm2', conversationId: 'c1', role: 'assistant', content: 'Pink tulips in a glass vase.',
      status: 'complete', createdAt: 2, durable: true },
    { id: 'm3', conversationId: 'c1', role: 'user', content: 'And this one?',
      status: 'complete', createdAt: 3, durable: true, imageRefs: [B] },
  ],
}

function brainReturns(payload: unknown) {
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status: 200, headers: { 'content-type': 'application/json' },
    })) as typeof fetch
  return () => { globalThis.fetch = original }
}

const reopen = async (id = 'c1') => {
  const response = await GET(new Request(`http://localhost/api/conversations/${id}/messages`),
    { params: Promise.resolve({ id }) })
  return { status: response.status, body: await response.json() as { messages: { content: string; imageRefs?: string[] }[] } }
}

test('the browser endpoint carries imageRefs through its allowlist', async () => {
  /*
   * The projection lists fields explicitly. A field added upstream and forgotten
   * here vanishes with nothing failing — the way `groundingFiles` was lost once
   * already, and the way a picture would.
   */
  const restore = brainReturns(BRAIN_HISTORY)
  try {
    const { status, body } = await reopen()
    assert.equal(status, 200)

    const first = body.messages.find((m) => m.content.startsWith('What do you see'))!
    const second = body.messages.find((m) => m.content.startsWith('And this one'))!
    assert.deepEqual(first.imageRefs, [A], 'the originating turn must keep its own picture')
    assert.deepEqual(second.imageRefs, [B])
    assert.ok(!first.imageRefs!.includes(B), 'a turn must not inherit another turn’s picture')

    // Asserted on the SERIALIZED body, because that string is all the browser gets.
    assert.match(JSON.stringify(body), /imageRefs/)
  } finally { restore() }
})

test('a text-only turn claims no images', async () => {
  const restore = brainReturns({
    messages: [{ id: 'm1', role: 'user', content: 'just text', status: 'complete', createdAt: 1 }],
  })
  try {
    const { body } = await reopen()
    // Absent, not an empty array: "no picture" and "a picture that failed to
    // load" must not look the same downstream.
    assert.equal('imageRefs' in body.messages[0]!, false)
  } finally { restore() }
})

test('an assistant turn never carries images', async () => {
  const restore = brainReturns(BRAIN_HISTORY)
  try {
    const { body } = await reopen()
    const assistant = body.messages.find((m) => m.content.startsWith('Pink tulips'))!
    assert.equal(assistant.imageRefs, undefined)
  } finally { restore() }
})

test('refs that are not canonical never reach the browser', async () => {
  /*
   * The browser turns a ref straight into `/api/images/<ref>`. A value that is
   * not an id becomes a request that 404s and renders as a broken icon beside a
   * filename — which is what a user reads as "the attachment is there but
   * broken".
   */
  const restore = brainReturns({
    messages: [{ id: 'm1', role: 'user', content: 'q', status: 'complete', createdAt: 1,
      imageRefs: ['undefined', '../../etc/passwd', A] }],
  })
  try {
    const { body } = await reopen()
    assert.deepEqual(body.messages[0]!.imageRefs, [A])
  } finally { restore() }
})

test.after(() => resetAuthPort())


test('an image-only assistant turn is returned, not filtered away as empty', async () => {
  /*
   * THE FOURTH TIME THIS RULE WAS MISSED. An image-generation turn produces no
   * words, so this route's "still being written" filter — which judged emptiness
   * by text length alone — dropped a COMPLETE assistant message carrying a
   * generated picture. It was written durably, it showed in the Media Library,
   * and it vanished on every reload.
   *
   * The filter still has a job, asserted below: a turn genuinely mid-write, with
   * neither text nor images, must not render.
   */
  const restore = brainReturns({
    messages: [
      { id: 'm1', conversationId: 'c1', role: 'user', content: 'generate letter A in png',
        status: 'complete', createdAt: 1, durable: true },
      { id: 'm2', conversationId: 'c1', role: 'assistant', content: '',
        status: 'complete', createdAt: 2, durable: true, imageRefs: [A] },
      { id: 'm3', conversationId: 'c1', role: 'assistant', content: '',
        status: 'partial', createdAt: 3, durable: true },
    ],
  })

  const { body } = await reopen()
  assert.equal(body.messages.length, 2, `the picture must survive: ${JSON.stringify(body.messages)}`)
  assert.deepEqual(body.messages[1]!.imageRefs, [A], 'and its ref comes back with it')
  assert.equal(body.messages[1]!.content, '', 'an image-only turn has no text, and that is fine')

  restore()
})

test('a turn with neither text nor images is still withheld', async () => {
  // The filter's original purpose: a turn still being written must not render.
  const restore = brainReturns({
    messages: [
      { id: 'm1', conversationId: 'c1', role: 'user', content: 'hello',
        status: 'complete', createdAt: 1, durable: true },
      { id: 'm2', conversationId: 'c1', role: 'assistant', content: '',
        status: 'partial', createdAt: 2, durable: true },
    ],
  })

  const { body } = await reopen()
  assert.equal(body.messages.length, 1)

  restore()
})
