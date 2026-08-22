/**
 * The anonymous trust boundary.
 *
 * The Brain trusts `X-Owner-Scope` unconditionally, so the security property is
 * that ONLY this module can produce a valid one. Every test here is about that,
 * not about convenience.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ANON_OWNER_PREFIX,
  AnonymousIdentityError,
  isAnonymousScope,
  mintAnonymousIdentity,
  verifyAnonymousCookie,
} from './anonymousIdentity'

const SECRET = 'a-test-secret-that-is-long-enough'
const OTHER = 'a-different-secret-entirely-here!'

test('a minted identity round-trips through verification', () => {
  const { identity, cookieValue } = mintAnonymousIdentity(SECRET)
  const verified = verifyAnonymousCookie(cookieValue, SECRET)
  assert.equal(verified.anonymousSessionId, identity.anonymousSessionId)
  assert.equal(verified.ownerScope, identity.ownerScope)
})

test('the scope is DERIVED, never carried by the browser', () => {
  const { identity, cookieValue } = mintAnonymousIdentity(SECRET)
  // The cookie contains the id and a signature — and no scope string at all.
  assert.ok(!cookieValue.includes(ANON_OWNER_PREFIX), 'cookie must not carry a scope')
  assert.equal(identity.ownerScope, `${ANON_OWNER_PREFIX}${identity.anonymousSessionId}`)
})

test('two mints never share an identity', () => {
  const a = mintAnonymousIdentity(SECRET).identity.anonymousSessionId
  const b = mintAnonymousIdentity(SECRET).identity.anonymousSessionId
  assert.notEqual(a, b)
})

test('a tampered id is rejected — this is the whole point', () => {
  // Editing the id to read someone else's scope is exactly the attack the
  // signature exists to stop.
  const { cookieValue } = mintAnonymousIdentity(SECRET)
  const [, signature] = [cookieValue.slice(0, cookieValue.lastIndexOf('.')), cookieValue.slice(cookieValue.lastIndexOf('.') + 1)]
  const forged = `AAAAAAAAAAAAAAAAAAAAAAAA.${signature}`
  assert.throws(() => verifyAnonymousCookie(forged, SECRET), AnonymousIdentityError)
})

test('a tampered signature is rejected', () => {
  const { cookieValue } = mintAnonymousIdentity(SECRET)
  const id = cookieValue.slice(0, cookieValue.lastIndexOf('.'))
  assert.throws(() => verifyAnonymousCookie(`${id}.notavalidsignature`, SECRET), AnonymousIdentityError)
})

test('a cookie signed with a DIFFERENT secret is rejected', () => {
  // A cookie minted by another deployment — or a canary — must not be authority
  // here. This is the same property that stops a production session validating
  // against the canary.
  const { cookieValue } = mintAnonymousIdentity(OTHER)
  assert.throws(() => verifyAnonymousCookie(cookieValue, SECRET), AnonymousIdentityError)
})

test('malformed cookies are rejected rather than coerced', () => {
  for (const bad of ['', 'no-separator', '.', 'a.', '.b', 'x'.repeat(500)]) {
    assert.throws(
      () => verifyAnonymousCookie(bad, SECRET),
      AnonymousIdentityError,
      `"${bad.slice(0, 20)}" must be rejected`,
    )
  }
})

test('a scope-shaped string in the cookie position is still rejected', () => {
  // Someone who guesses the scheme cannot simply write the scope they want.
  assert.throws(() => verifyAnonymousCookie('anon:victim.signature', SECRET), AnonymousIdentityError)
})

test('signing refuses a missing or weak secret rather than producing a forgeable token', () => {
  for (const weak of ['', '   ', 'short']) {
    assert.throws(() => mintAnonymousIdentity(weak), AnonymousIdentityError, `"${weak}" must be refused`)
  }
})

test('isAnonymousScope recognises minted scopes and rejects impostors', () => {
  const { identity } = mintAnonymousIdentity(SECRET)
  assert.equal(isAnonymousScope(identity.ownerScope), true)

  // An authenticated scope must never read as anonymous, or the two namespaces
  // collapse and a user could be served an anonymous quota.
  assert.equal(isAnonymousScope('user:abc123'), false)
  assert.equal(isAnonymousScope('local'), false)
  assert.equal(isAnonymousScope('anon:'), false)
  assert.equal(isAnonymousScope('anon:has spaces'), false)
  assert.equal(isAnonymousScope('anon:short'), false)
})

test('the minted id is safe to place in a scope header', () => {
  // The Brain accepts [A-Za-z0-9._~-]; a delimiter here would let one identity
  // read as another.
  for (let i = 0; i < 50; i++) {
    const { identity } = mintAnonymousIdentity(SECRET)
    assert.match(identity.anonymousSessionId, /^[A-Za-z0-9._~-]+$/)
  }
})
