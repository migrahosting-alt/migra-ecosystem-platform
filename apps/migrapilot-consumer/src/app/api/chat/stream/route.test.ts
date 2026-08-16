/**
 * The streamed chat turn.
 *
 * The property this suite exists to protect: **a partial answer is never
 * persisted.** A durable conversation whose history claims the model finished
 * saying something it never finished is worse than no history at all, and it is
 * invisible until someone reloads hours later.
 *
 * Everything else — auth, ordering, what reaches the browser — is asserted the
 * same way as the buffered route, against a fetch double standing in for the
 * Brain at the network edge.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { POST } from './route'
import { setAuthPort, resetAuthPort } from '@/server/auth'
import type { AppSession, AuthPort } from '@/server/auth/authPort'

// ── harness ─────────────────────────────────────────────────────────────────

const CONVERSATION_ID = 'conv_stream1'

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
  buildLogoutRedirect: () => 'https://auth.example.test/logout',
  handleCallback: async () => {},
  clearSession: async () => {},
})

const post = (body: unknown): Promise<Response> =>
  POST(
    new Request('https://chat.example.test/api/chat/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )

const sse = (frames: [string, unknown][]): string =>
  frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')

/**
 * Stand in for the Brain. `chatFrames` is the raw SSE body it streams back;
 * `chunkAt` splits it so chunk boundaries fall mid-frame, which is the case a
 * naive parser gets wrong.
 */
function brainStub(
  options: {
    chatBody?: string
    chunkAt?: number
    /** Fails only the ASSISTANT append — the prompt must still be stored, or
     *  the route legitimately answers JSON instead of ever opening a stream. */
    assistantAppendStatus?: number
  } = {},
) {
  const calls: { url: string; init: RequestInit }[] = []
  const original = globalThis.fetch

  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const href = String(url)
    calls.push({ url: href, init })
    const json = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

    if (href.endsWith('/api/ai/chat')) {
      const payload = options.chatBody ?? sse([['token', { text: 'hello' }], ['done', { requestId: 'r' }]])
      const bytes = new TextEncoder().encode(payload)
      const split = options.chunkAt ?? bytes.length
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, split))
          if (split < bytes.length) controller.enqueue(bytes.slice(split))
          controller.close()
        },
      })
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    if (href.endsWith('/messages')) {
      const role = (() => {
        try {
          return JSON.parse(String(init.body)).role
        } catch {
          return undefined
        }
      })()
      const status = role === 'assistant' ? (options.assistantAppendStatus ?? 200) : 200
      return json(status, { ok: true, stored: true, message: { id: 'msg_1' } })
    }
    if (href.endsWith('/api/ai/conversations')) return json(200, { id: CONVERSATION_ID })
    return json(404, { ok: false })
  }) as typeof globalThis.fetch

  return {
    calls,
    paths: () => calls.map((call) => new URL(call.url).pathname),
    /** Assistant messages the route asked the Brain to persist. */
    storedAssistant: () =>
      calls
        .filter((call) => call.url.endsWith('/messages'))
        .map((call) => JSON.parse(String(call.init.body)))
        .filter((stored) => stored.role === 'assistant'),
    restore: () => void (globalThis.fetch = original),
  }
}

/** Collect the SSE this route emits to the browser. */
async function collect(response: Response): Promise<{ event: string; data: any }[]> {
  const text = await response.text()
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((raw) => {
      let event = 'message'
      const data: string[] = []
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
      }
      return { event, data: JSON.parse(data.join('\n')) }
    })
}

// ── authentication and validation ───────────────────────────────────────────

test('an unauthenticated stream is refused and never reaches the Brain', async () => {
  const brain = brainStub()
  setAuthPort(portWith(null))

  const response = await post({ prompt: 'hi' })
  assert.equal(response.status, 401)
  assert.deepEqual(brain.calls, [])

  brain.restore()
  resetAuthPort()
})

test('an empty prompt is refused before any Brain call', async () => {
  const brain = brainStub()
  setAuthPort(portWith(session))

  assert.equal((await post({ prompt: '   ' })).status, 400)
  assert.deepEqual(brain.calls, [])

  brain.restore()
  resetAuthPort()
})

// ── the streaming contract ──────────────────────────────────────────────────

test('the first frame is emitted before the Brain is even asked', async () => {
  /*
   * The regression that made streaming pointless. The Brain does not flush its
   * SSE headers on `writeHead` — Node sends them with the first `write()`, and
   * the Brain's first write comes only after the model's first token. Awaiting
   * that before replying meant the browser got nothing, not even headers, for
   * 21.7s warm and minutes cold.
   *
   * So: `meta` must be queued before the upstream request is made. Asserted by
   * making the Brain's chat call hang forever and still requiring the frame.
   */
  const original = globalThis.fetch
  let chatAsked = false
  globalThis.fetch = (async (url: string | URL | Request) => {
    const href = String(url)
    if (href.endsWith('/api/ai/chat')) {
      chatAsked = true
      return new Promise<Response>(() => {}) // never resolves
    }
    if (href.endsWith('/messages')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ id: CONVERSATION_ID }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  setAuthPort(portWith(session))

  const response = await post({ prompt: 'hi' })
  const reader = response.body!.getReader()
  // Resolves only if the frame was queued without waiting on the Brain.
  const { value } = await reader.read()
  const first = new TextDecoder().decode(value)

  assert.match(first, /^event: meta\n/)
  assert.match(first, new RegExp(CONVERSATION_ID))

  // The Brain call never resolves, so reading that frame at all proves the
  // reply does not wait on it. The turn is still genuinely dispatched.
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(chatAsked, true, 'the turn must still be dispatched to the Brain')

  await reader.cancel().catch(() => undefined)
  globalThis.fetch = original
  resetAuthPort()
})

test('the conversation id arrives before any token', async () => {
  // A cold load produces no token for minutes. This first frame is what makes
  // the page show progress instead of freezing, and it hands the client the
  // durable id up front.
  const brain = brainStub()
  setAuthPort(portWith(session))

  const response = await post({ prompt: 'hi' })
  assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8')
  // nginx buffers proxied responses by default, which would undo the streaming.
  assert.equal(response.headers.get('x-accel-buffering'), 'no')

  const frames = await collect(response)
  assert.equal(frames[0]!.event, 'meta')
  assert.equal(frames[0]!.data.conversationId, CONVERSATION_ID)

  brain.restore()
  resetAuthPort()
})

test('tokens stream through and the whole answer is persisted once', async () => {
  const brain = brainStub({
    chatBody: sse([
      ['token', { text: 'The capital ' }],
      ['token', { text: 'is Paris.' }],
      ['done', { requestId: 'r' }],
    ]),
  })
  setAuthPort(portWith(session))

  const frames = await collect(await post({ prompt: 'hi' }))
  assert.deepEqual(
    frames.filter((f) => f.event === 'token').map((f) => f.data.text),
    ['The capital ', 'is Paris.'],
  )
  assert.equal(frames[frames.length - 1]!.event, 'done')

  // Persisted once, whole — not once per token.
  assert.deepEqual(brain.storedAssistant(), [{ role: 'assistant', content: 'The capital is Paris.' }])

  brain.restore()
  resetAuthPort()
})

test('a frame split across chunk boundaries is not corrupted', async () => {
  const body = sse([['token', { text: 'abcdef' }], ['done', {}]])
  const brain = brainStub({ chatBody: body, chunkAt: 12 })
  setAuthPort(portWith(session))

  const frames = await collect(await post({ prompt: 'hi' }))
  assert.deepEqual(
    frames.filter((f) => f.event === 'token').map((f) => f.data.text),
    ['abcdef'],
  )
  assert.deepEqual(brain.storedAssistant(), [{ role: 'assistant', content: 'abcdef' }])

  brain.restore()
  resetAuthPort()
})

// ── a partial answer is never persisted ─────────────────────────────────────

test('a stream that ends without `done` persists NOTHING', async () => {
  // The model was still generating when the connection died. Storing what
  // arrived would make a truncated sentence permanent history.
  const brain = brainStub({ chatBody: sse([['token', { text: 'half an ans' }]]) })
  setAuthPort(portWith(session))

  const frames = await collect(await post({ prompt: 'hi' }))
  assert.deepEqual(brain.storedAssistant(), [], 'a partial answer must not be persisted')

  const last = frames[frames.length - 1]!
  assert.equal(last.event, 'error')
  assert.equal(last.data.error, 'stream_interrupted')

  brain.restore()
  resetAuthPort()
})

test('an error frame mid-stream persists NOTHING', async () => {
  const brain = brainStub({
    chatBody: sse([
      ['token', { text: 'starting' }],
      ['error', { code: 'COMPLETION_FAILED', message: 'The engine stream was interrupted.' }],
    ]),
  })
  setAuthPort(portWith(session))

  const frames = await collect(await post({ prompt: 'hi' }))
  assert.deepEqual(brain.storedAssistant(), [])
  assert.ok(frames.some((f) => f.event === 'error'))

  brain.restore()
  resetAuthPort()
})

test('a completed but empty stream persists nothing and says so', async () => {
  const brain = brainStub({ chatBody: sse([['done', {}]]) })
  setAuthPort(portWith(session))

  const frames = await collect(await post({ prompt: 'hi' }))
  assert.deepEqual(brain.storedAssistant(), [])
  assert.equal(frames[frames.length - 1]!.data.error, 'stream_interrupted')

  brain.restore()
  resetAuthPort()
})

test('an answer that completes but cannot be saved is reported, not claimed', async () => {
  // The user watched it arrive; a reload will not have it. Silence here would
  // be the app lying by omission.
  const brain = brainStub({ assistantAppendStatus: 500 })
  setAuthPort(portWith(session))

  const frames = await collect(await post({ prompt: 'hi' }))
  const last = frames[frames.length - 1]!
  assert.equal(last.event, 'error')
  assert.equal(last.data.error, 'not_saved')

  brain.restore()
  resetAuthPort()
})

// ── ordering and isolation ──────────────────────────────────────────────────

test('the prompt is durable before the model is asked', async () => {
  const brain = brainStub()
  setAuthPort(portWith(session))

  await collect(await post({ prompt: 'hi' }))
  const paths = brain.paths()
  assert.ok(
    paths.indexOf(`/api/ai/conversations/${CONVERSATION_ID}/messages`) < paths.indexOf('/api/ai/chat'),
    `prompt must be stored first: ${paths.join(', ')}`,
  )

  brain.restore()
  resetAuthPort()
})

test('an existing conversation is continued, not duplicated', async () => {
  const brain = brainStub()
  setAuthPort(portWith(session))

  await collect(await post({ prompt: 'again', conversationId: CONVERSATION_ID }))
  assert.ok(!brain.paths().includes('/api/ai/conversations'))

  brain.restore()
  resetAuthPort()
})

test('Brain routing diagnostics never reach the browser', async () => {
  // `context` and `route` carry retrieval detail, model ids and failover
  // history. The browser gets the answer, not the engine's internals.
  const brain = brainStub({
    chatBody: sse([
      ['context', { retrieved: [{ path: '/etc/secret-notes.md', score: 0.9 }] }],
      ['route', { model: 'qwen3:8b', provider: 'local', failedOver: ['gpt-oss:120b-cloud'] }],
      ['token', { text: 'answer' }],
      ['done', { model: 'qwen3:8b', usage: { inputTokens: 10, outputTokens: 2 } }],
    ]),
  })
  setAuthPort(portWith(session))

  const raw = await (await post({ prompt: 'hi' })).text()
  for (const leak of ['secret-notes', 'qwen3:8b', 'failedOver', 'inputTokens', 'x-owner-scope', '3988']) {
    assert.ok(!raw.includes(leak), `stream leaked ${leak}`)
  }

  brain.restore()
  resetAuthPort()
})

test('every Brain call in a streamed turn carries the derived scope', async () => {
  const brain = brainStub()
  setAuthPort(portWith(session))

  await collect(await post({ prompt: 'hi' }))
  for (const call of brain.calls) {
    assert.ok(new Headers(call.init.headers).get('x-owner-scope'), `unscoped call: ${call.url}`)
  }

  brain.restore()
  resetAuthPort()
})

// ── grounding mode ──────────────────────────────────────────────────────────

test('an ordinary turn asks for no document evidence', async () => {
  const brain = brainStub()
  setAuthPort(portWith(session))

  await collect(await post({ prompt: 'what is the capital of France' }))
  const chat = brain.calls.find((call) => call.url.endsWith('/api/ai/chat'))!
  // `none`, never `auto`: auto silently falls back when retrieval finds nothing,
  // which is how an ungrounded answer got presented as a document summary.
  assert.equal(JSON.parse(String(chat.init.body)).groundingMode, 'none')

  brain.restore()
  resetAuthPort()
})

test('a grounded turn demands the approved index', async () => {
  const brain = brainStub()
  setAuthPort(portWith(session))

  await collect(await post({ prompt: 'summarise my documents', grounded: true }))
  const chat = brain.calls.find((call) => call.url.endsWith('/api/ai/chat'))!
  assert.equal(JSON.parse(String(chat.init.body)).groundingMode, 'approved')

  brain.restore()
  resetAuthPort()
})

test('a non-boolean grounded flag does not enable grounding', async () => {
  const brain = brainStub()
  setAuthPort(portWith(session))

  for (const grounded of ['true', 1, {}, null]) {
    await collect(await post({ prompt: 'hi', grounded }))
  }
  for (const call of brain.calls.filter((c) => c.url.endsWith('/api/ai/chat'))) {
    assert.equal(JSON.parse(String(call.init.body)).groundingMode, 'none')
  }

  brain.restore()
  resetAuthPort()
})

test('a refusal for want of evidence is reported as such, and persists nothing', async () => {
  /*
   * In `approved` mode the Brain answers 409 INSUFFICIENT_APPROVED_EVIDENCE
   * rather than letting the model answer from its own priors. That is the
   * feature working. The user must hear the real reason, and no answer may be
   * written to the conversation.
   */
  const original = globalThis.fetch
  const calls: { url: string; init: RequestInit }[] = []
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const href = String(url)
    calls.push({ url: href, init })
    if (href.endsWith('/api/ai/chat')) {
      return new Response(
        JSON.stringify({
          ok: false,
          code: 'INSUFFICIENT_APPROVED_EVIDENCE',
          error: 'Your indexed documents do not cover that.',
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      )
    }
    if (href.endsWith('/messages')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ id: CONVERSATION_ID }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  setAuthPort(portWith(session))

  const frames = await collect(await post({ prompt: 'anything', grounded: true }))
  const last = frames[frames.length - 1]!
  assert.equal(last.event, 'error')
  assert.equal(last.data.error, 'insufficient_evidence')
  // The Brain's repo-centric text must not reach the user.
  assert.match(last.data.message, /do not cover that/)
  assert.ok(!last.data.message.includes('branch'), 'no developer branch language')
  assert.ok(!last.data.message.includes('semantic index'), 'no engine internals')

  const storedAssistant = calls
    .filter((call) => call.url.endsWith('/messages'))
    .map((call) => JSON.parse(String(call.init.body)))
    .filter((stored) => stored.role === 'assistant')
  assert.deepEqual(storedAssistant, [], 'a refusal must not be persisted as an answer')

  globalThis.fetch = original
  resetAuthPort()
})
