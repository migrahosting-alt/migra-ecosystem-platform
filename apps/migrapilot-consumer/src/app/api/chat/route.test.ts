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

/**
 * Stand in for the Brain at the network edge, without touching the gateway.
 *
 * A turn is four Brain calls, not one — create the conversation, append the
 * user's message, run the model, append the answer — so the double dispatches
 * by path. `chatStatus`/`chatBody` override only the model call; the
 * persistence calls succeed unless a test says otherwise.
 */
const CONVERSATION_ID = 'conv_test123'

function brainStub(
  options: {
    chatStatus?: number
    chatBody?: unknown
    appendStatus?: number
    createStatus?: number
  } = {},
) {
  const calls: { url: string; init: RequestInit }[] = []
  const original = globalThis.fetch

  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const href = String(url)
    calls.push({ url: href, init })

    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

    if (href.endsWith('/api/ai/chat')) {
      return json(options.chatStatus ?? 200, options.chatBody ?? { ok: true, content: 'answer' })
    }
    if (href.endsWith('/messages')) {
      return json(options.appendStatus ?? 200, { ok: true, stored: true, message: { id: 'msg_1' } })
    }
    if (href.endsWith('/api/ai/conversations')) {
      return json(options.createStatus ?? 200, { id: CONVERSATION_ID, memoryMode: 'durable' })
    }
    return json(404, { ok: false })
  }) as typeof globalThis.fetch

  return {
    calls,
    /** Just the Brain paths, in order. */
    paths: () => calls.map((call) => new URL(call.url).pathname),
    restore: () => void (globalThis.fetch = original),
  }
}

/** Back-compat shim for the tests that only care about the model call. */
const brainReturns = (status: number, body: unknown) =>
  brainStub({ chatStatus: status, chatBody: body })

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
  const brain = brainStub()
  setAuthPort(portWith(session))

  await post({ prompt: 'the prompt' })

  const chat = brain.calls.find((call) => call.url.endsWith('/api/ai/chat'))
  assert.ok(chat, `no chat call in: ${brain.paths().join(', ')}`)
  assert.equal(JSON.parse(String(chat!.init.body)).prompt, 'the prompt')

  // Tenancy is derived server-side from the session, on EVERY call — the
  // browser cannot influence it and no call may go out without it.
  for (const call of brain.calls) {
    assert.ok(new Headers(call.init.headers).get('x-owner-scope'), `unscoped call: ${call.url}`)
  }

  brain.restore()
  resetAuthPort()
})

// ── durable persistence ─────────────────────────────────────────────────────

test('a new conversation is created and both sides of the turn are stored', async () => {
  const brain = brainStub({ chatBody: { ok: true, content: 'the answer' } })
  setAuthPort(portWith(session))

  const response = await post({ prompt: 'the prompt' })
  assert.equal(response.status, 200)
  assert.equal(((await response.json()) as Record<string, unknown>).conversationId, CONVERSATION_ID)

  assert.deepEqual(brain.paths(), [
    '/api/ai/conversations',
    `/api/ai/conversations/${CONVERSATION_ID}/messages`,
    '/api/ai/chat',
    `/api/ai/conversations/${CONVERSATION_ID}/messages`,
  ])

  const stored = brain.calls
    .filter((call) => call.url.endsWith('/messages'))
    .map((call) => JSON.parse(String(call.init.body)))
  assert.deepEqual(stored, [
    { role: 'user', content: 'the prompt' },
    { role: 'assistant', content: 'the answer' },
  ])

  brain.restore()
  resetAuthPort()
})

test('the conversation is durable, so a reload can find it', async () => {
  const brain = brainStub()
  setAuthPort(portWith(session))

  await post({ prompt: 'hi' })
  const create = brain.calls.find((call) => call.url.endsWith('/api/ai/conversations'))
  // `session` memory would vanish on a Brain restart, which is precisely the
  // failure this whole slice exists to prevent.
  assert.equal(JSON.parse(String(create!.init.body)).memoryMode, 'durable')

  brain.restore()
  resetAuthPort()
})

test('an existing conversation is continued, not duplicated', async () => {
  const brain = brainStub()
  setAuthPort(portWith(session))

  await post({ prompt: 'follow up', conversationId: CONVERSATION_ID })
  assert.ok(
    !brain.paths().includes('/api/ai/conversations'),
    'a supplied conversation id must not create another conversation',
  )

  brain.restore()
  resetAuthPort()
})

test("the user's message is stored BEFORE the model runs, so a failed turn survives", async () => {
  // Persisting only on success would discard exactly the turns worth retrying.
  const brain = brainStub({ chatStatus: 502, chatBody: { ok: false, code: 'COMPLETION_FAILED' } })
  setAuthPort(portWith(session))

  const response = await post({ prompt: 'the prompt' })
  assert.equal(response.status, 502)

  const paths = brain.paths()
  assert.ok(
    paths.indexOf(`/api/ai/conversations/${CONVERSATION_ID}/messages`) < paths.indexOf('/api/ai/chat'),
    `the user message must be stored before the model call: ${paths.join(', ')}`,
  )
  // The answer never existed, so nothing is stored for it.
  assert.equal(paths.filter((path) => path.endsWith('/messages')).length, 1)

  brain.restore()
  resetAuthPort()
})

test('a failed turn still returns its conversation id, so the retry stays put', async () => {
  const brain = brainStub({ chatStatus: 502 })
  setAuthPort(portWith(session))

  const body = (await (await post({ prompt: 'hi' })).json()) as Record<string, unknown>
  assert.equal(body.conversationId, CONVERSATION_ID)
  assert.equal(body.content, undefined)

  brain.restore()
  resetAuthPort()
})

test('a conversation that cannot be created does not reach the model', async () => {
  const brain = brainStub({ createStatus: 500 })
  setAuthPort(portWith(session))

  const response = await post({ prompt: 'hi' })
  assert.equal(response.status, 502)
  assert.ok(!brain.paths().includes('/api/ai/chat'), 'no model call without somewhere to store the turn')

  brain.restore()
  resetAuthPort()
})

test('a foreign or unknown conversation id is a 404, not a silent new conversation', async () => {
  // The Brain scopes by owner, so another principal's id is genuinely not found
  // for this caller. Falling back to "create one" would hide the mistake.
  const brain = brainStub({ appendStatus: 404 })
  setAuthPort(portWith(session))

  const response = await post({ prompt: 'hi', conversationId: 'conv_someone_else' })
  assert.equal(response.status, 404)
  assert.ok(!brain.paths().includes('/api/ai/chat'))

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
