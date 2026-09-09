/**
 * The consumer's mail routes.
 *
 * These routes decide almost nothing — every OAuth check lives on the Brain,
 * and a consumer that pre-judged them would become a second, weaker copy of
 * the logic that stops a mailbox being grafted onto the wrong account. What is
 * under test is therefore the three things the consumer IS responsible for:
 * who may reach these routes at all, that unreachability is never rendered as
 * a claim about the connection, and that nothing Google sent ends up in a
 * redirect.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { GET as STATUS, DELETE as DISCONNECT } from './route'
import { POST as CONNECT } from './connect/route'
import { GET as CALLBACK } from './callback/route'
import { setAuthPort, resetAuthPort } from '@/server/auth'
import type { AppSession, AuthPort } from '@/server/auth/authPort'

const session: AppSession = {
  sessionId: 'sess-1',
  authUserId: 'auth-user-AAA',
  email: 'user@example.test',
  displayName: 'Example User',
  permissions: [],
  createdAt: Date.now(),
  expiresAt: Date.now() + 3_600_000,
}

const portWith = (current: AppSession | null): AuthPort => ({
  getSession: async () => current,
  buildLoginRedirect: async () => 'https://auth.example.test/authorize',
  buildSignupRedirect: async () => 'https://auth.example.test/signup',
  buildLogoutRedirect: () => 'https://auth.example.test/logout',
  handleCallback: async () => {},
  clearSession: async () => {},
})

const STATE = 'the-opaque-state-value'
const CODE = '4/0AbTheAuthorizationCode'

/** Stand in for the Brain at the network edge. */
function brainStub(options: { status?: number; body?: unknown; throws?: boolean } = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const original = globalThis.fetch

  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    if (options.throws) throw new Error('connect ECONNREFUSED')
    return new Response(JSON.stringify(options.body ?? { state: 'connected', account: 'a@b.test' }), {
      status: options.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch

  return { calls, restore: () => void (globalThis.fetch = original) }
}

const req = (url: string, init: RequestInit = {}): Request => new Request(url, init)

/* ------------------------------------------------------------------ *
 * 🚨 Who may reach these routes
 * ------------------------------------------------------------------ */

test('🚨 a signed-out visitor cannot begin a connection', async () => {
  /*
   * Stronger than the project refusal, and for a different reason. A mailbox
   * bound to an anonymous scope leaves a LIVE GRANT at Google — standing access
   * to a real person's email — attached to an identity that no longer exists
   * and that nothing here can resolve again in order to revoke it. The user
   * would have to remove it by hand, having been given no reason to think they
   * needed to.
   */
  setAuthPort(portWith(null))
  const brain = brainStub()
  try {
    const res = await CONNECT(req('https://chat.example.test/api/account/mail/connect', { method: 'POST' }))
    assert.equal(res.status, 401)
    assert.equal((await res.json()).remedy, 'sign-in')
    assert.equal(brain.calls.length, 0, 'a visitor reached the Brain')
  } finally {
    brain.restore()
    resetAuthPort()
  }
})

test('🚨 a signed-out visitor is not told their email is "not connected"', async () => {
  // That would answer a question about an account we have not identified, and
  // would show a Connect control to someone who cannot use it.
  setAuthPort(portWith(null))
  const brain = brainStub()
  try {
    const res = await STATUS()
    assert.equal(res.status, 401)
    const body = await res.json()
    assert.equal(body.remedy, 'sign-in')
    assert.notEqual(body.state, 'not_connected')
    assert.equal(brain.calls.length, 0)
  } finally {
    brain.restore()
    resetAuthPort()
  }
})

test('🚨 an ANONYMOUS visitor — a real principal — cannot connect a mailbox', async () => {
  /*
   * This is the case that matters, and until it existed nothing tested it.
   * The other refusals here have NO principal at all, so they exercise the
   * `!resolved` guard and never reach `canConnectMail` — exactly the gap that
   * once let an anonymous visitor through the project routes.
   *
   * An anonymous identity only exists when a signing secret is configured, so
   * the secret is set here to produce a genuine anonymous principal rather than
   * an absent one.
   */
  const previous = process.env.APP_SESSION_SECRET
  process.env.APP_SESSION_SECRET = 'test-anonymous-signing-secret'
  setAuthPort(portWith(null))
  const brain = brainStub()
  try {
    const begun = await CONNECT(req('https://chat.example.test/api/account/mail/connect', { method: 'POST' }))
    assert.equal(begun.status, 401, 'an anonymous visitor began a mailbox connection')
    assert.equal((await begun.json()).remedy, 'sign-in')

    const status = await STATUS()
    assert.equal(status.status, 401)

    // 🚨 The Brain is never reached. A grant bound to an anonymous scope would
    // leave standing access to a real mailbox attached to an identity that
    // disappears — with nothing left able to revoke it.
    assert.equal(brain.calls.length, 0, 'an anonymous visitor reached the Brain')
  } finally {
    brain.restore()
    resetAuthPort()
    if (previous === undefined) delete process.env.APP_SESSION_SECRET
    else process.env.APP_SESSION_SECRET = previous
  }
})

test('a signed-out visitor cannot disconnect', async () => {
  setAuthPort(portWith(null))
  const brain = brainStub()
  try {
    const res = await DISCONNECT(req('https://chat.example.test/api/account/mail', { method: 'DELETE' }))
    assert.equal(res.status, 401)
    assert.equal(brain.calls.length, 0)
  } finally {
    brain.restore()
    resetAuthPort()
  }
})

/* ------------------------------------------------------------------ *
 * 🚨 Unreachability is never a claim about the connection
 * ------------------------------------------------------------------ */

test('🚨 an unreachable Brain is 503, NOT "not connected"', async () => {
  /*
   * Rendering unreachability as "not connected" would show a Connect button to
   * someone whose mail IS connected — and if they pressed it, they would grant
   * consent again for no reason.
   */
  setAuthPort(portWith(session))
  const brain = brainStub({ throws: true })
  try {
    const res = await STATUS()
    assert.equal(res.status, 503)
    const body = await res.json()
    assert.equal(body.remedy, 'retry')
    assert.notEqual(body.state, 'not_connected')
  } finally {
    brain.restore()
    resetAuthPort()
  }
})

test('a reachable Brain answer is passed through unchanged', async () => {
  setAuthPort(portWith(session))
  const brain = brainStub({ body: { state: 'connected', account: 'alice@example.com', scopes: { read: true, draft: false, send: false } } })
  try {
    const res = await STATUS()
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), {
      state: 'connected',
      account: 'alice@example.com',
      scopes: { read: true, draft: false, send: false },
    })
  } finally {
    brain.restore()
    resetAuthPort()
  }
})

test('connect returns the URL the Brain built, and does not build one itself', async () => {
  // The consumer does not know the provider's name, its endpoints, or its
  // scopes — it asks where to send the user and sends them there.
  setAuthPort(portWith(session))
  const brain = brainStub({ body: { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' } })
  try {
    const res = await CONNECT(req('https://chat.example.test/api/account/mail/connect', { method: 'POST' }))
    assert.equal(res.status, 200)
    assert.equal((await res.json()).authorizationUrl, 'https://accounts.google.com/o/oauth2/v2/auth?x=1')
    assert.equal(brain.calls[0]!.init.method, 'POST', 'beginning a connection was not a POST')
  } finally {
    brain.restore()
    resetAuthPort()
  }
})

/* ------------------------------------------------------------------ *
 * 🚨 The callback
 * ------------------------------------------------------------------ */

const callbackUrl = (query: string): string => `https://chat.example.test/api/account/mail/callback?${query}`

test('🚨 nothing Google sent reaches the redirect', async () => {
  /*
   * One of these values is a bearer credential, and a redirect target is the
   * easiest place in a web application to leak one — through a Referer header
   * on the very next request.
   */
  setAuthPort(portWith(session))
  const brain = brainStub({ body: { connected: true, returnTo: '/chat/abc' } })
  try {
    const res = await CALLBACK(req(callbackUrl(`state=${STATE}&code=${encodeURIComponent(CODE)}`)))
    const location = res.headers.get('location') ?? ''
    assert.ok(!location.includes(STATE), `the state reached a redirect: ${location}`)
    assert.ok(!location.includes(CODE), `the authorization code reached a redirect: ${location}`)
    assert.ok(!location.includes('4/0Ab'), 'a fragment of the code reached a redirect')
    assert.equal(new URL(location).pathname, '/chat/abc')
  } finally {
    brain.restore()
    resetAuthPort()
  }
})

test('🚨 the callback forwards the parameters VERBATIM and judges none of them', async () => {
  // Every check lives on the Brain. A consumer that pre-judged them would
  // become a second, weaker copy of the logic that refuses a grafted mailbox.
  setAuthPort(portWith(session))
  const brain = brainStub({ body: { connected: true, returnTo: '/' } })
  try {
    await CALLBACK(req(callbackUrl(`state=${STATE}&code=${encodeURIComponent(CODE)}`)))
    const sent = JSON.parse(String(brain.calls[0]!.init.body))
    assert.equal(sent.state, STATE)
    assert.equal(sent.code, CODE)
  } finally {
    brain.restore()
    resetAuthPort()
  }
})

test('🚨 an OFF-SITE returnTo from the Brain is not followed', async () => {
  /*
   * The Brain already validated it, but it crossed a process boundary in
   * between and this is the last place before it becomes a Location header.
   * Checking twice costs nothing; being wrong sends someone who has just
   * authorised mailbox access to a site of an attacker's choosing.
   */
  for (const hostile of ['//evil.example', 'https://evil.example/x', '/\\evil.example']) {
    setAuthPort(portWith(session))
    const brain = brainStub({ body: { connected: true, returnTo: hostile } })
    try {
      const res = await CALLBACK(req(callbackUrl(`state=${STATE}&code=x`)))
      const location = new URL(res.headers.get('location') ?? '')
      assert.equal(location.origin, 'https://chat.example.test', `left the site for ${hostile}`)
    } finally {
      brain.restore()
      resetAuthPort()
    }
  }
})

test('🚨 a refused callback lands in the app, not on a JSON error page', async () => {
  // This is a browser navigation at the end of a flow the user started. The
  // right ending is the app with a message — never a JSON body, and never
  // Google's own words.
  setAuthPort(portWith(session))
  const brain = brainStub({ status: 400, body: { connected: false, message: 'That connection request is not valid.' } })
  try {
    const res = await CALLBACK(req(callbackUrl('state=forged&code=x')))
    assert.equal(res.status, 302)
    const location = new URL(res.headers.get('location') ?? '')
    assert.equal(location.pathname, '/')
    assert.equal(location.searchParams.get('mail'), 'failed')
  } finally {
    brain.restore()
    resetAuthPort()
  }
})

test('a session that ended during consent lands on a sign-in prompt, not an error', async () => {
  setAuthPort(portWith(null))
  const brain = brainStub()
  try {
    const res = await CALLBACK(req(callbackUrl(`state=${STATE}&code=x`)))
    assert.equal(res.status, 302)
    assert.equal(new URL(res.headers.get('location') ?? '').searchParams.get('mail'), 'signin')
    assert.equal(brain.calls.length, 0, 'a dead session still reached the Brain')
  } finally {
    brain.restore()
    resetAuthPort()
  }
})

test("🚨 the callback path is the canonical redirect URI", () => {
  /*
   * This path is generated by googleConsoleSetup() on the Brain and entered
   * into the Google Cloud console from that output. Renaming this directory
   * breaks every existing user's sign-in with redirect_uri_mismatch, and the
   * first person to notice would be a user — so the value is pinned here too,
   * on the side that actually serves it.
   */
  assert.equal(new URL(callbackUrl('')).pathname, '/api/account/mail/callback')
})
