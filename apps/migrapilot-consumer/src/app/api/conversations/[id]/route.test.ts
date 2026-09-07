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
import { POST as RENAME_APPROVAL } from './rename-approval/route'
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
  const calls: { method: string; path: string; body: unknown; scope: string | null }[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({
      method: init.method ?? 'GET',
      path: new URL(String(url)).pathname,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      // Captured because a scoped mutation that loses its scope does not fail —
      // it matches nothing and reports success. The header is the only place
      // that boundary is observable from here.
      scope: new Headers(init.headers).get('x-owner-scope'),
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

/*
 * ── THE BYPASS THAT WAS CLOSED ────────────────────────────────────────────
 *
 * These four tests used to assert that PATCH renamed a conversation: title
 * carried through, empty refused, over-long refused, anonymous scoped. Every one
 * of them passed, and together they pinned a CONSENT BYPASS in place.
 *
 * The product now asks the user to approve an exact rename before it happens.
 * This route performed the same mutation without asking anyone, which made the
 * governance contract true of one client and false at the service boundary — a
 * convention rather than a boundary.
 *
 * What is pinned now is the refusal, and that the approved path still reaches
 * the same backend mutation.
 */

test('🚨 direct rename through the API is REFUSED, with no Brain call at all', async () => {
  const brain = brainStub(200, { ok: true })
  setAuthPort(portWith(session))

  const response = await patch('conv_1', { title: 'renamed without approval' })
  assert.equal(response.status, 410, 'the withdrawn verb must not still rename')
  assert.equal(brain.calls.length, 0, '🚨 a direct rename reached the Brain')

  const body = (await response.json()) as { error: string; message: string; use: string }
  assert.equal(body.error, 'rename_requires_approval')
  assert.match(body.message, /approval/i)
  // The replacement is named, so a caller fixes it instead of hunting for a typo.
  assert.match(body.use, /rename-approval/)
  brain.restore()
})

test('the refusal does not depend on the body being valid', async () => {
  // An empty, over-long or malformed title must be refused for the SAME reason —
  // validating first would imply a well-formed request could still rename.
  const brain = brainStub(200, { ok: true })
  setAuthPort(portWith(session))
  for (const body of [{ title: '' }, { title: 'x'.repeat(400) }, {}, 'not json']) {
    const response = await patch('conv_1', body)
    assert.equal(response.status, 410, `bypassed with ${JSON.stringify(body).slice(0, 30)}`)
  }
  assert.equal(brain.calls.length, 0)
  brain.restore()
})

test('a signed-out visitor cannot bypass approval either', async () => {
  const brain = brainStub(200, { ok: true })
  setAuthPort(portWith(null))
  const response = await patch('conv_1', { title: 'mine now' })
  assert.equal(response.status, 410)
  assert.equal(brain.calls.length, 0)
  brain.restore()
})

test('🚨 the APPROVED path still reaches the same backend mutation', async () => {
  /*
   * The other half: closing the bypass must not have closed renaming. The
   * approval route dispatches to the Brain's consent endpoint, which performs the
   * same store mutation the withdrawn verb used to.
   */
  const brain = brainStub(200, { status: 'done', conversation: { id: 'conv_1', title: 'renamed' } })
  setAuthPort(portWith(session))

  const response = await RENAME_APPROVAL(
    new Request('https://chat.example.test/api/conversations/conv_1/rename-approval', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ step: 'dispatch', approvalToken: 'ap_1', title: 'renamed' }),
    }),
    params('conv_1'),
  )
  assert.equal(response.status, 200)
  assert.equal(brain.calls.length, 1, 'the approved path must still reach the Brain')
  assert.equal(brain.calls[0]?.method, 'POST')
  assert.match(brain.calls[0]?.path ?? '', /rename\/dispatch$/)
  const scope = brain.calls[0]?.scope ?? ''
  assert.ok(scope.length > 0, 'the dispatch must carry a scope, never run unscoped')
  brain.restore()
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

test('a signed-out visitor can delete their OWN conversation, scoped to them', async () => {
  // Same reversal, and the more important half of it: erasing what you typed is
  // the control a signed-out person is most likely to want, and it was refused.
  const brain = brainStub(200, { ok: true })
  setAuthPort(portWith(null))

  const response = await del('conv_1')
  assert.equal(response.status, 200)
  assert.equal(brain.calls.length, 1)
  const scope = brain.calls[0]?.scope ?? ''
  assert.ok(scope.length > 0, 'a delete must never run unscoped — that would cross visitors')

  brain.restore()
  reset()
})
