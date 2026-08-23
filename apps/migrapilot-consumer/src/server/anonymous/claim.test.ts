/**
 * Signing in keeps the conversation.
 *
 * This is the moment the whole slice is for, and the moment a person decides
 * whether to trust the product: they asked four questions, hit the limit, signed
 * in — and either the thread is still there or it looks like they lost their
 * work.
 *
 * The properties that make it safe rather than merely convenient:
 *
 *   the transfer is made AS THE ACCOUNT, with the anonymous side named
 *   both halves come from ONE verified cookie, never from a request
 *   the conversation ID is preserved, so the URL still resolves
 *   the anonymous authority is revoked once, and ONLY once, nothing is left
 *     behind — a cookie discarded while its conversations are still in the
 *     anonymous scope makes them unreachable by anyone
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.APP_SESSION_SECRET = 'claim-test-signing-secret-value'

import { claimAnonymousWorkInto } from './claim'
import { ANONYMOUS_COOKIE_NAME, mintAnonymousIdentity } from '../tenancy/anonymousIdentity'
import type { AppSession } from '../auth/authPort'
import {
  __getCookie,
  __resetCookies,
  __setCookie,
} from '../../../test/nextHeadersStub.mjs'

const account: AppSession = {
  sessionId: 'sess-1',
  authUserId: 'auth-user-AAA',
  email: 'user@example.test',
  permissions: [],
  createdAt: Date.now(),
  expiresAt: Date.now() + 3_600_000,
}

interface StubOptions {
  conversations?: { id: string }[]
  /** Conversation ids the Brain refuses to move. */
  refuse?: string[]
  listStatus?: number
}

function brainStub(options: StubOptions = {}) {
  const calls: { path: string; method: string; body: any; scope: string | null }[] = []
  const original = globalThis.fetch

  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const path = new URL(String(url)).pathname
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({
      path,
      method: init.method ?? 'GET',
      body,
      scope: new Headers(init.headers).get('x-owner-scope'),
    })
    const json = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

    if (path === '/api/ai/conversations') {
      if (options.listStatus) return json(options.listStatus, { ok: false })
      return json(200, { conversations: options.conversations ?? [{ id: 'conv_1' }] })
    }
    if (path === '/api/ai/anonymous/claim') {
      if (options.refuse?.includes(body.conversationId)) {
        return json(404, { ok: false, code: 'NOT_FOUND' })
      }
      return json(200, { ok: true, conversationId: body.conversationId, claimed: true })
    }
    return json(404, { ok: false })
  }) as typeof globalThis.fetch

  return { calls, restore: () => void (globalThis.fetch = original) }
}

/** Put a real, verifiable anonymous identity in the jar. */
function visitorCookie(): { sessionId: string; owner: string } {
  const { identity, cookieValue } = mintAnonymousIdentity(process.env.APP_SESSION_SECRET!)
  __setCookie(ANONYMOUS_COOKIE_NAME, cookieValue)
  return { sessionId: identity.anonymousSessionId, owner: identity.ownerScope }
}

test('the conversation moves, keeps its id, and the visitor identity is revoked', async () => {
  __resetCookies()
  const visitor = visitorCookie()
  const brain = brainStub({ conversations: [{ id: 'conv_1' }] })

  const outcome = await claimAnonymousWorkInto(account)

  assert.deepEqual(outcome.claimed, ['conv_1'], 'the id is preserved, so /chat/conv_1 still resolves')
  assert.equal(outcome.failed.length, 0)

  // Read as the VISITOR — their scope is the only one those rows are visible in.
  const list = brain.calls.find((call) => call.path === '/api/ai/conversations')
  assert.equal(list?.scope, visitor.owner)

  // Moved AS THE ACCOUNT, with the anonymous side named. A claim sent as the
  // visitor is exactly what the Brain refuses.
  const claim = brain.calls.find((call) => call.path === '/api/ai/anonymous/claim')
  assert.equal(claim?.scope, 'user:auth-user-AAA')
  assert.equal(claim?.body.anonymousSessionId, visitor.sessionId)
  assert.equal(claim?.body.anonymousOwner, visitor.owner)
  assert.equal(claim?.body.anonymousOwner, `anon:${claim?.body.anonymousSessionId}`)

  // The browser's copy of a token that can no longer read anything is removed.
  assert.equal(__getCookie(ANONYMOUS_COOKIE_NAME), undefined)

  brain.restore()
  __resetCookies()
})

test('every conversation moves, not only the one on screen', async () => {
  __resetCookies()
  visitorCookie()
  const brain = brainStub({ conversations: [{ id: 'conv_1' }, { id: 'conv_2' }, { id: 'conv_3' }] })

  const outcome = await claimAnonymousWorkInto(account)

  assert.deepEqual(outcome.claimed, ['conv_1', 'conv_2', 'conv_3'])
  brain.restore()
  __resetCookies()
})

test('one refused conversation does not abandon the rest, and KEEPS the identity', async () => {
  __resetCookies()
  visitorCookie()
  const brain = brainStub({
    conversations: [{ id: 'conv_1' }, { id: 'conv_2' }],
    refuse: ['conv_1'],
  })

  const outcome = await claimAnonymousWorkInto(account)

  assert.deepEqual(outcome.failed, ['conv_1'])
  assert.deepEqual(outcome.claimed, ['conv_2'])
  /*
   * THE COOKIE SURVIVES A PARTIAL CLAIM, and this is the whole lesson.
   *
   * `conv_1` is still in the anonymous scope, and this cookie is the only
   * credential that can reach it. Revoking it here is how signing in destroyed a
   * visitor's history on production: the transfer was refused, the credential
   * was discarded, and the conversation became unreachable by anyone at all.
   */
  assert.ok(
    __getCookie(ANONYMOUS_COOKIE_NAME),
    'work left behind must stay reachable, so the retry can finish it',
  )

  brain.restore()
  __resetCookies()
})

test('a browser with no anonymous cookie claims nothing and touches no Brain', async () => {
  __resetCookies()
  const brain = brainStub()

  const outcome = await claimAnonymousWorkInto(account)

  assert.equal(outcome.hadAnonymousIdentity, false)
  assert.equal(brain.calls.length, 0)

  brain.restore()
})

test('a cookie we cannot prove we issued claims NOTHING', async () => {
  __resetCookies()
  // A forged pair. Honouring it would move rows on an unverified assertion —
  // which is how "make this conversation mine" becomes something anyone can ask.
  __setCookie(ANONYMOUS_COOKIE_NAME, `${'q'.repeat(24)}.notavalidsignature`)
  const brain = brainStub()

  const outcome = await claimAnonymousWorkInto(account)

  assert.equal(outcome.hadAnonymousIdentity, false)
  assert.equal(brain.calls.length, 0, 'no list, and certainly no claim')

  brain.restore()
  __resetCookies()
})

test('a failed listing KEEPS the identity — "we could not read it" is not "it is gone"', async () => {
  __resetCookies()
  visitorCookie()
  const brain = brainStub({ listStatus: 503 })

  const outcome = await claimAnonymousWorkInto(account)

  assert.equal(outcome.hadAnonymousIdentity, true)
  assert.deepEqual(outcome.claimed, [])
  assert.ok(
    __getCookie(ANONYMOUS_COOKIE_NAME),
    'a transient outage must not cost the visitor the only credential that reaches their work',
  )

  brain.restore()
  __resetCookies()
})

test('claiming twice moves nothing the second time — the cookie is already gone', async () => {
  __resetCookies()
  visitorCookie()
  const brain = brainStub({ conversations: [{ id: 'conv_1' }] })

  const first = await claimAnonymousWorkInto(account)
  const second = await claimAnonymousWorkInto(account)

  assert.deepEqual(first.claimed, ['conv_1'])
  assert.deepEqual(first.failed, [], 'a clean claim, so the identity is retired')
  assert.equal(second.hadAnonymousIdentity, false)
  assert.equal(
    brain.calls.filter((call) => call.path === '/api/ai/anonymous/claim').length,
    1,
    'the second call is inert, which is what makes the self-healing retry safe',
  )

  brain.restore()
  __resetCookies()
})
