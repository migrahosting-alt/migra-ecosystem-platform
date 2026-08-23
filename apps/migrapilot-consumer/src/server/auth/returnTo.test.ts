/**
 * Where a sign-in lands.
 *
 * The destination is what makes "signing in continues the conversation" true
 * rather than aspirational — and it is also the classic open-redirect surface,
 * because the value is chosen before a round trip through a third party and used
 * afterwards to build a `Location` header.
 *
 * So it is kept server-side, and it is validated at BOTH ends. "We wrote it" is
 * a claim about the past; the check is cheap.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { RETURN_COOKIE, rememberReturnPath, safeReturnPath, takeReturnPath } from './returnTo'
import { __getCookie, __resetCookies, __setCookie } from '../../../test/nextHeadersStub.mjs'

test('a same-origin path is accepted', () => {
  assert.equal(safeReturnPath('/chat/conv_1'), '/chat/conv_1')
  assert.equal(safeReturnPath('/'), '/')
  assert.equal(safeReturnPath('/files?tab=recent'), '/files?tab=recent')
})

test('anything that could leave this origin is refused', () => {
  for (const hostile of [
    'https://evil.example/steal',
    'http://evil.example',
    // Browsers treat this as absolute; a naive "starts with /" check lets it through.
    '//evil.example/steal',
    '/\\evil.example',
    'javascript:alert(1)',
    'chat/conv_1',
    '',
  ]) {
    assert.equal(safeReturnPath(hostile), null, `${hostile} must not be a landing destination`)
  }
})

test('a control character cannot be smuggled into the Location header', () => {
  assert.equal(safeReturnPath('/chat\r\nSet-Cookie: a=b'), null)
  assert.equal(safeReturnPath('/chat\n/evil'), null)
})

test('an absurdly long value is refused rather than stored', () => {
  assert.equal(safeReturnPath(`/${'a'.repeat(600)}`), null)
})

test('a destination round-trips once, and only once', async () => {
  __resetCookies()

  await rememberReturnPath('/chat/conv_42')
  assert.equal(__getCookie(RETURN_COOKIE), '/chat/conv_42')

  assert.equal(await takeReturnPath(), '/chat/conv_42')
  // Single use: a stale destination must not hijack a later, unrelated sign-in.
  assert.equal(await takeReturnPath(), null)

  __resetCookies()
})

test('a hostile destination is never stored in the first place', async () => {
  __resetCookies()
  await rememberReturnPath('https://evil.example/steal')
  assert.equal(__getCookie(RETURN_COOKIE), undefined)
  __resetCookies()
})

test('a cookie that somehow holds a hostile value is still refused on the way out', async () => {
  __resetCookies()
  // Defence in depth: even a value this app is supposed to have written is
  // re-checked, because the check is cheap and the failure mode is an open
  // redirect from an authenticated flow.
  __setCookie(RETURN_COOKIE, 'https://evil.example/steal')
  assert.equal(await takeReturnPath(), null)
  __resetCookies()
})
