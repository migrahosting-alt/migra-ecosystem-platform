/**
 * Principal resolution — the seam that admits signed-out visitors.
 *
 * This is the boundary a stranger crosses to reach real inference, so the tests
 * are about what must NOT happen: no browser-chosen scope, no downgrade of a
 * signed-in user, no shared bucket when a cookie cannot be verified, no
 * anonymous identity at all when we cannot sign one.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AnonymousDisabledError,
  isAnonymousAllowedOperation,
  isAnonymousScope,
  resolveSessionOrAnonymous,
} from './principal'
import { mintAnonymousIdentity } from './anonymousIdentity'

const SECRET = 'a-test-signing-secret-of-sufficient-length-0123456789'

const SESSION = {
  authUserId: 'auth-user-AAA',
  email: 'someone@example.com',
} as never

const deps = (over: Partial<Parameters<typeof resolveSessionOrAnonymous>[0]> = {}) => ({
  session: async () => null,
  anonymousCookie: () => undefined,
  secret: () => SECRET,
  ...over,
})

test('a verified session ALWAYS wins, even with an anonymous cookie present', async () => {
  /*
   * The downgrade this prevents: a signed-in person carrying an old anonymous
   * cookie gets silently limited to five turns, and their conversations are
   * filed under a scope they lose access to when the cookie expires.
   */
  const { cookieValue } = mintAnonymousIdentity(SECRET)
  const p = await resolveSessionOrAnonymous(
    deps({ session: async () => SESSION, anonymousCookie: () => cookieValue }),
  )
  assert.equal(p.kind, 'session')
  assert.equal(p.scope.owner, 'user:auth-user-AAA')
  assert.equal(isAnonymousScope(p.scope.owner), false)
})

test('a signed-out visitor with no cookie gets a fresh identity and a cookie to set', async () => {
  const p = await resolveSessionOrAnonymous(deps())
  assert.equal(p.kind, 'anonymous')
  assert.ok(p.kind === 'anonymous' && p.mintedCookie, 'the caller is told to write the cookie')
  assert.ok(p.scope.owner.startsWith('anon:'))
  assert.equal(p.scope.workspace, p.scope.owner, 'one workspace for a signed-out visitor')
})

test('a valid cookie is REUSED — refresh keeps the same identity', async () => {
  // This is what makes "refresh → same conversation" possible at all.
  const { cookieValue, identity } = mintAnonymousIdentity(SECRET)
  const p = await resolveSessionOrAnonymous(deps({ anonymousCookie: () => cookieValue }))
  assert.equal(p.kind, 'anonymous')
  assert.equal(p.scope.owner, identity.ownerScope)
  assert.equal(p.kind === 'anonymous' && p.mintedCookie, undefined, 'nothing to re-issue')
})

test('a TAMPERED cookie mints a new identity rather than being honoured', async () => {
  /*
   * The attack: edit the id in the cookie to someone else's and read their
   * conversation. The signature makes the pair unforgeable, and the response to
   * a bad pair is a NEW identity — never a fallback scope, which would drop
   * every failed verification into one shared bucket.
   */
  const { cookieValue, identity } = mintAnonymousIdentity(SECRET)
  const [id, sig] = cookieValue.split('.')
  const victim = mintAnonymousIdentity(SECRET).identity.anonymousSessionId

  const forged = `${victim}.${sig}`
  const p = await resolveSessionOrAnonymous(deps({ anonymousCookie: () => forged }))
  assert.equal(p.kind, 'anonymous')
  assert.notEqual(p.scope.owner, `anon:${victim}`, 'the forged id must not become a scope')
  assert.notEqual(p.scope.owner, identity.ownerScope)
  assert.ok(p.kind === 'anonymous' && p.mintedCookie, 'a replacement identity was issued')
  assert.ok(id && sig)
})

test('a cookie signed with a DIFFERENT secret is not honoured', async () => {
  const { cookieValue } = mintAnonymousIdentity('some-other-secret-entirely-0123456789abcd')
  const p = await resolveSessionOrAnonymous(deps({ anonymousCookie: () => cookieValue }))
  assert.ok(p.kind === 'anonymous' && p.mintedCookie, 'replaced, not trusted')
})

test('two visitors never share a scope', async () => {
  const a = await resolveSessionOrAnonymous(deps())
  const b = await resolveSessionOrAnonymous(deps())
  assert.notEqual(a.scope.owner, b.scope.owner)
})

test('without a signing secret, anonymous chat is REFUSED rather than weakened', async () => {
  // An unsigned anonymous identity is forgeable by anyone. Missing configuration
  // must disable the feature, not downgrade its security.
  await assert.rejects(
    () => resolveSessionOrAnonymous(deps({ secret: () => undefined })),
    AnonymousDisabledError,
  )
})

test('a session that throws is treated as signed out, not as an error', async () => {
  const p = await resolveSessionOrAnonymous(
    deps({ session: async () => { throw new Error('no session cookie') } }),
  )
  assert.equal(p.kind, 'anonymous')
})

test('the anonymous operation allowlist is closed by default', () => {
  /*
   * A denylist would expose every future Brain capability to the public internet
   * the moment it was added. These are the operations "try it before you sign
   * in" actually needs.
   */
  for (const allowed of ['chatTurn', 'createConversation', 'appendMessage', 'listMessages', 'getConversation', 'listConversations']) {
    assert.equal(isAnonymousAllowedOperation(allowed), true, `${allowed} must be reachable`)
  }
  for (const denied of ['listIndexes', 'createDocsIndex', 'syncIndex', 'approveIndex', 'transcribe', 'getCodingRun', 'setConversationGrounding']) {
    assert.equal(isAnonymousAllowedOperation(denied), false, `${denied} must NOT be reachable anonymously`)
  }
  assert.equal(isAnonymousAllowedOperation('somethingAddedNextWeek'), false, 'unknown operations are closed')
})

test('a visitor can undo their own conversations, not reach into an account', () => {
  /*
   * THIS REVERSES AN EARLIER LINE OF THIS SAME TEST, which asserted that
   * `deleteConversation` must not be reachable anonymously. That looked like
   * the safe default and was not: a signed-out visitor can create conversations
   * and append to them, so their scope fills up, and rename/delete/"Delete
   * conversation history" were then rendered to them and refused every time.
   *
   * The distinction that matters is not signed-in vs signed-out — it is whether
   * the operation stays inside the caller's own scope. These two do, and
   * row-level security is what enforces it. The claim does not, which is why it
   * remains authenticated even though it is part of the same visitor journey.
   */
  assert.equal(isAnonymousAllowedOperation('renameConversation'), true)
  assert.equal(isAnonymousAllowedOperation('deleteConversation'), true)
  assert.equal(
    isAnonymousAllowedOperation('claimAnonymousConversation'),
    false,
    'the claim crosses scopes and is made AS the account',
  )
})
