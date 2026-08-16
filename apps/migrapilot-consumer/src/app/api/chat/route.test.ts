/**
 * The chat turn contract.
 *
 * The property worth protecting here is narrow and absolute: **this route never
 * produces text that did not come from the model.** Every failure path is
 * asserted to carry no `content` at all, because the two things this replaced —
 * a local `demoReply()` and a fixed "AI isn't connected" notice — both put
 * invented prose where an answer belongs, on a public site.
 *
 * The Brain is never contacted: `callBrain` resolves the session through the
 * injected auth port and `fetchImpl` is a double. What is under test is the
 * mapping from a `BrainResult` to a status code and body.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { POST } from './route'
import { setAuthPort, resetAuthPort } from '@/server/auth'
import type { AppSession, AuthPort } from '@/server/auth/authPort'

// ── harness ─────────────────────────────────────────────────────────────────

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
  buildLogoutRedirect: () => 'https://auth.example.test/logout',
  handleCallback: async () => {},
  clearSession: async () => {},
})

const post = (body: unknown): Promise<Response> =>
  POST(
    new Request('https://chat.example.test/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )

/** Stand in for the Brain at the network edge, without touching the gateway. */
function brainReturns(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  return { calls, restore: () => void (globalThis.fetch = original) }
}

/** No failure response may carry model-shaped text. */
async function assertCarriesNoAnswer(response: Response) {
  const body = (await response.json()) as Record<string, unknown>
  assert.equal(body.content, undefined, 'a failed turn must not carry content')
  assert.ok(typeof body.error === 'string' && body.error.length > 0)
  assert.ok(typeof body.message === 'string' && body.message.length > 0)
}

// ── authentication ──────────────────────────────────────────────────────────

test('an unauthenticated turn is refused with 401 and no answer', async () => {
  setAuthPort(portWith(null))
  const response = await post({ prompt: 'hello' })
  assert.equal(response.status, 401)
  await assertCarriesNoAnswer(response)
  resetAuthPort()
})

test('an expired session is refused', async () => {
  setAuthPort(portWith({ ...session, expiresAt: Date.now() - 1 }))
  const response = await post({ prompt: 'hello' })
  assert.equal(response.status, 401)
  resetAuthPort()
})

test('an unauthenticated turn never reaches the Brain', async () => {
  const brain = brainReturns(200, { ok: true, content: 'leaked' })
  setAuthPort(portWith(null))

  await post({ prompt: 'hello' })
  assert.deepEqual(brain.calls, [], 'no Brain request may be made without a session')

  brain.restore()
  resetAuthPort()
})

// ── request validation ──────────────────────────────────────────────────────

test('a malformed body is refused before any Brain call', async () => {
  const brain = brainReturns(200, { ok: true, content: 'x' })
  setAuthPort(portWith(session))

  const response = await post('not json at all')
  assert.equal(response.status, 400)
  await assertCarriesNoAnswer(response)
  assert.deepEqual(brain.calls, [])

  brain.restore()
  resetAuthPort()
})

test('an empty or non-string prompt is refused', async () => {
  const brain = brainReturns(200, { ok: true, content: 'x' })
  setAuthPort(portWith(session))

  for (const prompt of [undefined, '', '   ', 42, null, { text: 'hi' }]) {
    const response = await post({ prompt })
    assert.equal(response.status, 400, `prompt ${JSON.stringify(prompt)} should be refused`)
  }
  assert.deepEqual(brain.calls, [], 'an invalid prompt must not reach the Brain')

  brain.restore()
  resetAuthPort()
})

// ── the answer path ─────────────────────────────────────────────────────────

test('a real answer is returned verbatim', async () => {
  const answer = 'The capital of France is Paris.'
  const brain = brainReturns(200, { ok: true, content: answer, model: 'qwen3:8b', provider: 'local' })
  setAuthPort(portWith(session))

  const response = await post({ prompt: 'What is the capital of France?' })
  assert.equal(response.status, 200)
  const body = (await response.json()) as Record<string, unknown>
  // Verbatim: the route must not trim, wrap or annotate model output.
  assert.equal(body.content, answer)
  assert.equal(body.model, 'qwen3:8b')

  brain.restore()
  resetAuthPort()
})

test('the browser is told nothing about where the Brain lives', async () => {
  const brain = brainReturns(200, { ok: true, content: 'ok', model: 'qwen3:8b' })
  setAuthPort(portWith(session))

  const raw = await (await post({ prompt: 'hi' })).text()
  for (const leak of ['3988', 'x-owner-scope', '/api/ai/', 'auth-user-AAA']) {
    assert.ok(!raw.includes(leak), `response leaked ${leak}`)
  }

  brain.restore()
  resetAuthPort()
})

test('the prompt reaches the Brain chat operation, scoped to the caller', async () => {
  const brain = brainReturns(200, { ok: true, content: 'ok' })
  setAuthPort(portWith(session))

  await post({ prompt: 'the prompt' })
  assert.equal(brain.calls.length, 1)
  const [call] = brain.calls
  assert.ok(call!.url.endsWith('/api/ai/chat'), `unexpected path: ${call!.url}`)
  // Tenancy is derived server-side from the session; the browser cannot influence it.
  const headers = new Headers(call!.init.headers)
  assert.ok(headers.get('x-owner-scope'))
  assert.equal(JSON.parse(String(call!.init.body)).prompt, 'the prompt')

  brain.restore()
  resetAuthPort()
})

// ── every failure is reported as a failure ──────────────────────────────────

test('a 200 with empty content is a failed turn, not an empty answer', async () => {
  // An empty assistant bubble reads as "the model had nothing to say".
  for (const content of ['', '   ', undefined, null, 42]) {
    const brain = brainReturns(200, { ok: true, content })
    setAuthPort(portWith(session))

    const response = await post({ prompt: 'hi' })
    assert.equal(response.status, 502, `content ${JSON.stringify(content)} should fail`)
    await assertCarriesNoAnswer(response)

    brain.restore()
    resetAuthPort()
  }
})

test('a Brain error is reported without inventing an answer', async () => {
  const brain = brainReturns(502, { ok: false, code: 'COMPLETION_FAILED' })
  setAuthPort(portWith(session))

  const response = await post({ prompt: 'hi' })
  assert.equal(response.status, 502)
  await assertCarriesNoAnswer(response)

  brain.restore()
  resetAuthPort()
})

test('an unreachable Brain is reported as unreachable', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed')
  }) as typeof globalThis.fetch
  setAuthPort(portWith(session))

  const response = await post({ prompt: 'hi' })
  assert.equal(response.status, 503)
  await assertCarriesNoAnswer(response)

  globalThis.fetch = original
  resetAuthPort()
})

test('a model timeout is distinguishable from a model failure', async () => {
  // The first turn after an idle period pays a full model load, so "slow" and
  // "broken" must not collapse into one message — 504 tells the user to retry.
  const original = globalThis.fetch
  globalThis.fetch = (async () => {
    const error = new Error('timed out')
    error.name = 'TimeoutError'
    throw error
  }) as typeof globalThis.fetch
  setAuthPort(portWith(session))

  const response = await post({ prompt: 'hi' })
  assert.equal(response.status, 504)
  const body = (await response.json()) as Record<string, unknown>
  assert.equal(body.error, 'model_timeout')
  assert.equal(body.content, undefined)

  globalThis.fetch = original
  resetAuthPort()
})
