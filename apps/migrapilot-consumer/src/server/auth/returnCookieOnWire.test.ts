/**
 * The destination has to actually leave the server.
 *
 * WHY. Signing in from a conversation landed on the home page. The sign-in link
 * carried `?next=/chat/<id>`, the value was validated, and it was "stored" — but
 * the login route returned a bare `Response.redirect(...)`, and a cookie written
 * through `cookies()` is only emitted when the framework builds the response. So
 * the `Set-Cookie` header was silently dropped and the conversation was lost.
 *
 * ASSERTED ON THE WIRE. A test that checked `rememberReturnPath` was called would
 * have passed throughout the entire time this was broken.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { RETURN_COOKIE, redirectRememberingReturnPath } from './returnTo'

const cookieOf = (response: Response): string | null => response.headers.get('set-cookie')

test('the redirect carries the destination as a real Set-Cookie header', () => {
  const response = redirectRememberingReturnPath('https://auth.example.test/authorize', '/chat/conv_abc123')
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), 'https://auth.example.test/authorize')

  const cookie = cookieOf(response)
  assert.ok(cookie, 'the header must be present — this is the bug')
  assert.match(cookie!, new RegExp(`^${RETURN_COOKIE}=`))
  assert.match(cookie!, /%2Fchat%2Fconv_abc123/, 'and it must encode the path')
})

test('it is HttpOnly, Secure and Lax', () => {
  const cookie = cookieOf(redirectRememberingReturnPath('https://auth.example.test/a', '/chat/c1'))!
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /Secure/)
  // Lax, not Strict: the callback is a top-level navigation FROM the identity
  // provider, and Strict would withhold the cookie exactly there.
  assert.match(cookie, /SameSite=Lax/)
  assert.doesNotMatch(cookie, /SameSite=Strict/)
})

test('a destination this app cannot own is refused, not redirected to', () => {
  /*
   * The value originates in a query string. An absolute URL, a protocol-relative
   * host, or a backslash variant would each turn this into an open redirect.
   */
  for (const hostile of [
    'https://evil.example/steal',
    '//evil.example/steal',
    '\\\\evil.example',
    'javascript:alert(1)',
    '',
    null,
    undefined,
  ]) {
    const response = redirectRememberingReturnPath('https://auth.example.test/a', hostile as string | null)
    assert.equal(cookieOf(response), null, `${JSON.stringify(hostile)} must not be remembered`)
    assert.equal(response.status, 302, 'and the sign-in still proceeds')
  }
})

test('the sign-in is never blocked by an unusable destination', () => {
  // Losing the return path degrades the landing; it must never stop the login.
  const response = redirectRememberingReturnPath('https://auth.example.test/a', 'https://evil.example')
  assert.equal(response.headers.get('location'), 'https://auth.example.test/a')
})
