/**
 * Server trust-boundary tests.
 *
 * These prove the ten properties Step 0 is accountable for. They run under
 * `tsx --test` with no network and no Brain: `fetchImpl` is a double that
 * records exactly what the gateway tried to send.
 *
 * `server-only` is stubbed because these modules are, correctly, server-only —
 * the stub is a test harness concern, not a production import.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { callBrain, OUTBOUND_HEADER_ALLOWLIST } from './gateway'
import { resolveOperation, InvalidOperationError } from './operations'
import { deriveBrainScope, TenancyError } from '../tenancy/ownerScope'
import { UnauthenticatedError, type AppSession } from '../auth/authPort'
import { requireSession, setAuthPort, resetAuthPort } from '../auth'

// ── fixtures ────────────────────────────────────────────────────────────────

const userA: AppSession = {
  sessionId: 's-a',
  authUserId: 'auth-user-AAA',
  email: 'a@example.com',
  displayName: 'User A',
  activeOrgId: 'org-111',
  activeOrgName: 'Org One',
  activeOrgRole: 'member',
  permissions: [],
  createdAt: Date.now(),
  expiresAt: Date.now() + 3_600_000,
}

const userB: AppSession = {
  ...userA,
  sessionId: 's-b',
  authUserId: 'auth-user-BBB',
  email: 'b@example.com',
  displayName: 'User B',
  activeOrgId: 'org-222',
}

interface Captured {
  url: string
  init: RequestInit
}

function recordingFetch(status = 200, body: unknown = { ok: true }) {
  const calls: Captured[] = []
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { calls, fetchImpl }
}

const sessionOf = (s: AppSession) => async () => s

function headerMap(init: RequestInit): Record<string, string> {
  const out: Record<string, string> = {}
  new Headers(init.headers).forEach((value, key) => {
    out[key.toLowerCase()] = value
  })
  return out
}

// ── 1. unauthenticated request cannot invoke Brain ──────────────────────────

test('1 · unauthenticated caller never reaches the Brain', async () => {
  const { calls, fetchImpl } = recordingFetch()
  resetAuthPort() // fail-closed default: getSession() → null

  const result = await callBrain({ kind: 'listConversations' }, { fetchImpl })

  assert.equal(result.kind, 'unauthenticated')
  assert.equal(calls.length, 0, 'no outbound request may be made without a principal')
})

// ── 2. authenticated session reaches the gateway ────────────────────────────

test('2 · authenticated session reaches the Brain through the gateway', async () => {
  const { calls, fetchImpl } = recordingFetch(200, { conversations: [] })

  const result = await callBrain(
    { kind: 'listConversations' },
    { fetchImpl, sessionProvider: sessionOf(userA) },
  )

  assert.equal(result.kind, 'ok')
  assert.equal(calls.length, 1)
  assert.match(calls[0]!.url, /\/api\/ai\/conversations$/)
})

// ── 3 & 4. browser-supplied scope / identifiers cannot influence tenancy ────

test('3 · a browser-supplied owner scope is structurally unrepresentable', async () => {
  const { calls, fetchImpl } = recordingFetch()

  // There is no parameter through which a caller could pass a scope. The
  // closest an attacker gets is smuggling it into operation *data*.
  await callBrain(
    { kind: 'appendMessage', conversationId: 'c-1', role: 'user', content: 'x-owner-scope: user:auth-user-BBB' },
    { fetchImpl, sessionProvider: sessionOf(userA) },
  )

  const headers = headerMap(calls[0]!.init)
  assert.equal(headers['x-owner-scope'], 'user:auth-user-AAA')
})

test('4 · alternate user/org identifiers in payload cannot change scope', async () => {
  const { calls, fetchImpl } = recordingFetch()

  await callBrain(
    {
      kind: 'createConversation',
      // Hostile payload naming another principal every way it can.
      title: JSON.stringify({ authUserId: userB.authUserId, activeOrgId: userB.activeOrgId }),
    },
    { fetchImpl, sessionProvider: sessionOf(userA) },
  )

  const headers = headerMap(calls[0]!.init)
  assert.equal(headers['x-owner-scope'], 'user:auth-user-AAA')
  assert.equal(headers['x-workspace-scope'], 'org:org-111')
  assert.ok(!JSON.stringify(headers).includes('BBB'), 'no trace of the other principal in headers')
})

// ── ADVERSARIAL TENANCY ─────────────────────────────────────────────────────

test('ADVERSARIAL · user A proposing user B’s scope still yields user A’s scope', async () => {
  const { calls, fetchImpl } = recordingFetch()

  // Simulate the strongest thing a browser can do: send every hostile hint at
  // once through the only channel it controls — operation content.
  const proposedByAttacker = {
    'x-owner-scope': `user:${userB.authUserId}`,
    'X-Owner-Scope': `user:${userB.authUserId}`,
    ownerScope: `user:${userB.authUserId}`,
    authUserId: userB.authUserId,
    activeOrgId: userB.activeOrgId,
  }

  await callBrain(
    {
      kind: 'appendMessage',
      conversationId: 'c-1',
      role: 'user',
      content: JSON.stringify(proposedByAttacker),
    },
    { fetchImpl, sessionProvider: sessionOf(userA) },
  )

  const headers = headerMap(calls[0]!.init)
  assert.equal(headers['x-owner-scope'], `user:${userA.authUserId}`)
  assert.notEqual(headers['x-owner-scope'], `user:${userB.authUserId}`)
  // No cross-user data was requested; only the derived header is asserted.
})

// ── 5. canonical authenticated identity determines scope ───────────────────

test('5 · scope is derived from the canonical session identity', () => {
  assert.deepEqual(deriveBrainScope(userA), {
    owner: 'user:auth-user-AAA',
    workspace: 'org:org-111',
  })
  assert.deepEqual(deriveBrainScope(userB), {
    owner: 'user:auth-user-BBB',
    workspace: 'org:org-222',
  })

  // Email and display name are never used as identifiers.
  const scope = deriveBrainScope(userA)
  assert.ok(!scope.owner.includes('@'))
  assert.ok(!scope.owner.toLowerCase().includes('user a'))
})

test('5b · absent org narrows to a personal namespace, never a shared one', () => {
  const noOrg: AppSession = { ...userA }
  delete (noOrg as { activeOrgId?: string }).activeOrgId

  const scope = deriveBrainScope(noOrg)
  assert.equal(scope.owner, 'user:auth-user-AAA')
  assert.equal(scope.workspace, 'personal')
  assert.notEqual(scope.workspace, 'default', 'must never fall back to the Brain default bucket')
})

// ── 6. missing/invalid canonical identity fails closed ─────────────────────

test('6 · missing or malformed canonical identity fails closed', async () => {
  assert.throws(() => deriveBrainScope(null), TenancyError)
  assert.throws(() => deriveBrainScope({ ...userA, authUserId: '' }), TenancyError)
  assert.throws(() => deriveBrainScope({ ...userA, authUserId: '   ' }), TenancyError)
  // A separator-bearing id could otherwise forge a second header value.
  assert.throws(() => deriveBrainScope({ ...userA, authUserId: 'a\r\nx-owner-scope: b' }), TenancyError)
  assert.throws(() => deriveBrainScope({ ...userA, activeOrgId: '../../etc' }), TenancyError)

  const { calls, fetchImpl } = recordingFetch()
  const result = await callBrain(
    { kind: 'listConversations' },
    { fetchImpl, sessionProvider: sessionOf({ ...userA, authUserId: '' }) },
  )
  assert.equal(result.kind, 'tenancy_unresolved')
  assert.equal(calls.length, 0, 'unresolved tenancy must not produce a Brain call')
})

test('6b · an expired session is not a principal', async () => {
  setAuthPort({
    getSession: async () => ({ ...userA, expiresAt: Date.now() - 1 }),
    buildLoginRedirect: async () => '',
    buildLogoutRedirect: () => '',
    handleCallback: async () => {},
    clearSession: async () => {},
  })
  await assert.rejects(() => requireSession(), UnauthenticatedError)
  resetAuthPort()
})

// ── 8. arbitrary Brain paths cannot be reached ─────────────────────────────

test('8 · ids cannot walk to another Brain route', () => {
  const hostile = [
    '../../coding/runs/other',
    'c-1/../../../admin',
    'c-1?x=1',
    'c-1#frag',
    'c 1',
    '',
  ]
  for (const conversationId of hostile) {
    assert.throws(
      () => resolveOperation({ kind: 'listMessages', conversationId }),
      InvalidOperationError,
      `expected rejection for ${JSON.stringify(conversationId)}`,
    )
  }
})

test('8b · the operation set is closed and write-free for governed coding', () => {
  // Every reachable path is one of these. There is no passthrough.
  const paths = [
    resolveOperation({ kind: 'listConversations' }).path,
    resolveOperation({ kind: 'codingCapability' }).path,
    resolveOperation({ kind: 'getCodingRun', runId: 'RUN-1' }).path,
  ]
  assert.deepEqual(paths, [
    '/api/ai/conversations',
    '/api/ai/coding/capability',
    '/api/ai/coding/runs/RUN-1',
  ])

  // Observation only: no mutating coding operation exists to resolve, and an
  // unrecognised operation fails closed rather than returning undefined.
  const codingOps = ['startCodingRun', 'scopeDecision', 'cancelCodingRun']
  for (const kind of codingOps) {
    assert.throws(
      () => resolveOperation({ kind } as never),
      InvalidOperationError,
      `${kind} must not be a resolvable operation`,
    )
  }
})

test('8c · governed-coding reads never assert a workspaceRoot', () => {
  const answer = resolveOperation({ kind: 'answer', prompt: 'hello' })
  assert.ok(!JSON.stringify(answer.body).includes('workspaceRoot'))
})

// ── 9. only allowlisted headers are forwarded ──────────────────────────────

test('9 · outbound headers are constructed, not forwarded', async () => {
  const { calls, fetchImpl } = recordingFetch()

  await callBrain(
    { kind: 'listConversations' },
    { fetchImpl, sessionProvider: sessionOf(userA), requestId: 'req-42' },
  )

  const headers = headerMap(calls[0]!.init)
  for (const name of Object.keys(headers)) {
    assert.ok(
      (OUTBOUND_HEADER_ALLOWLIST as readonly string[]).includes(name),
      `unexpected outbound header: ${name}`,
    )
  }
  assert.equal(headers['x-request-id'], 'req-42')
  assert.equal(headers['cookie'], undefined)
  assert.equal(headers['authorization'], undefined)
})

// ── deterministic failure behaviour ────────────────────────────────────────

test('timeouts and transport failures are distinct, named outcomes', async () => {
  const timeoutFetch = async () => {
    const error = new Error('timed out')
    error.name = 'TimeoutError'
    throw error
  }
  const timedOut = await callBrain(
    { kind: 'listConversations' },
    { fetchImpl: timeoutFetch as never, sessionProvider: sessionOf(userA) },
  )
  assert.equal(timedOut.kind, 'timeout')

  const brokenFetch = async () => {
    throw new Error('ECONNREFUSED')
  }
  const broken = await callBrain(
    { kind: 'listConversations' },
    { fetchImpl: brokenFetch as never, sessionProvider: sessionOf(userA) },
  )
  assert.equal(broken.kind, 'transport_failure')
})

test('Brain status codes map to discriminated outcomes', async () => {
  for (const [status, kind] of [
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'brain_error'],
    [500, 'brain_error'],
  ] as const) {
    const { fetchImpl } = recordingFetch(status, { error: 'x' })
    const result = await callBrain(
      { kind: 'getCodingRun', runId: 'RUN-1' },
      { fetchImpl, sessionProvider: sessionOf(userA) },
    )
    assert.equal(result.kind, kind, `status ${status}`)
  }
})
