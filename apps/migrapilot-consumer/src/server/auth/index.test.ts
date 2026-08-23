/**
 * Lazy, per-runtime auth port resolution.
 *
 * REGRESSION CONTEXT. The port used to be installed once from
 * `instrumentation.ts` via `setAuthPort`. Next runs the instrumentation hook in
 * its own module graph, so the module-level variable that hook mutated was not
 * the one route handlers read — every route saw the fail-closed default and
 * answered 503 while the environment was fully configured.
 *
 * The property that fixes it, and the one these tests pin, is: **the runtime
 * that serves the request is the runtime that reads the environment.** The
 * environment below is therefore always mutated AFTER this module is imported.
 * A resolution that ran at import time would fail every one of these.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { getAuthPort, setAuthPort, resetAuthPort, getSession, requireSession, toPublicSession } from './index'
import { unconfiguredAuthPort, UnauthenticatedError, type AppSession, type AuthPort } from './authPort'

// ── harness ─────────────────────────────────────────────────────────────────

const COMPLETE = {
  MIGRAAUTH_CLIENT_ID: 'migrapilot_web',
  MIGRAAUTH_REDIRECT_URI: 'https://chat.example.test/api/auth/callback',
  APP_BASE_URL: 'https://chat.example.test',
  APP_SESSION_SECRET: 'test-session-secret-not-a-real-secret',
  MIGRAAUTH_BASE_URL: 'https://auth.example.test',
} as const

const OWNED = [
  ...Object.keys(COMPLETE),
  'AUTH_PUBLIC_URL',
  'MIGRAAUTH_WEB_URL',
  'AUTH_WEB_URL',
  'MIGRAAUTH_CLIENT_SECRET',
  'MIGRAAUTH_POST_LOGOUT_REDIRECT_URI',
  'MIGRAAUTH_SCOPES',
  'APP_SESSION_COOKIE_NAME',
  'NEXT_RUNTIME',
]

/** Install exactly `env`, clearing anything a developer `.env` might supply. */
function applyEnv(env: Record<string, string | undefined>): void {
  // `NODE_ENV` is typed read-only; driving the production branch is the point.
  const mutableEnv = process.env as Record<string, string | undefined>
  for (const name of OWNED) delete mutableEnv[name]
  mutableEnv.NODE_ENV = 'production'
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) mutableEnv[name] = value
  }
}

/** Every test starts from a clean port and a clean environment. */
function reset(env: Record<string, string | undefined> = {}): void {
  resetAuthPort()
  applyEnv(env)
}

const session = (over: Partial<AppSession> = {}): AppSession => ({
  sessionId: 'sess-1',
  authUserId: 'auth-user-AAA',
  email: 'user@example.test',
  displayName: 'Example User',
  activeOrgId: 'org-1',
  activeOrgName: 'Org One',
  activeOrgRole: 'member',
  permissions: ['chat:write'],
  createdAt: Date.now(),
  expiresAt: Date.now() + 3_600_000,
  ...over,
})

const stubPort = (over: Partial<AuthPort> = {}): AuthPort => ({
  getSession: async () => null,
  buildLoginRedirect: async () => 'https://auth.example.test/authorize',
  buildSignupRedirect: async () => 'https://auth.example.test/signup',
  buildLogoutRedirect: () => 'https://auth.example.test/logout',
  handleCallback: async () => {},
  clearSession: async () => {},
  ...over,
})

// ── the module-graph regression ─────────────────────────────────────────────

test('an environment set after import is still read — resolution is deferred to the call', async () => {
  // This is the exact defect: configuration that arrives after module
  // evaluation must still reach the port that serves the request.
  reset(COMPLETE)
  const port = await getAuthPort()
  assert.notEqual(port, unconfiguredAuthPort, 'a complete environment must not resolve to the fail-closed port')
})

test('an incomplete environment resolves to the fail-closed port', async () => {
  reset({ ...COMPLETE, MIGRAAUTH_CLIENT_ID: undefined })
  assert.equal(await getAuthPort(), unconfiguredAuthPort)
})

test('an empty variable resolves to the fail-closed port', async () => {
  // `??` accepted this in production and built a relative authorize URL.
  reset({ ...COMPLETE, MIGRAAUTH_BASE_URL: '' })
  assert.equal(await getAuthPort(), unconfiguredAuthPort)
})

test('resolution is memoised per runtime — the environment is not re-read per request', async () => {
  reset(COMPLETE)
  const first = await getAuthPort()
  // Break the environment without resetting. A memoised resolution must not
  // notice; re-reading per request would make behaviour depend on call order.
  process.env.MIGRAAUTH_CLIENT_ID = ''
  const second = await getAuthPort()
  assert.equal(second, first)
})

test('concurrent first calls share one resolution', async () => {
  reset(COMPLETE)
  const [a, b, c] = await Promise.all([getAuthPort(), getAuthPort(), getAuthPort()])
  assert.equal(a, b)
  assert.equal(b, c)
})

// ── it must never reject ────────────────────────────────────────────────────

test('getAuthPort never rejects, whatever the environment', async () => {
  // A rejection here would surface as a 500 on every route rather than as a
  // refusal, so the fail-closed contract is a resolved value, not a throw.
  //
  // Only the shape of the resolution is asserted. Driving a *configured* port's
  // `getSession` would reach `cookies()`, which needs a request scope that
  // `node --test` has no way to provide; the route suite covers that path with
  // an injected port instead.
  const broken: Record<string, string | undefined>[] = [
    {},
    { ...COMPLETE, MIGRAAUTH_BASE_URL: '/authorize' },
    { ...COMPLETE, APP_BASE_URL: 'javascript:alert(1)' },
    { ...COMPLETE, MIGRAAUTH_REDIRECT_URI: 'https://' },
    { ...COMPLETE, NEXT_RUNTIME: 'edge' },
  ]
  for (const env of broken) {
    reset(env)
    const port = await getAuthPort()
    assert.equal(port, unconfiguredAuthPort, `expected fail-closed for ${JSON.stringify(env)}`)
    // The fail-closed port answers an unauthenticated read without throwing.
    assert.equal(await port.getSession(), null)
  }

  // A merely odd-but-usable value must still resolve, and still not reject.
  reset({ ...COMPLETE, MIGRAAUTH_SCOPES: '   ' })
  assert.notEqual(await getAuthPort(), unconfiguredAuthPort)
})

// ── the injection seam ──────────────────────────────────────────────────────

test('an explicit override wins over the environment', async () => {
  reset(COMPLETE)
  const injected = stubPort()
  setAuthPort(injected)
  assert.equal(await getAuthPort(), injected)
})

test('installing an override drops a memoised resolution', async () => {
  reset(COMPLETE)
  const resolved = await getAuthPort()
  const injected = stubPort()
  setAuthPort(injected)
  assert.equal(await getAuthPort(), injected)
  assert.notEqual(await getAuthPort(), resolved)
})

test('resetAuthPort drops both the override and the memo', async () => {
  reset(COMPLETE)
  setAuthPort(stubPort())
  reset({ ...COMPLETE, APP_SESSION_SECRET: undefined })
  assert.equal(await getAuthPort(), unconfiguredAuthPort)
})

// ── session accessors ───────────────────────────────────────────────────────

test('getSession returns null rather than throwing when unconfigured', async () => {
  reset({})
  assert.equal(await getSession(), null)
})

test('getSession and requireSession agree on what "signed in" means', async () => {
  // Expiry was once checked only in requireSession, so the shell rendered a
  // signed-in header while every action behind it answered 401.
  reset({})
  const expired = session({ expiresAt: Date.now() - 1 })
  setAuthPort(stubPort({ getSession: async () => expired }))

  assert.equal(await getSession(), null, 'an expired session must not read as signed in')
  await assert.rejects(() => requireSession(), UnauthenticatedError)
})

test('a live session reads as signed in from both', async () => {
  reset({})
  const live = session()
  setAuthPort(stubPort({ getSession: async () => live }))

  assert.equal(await getSession(), live)
  assert.equal(await requireSession(), live)
})

test('requireSession throws when there is no session', async () => {
  reset({})
  setAuthPort(stubPort({ getSession: async () => null }))
  await assert.rejects(() => requireSession(), UnauthenticatedError)
})

test('requireSession throws on an expired session', async () => {
  reset({})
  setAuthPort(stubPort({ getSession: async () => session({ expiresAt: Date.now() - 1 }) }))
  await assert.rejects(() => requireSession(), UnauthenticatedError)
})

test('requireSession returns a live session', async () => {
  reset({})
  const live = session()
  setAuthPort(stubPort({ getSession: async () => live }))
  assert.equal(await requireSession(), live)
})

// ── what a client component may receive ─────────────────────────────────────

test('the public session carries no tenancy-constructing material', async () => {
  const full = session({
    productAccount: { plan: 'pro', internalId: 'acct-secret' },
  })
  const publicSession = toPublicSession(full)

  assert.deepEqual(Object.keys(publicSession).sort(), [
    'activeOrgName',
    'activeOrgRole',
    'displayName',
    'email',
    'permissions',
  ])

  // The browser must never receive the identifiers tenancy is derived from.
  const serialized = JSON.stringify(publicSession)
  for (const forbidden of [full.authUserId, full.sessionId, full.activeOrgId!, 'acct-secret']) {
    assert.ok(!serialized.includes(forbidden), `public session leaked ${forbidden}`)
  }
})

test('the public session falls back to the email when no display name exists', async () => {
  const publicSession = toPublicSession(session({ displayName: undefined }))
  assert.equal(publicSession.displayName, 'user@example.test')
})

test('the public session omits org fields when there is no active org', async () => {
  const publicSession = toPublicSession(session({ activeOrgName: undefined, activeOrgRole: undefined }))
  assert.equal('activeOrgName' in publicSession, false)
  assert.equal('activeOrgRole' in publicSession, false)
})
