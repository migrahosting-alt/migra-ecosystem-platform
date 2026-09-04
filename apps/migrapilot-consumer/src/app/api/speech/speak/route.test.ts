/**
 * Reading an answer aloud, and who may.
 *
 * 🚨 THE DEFECT THIS SUITE EXISTS FOR. `synthesisCapability` and
 * `synthesizeSpeech` are absent from the operation audience table, so they take
 * the authenticated-only default and a signed-out visitor is REFUSED. This route
 * collapsed every failure into "the voice service could not be reached" — so the
 * Listen control rendered live on every answer, failed on click, and blamed our
 * infrastructure for a decision about accounts. The product had already fixed
 * exactly this twice (rename/delete, then the thumbs) and it was live again here.
 *
 * A refusal and an outage are different facts. Both are asserted, separately.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

// An anonymous identity is only mintable when it can be signed; without this the
// visitor resolves to nobody and the refusal under test never happens.
process.env.APP_SESSION_SECRET = 'speech-slice-test-secret-value'

import { GET, POST } from './route'
import { setAuthPort, resetAuthPort } from '@/server/auth'
import type { AppSession, AuthPort } from '@/server/auth/authPort'

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

/** What production actually reports, so the pass-through is tested against it. */
const CAPABILITY = {
  ready: true,
  voices: [
    { id: 'warm', label: 'Warm' },
    { id: 'bright', label: 'Bright' },
    { id: 'steady', label: 'Steady' },
  ],
  defaultVoice: 'warm',
  maxChars: 4000,
}

function brainStub(options: { capabilityStatus?: number; synthesisStatus?: number } = {}) {
  const calls: { url: string; body: unknown }[] = []
  const original = globalThis.fetch

  globalThis.fetch = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const href = String(url)
    let body: unknown = null
    try {
      body = init.body ? JSON.parse(String(init.body)) : null
    } catch {
      body = String(init.body)
    }
    calls.push({ url: href, body })
    const json = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

    if (href.endsWith('/api/ai/speech/synthesis/capability')) {
      if (options.capabilityStatus) return json(options.capabilityStatus, { ok: false })
      return json(200, CAPABILITY)
    }
    if (href.endsWith('/api/ai/speech/synthesize')) {
      if (options.synthesisStatus) return json(options.synthesisStatus, { ok: false })
      return json(200, {
        audioBase64: 'QUJD',
        mimeType: 'audio/mpeg',
        durationSec: 1.5,
        voice: (body as { voice?: string })?.voice ?? 'warm',
        synthesisMs: 40,
      })
    }
    return json(404, { ok: false })
  }) as typeof globalThis.fetch

  return {
    calls,
    reachedBrain: () => calls.some((call) => call.url.includes('/api/ai/speech/')),
    synthesisBody: () => calls.find((call) => call.url.endsWith('/api/ai/speech/synthesize'))?.body,
    restore: () => void (globalThis.fetch = original),
  }
}

const speak = (body: unknown): Promise<Response> =>
  POST(
    new Request('https://chat.example.test/api/speech/speak', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

// ── the refusal, which is not an outage ─────────────────────────────────────

test('a signed-out visitor is told to sign in, NOT that the service is down', async () => {
  const brain = brainStub()
  setAuthPort(signedOut)

  const body = (await (await GET()).json()) as {
    ready: boolean; voices: unknown[]; reason?: string; requiresAccount?: boolean
  }

  assert.equal(body.ready, false)
  assert.deepEqual(body.voices, [])
  assert.equal(body.requiresAccount, true, 'the reason is about an account')
  assert.match(body.reason ?? '', /sign in/i)
  assert.doesNotMatch(body.reason ?? '', /could not be reached/i, 'a refusal must not read as an outage')

  brain.restore()
  resetAuthPort()
})

test('and the refusal never reaches the Brain — it is decided at our boundary', async () => {
  const brain = brainStub()
  setAuthPort(signedOut)

  await GET()

  assert.equal(brain.reachedBrain(), false, 'an unauthorized operation must not be forwarded')

  brain.restore()
  resetAuthPort()
})

test('speaking as a signed-out visitor is 403, not 503', async () => {
  /*
   * The status code is the whole point: 503 says "try again", and retrying can
   * never succeed. 403 says the one true thing — this needs an account.
   */
  const brain = brainStub()
  setAuthPort(signedOut)

  const response = await speak({ text: 'read this to me' })
  const body = (await response.json()) as { error: string; message: string }

  assert.equal(response.status, 403)
  assert.equal(body.error, 'requires_account')
  assert.match(body.message, /sign in/i)
  assert.match(body.message, /text above is unaffected/i, 'the answer is untouched, and says so')
  assert.equal(brain.reachedBrain(), false)

  brain.restore()
  resetAuthPort()
})

// ── the voices, for a caller who may have them ──────────────────────────────

test('the voices come from the engine and are passed through unchanged', async () => {
  const brain = brainStub()
  setAuthPort(signedIn)

  const body = (await (await GET()).json()) as typeof CAPABILITY

  assert.equal(body.ready, true)
  assert.deepEqual(body.voices, CAPABILITY.voices)
  assert.equal(body.defaultVoice, 'warm')

  brain.restore()
  resetAuthPort()
})

test('a chosen voice reaches the engine', async () => {
  const brain = brainStub()
  setAuthPort(signedIn)

  const response = await speak({ text: 'read this to me', voice: 'bright' })
  assert.equal(response.status, 200)
  assert.equal((brain.synthesisBody() as { voice?: string })?.voice, 'bright')

  brain.restore()
  resetAuthPort()
})

test('no chosen voice sends none, so the engine keeps its own default', async () => {
  const brain = brainStub()
  setAuthPort(signedIn)

  await speak({ text: 'read this to me' })
  const sent = brain.synthesisBody() as Record<string, unknown>

  assert.equal('voice' in sent, false, 'an absent choice must not become a guessed one')

  brain.restore()
  resetAuthPort()
})

test('a voice that is not a string is dropped rather than forwarded', async () => {
  const brain = brainStub()
  setAuthPort(signedIn)

  await speak({ text: 'read this to me', voice: { id: 'bright' } })

  assert.equal('voice' in (brain.synthesisBody() as Record<string, unknown>), false)

  brain.restore()
  resetAuthPort()
})

// ── a real outage is still reported as one ──────────────────────────────────

test('an engine that IS down is still reported as unavailable, not as a sign-in problem', async () => {
  const brain = brainStub({ synthesisStatus: 503 })
  setAuthPort(signedIn)

  const response = await speak({ text: 'read this to me' })
  const body = (await response.json()) as { error: string; message: string }

  assert.equal(response.status, 503)
  assert.equal(body.error, 'speech_unavailable')
  assert.doesNotMatch(body.message, /sign in/i, 'an outage must not be blamed on the account')

  brain.restore()
  resetAuthPort()
})

test('a capability probe that fails reads as unreachable, and offers no voices', async () => {
  // A REAL fault this time — the engine answering 503, not a caller being refused.
  const brain = brainStub({ capabilityStatus: 503 })
  setAuthPort(signedIn)

  const body = (await (await GET()).json()) as { ready: boolean; voices: unknown[]; requiresAccount?: boolean }

  assert.equal(body.ready, false)
  assert.deepEqual(body.voices, [])
  assert.notEqual(body.requiresAccount, true, 'an outage is not an account problem')

  brain.restore()
  resetAuthPort()
})

// ── the answer is never at risk ─────────────────────────────────────────────

test('nothing here writes: an over-long answer is refused cheaply', async () => {
  const brain = brainStub()
  setAuthPort(signedIn)

  const response = await speak({ text: 'x'.repeat(4001) })

  assert.equal(response.status, 413)
  assert.equal(brain.reachedBrain(), false, 'the ceiling is enforced before the engine is asked')

  brain.restore()
  resetAuthPort()
})

test('an empty request is refused before anything is asked', async () => {
  const brain = brainStub()
  setAuthPort(signedIn)

  assert.equal((await speak({ text: '   ' })).status, 400)
  assert.equal(brain.reachedBrain(), false)

  brain.restore()
  resetAuthPort()
})
