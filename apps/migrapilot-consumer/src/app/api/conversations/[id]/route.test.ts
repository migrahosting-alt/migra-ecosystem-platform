/**
 * Renaming and deleting a conversation.
 *
 * DELETE is the only irreversible action the product has, so the properties that
 * matter are about restraint: it must not reach the Brain without a principal,
 * it must not report success it did not get, and asking twice must not become an
 * error about a thing that is exactly as gone as the user wanted.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.APP_SESSION_SECRET = 'conversation-route-test-secret-value'

import { PATCH, DELETE } from './route'
import { setAuthPort, resetAuthPort } from '@/server/auth'
import type { AppSession, AuthPort } from '@/server/auth/authPort'
import { __resetCookies } from '../../../../../test/nextHeadersStub.mjs'

const session: AppSession = {
  sessionId: 'sess-1',
  authUserId: 'auth-user-AAA',
  email: 'user@example.test',
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

const params = (id: string) => ({ params: Promise.resolve({ id }) })

const patch = (id: string, body: unknown) =>
  PATCH(
    new Request('https://chat.example.test/api/conversations/x', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    params(id),
  )

const del = (id: string) =>
  DELETE(new Request('https://chat.example.test/api/conversations/x', { method: 'DELETE' }), params(id))

function brainStub(status = 200, body: unknown = { id: 'conv_1', title: 'renamed' }) {
  const calls: { method: string; path: string; body: unknown }[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({
      method: init.method ?? 'GET',
      path: new URL(String(url)).pathname,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    })
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof globalThis.fetch
  return { calls, restore: () => void (globalThis.fetch = original) }
}

const reset = () => {
  resetAuthPort()
  __resetCookies()
}

// ── rename ──────────────────────────────────────────────────────────────────

test('a rename reaches the Brain as a PATCH carrying the new title', async () => {
  const brain = brainStub()
  setAuthPort(portWith(session))

  const response = await patch('conv_1', { title: '  Migration planning  ' })

  assert.equal(response.status, 200)
  assert.equal((await response.json()).title, 'renamed')
  assert.equal(brain.calls[0]?.method, 'PATCH')
  assert.equal(brain.calls[0]?.path, '/api/ai/conversations/conv_1')
  assert.deepEqual(brain.calls[0]?.body, { title: 'Migration planning' }, 'trimmed before it is stored')

  brain.restore()
  reset()
})

test('an empty or whitespace title is refused before the Brain is asked', async () => {
  // A blank title renders as an unidentifiable row in the sidebar.
  for (const title of ['', '   ', 42, null]) {
    const brain = brainStub()
    setAuthPort(portWith(session))

    const response = await patch('conv_1', { title })
    assert.equal(response.status, 400)
    assert.equal(brain.calls.length, 0)

    brain.restore()
    reset()
  }
})

test('an over-long title is refused rather than truncated behind the user\'s back', async () => {
  const brain = brainStub()
  setAuthPort(portWith(session))

  const response = await patch('conv_1', { title: 'x'.repeat(201) })
  assert.equal(response.status, 400)
  assert.equal(brain.calls.length, 0)

  brain.restore()
  reset()
})

test('renaming while signed out never reaches the Brain', async () => {
  const brain = brainStub()
  setAuthPort(portWith(null))

  const response = await patch('conv_1', { title: 'mine now' })
  // Anonymous chat is configured in this suite, so the principal resolves — and
  // the gateway refuses the OPERATION, which is the check being pinned.
  assert.ok(response.status === 401 || response.status === 403, `got ${response.status}`)
  assert.equal(brain.calls.length, 0, 'the refusal happens before any request leaves')

  brain.restore()
  reset()
})

// ── delete ──────────────────────────────────────────────────────────────────

test('a delete reaches the Brain as a DELETE and reports success', async () => {
  const brain = brainStub(200, { ok: true })
  setAuthPort(portWith(session))

  const response = await del('conv_1')

  assert.equal(response.status, 200)
  assert.equal((await response.json()).deleted, true)
  assert.equal(brain.calls[0]?.method, 'DELETE')
  assert.equal(brain.calls[0]?.path, '/api/ai/conversations/conv_1')

  brain.restore()
  reset()
})

test('deleting something already gone is a SUCCESS, not an error', async () => {
  /*
   * A double click, or a retry after a dropped response. The user asked for the
   * conversation to be absent and it is absent; reporting a failure would send
   * them back to delete it again.
   */
  const brain = brainStub(404, { ok: false })
  setAuthPort(portWith(session))

  const response = await del('conv_1')
  assert.equal(response.status, 200)
  assert.equal((await response.json()).deleted, true)

  brain.restore()
  reset()
})

test('a Brain that refuses the delete is NOT reported as deleted', async () => {
  // The dangerous direction: saying it is gone when it is not means the user
  // stops trying, and the thing they wanted removed quietly stays.
  const brain = brainStub(500, { ok: false })
  setAuthPort(portWith(session))

  const response = await del('conv_1')
  assert.equal(response.status, 502)
  assert.equal((await response.json()).deleted, undefined)

  brain.restore()
  reset()
})

test('deleting while signed out never reaches the Brain', async () => {
  const brain = brainStub()
  setAuthPort(portWith(null))

  const response = await del('conv_1')
  assert.ok(response.status === 401 || response.status === 403, `got ${response.status}`)
  assert.equal(brain.calls.length, 0)

  brain.restore()
  reset()
})
