/**
 * Auth configuration resolution.
 *
 * These are regression tests for two production defects, not speculative cases:
 *
 * 1. The port was installed from `instrumentation.ts`, which Next runs in a
 *    separate module graph. Route handlers read a different module instance and
 *    answered 503 with the environment fully configured. Resolution is now lazy
 *    and per-runtime; `./index.test.ts` covers that half.
 *
 * 2. Release v5b answered `/api/auth/login` with `ERR_INVALID_URL` because an
 *    empty `MIGRAAUTH_BASE_URL` was accepted by `??` as a configured value, so
 *    an absolute authorize URL was built as the bare path `/authorize?…`. Empty
 *    is now absent, and every URL must parse as absolute http(s).
 *
 * The contract under test is FAIL-CLOSED: anything missing or unusable must
 * yield a port that refuses, never a port that half-works.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveAuthPort } from './resolveAuthPort'
import { AuthNotConfiguredError } from './authPort'

// ── harness ─────────────────────────────────────────────────────────────────

/** A complete, valid environment. Individual tests break one field at a time. */
const COMPLETE = {
  MIGRAAUTH_CLIENT_ID: 'migrapilot_web',
  MIGRAAUTH_REDIRECT_URI: 'https://chat.example.test/api/auth/callback',
  APP_BASE_URL: 'https://chat.example.test',
  APP_SESSION_SECRET: 'test-session-secret-not-a-real-secret',
  MIGRAAUTH_BASE_URL: 'https://auth.example.test',
} as const

/** Every variable resolution reads, so a test never inherits the real shell. */
const OWNED = [
  'MIGRAAUTH_CLIENT_ID',
  'MIGRAAUTH_REDIRECT_URI',
  'APP_BASE_URL',
  'APP_SESSION_SECRET',
  'MIGRAAUTH_BASE_URL',
  'AUTH_PUBLIC_URL',
  'MIGRAAUTH_WEB_URL',
  'AUTH_WEB_URL',
  'MIGRAAUTH_CLIENT_SECRET',
  'MIGRAAUTH_POST_LOGOUT_REDIRECT_URI',
  'MIGRAAUTH_SCOPES',
  'MIGRAAUTH_API_URL',
  'APP_SESSION_COOKIE_NAME',
  'NEXT_RUNTIME',
  'NODE_ENV',
] as const

/**
 * Run `resolveAuthPort` against exactly `env` and nothing else.
 *
 * The ambient environment is cleared for every owned name first — otherwise a
 * developer machine with a real `.env` loaded would mask a missing-variable
 * test by supplying the value the test is trying to withhold.
 */
async function resolveWith(env: Record<string, string | undefined>) {
  // `NODE_ENV` is typed read-only, but these tests exist precisely to drive the
  // production/development branch, so the mutable view is the point.
  const mutableEnv = process.env as Record<string, string | undefined>

  const saved = new Map<string, string | undefined>()
  for (const name of OWNED) {
    saved.set(name, mutableEnv[name])
    delete mutableEnv[name]
  }
  // Production is the posture worth defaulting to: it is the one that forbids
  // the localhost issuer fallback.
  mutableEnv.NODE_ENV = 'production'
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete mutableEnv[name]
    else mutableEnv[name] = value
  }

  try {
    return await resolveAuthPort()
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete mutableEnv[name]
      else mutableEnv[name] = value
    }
  }
}

/** Assert a resolution refuses every operation, not merely that a flag is false. */
async function assertFailsClosed(resolution: Awaited<ReturnType<typeof resolveAuthPort>>) {
  assert.equal(resolution.configured, false)
  await assert.rejects(() => resolution.port.buildLoginRedirect(), AuthNotConfiguredError)
  assert.throws(() => resolution.port.buildLogoutRedirect(), AuthNotConfiguredError)
  await assert.rejects(
    () => resolution.port.handleCallback({ code: 'c', state: 's', bootstrap: async () => ({ activeOrg: null, permissions: [] }) }),
    AuthNotConfiguredError,
  )
  await assert.rejects(() => resolution.port.clearSession(), AuthNotConfiguredError)
  // getSession is the one operation that must NOT throw: an unauthenticated
  // caller is a normal state, and a throw here would turn every page into a 500.
  assert.equal(await resolution.port.getSession(), null)
}

// ── empty string is not a value ─────────────────────────────────────────────

test('an empty required variable is treated as missing, not as a value', async () => {
  for (const name of Object.keys(COMPLETE)) {
    const resolution = await resolveWith({ ...COMPLETE, [name]: '' })
    assert.ok(
      resolution.missing.includes(name),
      `empty ${name} must be reported missing, got: [${resolution.missing.join(', ')}]`,
    )
    await assertFailsClosed(resolution)
  }
})

test('a whitespace-only required variable is treated as missing', async () => {
  for (const name of Object.keys(COMPLETE)) {
    const resolution = await resolveWith({ ...COMPLETE, [name]: '   \t ' })
    assert.ok(resolution.missing.includes(name), `whitespace ${name} must be reported missing`)
    await assertFailsClosed(resolution)
  }
})

test('an unset required variable is reported missing', async () => {
  for (const name of Object.keys(COMPLETE)) {
    const resolution = await resolveWith({ ...COMPLETE, [name]: undefined })
    assert.ok(resolution.missing.includes(name), `unset ${name} must be reported missing`)
    await assertFailsClosed(resolution)
  }
})

test('every missing variable is reported at once, so one deploy fixes them all', async () => {
  const resolution = await resolveWith({})
  for (const name of Object.keys(COMPLETE)) {
    assert.ok(resolution.missing.includes(name), `${name} absent from the missing list`)
  }
  await assertFailsClosed(resolution)
})

test('the missing list carries names only — never a value', async () => {
  const resolution = await resolveWith({ ...COMPLETE, MIGRAAUTH_CLIENT_ID: undefined })
  // This list is logged. A value leaking into it would be a secret in the log.
  for (const entry of resolution.missing) {
    assert.ok(
      (OWNED as readonly string[]).includes(entry) || entry === 'NEXT_RUNTIME!=nodejs',
      `missing list entry ${JSON.stringify(entry)} is not a bare variable name`,
    )
  }
  assert.ok(!resolution.missing.some((m) => m.includes(COMPLETE.APP_SESSION_SECRET)))
})

// ── URLs must be absolute ───────────────────────────────────────────────────

test('a relative URL fails closed — this is the v5b ERR_INVALID_URL defect', async () => {
  // The exact production shape: an origin that is not an origin, which produced
  // `Failed to parse URL from /authorize?response_type=code&…`.
  for (const name of ['MIGRAAUTH_BASE_URL', 'MIGRAAUTH_REDIRECT_URI', 'APP_BASE_URL']) {
    const resolution = await resolveWith({ ...COMPLETE, [name]: '/authorize' })
    assert.ok(resolution.missing.includes(name), `relative ${name} must fail closed`)
    await assertFailsClosed(resolution)
  }
})

test('a non-http scheme fails closed', async () => {
  for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://auth.example.test']) {
    const resolution = await resolveWith({ ...COMPLETE, MIGRAAUTH_BASE_URL: value })
    assert.ok(resolution.missing.includes('MIGRAAUTH_BASE_URL'), `${value} must fail closed`)
    await assertFailsClosed(resolution)
  }
})

test('a malformed URL fails closed', async () => {
  const resolution = await resolveWith({ ...COMPLETE, APP_BASE_URL: 'https://' })
  assert.ok(resolution.missing.includes('APP_BASE_URL'))
  await assertFailsClosed(resolution)
})

// ── the localhost issuer is a development convenience only ──────────────────

test('production refuses to fall back to the localhost issuer', async () => {
  const resolution = await resolveWith({ ...COMPLETE, MIGRAAUTH_BASE_URL: undefined })
  assert.ok(resolution.missing.includes('MIGRAAUTH_BASE_URL'))
  await assertFailsClosed(resolution)
})

test('development may fall back to the localhost issuer', async () => {
  const resolution = await resolveWith({
    ...COMPLETE,
    MIGRAAUTH_BASE_URL: undefined,
    NODE_ENV: 'development',
  })
  assert.equal(resolution.configured, true, `unexpected missing: [${resolution.missing.join(', ')}]`)
  const { getAuthClientConfig } = await import('@migrateck/auth-client')
  assert.equal(getAuthClientConfig().migraAuthBaseUrl, 'http://localhost:4000')
})

test('AUTH_PUBLIC_URL is accepted as the issuer alias', async () => {
  const resolution = await resolveWith({
    ...COMPLETE,
    MIGRAAUTH_BASE_URL: undefined,
    AUTH_PUBLIC_URL: 'https://auth.alias.test',
  })
  assert.equal(resolution.configured, true, `unexpected missing: [${resolution.missing.join(', ')}]`)
  const { getAuthClientConfig } = await import('@migrateck/auth-client')
  assert.equal(getAuthClientConfig().migraAuthBaseUrl, 'https://auth.alias.test')
})

test('an empty alias does not shadow a set primary', async () => {
  const resolution = await resolveWith({ ...COMPLETE, AUTH_PUBLIC_URL: '' })
  assert.equal(resolution.configured, true, `unexpected missing: [${resolution.missing.join(', ')}]`)
  const { getAuthClientConfig } = await import('@migrateck/auth-client')
  assert.equal(getAuthClientConfig().migraAuthBaseUrl, COMPLETE.MIGRAAUTH_BASE_URL)
})

// ── the happy path, and what it hands the auth client ───────────────────────

test('a complete environment configures the real port', async () => {
  const resolution = await resolveWith(COMPLETE)
  assert.equal(resolution.configured, true, `unexpected missing: [${resolution.missing.join(', ')}]`)
  assert.deepEqual(resolution.missing, [])

  const { getAuthClientConfig } = await import('@migrateck/auth-client')
  const cfg = getAuthClientConfig()
  assert.equal(cfg.migraAuthBaseUrl, 'https://auth.example.test')
  assert.equal(cfg.clientId, 'migrapilot_web')
  assert.equal(cfg.redirectUri, COMPLETE.MIGRAAUTH_REDIRECT_URI)
  assert.equal(cfg.appBaseUrl, COMPLETE.APP_BASE_URL)
  // `migrapilot_web` is registered with token_auth_method=none. A secret must
  // not be invented for a public PKCE client.
  assert.equal(cfg.clientSecret, undefined)
})

test('the web origin defaults to the issuer, never to a localhost default', async () => {
  // MigraAuth serves /authorize and /login from one origin in this deployment.
  // The previous localhost:4100 default silently broke logout in production.
  const resolution = await resolveWith({ ...COMPLETE, MIGRAAUTH_WEB_URL: undefined })
  assert.equal(resolution.configured, true)
  const { getAuthClientConfig } = await import('@migrateck/auth-client')
  assert.equal(getAuthClientConfig().migraAuthWebUrl, COMPLETE.MIGRAAUTH_BASE_URL)
})

test('an empty web origin falls back to the issuer rather than to an empty origin', async () => {
  // `new URL('/logout', '')` throws. This is the logout-side twin of the v5b bug.
  const resolution = await resolveWith({ ...COMPLETE, MIGRAAUTH_WEB_URL: '' })
  assert.equal(resolution.configured, true)
  const { getAuthClientConfig } = await import('@migrateck/auth-client')
  assert.equal(getAuthClientConfig().migraAuthWebUrl, COMPLETE.MIGRAAUTH_BASE_URL)
  assert.doesNotThrow(() => new URL('/logout', getAuthClientConfig().migraAuthWebUrl))
})

// ── the back channel is a separate origin from the browser redirect ─────────

test('the back-channel origin defaults to the issuer', async () => {
  const resolution = await resolveWith({ ...COMPLETE, MIGRAAUTH_API_URL: undefined })
  assert.equal(resolution.configured, true, `unexpected missing: [${resolution.missing.join(', ')}]`)
  const { getAuthClientConfig } = await import('@migrateck/auth-client')
  const cfg = getAuthClientConfig()
  // Unset means "same origin for both" — the behaviour every other app relies on.
  assert.equal(cfg.migraAuthApiUrl ?? cfg.migraAuthBaseUrl, COMPLETE.MIGRAAUTH_BASE_URL)
})

test('the back-channel origin can differ from the browser origin', async () => {
  // The VM111 topology: the browser reaches the public issuer, the server
  // cannot (its own edge address hairpins), so /token and /userinfo go over the
  // private path while /authorize stays public.
  const resolution = await resolveWith({ ...COMPLETE, MIGRAAUTH_API_URL: 'http://app-core:4120' })
  assert.equal(resolution.configured, true, `unexpected missing: [${resolution.missing.join(', ')}]`)

  const { getAuthClientConfig } = await import('@migrateck/auth-client')
  const cfg = getAuthClientConfig()
  assert.equal(cfg.migraAuthApiUrl, 'http://app-core:4120')
  // The browser must still be sent to the public issuer.
  assert.equal(cfg.migraAuthBaseUrl, COMPLETE.MIGRAAUTH_BASE_URL)
})

test('an empty back-channel origin falls back to the issuer, not to an empty origin', async () => {
  const resolution = await resolveWith({ ...COMPLETE, MIGRAAUTH_API_URL: '' })
  assert.equal(resolution.configured, true)
  const { getAuthClientConfig } = await import('@migrateck/auth-client')
  const cfg = getAuthClientConfig()
  assert.equal(cfg.migraAuthApiUrl, undefined)
  assert.doesNotThrow(() => new URL('/token', cfg.migraAuthApiUrl ?? cfg.migraAuthBaseUrl))
})

test('a relative back-channel origin is refused rather than used', async () => {
  const resolution = await resolveWith({ ...COMPLETE, MIGRAAUTH_API_URL: '/token' })
  assert.equal(resolution.configured, true)
  const { getAuthClientConfig } = await import('@migrateck/auth-client')
  // Unusable means absent: the exchange falls back to the issuer rather than
  // building `/token/token`.
  assert.equal(getAuthClientConfig().migraAuthApiUrl, undefined)
})

test('scopes default when unset and are honoured when set', async () => {
  const { getAuthClientConfig } = await import('@migrateck/auth-client')

  await resolveWith({ ...COMPLETE, MIGRAAUTH_SCOPES: undefined })
  assert.deepEqual(getAuthClientConfig().scopes, ['openid', 'profile', 'email', 'offline_access'])

  await resolveWith({ ...COMPLETE, MIGRAAUTH_SCOPES: 'openid  profile   orgs:read' })
  assert.deepEqual(getAuthClientConfig().scopes, ['openid', 'profile', 'orgs:read'])

  // Whitespace-only is not "the empty scope set" — it is an unset variable.
  await resolveWith({ ...COMPLETE, MIGRAAUTH_SCOPES: '   ' })
  assert.deepEqual(getAuthClientConfig().scopes, ['openid', 'profile', 'email', 'offline_access'])
})

test('trailing slashes are trimmed so no URL is built with a doubled separator', async () => {
  const resolution = await resolveWith({ ...COMPLETE, MIGRAAUTH_BASE_URL: 'https://auth.example.test///' })
  assert.equal(resolution.configured, true)
  const { getAuthClientConfig } = await import('@migrateck/auth-client')
  assert.equal(getAuthClientConfig().migraAuthBaseUrl, 'https://auth.example.test')
})

test('the post-logout target defaults to the app base URL', async () => {
  await resolveWith({ ...COMPLETE, MIGRAAUTH_POST_LOGOUT_REDIRECT_URI: '' })
  const { getAuthClientConfig } = await import('@migrateck/auth-client')
  assert.equal(getAuthClientConfig().postLogoutRedirectUri, COMPLETE.APP_BASE_URL)
})

// ── runtime guard ───────────────────────────────────────────────────────────

test('a non-node runtime fails closed even with a complete environment', async () => {
  // The edge runtime has no MigraAuth session and cannot run the server client.
  const resolution = await resolveWith({ ...COMPLETE, NEXT_RUNTIME: 'edge' })
  assert.deepEqual(resolution.missing, ['NEXT_RUNTIME!=nodejs'])
  await assertFailsClosed(resolution)
})

test('the node runtime is accepted when named explicitly', async () => {
  const resolution = await resolveWith({ ...COMPLETE, NEXT_RUNTIME: 'nodejs' })
  assert.equal(resolution.configured, true, `unexpected missing: [${resolution.missing.join(', ')}]`)
})
