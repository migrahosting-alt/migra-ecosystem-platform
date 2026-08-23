/**
 * A signed-out visitor's chat turn, end to end through the real route.
 *
 * THE ORDER IS THE FEATURE, so the order is what is asserted. Not "a reserve
 * happened" but "the reserve happened BEFORE the model was asked" — a limit
 * checked after generation has already paid for the inference it exists to
 * prevent, and would pass a test that only counted calls.
 *
 * The settlement asymmetry is asserted the same way, from the Brain's point of
 * view: what did this route actually ask the ledger to do, and did any token
 * reach the user first.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.UPLOAD_ROOT = mkdtempSync(join(tmpdir(), 'migrapilot-anon-'))
// Without a signing secret an anonymous identity would be forgeable, so the
// feature is OFF. Every test below depends on it being configured.
process.env.APP_SESSION_SECRET = 'anonymous-slice-test-secret-value'

import { POST } from './route'
import { setAuthPort, resetAuthPort } from '@/server/auth'
import { ANONYMOUS_COOKIE_NAME } from '@/server/tenancy/anonymousIdentity'
import type { AppSession, AuthPort } from '@/server/auth/authPort'
// The jar the loader substitutes for `next/headers` — see test/nextHeadersStub.mjs.
import {
  __getCookie,
  __resetCookies,
  __setCookie,
  __setReadOnly,
} from '../../../../../test/nextHeadersStub.mjs'

const CONVERSATION_ID = 'conv_anon1'

const signedOut: AuthPort = {
  getSession: async () => null,
  buildLoginRedirect: async () => 'https://auth.example.test/authorize',
  buildSignupRedirect: async () => 'https://auth.example.test/signup',
  buildLogoutRedirect: () => 'https://auth.example.test/logout',
  handleCallback: async () => {},
  clearSession: async () => {},
}

const account: AppSession = {
  sessionId: 'sess-1',
  authUserId: 'auth-user-AAA',
  email: 'user@example.test',
  permissions: [],
  createdAt: Date.now(),
  expiresAt: Date.now() + 3_600_000,
}

const signedIn: AuthPort = { ...signedOut, getSession: async () => account }

const post = (body: unknown): Promise<Response> =>
  POST(
    new Request('https://chat.example.test/api/chat/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

const sse = (frames: [string, unknown][]): string =>
  frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')

const quotaOf = (limit: number, used: number) => ({
  mode: 'anonymous' as const,
  allowed: limit - used > 0,
  limit,
  used,
  remaining: Math.max(0, limit - used),
  warning: limit - used > 0 && limit - used <= 2,
  exhausted: limit - used <= 0,
})

interface StubOptions {
  /** 429 from reserve: the visitor is out of turns. */
  exhausted?: boolean
  /** 503 from reserve: the ledger is unreachable. Never a free turn. */
  ledgerDown?: boolean
  /** The Brain refuses to open the chat stream at all. */
  streamStatus?: number
  /** The SSE the Brain streams back. */
  chatBody?: string
  /** Fail the assistant append, to prove a delivered answer still charges. */
  assistantAppendStatus?: number
  used?: number
}

function brainStub(options: StubOptions = {}) {
  const calls: { path: string; body: unknown; scope: string | null }[] = []
  const original = globalThis.fetch
  const limit = 5
  let used = options.used ?? 0

  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const href = String(url)
    const path = new URL(href).pathname
    const parsed = (() => {
      try {
        return init.body ? JSON.parse(String(init.body)) : undefined
      } catch {
        return String(init.body)
      }
    })()
    calls.push({ path, body: parsed, scope: new Headers(init.headers).get('x-owner-scope') })

    const json = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

    if (path === '/api/ai/anonymous/reserve') {
      if (options.ledgerDown) {
        return json(503, { ok: false, code: 'PERSISTENCE_UNAVAILABLE', error: 'down' })
      }
      if (options.exhausted) {
        return json(429, { ok: false, code: 'QUOTA_EXHAUSTED', quota: quotaOf(limit, limit) })
      }
      used += 1
      return json(200, {
        ok: true,
        reservation: { reservationId: parsed?.reservationId, remainingAfterReservation: limit - used },
        quota: quotaOf(limit, used),
      })
    }
    if (path === '/api/ai/anonymous/settle') {
      if (parsed?.producedOutput !== true) used = Math.max(0, used - 1)
      return json(200, { ok: true, settlement: parsed?.producedOutput ? 'consume' : 'release' })
    }
    if (path === '/api/ai/anonymous/quota') {
      return json(200, { ok: true, quota: quotaOf(limit, used), claimed: false })
    }

    if (path === '/api/ai/chat') {
      if (options.streamStatus) return json(options.streamStatus, { ok: false, error: 'refused' })
      const payload =
        options.chatBody ?? sse([['token', { text: 'hello' }], ['done', { requestId: 'r' }]])
      const bytes = new TextEncoder().encode(payload)
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes)
            controller.close()
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )
    }
    if (path.endsWith('/messages')) {
      const status = parsed?.role === 'assistant' ? (options.assistantAppendStatus ?? 200) : 200
      return json(status, { ok: true, message: { id: 'm1' } })
    }
    if (path === '/api/ai/conversations') return json(200, { id: CONVERSATION_ID })
    if (/^\/api\/ai\/conversations\/[^/]+$/.test(path)) {
      return json(200, { id: CONVERSATION_ID, groundingFiles: [] })
    }
    return json(404, { ok: false })
  }) as typeof globalThis.fetch

  return {
    calls,
    paths: () => calls.map((call) => call.path),
    settlements: () =>
      calls
        .filter((call) => call.path === '/api/ai/anonymous/settle')
        .map((call) => call.body as { reservationId: string; producedOutput: boolean; failure?: string }),
    restore: () => void (globalThis.fetch = original),
  }
}

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

const reset = () => {
  resetAuthPort()
  __resetCookies()
  __setReadOnly(false)
}

// ── the first turn ──────────────────────────────────────────────────────────

test('a visitor with no cookie gets an identity, a reservation, and an answer', async () => {
  const brain = brainStub()
  setAuthPort(signedOut)
  __resetCookies()

  const response = await post({ prompt: 'hello' })
  assert.equal(response.status, 200)
  const frames = await collect(response)

  // The identity was WRITTEN. Without this the next request mints another one,
  // which is a fresh allowance every time.
  const cookie = __getCookie(ANONYMOUS_COOKIE_NAME)
  assert.ok(cookie, 'the minted anonymous identity must be persisted to the browser')

  // Every Brain call in this request used the SAME anonymous scope.
  const scopes = new Set(brain.calls.map((call) => call.scope))
  assert.equal(scopes.size, 1, 'one visitor, one scope, for the whole request')
  assert.match([...scopes][0] ?? '', /^anon:/)

  // THE ORDER. Reserve strictly before the model.
  const paths = brain.paths()
  assert.ok(
    paths.indexOf('/api/ai/anonymous/reserve') < paths.indexOf('/api/ai/chat'),
    'the allowance must be taken before the model is asked anything',
  )
  // And before anything is written on the visitor's behalf.
  assert.ok(
    paths.indexOf('/api/ai/anonymous/reserve') < paths.indexOf('/api/ai/conversations'),
    'a visitor with no turns left must not leave a half-written thread behind',
  )

  // The count on screen is the server's, delivered before the first token.
  const meta = frames.find((frame) => frame.event === 'meta')
  assert.equal(meta?.data.quota.remaining, 4)
  assert.equal(meta?.data.quota.limit, 5)

  // An answer arrived, so the turn is spent.
  assert.deepEqual(brain.settlements().map((s) => s.producedOutput), [true])
  assert.equal(frames.at(-1)?.event, 'done')
  assert.equal(frames.at(-1)?.data.quota.remaining, 4)

  brain.restore()
  reset()
})

test('the same cookie is REUSED on the next turn — refresh keeps the visitor', async () => {
  const brain = brainStub()
  setAuthPort(signedOut)
  __resetCookies()

  await collect(await post({ prompt: 'one' }))
  const first = __getCookie(ANONYMOUS_COOKIE_NAME)
  const firstScope = brain.calls[0]!.scope

  await collect(await post({ prompt: 'two', conversationId: CONVERSATION_ID }))
  const second = __getCookie(ANONYMOUS_COOKIE_NAME)

  assert.equal(second, first, 'a returning visitor keeps the identity they were issued')
  assert.equal(brain.calls.at(-1)!.scope, firstScope, 'and therefore the same scope')

  brain.restore()
  reset()
})

// ── exhaustion ──────────────────────────────────────────────────────────────

test('an exhausted visitor is refused BEFORE inference, and nothing is written', async () => {
  const brain = brainStub({ exhausted: true })
  setAuthPort(signedOut)
  __resetCookies()

  const response = await post({ prompt: 'one more' })

  assert.equal(response.status, 429, 'out of turns is 429 — not forbidden, and signing in fixes it')
  const payload = (await response.json()) as { error: string; quota: { exhausted: boolean } }
  assert.equal(payload.error, 'quota_exhausted')
  assert.equal(payload.quota.exhausted, true)

  const paths = brain.paths()
  assert.ok(!paths.includes('/api/ai/chat'), 'the model must never be asked')
  assert.ok(!paths.includes('/api/ai/conversations'), 'no conversation may be created')
  assert.ok(!paths.some((p) => p.endsWith('/messages')), 'nothing may be stored')

  brain.restore()
  reset()
})

test('an unreadable ledger refuses the turn rather than inventing an allowance', async () => {
  const brain = brainStub({ ledgerDown: true })
  setAuthPort(signedOut)
  __resetCookies()

  const response = await post({ prompt: 'hello' })

  assert.equal(response.status, 503)
  assert.equal((await response.json()).error, 'quota_unavailable')
  assert.ok(!brain.paths().includes('/api/ai/chat'), 'a storage hiccup must not hand out free turns')

  brain.restore()
  reset()
})

// ── settlement ──────────────────────────────────────────────────────────────

test('a turn that fails before any output is REFUNDED', async () => {
  const brain = brainStub({ streamStatus: 500 })
  setAuthPort(signedOut)
  __resetCookies()

  const frames = await collect(await post({ prompt: 'hello' }))

  const settled = brain.settlements()
  assert.equal(settled.length, 1)
  assert.equal(settled[0]!.producedOutput, false, 'our outage must not cost the visitor a turn')

  // And the refund is reported, so the composer stops showing a spent turn.
  const quota = frames.find((frame) => frame.event === 'quota')
  assert.equal(quota?.data.remaining, 5)

  brain.restore()
  reset()
})

test('a stream that ends without `done` is refunded and nothing is persisted', async () => {
  const brain = brainStub({ chatBody: sse([['token', { text: 'partial' }]]) })
  setAuthPort(signedOut)
  __resetCookies()

  const frames = await collect(await post({ prompt: 'hello' }))

  assert.equal(brain.settlements()[0]!.producedOutput, false)
  assert.ok(
    !brain.calls.some((call) => (call.body as { role?: string })?.role === 'assistant'),
    'a truncated answer is not an answer and is never stored',
  )
  assert.equal(frames.find((f) => f.event === 'error')?.data.error, 'stream_interrupted')

  brain.restore()
  reset()
})

test('an answer that arrived but could not be SAVED still costs the turn', async () => {
  // The user read real generated text. Refunding it because our storage blinked
  // would make the limit meaningless in exactly the case people would learn to
  // reproduce — and would pay for the inference twice.
  const brain = brainStub({ assistantAppendStatus: 503 })
  setAuthPort(signedOut)
  __resetCookies()

  const frames = await collect(await post({ prompt: 'hello' }))

  assert.equal(brain.settlements()[0]!.producedOutput, true)
  assert.equal(frames.find((f) => f.event === 'error')?.data.error, 'not_saved')

  brain.restore()
  reset()
})

// ── who is metered ──────────────────────────────────────────────────────────

test('a signed-in user is never metered and never touches the ledger', async () => {
  const brain = brainStub()
  setAuthPort(signedIn)
  __resetCookies()

  const response = await post({ prompt: 'hello' })
  assert.equal(response.status, 200)
  const frames = await collect(response)

  const paths = brain.paths()
  assert.ok(!paths.some((path) => path.startsWith('/api/ai/anonymous/')), 'no allowance applies')
  assert.equal(brain.calls[0]!.scope, 'user:auth-user-AAA')
  assert.equal(frames.find((f) => f.event === 'meta')?.data.quota, undefined)
  assert.equal(__getCookie(ANONYMOUS_COOKIE_NAME), undefined, 'no anonymous identity is minted')

  brain.restore()
  reset()
})

test('a session always wins over a stale anonymous cookie', async () => {
  const brain = brainStub()
  setAuthPort(signedIn)
  __resetCookies()
  // A browser that used the product signed out, then signed in.
  __setCookie(ANONYMOUS_COOKIE_NAME, 'sPQfR3nT8kLmXyZa2bCdEfGh.notarealsignature')

  await collect(await post({ prompt: 'hello' }))

  assert.equal(brain.calls[0]!.scope, 'user:auth-user-AAA')
  assert.ok(
    !brain.paths().some((path) => path.startsWith('/api/ai/anonymous/')),
    'a paying user must never be downgraded into a five-turn limit',
  )

  brain.restore()
  reset()
})

// ── the feature being OFF is a real state ───────────────────────────────────

test('with no signing secret, a signed-out visitor is refused rather than served unsigned', async () => {
  const secret = process.env.APP_SESSION_SECRET
  delete process.env.APP_SESSION_SECRET
  const brain = brainStub()
  setAuthPort(signedOut)
  __resetCookies()

  const response = await post({ prompt: 'hello' })

  assert.equal(response.status, 401)
  assert.equal(brain.calls.length, 0)

  process.env.APP_SESSION_SECRET = secret
  brain.restore()
  reset()
})

test('an identity that cannot be written is refused, not served', async () => {
  // A read-only cookie jar is a Server Component. An identity minted there would
  // exist for one request, and the next would mint another — a fresh allowance
  // every time, which is unlimited free inference wearing a limit.
  const brain = brainStub()
  setAuthPort(signedOut)
  __resetCookies()
  __setReadOnly(true)

  const response = await post({ prompt: 'hello' })

  assert.equal(response.status, 503)
  assert.equal((await response.json()).error, 'session_unavailable')
  assert.equal(brain.calls.length, 0)

  brain.restore()
  reset()
})
