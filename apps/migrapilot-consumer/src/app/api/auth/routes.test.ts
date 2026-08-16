/**
 * The three auth route contracts: login, callback, logout.
 *
 * Each handler is exercised against an injected `AuthPort`, so no network, no
 * MigraAuth and no cookie store are involved. What is under test is the part
 * these routes are actually accountable for — status codes, redirect targets,
 * what reaches the URL, and what happens when the port refuses.
 *
 * The routes deliberately hold no OAuth knowledge: PKCE, state and the token
 * exchange live in `@migrateck/auth-client`. A route that built its own
 * authorize URL would silently bypass PKCE, so `buildLoginRedirect` being the
 * only source of that URL is itself a security property worth pinning.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { GET as login } from './login/route'
import { GET as callback } from './callback/route'
import { GET as logoutGet, POST as logoutPost } from './logout/route'
import { setAuthPort, resetAuthPort } from '@/server/auth'
import { AuthNotConfiguredError, unconfiguredAuthPort, type AuthPort, type BootstrapFn } from '@/server/auth/authPort'

// ── harness ─────────────────────────────────────────────────────────────────

const APP_BASE = 'https://chat.example.test'
const AUTHORIZE =
  'https://auth.example.test/authorize?response_type=code&client_id=migrapilot_web' +
  '&redirect_uri=https%3A%2F%2Fchat.example.test%2Fapi%2Fauth%2Fcallback' +
  '&scope=openid+profile+email+offline_access' +
  '&code_challenge=uK4TqIN3n23nJMFQ-0KXDbUuB6CzSfpY3Va3Exltb28&code_challenge_method=S256&state=abc123'

interface Recorded {
  callbacks: { code: string; state: string }[]
  bootstraps: BootstrapFn[]
  cleared: number
}

function recordingPort(over: Partial<AuthPort> = {}): { port: AuthPort; recorded: Recorded } {
  const recorded: Recorded = { callbacks: [], bootstraps: [], cleared: 0 }
  const port: AuthPort = {
    getSession: async () => null,
    buildLoginRedirect: async () => AUTHORIZE,
    buildLogoutRedirect: () => `https://auth.example.test/logout?return_to=${encodeURIComponent(APP_BASE)}`,
    handleCallback: async ({ code, state, bootstrap }) => {
      recorded.callbacks.push({ code, state })
      recorded.bootstraps.push(bootstrap)
    },
    clearSession: async () => {
      recorded.cleared += 1
    },
    ...over,
  }
  return { port, recorded }
}

/** `Response.redirect` needs an absolute request URL; this supplies a real one. */
const callbackRequest = (query: string): Request => new Request(`${APP_BASE}/api/auth/callback${query}`)

function setBaseUrl(value: string | undefined): void {
  if (value === undefined) delete process.env.APP_BASE_URL
  else process.env.APP_BASE_URL = value
}

// Routes read APP_BASE_URL directly; start every test from a known value.
setBaseUrl(APP_BASE)

// ── login ───────────────────────────────────────────────────────────────────

test('login redirects to exactly the authorize URL the port built', async () => {
  const { port } = recordingPort()
  setAuthPort(port)

  const response = await login()
  assert.equal(response.status, 302)
  // Byte-identical: the route must not rewrite, re-encode or augment the URL.
  assert.equal(response.headers.get('location'), AUTHORIZE)
  resetAuthPort()
})

test('the authorize URL carries PKCE S256 and a state, and no secret', async () => {
  const { port } = recordingPort()
  setAuthPort(port)

  const location = (await login()).headers.get('location')!
  const params = new URL(location).searchParams
  assert.equal(params.get('response_type'), 'code')
  assert.equal(params.get('code_challenge_method'), 'S256')
  assert.ok(params.get('code_challenge'))
  assert.ok(params.get('state'))
  // `migrapilot_web` is a public client: a secret in the browser-visible URL
  // would be a disclosure, not a configuration detail.
  assert.equal(params.get('client_secret'), null)
  assert.equal(params.get('code_verifier'), null)
  resetAuthPort()
})

test('login answers 503 — never a redirect — when auth is unconfigured', async () => {
  // A redirect to a login that cannot complete strands the user at the issuer.
  setAuthPort(unconfiguredAuthPort)

  const response = await login()
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('location'), null)
  assert.equal((await response.json()).error, 'auth_not_configured')
  resetAuthPort()
})

test('login propagates an unexpected fault rather than masking it as 503', async () => {
  // 503 means "not configured". Anything else must not be laundered into it.
  const { port } = recordingPort({
    buildLoginRedirect: async () => {
      throw new Error('issuer unreachable')
    },
  })
  setAuthPort(port)

  await assert.rejects(() => login(), /issuer unreachable/)
  resetAuthPort()
})

// ── callback ────────────────────────────────────────────────────────────────

test('a valid callback exchanges the code and lands the user on the app', async () => {
  const { port, recorded } = recordingPort()
  setAuthPort(port)

  const response = await callback(callbackRequest('?code=the-code&state=the-state'))
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), `${APP_BASE}/`)
  assert.deepEqual(recorded.callbacks, [{ code: 'the-code', state: 'the-state' }])
  resetAuthPort()
})

test('the callback supplies a bootstrap that invents no org and no permissions', async () => {
  // Org context must arrive from a resolver, never from token claims, and this
  // app has no resolver wired yet. Fabricating membership here would grant
  // tenancy the issuer never asserted.
  const { port, recorded } = recordingPort()
  setAuthPort(port)

  await callback(callbackRequest('?code=c&state=s'))
  assert.equal(recorded.bootstraps.length, 1)

  const supplied: BootstrapFn = recorded.bootstraps[0]!
  const result = await supplied({
    authUserId: 'auth-user-AAA',
    email: 'user@example.test',
    accessToken: 'token-value',
    expiresInSeconds: 3600,
  })
  assert.equal(result.activeOrg, null)
  assert.deepEqual(result.permissions, [])
  resetAuthPort()
})

test('the callback never puts the code, state or a token in the redirect', async () => {
  const { port } = recordingPort()
  setAuthPort(port)

  const location = (await callback(callbackRequest('?code=the-code&state=the-state'))).headers.get('location')!
  for (const leak of ['the-code', 'the-state', 'access_token', 'code=']) {
    assert.ok(!location.includes(leak), `redirect leaked ${leak}: ${location}`)
  }
  resetAuthPort()
})

test('a callback missing code or state is refused without an exchange', async () => {
  for (const query of ['', '?code=only', '?state=only', '?code=&state=s', '?code=c&state=']) {
    const { port, recorded } = recordingPort()
    setAuthPort(port)

    const response = await callback(callbackRequest(query))
    assert.equal(response.status, 400, `query ${query || '(none)'} should be refused`)
    assert.equal((await response.json()).error, 'invalid_callback')
    assert.deepEqual(recorded.callbacks, [], 'a malformed callback must not reach the exchange')
    resetAuthPort()
  }
})

test('a provider error becomes a failed sign-in, not a crash', async () => {
  const { port, recorded } = recordingPort()
  setAuthPort(port)

  const response = await callback(callbackRequest('?error=access_denied'))
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), `${APP_BASE}/?auth_error=access_denied`)
  assert.deepEqual(recorded.callbacks, [])
  resetAuthPort()
})

test('a provider error is encoded, so it cannot inject extra query parameters', async () => {
  const { port } = recordingPort()
  setAuthPort(port)

  const response = await callback(callbackRequest('?error=' + encodeURIComponent('x&admin=1')))
  const location = new URL(response.headers.get('location')!)
  assert.equal(location.searchParams.get('auth_error'), 'x&admin=1')
  assert.equal(location.searchParams.get('admin'), null)
  resetAuthPort()
})

test('a rejected exchange is a failed sign-in with no detail in the URL', async () => {
  // Replayed code, bad state, expired verifier — all user-visible as one
  // opaque failure. The reason must not reach the address bar.
  const { port } = recordingPort({
    handleCallback: async () => {
      throw new Error('PKCE verifier mismatch for subject auth-user-AAA')
    },
  })
  setAuthPort(port)

  const response = await callback(callbackRequest('?code=c&state=s'))
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), `${APP_BASE}/?auth_error=exchange_failed`)
  const location = response.headers.get('location')!
  assert.ok(!location.includes('PKCE'))
  assert.ok(!location.includes('auth-user-AAA'))
  resetAuthPort()
})

test('the callback answers 503 when auth is unconfigured', async () => {
  setAuthPort(unconfiguredAuthPort)

  const response = await callback(callbackRequest('?code=c&state=s'))
  assert.equal(response.status, 503)
  assert.equal((await response.json()).error, 'auth_not_configured')
  resetAuthPort()
})

test('the callback survives an empty APP_BASE_URL instead of answering 500', async () => {
  // `Response.redirect` requires an absolute URL. An empty base previously
  // produced `//?auth_error=…` and threw, failing a sign-in that had succeeded.
  const { port } = recordingPort()
  setAuthPort(port)
  setBaseUrl('')

  const response = await callback(callbackRequest('?code=c&state=s'))
  assert.equal(response.status, 302)
  const location = response.headers.get('location')!
  assert.doesNotThrow(() => new URL(location))
  assert.equal(new URL(location).origin, APP_BASE)

  setBaseUrl(APP_BASE)
  resetAuthPort()
})

test('a relative APP_BASE_URL does not produce an unparseable redirect', async () => {
  const { port } = recordingPort()
  setAuthPort(port)
  setBaseUrl('/app')

  const location = (await callback(callbackRequest('?code=c&state=s'))).headers.get('location')!
  assert.doesNotThrow(() => new URL(location))

  setBaseUrl(APP_BASE)
  resetAuthPort()
})

test('a trailing slash on APP_BASE_URL does not double the separator', async () => {
  const { port } = recordingPort()
  setAuthPort(port)
  setBaseUrl(`${APP_BASE}//`)

  const location = (await callback(callbackRequest('?code=c&state=s'))).headers.get('location')!
  assert.equal(location, `${APP_BASE}/`)

  setBaseUrl(APP_BASE)
  resetAuthPort()
})

// ── logout ──────────────────────────────────────────────────────────────────

test('logout destroys the local session before redirecting to the issuer', async () => {
  for (const handler of [logoutPost, logoutGet]) {
    const { port, recorded } = recordingPort()
    setAuthPort(port)

    const response = await handler()
    assert.equal(response.status, 302)
    assert.equal(recorded.cleared, 1, 'the local session must be cleared exactly once')
    assert.equal(new URL(response.headers.get('location')!).pathname, '/logout')
    resetAuthPort()
  }
})

test('the local session is cleared even if the issuer redirect is never followed', async () => {
  // Order matters: clearing after building the redirect would leave a live
  // cookie behind whenever the browser drops the redirect.
  const order: string[] = []
  const { port } = recordingPort({
    clearSession: async () => {
      order.push('clear')
    },
    buildLogoutRedirect: () => {
      order.push('redirect')
      return 'https://auth.example.test/logout'
    },
  })
  setAuthPort(port)

  await logoutPost()
  assert.deepEqual(order, ['clear', 'redirect'])
  resetAuthPort()
})

test('logout answers 503 when auth is unconfigured', async () => {
  for (const handler of [logoutPost, logoutGet]) {
    setAuthPort(unconfiguredAuthPort)

    const response = await handler()
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error, 'auth_not_configured')
    resetAuthPort()
  }
})

test('POST and GET logout do identical work', async () => {
  const results = []
  for (const handler of [logoutPost, logoutGet]) {
    const { port, recorded } = recordingPort()
    setAuthPort(port)
    const response = await handler()
    results.push({ status: response.status, location: response.headers.get('location'), cleared: recorded.cleared })
    resetAuthPort()
  }
  assert.deepEqual(results[0], results[1])
})

// ── the refusal type is the contract, not the message ───────────────────────

test('only AuthNotConfiguredError becomes 503 across every route', async () => {
  const notConfigured = new AuthNotConfiguredError()
  assert.equal(notConfigured.code, 'AUTH_NOT_CONFIGURED')

  const { port } = recordingPort({
    clearSession: async () => {
      throw new Error('cookie store unavailable')
    },
  })
  setAuthPort(port)
  await assert.rejects(() => logoutPost(), /cookie store unavailable/)
  resetAuthPort()
})
