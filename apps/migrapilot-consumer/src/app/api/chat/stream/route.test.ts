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
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A real, empty library: reconciliation must be exercised, not short-circuited by an
// unreadable default root.
process.env.UPLOAD_ROOT = mkdtempSync(join(tmpdir(), 'migrapilot-chat-'))
// Likewise for images. Without it a generated image is written to the production
// default path, which is unwritable here — and the turn then fails for a reason
// that has nothing to do with what is being tested.
process.env.IMAGE_ROOT = mkdtempSync(join(tmpdir(), 'migrapilot-chat-images-'))

import { POST, describePages } from './route'
import { setAuthPort, resetAuthPort } from '@/server/auth'
import { saveFile, userDirectory } from '@/server/files/storage'
import type { AppSession, AuthPort } from '@/server/auth/authPort'

// ── harness ─────────────────────────────────────────────────────────────────

const CONVERSATION_ID = 'conv_stream1'
/** Resolved lazily: userDirectory() needs a session, which each test installs. */
let UPLOAD_DIR = ''

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

const post = (body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  POST(
    new Request('https://chat.example.test/api/chat/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )

/** A real 1x1 PNG, so the store's magic-byte check sees genuine bytes. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

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
    /** Fails the USER append — a storage outage stops the turn before the model runs. */
    userAppendStatus?: number
    /** The Brain's error body, whose `code` carries the real reason. */
    userAppendBody?: unknown
    /** Files the conversation is durably grounded in, as the Brain would report. */
    conversationGrounding?: string[]
    /** Serve an APPROVED index so reconciliation can find one. */
    approvedIndex?: boolean
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
      if (role !== 'assistant' && options.userAppendStatus) {
        return json(options.userAppendStatus, options.userAppendBody ?? { ok: false })
      }
      const status = role === 'assistant' ? (options.assistantAppendStatus ?? 200) : 200
      return json(status, { ok: true, stored: true, message: { id: 'msg_1' } })
    }
    if (href.endsWith('/api/ai/conversations')) return json(200, { id: CONVERSATION_ID })
    // Reconciliation reads the conversation, then the index, before it will ground.
    if (/\/api\/ai\/conversations\/[^/]+$/.test(new URL(href).pathname)) {
      return json(200, { id: CONVERSATION_ID, groundingFiles: options.conversationGrounding ?? [] })
    }
    if (href.includes('/api/ai/indexes') && !href.includes('/status')) {
      return json(200, {
        indexes: options.approvedIndex ? [{ id: 'ix1', root: UPLOAD_DIR, state: 'approved' }] : [],
      })
    }
    if (href.includes('/status')) return json(200, { state: 'approved' })
    if (href.endsWith('/grounding')) return json(200, { id: CONVERSATION_ID })
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

test('a persistence refusal mid-stream is reported as not_saved, not as a failed turn', async () => {
  // The Brain emits PERSISTENCE_UNAVAILABLE AFTER the tokens are on the wire:
  // the answer is real and finished, and only its storage failed. Flattening it
  // into `brain_error` would tell the user their answer failed while the
  // finished text sat on screen — and the client would then delete it.
  const brain = brainStub({
    chatBody: sse([
      ['token', { text: 'Paris' }],
      ['error', { code: 'PERSISTENCE_UNAVAILABLE', message: 'The answer was produced but could not be saved.' }],
      ['done', {}],
    ]),
  })
  setAuthPort(portWith(session))

  const frames = await collect(await post({ prompt: 'capital of France?' }))
  const errors = frames.filter((f) => f.event === 'error')

  assert.ok(errors.length > 0, 'the refusal must reach the client')
  assert.ok(
    errors.some((f) => f.data.error === 'not_saved'),
    'a persistence refusal must be named not_saved',
  )
  assert.ok(
    !errors.some((f) => f.data.error === 'brain_error'),
    'it must NOT be flattened into a generic generation failure',
  )
  // The tokens still reached the user — that is the whole point of the distinction.
  assert.ok(frames.some((f) => f.event === 'token' && f.data.text === 'Paris'))

  brain.restore()
  resetAuthPort()
})

test('a storage outage is named, not blamed on "the assistant service"', async () => {
  // Reproduced on the canary: with the Brain's database read-only, the Brain
  // answered 503 PERSISTENCE_UNAVAILABLE and the user was shown "The assistant
  // service could not complete this request" — a model-fault reading of a
  // storage fault, with an identical retry as the only suggested action.
  const brain = brainStub({
    userAppendStatus: 503,
    userAppendBody: { ok: false, code: 'PERSISTENCE_UNAVAILABLE', error: 'Durable storage is unavailable.' },
  })
  setAuthPort(portWith(session))

  const response = await post({ prompt: 'hi' })
  assert.equal(response.status, 503, 'a storage outage is not a 502 service error')
  const body = (await response.json()) as { error: string; message: string }
  assert.equal(body.error, 'persistence_unavailable')
  assert.match(body.message, /could not be saved/i)
  assert.doesNotMatch(body.message, /assistant service/i, 'must not blame the model service')

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

test('attaching a file that is NOT in the library grounds nothing and stores nothing', async () => {
  // Reconciliation runs before the answer: the durable set is checked against the files
  // that actually exist. A name with no file behind it cannot ground, and must not be
  // written to the conversation either — a stale entry would keep claiming grounding on
  // every later turn. (The positive path needs a real file and an approved index, and is
  // covered by server/files/grounding.test.ts.)
  const brain = brainStub()
  setAuthPort(portWith(session))

  await collect(await post({ prompt: 'summarise my documents', attachments: ['notes.md'] }))

  /*
   * BEHAVIOUR CHANGED, and the change is the improvement. This used to assert
   * that the turn still reached the model with `groundingMode: 'none'` — an
   * ungrounded answer to "summarise my documents". That is now refused before
   * the model is asked, because answering a document question from nothing is
   * the defect, not the fallback.
   *
   * The property this test exists for is unchanged and still asserted below: a
   * name with no file behind it must never be written to the conversation, or a
   * stale entry would keep claiming grounding on every later turn.
   */
  assert.equal(
    brain.calls.some((call) => call.url.endsWith('/api/ai/chat')),
    false,
    'a document question with nothing behind it does not reach the model',
  )

  const put = brain.calls.find((call) => call.url.endsWith('/grounding'))
  assert.deepEqual(JSON.parse(String(put!.init.body)).files, [], 'a phantom file must not be stored')

  brain.restore()
  resetAuthPort()
})

test('THE GROUNDING SET REACHES THE BRAIN, not just the conversation', async () => {
  /*
   * The regression this exists for: the route spread `groundingFiles` into the seam call,
   * excess-property checks do not apply through a spread, so it compiled and passed while
   * resolveOperation dropped the field building the wire body. Retrieval kept ranking over
   * the whole library, and a grounded conversation could not find its own attached file.
   *
   * Asserting groundingMode was not enough — the boundary has to be ON THE WIRE.
   */
  setAuthPort(portWith(session))
  // A REAL file on disk: reconciliation refuses to ground on a name with nothing behind it,
  // which is the correct behaviour and would otherwise mask the regression under test.
  UPLOAD_DIR = await userDirectory()
  await saveFile('notes.md', new TextEncoder().encode('notes content').buffer as ArrayBuffer)
  const brain = brainStub({ conversationGrounding: ['notes.md'], approvedIndex: true })

  await collect(await post({ prompt: 'what is in my notes?', conversationId: CONVERSATION_ID }))

  const chat = brain.calls.find((call) => call.url.endsWith('/api/ai/chat'))!
  const body = JSON.parse(String(chat.init.body))
  assert.equal(body.groundingMode, 'approved')
  assert.deepEqual(body.groundingFiles, ['notes.md'], 'the file set must be sent to the Brain')

  brain.restore()
  resetAuthPort()
})

test('a body flag alone can no longer ground a turn', async () => {
  // The exact defect: the browser said "grounded" and the server believed it, so
  // grounding lived only as long as the tab. A claim from the client is not state.
  const brain = brainStub()
  setAuthPort(portWith(session))

  await collect(await post({ prompt: 'summarise my documents', grounded: true }))

  /*
   * The client's claim buys nothing. It used to be observable as a turn reaching
   * the model with `groundingMode: 'none'`; it is now observable as the turn
   * being refused, since the server knows no document is attached whatever the
   * body says. Either way the flag grounded nothing — which is the point.
   */
  assert.equal(
    brain.calls.some((call) => call.url.endsWith('/api/ai/chat')),
    false,
    'a client-declared grounding flag cannot produce a grounded answer',
  )

  brain.restore()
  resetAuthPort()
})

test('a malformed attachments field does not enable grounding', async () => {
  const brain = brainStub()
  setAuthPort(portWith(session))

  for (const attachments of ['notes.md', 1, {}, null, [1, 2], ['']]) {
    await collect(await post({ prompt: 'hi', attachments }))
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
  /*
   * DECISION REVERSED, deliberately. This previously asserted that a refusal is
   * never persisted. That was too broad: a refusal the system CHOSE to give —
   * "your documents do not cover that" — is a real response to the question, and
   * dropping it meant a user who reloaded found their question with no reply at
   * all, which reads as the product having lost the turn.
   *
   * The line now falls between DELIBERATE and TRANSIENT rather than between
   * refusal and answer: a chosen refusal is stored, a transport fault is not.
   */
  assert.equal(storedAssistant.length, 1, 'a deliberate refusal IS part of the conversation')
  assert.match(storedAssistant[0].content, /do not cover that/)

  globalThis.fetch = original
  resetAuthPort()
})


/* ---- the turn's trace id ---- */

test("the browser's id reaches the Brain, the meta frame and the response header", async () => {
  /*
   * ASSERTED AT THE BOUNDARY, not on a type. The whole value of a correlation id
   * is that the SAME string appears in the browser, in this service's log and in
   * the Brain's audit record; a version of this that only checked the route
   * accepted the header would pass while the header never left the process.
   */
  const supplied = 'req_0123456789abcdef0123'
  const brain = brainStub()
  setAuthPort(portWith(session))

  const response = await post({ prompt: 'hi' }, { 'x-request-id': supplied })
  assert.equal(response.headers.get('x-request-id'), supplied, 'the response names the turn')

  const frames = await collect(response)
  assert.equal(frames[0]!.data.requestId, supplied, 'the browser is told the id it was recorded under')
  const done = frames.find((f) => f.event === 'done')
  assert.equal(done?.data.requestId, supplied)

  // The leg that actually crosses a network.
  const upstream = brain.calls.find((c) => c.url.endsWith('/api/ai/chat'))
  assert.ok(upstream, 'the Brain was called')
  const sent = new Headers(upstream.init.headers as HeadersInit)
  assert.equal(sent.get('x-request-id'), supplied, 'the id is on the wire to the Brain')

  brain.restore()
  resetAuthPort()
})

test('a malformed id is replaced everywhere it would otherwise be echoed', async () => {
  /*
   * A literal newline cannot reach here — the platform refuses to construct such
   * a header at all, which is why that case is covered as a unit test on
   * `adoptRequestId` rather than through the route. What CAN arrive is an
   * over-long or out-of-charset value, and that still lands in this service's
   * logs and the Brain's durable audit store if it is echoed unchecked.
   */
  for (const hostile of ['req_' + 'a'.repeat(4000), 'req_NOT-HEX-AT-ALL!!', 'short']) {
    const brain = brainStub()
    setAuthPort(portWith(session))

    const response = await post({ prompt: 'hi' }, { 'x-request-id': hostile })
    const issued = response.headers.get('x-request-id')!
    assert.notEqual(issued, hostile, `${hostile.slice(0, 24)} must not be echoed`)
    assert.match(issued, /^req_[0-9a-f]{16,32}$/)

    const frames = await collect(response)
    assert.equal(frames[0]!.data.requestId, issued, 'the browser learns the real name')

    const upstream = brain.calls.find((c) => c.url.endsWith('/api/ai/chat'))
    const sent = new Headers(upstream!.init.headers as HeadersInit)
    assert.equal(sent.get('x-request-id'), issued, 'and the Brain is given the real name')

    brain.restore()
    resetAuthPort()
  }
})

test('a turn with no id supplied is still named, and named consistently', async () => {
  const brain = brainStub()
  setAuthPort(portWith(session))

  const response = await post({ prompt: 'hi' })
  const issued = response.headers.get('x-request-id')!
  assert.match(issued, /^req_[0-9a-f]{16,32}$/)

  const frames = await collect(response)
  // One turn, one name — the header, the frames and the Brain call all agree.
  assert.equal(frames[0]!.data.requestId, issued)
  const upstream = brain.calls.find((c) => c.url.endsWith('/api/ai/chat'))
  assert.equal(new Headers(upstream!.init.headers as HeadersInit).get('x-request-id'), issued)

  brain.restore()
  resetAuthPort()
})


test('a reason already given is not replaced by a generic one', async () => {
  /*
   * FOUND IN THE LIVE BROWSER. An image-generation turn failed with "Studio
   * could not be reached" — the one sentence that says what happened — and the
   * end-of-turn generic error overwrote it, so the user was told "The model did
   * not produce an answer" for a turn where no model was involved at all.
   */
  const brain = brainStub({
    chatBody: sse([['error', { code: 'IMAGE_GENERATION_FAILED', message: 'Studio could not be reached: fetch failed' }]]),
  })
  setAuthPort(portWith(session))

  const frames = await collect(await post({ prompt: 'generate letter A in png' }))
  const errors = frames.filter((f) => f.event === 'error')
  assert.equal(errors.length, 1, `exactly one explanation, saw ${JSON.stringify(errors.map((e) => e.data))}`)
  assert.match(String(errors[0]!.data.message), /Studio could not be reached/)
  assert.doesNotMatch(String(errors[0]!.data.message), /did not produce an answer/)

  brain.restore()
  resetAuthPort()
})

test('a turn that simply produced nothing still says so', async () => {
  // The generic message must survive for the case it was written for.
  const brain = brainStub({ chatBody: sse([['done', { requestId: 'r' }]]) })
  setAuthPort(portWith(session))

  const frames = await collect(await post({ prompt: 'hi' }))
  const errors = frames.filter((f) => f.event === 'error')
  assert.equal(errors.length, 1)
  assert.match(String(errors[0]!.data.message), /did not produce an answer/)

  brain.restore()
  resetAuthPort()
})


test('a picture is a message: a generated turn with no text still persists', async () => {
  /*
   * THE SIGNED-IN FIXTURE FAILURE. Studio produced a real 194KB PNG, the image
   * was stored under a canonical ref, and the assistant message was refused
   * before it left this process: an image-generation turn has NO text, and the
   * content validator — correct for a prompt — rejects an empty string. The user
   * was told "the answer arrived but could not be saved" while the artifact sat
   * perfectly stored in their library.
   */
  const brain = brainStub({
    chatBody: sse([
      ['route', { capability: 'image_generation', model: 'flux1-schnell-fp8.safetensors' }],
      ['image', {
        mimeType: 'image/png',
        dataBase64: PNG_BASE64,
        model: 'flux1-schnell-fp8.safetensors',
        runId: 'studio-run-1',
        prompt: "a single capital letter 'A', bold black serif typography",
      }],
      ['done', { requestId: 'r' }],
    ]),
  })
  setAuthPort(portWith(session))

  const frames = await collect(await post({ prompt: 'generate letter A in png' }))

  const done = frames.find((f) => f.event === 'done')
  assert.ok(done, `the turn completed, saw ${JSON.stringify(frames.map((f) => f.event))}`)
  assert.equal(frames.filter((f) => f.event === 'error').length, 0, 'nothing failed')

  // The ref reached the browser AND the assistant message carries it.
  const imageFrame = frames.find((f) => f.event === 'image')
  assert.match(String(imageFrame?.data.ref), /^img_[0-9a-f]{32}$/)
  assert.deepEqual(done!.data.images, [imageFrame!.data.ref])

  const append = brain.calls.find(
    (c) => c.url.endsWith('/messages') && JSON.parse(String(c.init.body)).role === 'assistant',
  )
  assert.ok(append, 'the assistant message was appended')
  const body = JSON.parse(String(append!.init.body)) as { content: string; imageRefs?: string[] }
  assert.equal(body.content, '', 'an image-only turn has no text, and that is allowed')
  assert.deepEqual(body.imageRefs, [imageFrame!.data.ref], 'the ref is on the message, not the bytes')
  // Never the bytes.
  assert.doesNotMatch(String(append!.init.body), /iVBORw0KGgo/)

  brain.restore()
  resetAuthPort()
})

test('a message with neither text nor images is still refused', async () => {
  // Emptiness is only allowed BECAUSE a picture is the content.
  const brain = brainStub({ chatBody: sse([['done', { requestId: 'r' }]]) })
  setAuthPort(portWith(session))

  await collect(await post({ prompt: 'hi' }))
  const appended = brain.calls.filter(
    (c) => c.url.endsWith('/messages') && JSON.parse(String(c.init.body)).role === 'assistant',
  )
  assert.equal(appended.length, 0, 'nothing empty was written')

  brain.restore()
  resetAuthPort()
})

test('an edit request the product cannot perform is refused honestly, not improvised', async () => {
  /*
   * WHY THIS EXISTS. The router learned to recognise "transform" turns before
   * anything could execute one, and the turn was still handed to a text model.
   * Asked to "make this one blue", it answered "Sure! Here's the text in blue:
   * blue" — an invented edit result for an edit that never happened.
   *
   * The user must be told the truth: the image can be understood, editing does
   * not exist yet, and here is the thing that can be done instead.
   */
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string | URL | Request) => {
    const href = String(url)
    if (href.endsWith('/api/ai/chat')) {
      return new Response(
        JSON.stringify({
          ok: false,
          code: 'IMAGE_EDITING_UNAVAILABLE',
          error:
            'I can understand the image, but image editing is not available in MigraPilot yet. ' +
            'I can generate a new image based on your requested change instead.',
          operation: 'image.transform',
        }),
        { status: 422, headers: { 'content-type': 'application/json' } },
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

  const frames = await collect(await post({ prompt: 'make this one blue' }))
  const last = frames[frames.length - 1]!

  assert.equal(last.event, 'error')
  assert.equal(last.data.error, 'image_editing_unavailable')
  // The three things the sentence must carry, asserted individually so a
  // rewrite cannot quietly drop one.
  assert.match(last.data.message, /understand the image/i)
  assert.match(last.data.message, /not available/i)
  assert.match(last.data.message, /generate a new image/i)
  // And it must never read as though the edit happened.
  assert.ok(!/here('s| is) (the|your)/i.test(last.data.message), 'no invented edit result')

  globalThis.fetch = original
  resetAuthPort()
})

test('a conversation whose active image was deleted says so instead of answering blind', async () => {
  /*
   * WHY THIS EXISTS. An active image ref is carried forward so a follow-up needs
   * no reattachment. When that artifact is deleted, the ref stops resolving and
   * is reconciled away correctly — but silently. The next question was answered
   * as though a picture had never been attached: confident, ungrounded, with
   * nothing telling the user why the answer no longer described their image.
   *
   * This is the case I created for real by deleting an image mid-session, then
   * misread as "follow-up context is broken".
   */
  const original = globalThis.fetch
  const brainCalls: string[] = []
  globalThis.fetch = (async (url: string | URL | Request) => {
    const href = String(url)
    brainCalls.push(href)
    if (href.includes('/conversations/') && !href.endsWith('/messages')) {
      // The conversation still remembers a ref whose artifact no longer exists.
      return new Response(
        JSON.stringify({ id: CONVERSATION_ID, imageRefs: ['img_' + 'd'.repeat(32)] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify({ ok: true, id: CONVERSATION_ID }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  setAuthPort(portWith(session))

  const frames = await collect(await post({ prompt: 'what colour is it?', conversationId: CONVERSATION_ID }))
  const last = frames[frames.length - 1]!

  assert.equal(last.event, 'error')
  assert.equal(last.data.error, 'active_image_unavailable')
  assert.match(last.data.message, /no longer available/i)
  assert.match(last.data.message, /Media Library/i)

  // And the model was never asked — there was nothing to answer from.
  assert.equal(brainCalls.some((u) => u.includes('/api/ai/chat')), false, 'no model call')

  globalThis.fetch = original
  resetAuthPort()
})

/*
 * ══════════════════════════════════════════════════════════════════════════
 * BEHAVIOURAL MATRIX — a conversation's ACTIVE image context.
 *
 * Every case asserts what the BRAIN ACTUALLY RECEIVED, not what the interface
 * shows. The distinction is the point: the UI can look perfectly correct while
 * the model is sent something else entirely, and that gap is exactly how a
 * follow-up ends up answered blind.
 * ══════════════════════════════════════════════════════════════════════════
 */

/** Store a real image for this session and return its ref. */
async function storedImage(name: string, fill: number): Promise<string> {
  // Storing is scoped to the caller, so the session must be in place first —
  // the previous test's cleanup resets it.
  setAuthPort(portWith(session))
  const { saveImage } = await import('@/server/files/imageStore')
  /*
   * A genuinely VALID png whose pixels differ per call, so each image gets a
   * distinct content-addressed id. An earlier version appended a byte to a fixed
   * PNG to vary the hash — the store accepted it on magic bytes and header, and
   * then every read dropped it as undecodable, which looked exactly like the
   * context bug these tests exist to rule out.
   */
  const { deflateSync } = await import('node:zlib')
  const w = 8, h = 8
  const raw = Buffer.concat(Array.from({ length: h }, () =>
    Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, fill)])))
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Buffer) => {
    let c = 0xffffffff
    for (const x of b) c = table[(c ^ x) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length)
    const body = Buffer.concat([Buffer.from(t, 'ascii'), d])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
  const meta = await saveImage(name, png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer)
  return meta.id
}

/**
 * Run one turn against a conversation whose stored active set is `storedRefs`,
 * and report exactly what the Brain was sent.
 */
async function turnWith(options: {
  storedRefs: string[]
  attachNow?: string[]
  prompt?: string
}): Promise<{ sentRefs: string[]; setImagesTo: string[] | null; askedModel: boolean }> {
  const original = globalThis.fetch
  let sentRefs: string[] = []
  let setImagesTo: string[] | null = null
  let askedModel = false

  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const href = String(url)
    const method = (init.method ?? 'GET').toUpperCase()
    const parseBody = () => {
      try {
        return JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
      } catch {
        return {} as Record<string, unknown>
      }
    }

    if (href.endsWith('/api/ai/chat')) {
      askedModel = true
      const body = parseBody()
      /*
       * The Brain reads `attachments`; the consumer's own option is named
       * `imageAttachments`. Both are accepted here so this asserts what the
       * Brain ACTUALLY receives rather than what the consumer called it.
       */
      const attachments = ((body.attachments ?? body.imageAttachments ?? []) as { name?: string; ref?: string }[])
      sentRefs = attachments.map((a) => a.name ?? a.ref ?? '')
      return new Response('event: done\ndata: {}\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }
    if (href.includes('/images') && method === 'PUT') {
      setImagesTo = (parseBody().images ?? []) as string[]
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (href.includes('/conversations/') && !href.endsWith('/messages')) {
      return new Response(JSON.stringify({ id: CONVERSATION_ID, imageRefs: options.storedRefs }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ ok: true, id: CONVERSATION_ID }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch

  setAuthPort(portWith(session))
  await collect(
    await post({
      prompt: options.prompt ?? 'follow up',
      conversationId: CONVERSATION_ID,
      ...(options.attachNow ? { images: options.attachNow } : {}),
    }),
  )
  globalThis.fetch = original
  resetAuthPort()
  return { sentRefs, setImagesTo, askedModel }
}

test('MATRIX: a follow-up with no reattachment still sends the active image to the Brain', async () => {
  // Refresh and reopen-from-History are the same code path as any other
  // follow-up: the browser sends a conversationId and no images, and the active
  // set is read from the conversation. Asserted on what the Brain received.
  const ref = await storedImage('active.png', 1)
  const { sentRefs, askedModel } = await turnWith({ storedRefs: [ref] })

  assert.equal(askedModel, true)
  assert.deepEqual(sentRefs, [ref], 'the stored active image reached the model')
})

test('MATRIX: attaching a new image adds it to the active set that is sent', async () => {
  const older = await storedImage('older.png', 2)
  const fresh = await storedImage('fresh.png', 3)
  const { sentRefs, setImagesTo } = await turnWith({ storedRefs: [older], attachNow: [fresh] })

  assert.ok(sentRefs.includes(fresh), 'the newly attached image is sent')
  assert.deepEqual(setImagesTo, sentRefs, 'and the persisted active set matches exactly what was sent')
})

test('MATRIX: multi-image order is deterministic and survives to the Brain', async () => {
  /*
   * "The first one" is a real question a user asks, so the order the model sees
   * must be the order the conversation recorded — stored refs first, then what
   * this turn added.
   */
  const a = await storedImage('a.png', 4)
  const b = await storedImage('b.png', 5)
  const c = await storedImage('c.png', 6)

  const first = await turnWith({ storedRefs: [a, b], attachNow: [c] })
  assert.deepEqual(first.sentRefs, [a, b, c])

  // Repeated with the same inputs, it must not reshuffle.
  const again = await turnWith({ storedRefs: [a, b], attachNow: [c] })
  assert.deepEqual(again.sentRefs, first.sentRefs, 'order is stable across turns')
})

test('MATRIX: clearing the active set means the next turn sends no image', async () => {
  // What "remove it from the conversation" must actually mean downstream.
  const { sentRefs, askedModel } = await turnWith({ storedRefs: [] })

  assert.equal(askedModel, true, 'a text question still gets answered')
  assert.deepEqual(sentRefs, [], 'and carries no image')
})

test('MATRIX: a text-only conversation is completely unaffected', async () => {
  const { sentRefs, setImagesTo, askedModel } = await turnWith({
    storedRefs: [],
    prompt: 'what is the capital of France?',
  })

  assert.equal(askedModel, true)
  assert.deepEqual(sentRefs, [])
  // Nothing to reconcile means no write at all — a text thread must not acquire
  // image state simply by being talked to.
  assert.equal(setImagesTo, null, 'no image set was written')
})

test('MATRIX: a ref that no longer resolves is dropped from what the Brain receives', async () => {
  /*
   * The partial case, which is the one that leaks if it is wrong: some of the
   * active set is gone, the rest is fine. The survivors go; the dead ref does
   * not; and the persisted set is corrected to match.
   */
  const alive = await storedImage('alive.png', 7)
  const dead = 'img_' + 'e'.repeat(32)
  const { sentRefs, setImagesTo } = await turnWith({ storedRefs: [alive, dead] })

  assert.deepEqual(sentRefs, [alive])
  assert.deepEqual(setImagesTo, [alive], 'the conversation no longer claims the dead ref')
})

/*
 * ══════════════════════════════════════════════════════════════════════════
 * THE REFUSAL PATH — a refusal is an ANSWER, and must survive a reload.
 *
 * Both of these were emitted and forgotten: the user was told the truth, hit
 * refresh, and found their question sitting there with no reply at all, which
 * reads as the product having lost the turn.
 * ══════════════════════════════════════════════════════════════════════════
 */

/** Run one refused turn and report what was told, stored, and recorded. */
async function refusedTurn(brainResponse: { status: number; body: unknown }): Promise<{
  told: string
  storedAssistant: string | null
  outcome: string | null
  brainFailureRecorded: boolean
}> {
  const original = globalThis.fetch
  let storedAssistant: string | null = null
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const href = String(url)
    if (href.endsWith('/api/ai/chat')) {
      return new Response(JSON.stringify(brainResponse.body), {
        status: brainResponse.status,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (href.endsWith('/messages') && (init.method ?? 'GET').toUpperCase() === 'POST') {
      const parsed = JSON.parse(String(init.body ?? '{}')) as { role?: string; content?: string }
      if (parsed.role === 'assistant') storedAssistant = parsed.content ?? ''
      return new Response(JSON.stringify({ ok: true, id: 'm1' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ ok: true, id: CONVERSATION_ID }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch

  setAuthPort(portWith(session))
  const frames = await collect(await post({ prompt: 'edit this image', conversationId: CONVERSATION_ID }))
  globalThis.fetch = original
  resetAuthPort()

  const last = frames[frames.length - 1]!
  const turnLine = frames.find((f) => f.event === 'error')
  return {
    told: String(last.data.message ?? ''),
    storedAssistant,
    outcome: turnLine ? String(last.data.error ?? '') : null,
    brainFailureRecorded: false,
  }
}

test('REGRESSION: a capability refusal is written to the conversation, so a reload still shows it', async () => {
  const result = await refusedTurn({
    status: 422,
    body: {
      ok: false,
      code: 'IMAGE_EDITING_UNAVAILABLE',
      error:
        'I can understand the image, but image editing is not available in MigraPilot yet. ' +
        'I can generate a new image based on your requested change instead.',
    },
  })

  assert.match(result.told, /image editing is not available/i, 'the user is told live')
  assert.ok(result.storedAssistant, 'AND it is stored as an assistant message')
  assert.match(result.storedAssistant!, /image editing is not available/i)
  // The stored text is the same text — a reload must not show a different answer.
  assert.equal(result.storedAssistant, result.told)
})

test('REGRESSION: a transport fault is NOT written to the conversation', async () => {
  /*
   * The other half of the rule. Our outage says nothing about what the user
   * asked, and storing it would make our failure a permanent part of their
   * history.
   */
  const result = await refusedTurn({ status: 503, body: { ok: false, code: 'UPSTREAM_DEAD' } })

  assert.ok(result.told.length > 0, 'the user is still told something')
  assert.equal(result.storedAssistant, null, 'but nothing is written to the thread')
})

test('REGRESSION: a refusal is never recorded as an outage', async () => {
  /*
   * It used to settle as `brain_unreachable` with `brain_failure: brain_error`.
   * A deliberate 422 is the feature working; counting it as an outage drags
   * alerting into a healthy path and inflates the error rate.
   */
  const result = await refusedTurn({
    status: 422,
    body: { ok: false, code: 'IMAGE_EDITING_UNAVAILABLE', error: 'not available yet' },
  })
  assert.equal(result.outcome, 'image_editing_unavailable', 'reported to the client as a refusal')
  assert.ok(result.storedAssistant, 'and kept in the conversation')
})

test('a question about an unattached document is refused, not answered from nothing', async () => {
  /*
   * THE DEFECT. Asked for the rollback marker in an indexed runbook that had
   * never been attached to the conversation, the model answered that the command
   * "might be `./rollback.sh`" and that the script "typically undoes the changes
   * made during the cutover". Fluent, confident, invented — and the Files page
   * had told the user the document was ready, so they had every reason to
   * believe it had been read.
   *
   * The library is durable storage; a conversation is grounded by the files
   * ATTACHED TO IT.
   */
  const original = globalThis.fetch
  const brainCalls: string[] = []
  let storedAssistant: string | null = null
  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const href = String(url)
    brainCalls.push(href)
    if (href.endsWith('/messages') && (init.method ?? 'GET').toUpperCase() === 'POST') {
      const parsed = JSON.parse(String(init.body ?? '{}')) as { role?: string; content?: string }
      if (parsed.role === 'assistant') storedAssistant = parsed.content ?? ''
    }
    return new Response(JSON.stringify({ ok: true, id: CONVERSATION_ID }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  setAuthPort(portWith(session))

  const frames = await collect(
    await post({ prompt: 'what is the rollback marker in my runbook?', conversationId: CONVERSATION_ID }),
  )
  const last = frames[frames.length - 1]!

  assert.equal(last.event, 'error')
  assert.equal(last.data.error, 'document_not_attached')
  assert.match(last.data.message, /attached to this conversation/i)
  assert.match(last.data.message, /choose it from Files/i)

  // The model is never asked — there is nothing to answer from.
  assert.equal(brainCalls.some((u) => u.includes('/api/ai/chat')), false, 'no model call')
  // And the refusal is part of the conversation, like every other deliberate one.
  assert.ok(storedAssistant, 'the refusal was stored')

  globalThis.fetch = original
  resetAuthPort()
})

test('an ordinary question with no files attached is still answered', async () => {
  // The refusal must not become a trap that catches normal conversation.
  const original = globalThis.fetch
  let askedModel = false
  globalThis.fetch = (async (url: string | URL | Request) => {
    const href = String(url)
    if (href.endsWith('/api/ai/chat')) {
      askedModel = true
      return new Response('event: done\ndata: {}\n\n', {
        status: 200, headers: { 'content-type': 'text/event-stream' },
      })
    }
    return new Response(JSON.stringify({ ok: true, id: CONVERSATION_ID }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }) as typeof globalThis.fetch
  setAuthPort(portWith(session))

  await collect(await post({ prompt: 'what is the capital of France?', conversationId: CONVERSATION_ID }))
  assert.equal(askedModel, true, 'a normal question still reaches the model')

  globalThis.fetch = original
  resetAuthPort()
})

test('attribution is the ENGINE\'s report, intersected with the caller\'s own library', async () => {
  /*
   * THE DEFECT. Attribution was derived with `answer.includes(file.name)`, so
   * provenance was a property of WORDING: a grounded TXT answer that mentioned
   * its filename showed "From your files", and an equally grounded Markdown
   * answer that did not mention it showed nothing. Same path, same evidence,
   * different trust signal.
   *
   * Tested directly rather than through the turn, because the mock harness has
   * no approved index and so can never reach a grounded turn — a test that
   * passed there would be passing for the wrong reason.
   */
  const { attributedFiles } = await import('./route')
  const { saveFile } = await import('@/server/files/storage')
  setAuthPort(portWith(session))
  await saveFile('attributed-runbook.md', new TextEncoder().encode('# Runbook').buffer as ArrayBuffer)

  // The engine reports index PATHS; the library is keyed by name.
  assert.deepEqual(
    await attributedFiles(['some/index/root/attributed-runbook.md']),
    ['attributed-runbook.md'],
    'attributed although no prose was consulted at all',
  )

  // A path that is not one of the caller's documents can never be surfaced.
  assert.deepEqual(await attributedFiles(['/etc/passwd', 'someone-elses.md']), [])

  // Nothing grounded means nothing attributed — no speculative credit.
  assert.deepEqual(await attributedFiles([]), [])

  resetAuthPort()
})

/*
 * ── PAGE PROVENANCE MUST NOT INVENT A CITATION ──────────────────────────────
 *
 * A range is a claim about every page between its ends. Collapsing pages 2, 9
 * and 40 into "pages 2-40" would cite 38 pages nobody retrieved — the same class
 * of error as the filename attribution this replaced, where provenance was
 * inferred instead of carried.
 */

test('a single retrieved page reads as one page', () => {
  assert.equal(describePages([7]), 'page 7')
})

test('the same page cited by several chunks appears once', () => {
  assert.equal(describePages([7, 7, 7]), 'page 7')
})

test('adjacent pages read as a span', () => {
  assert.equal(describePages([7, 8]), 'pages 7-8')
  assert.equal(describePages([8, 7]), 'pages 7-8', 'order of retrieval must not matter')
})

test('NONCONTIGUOUS pages are never collapsed into a fake range', () => {
  const label = describePages([2, 9])
  assert.equal(label, 'pages 2, 9')
  assert.doesNotMatch(label, /2-9/, 'must not claim the seven pages in between')
})

test('a mix of runs and singles keeps both honest', () => {
  assert.equal(describePages([2, 3, 4, 9]), 'pages 2-4, 9')
})

test('many scattered pages become a count rather than an unreadable list', () => {
  // Still true, still checkable, and it does not pretend to a range.
  const label = describePages([2, 9, 40, 41, 77, 90])
  assert.equal(label, '6 pages')
  assert.doesNotMatch(label, /-/, 'a count must not imply contiguity')
})

test('no pages produces no label, so non-PDF sources are unchanged', () => {
  assert.equal(describePages([]), '')
  assert.equal(describePages([0, -3]), '', 'nonsense page numbers are not rendered')
})
