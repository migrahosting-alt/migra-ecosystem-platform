/**
 * Starting an email connection from the UI.
 *
 * The property that matters most is negative: a failure must NOT navigate.
 * Sending someone to a consent screen whose callback is guaranteed to be
 * refused takes their mailbox permission and then throws it away.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  beginEmailConnection,
  remedyLabel,
  CONNECT_SIGN_IN,
  CONNECT_UNAVAILABLE,
} from './connectEmail'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y'

const respond = (status: number, body: unknown, opts: { throws?: boolean } = {}) =>
  (async () => {
    if (opts.throws) throw new Error('connect ECONNREFUSED')
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch

/* ------------------------------------------------------------------ *
 * Wording
 * ------------------------------------------------------------------ */

test('🚨 connecting and reconnecting are worded differently', () => {
  /*
   * Someone whose grant expired HAS an account linked. Calling it "Connect"
   * describes a first-time action and hides that the authorization is what
   * broke.
   */
  assert.equal(remedyLabel('connect-account'), 'Connect')
  assert.equal(remedyLabel('reconnect-account'), 'Reconnect')
  assert.notEqual(remedyLabel('connect-account'), remedyLabel('reconnect-account'))
})

/* ------------------------------------------------------------------ *
 * The happy path
 * ------------------------------------------------------------------ */

test('a started flow returns the server-built URL', async () => {
  const outcome = await beginEmailConnection('/chat/abc', {
    fetchImpl: respond(200, { authorizationUrl: AUTH_URL }),
  })
  assert.deepEqual(outcome, { ok: true, authorizationUrl: AUTH_URL })
})

test('🚨 this side sends a PATH and never builds a URL of its own', async () => {
  /*
   * A consumer that built its own authorization URL would be a second place
   * where the redirect URI and the scopes are decided, and the two would drift
   * — with the first symptom appearing at a user's sign-in.
   */
  let sent: RequestInit | undefined
  const capture = (async (_url: string, init: RequestInit) => {
    sent = init
    return new Response(JSON.stringify({ authorizationUrl: AUTH_URL }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch

  await beginEmailConnection('/chat/abc', { fetchImpl: capture })
  const body = JSON.parse(String(sent?.body))
  assert.equal(body.returnTo, '/chat/abc')
  assert.equal(sent?.method, 'POST', 'starting a connection was not a POST')
  const serialised = JSON.stringify(body)
  assert.ok(!/googleapis|accounts\.google|scope|client_id/i.test(serialised),
    `the consumer named an OAuth concept: ${serialised}`)
})

/* ------------------------------------------------------------------ *
 * 🚨 Failures do not navigate
 * ------------------------------------------------------------------ */

test('🚨 a transport failure yields no URL', async () => {
  const outcome = await beginEmailConnection('/', { fetchImpl: respond(0, {}, { throws: true }) })
  assert.deepEqual(outcome, { ok: false, message: CONNECT_UNAVAILABLE })
})

test('🚨 a 200 with NO url is a failure, not a navigation', async () => {
  /*
   * `location.assign('undefined')` would send the user to a relative path
   * inside our own app named "undefined" — a broken page that looks like the
   * product simply lost their click.
   */
  const outcome = await beginEmailConnection('/', { fetchImpl: respond(200, {}) })
  assert.equal(outcome.ok, false)
})

test('🚨 a RELATIVE or non-https url is refused', async () => {
  for (const bad of ['/oauth/start', 'http://accounts.google.com/x', 'javascript:alert(1)', 'undefined']) {
    const outcome = await beginEmailConnection('/', { fetchImpl: respond(200, { authorizationUrl: bad }) })
    assert.equal(outcome.ok, false, `${bad} was accepted as a destination`)
  }
})

test('a non-JSON body is a failure rather than a crash', async () => {
  const outcome = await beginEmailConnection('/', { fetchImpl: respond(200, '<html>gateway</html>') })
  assert.equal(outcome.ok, false)
})

test('🚨 a 503 does not navigate', async () => {
  const outcome = await beginEmailConnection('/', {
    fetchImpl: respond(503, { error: 'brain_unavailable' }),
  })
  assert.deepEqual(outcome, { ok: false, message: CONNECT_UNAVAILABLE })
})

test('🚨 needing to sign in is a DIFFERENT message from a retry', async () => {
  // "Try again shortly" is advice a signed-out user cannot act on.
  const outcome = await beginEmailConnection('/', {
    fetchImpl: respond(401, { error: 'unauthenticated', remedy: 'sign-in' }),
  })
  assert.deepEqual(outcome, { ok: false, message: CONNECT_SIGN_IN })
  assert.notEqual(CONNECT_SIGN_IN, CONNECT_UNAVAILABLE)
})

test('no failure message names a provider or an OAuth concept', async () => {
  for (const message of [CONNECT_UNAVAILABLE, CONNECT_SIGN_IN]) {
    assert.ok(!/google|gmail|oauth|token|scope/i.test(message),
      `machinery leaked into a user-facing message: ${message}`)
  }
})
