/**
 * WHAT WE TELL SOMEONE WHEN INDEXING DOES NOT SUCCEED.
 *
 * 🚨 MEASURED ON STAGING 2026-09-26. Attaching a 306 KB, 31-slide deck returned
 * 504 after ~39 s and the chip read "Your files could not be read. Nothing was
 * indexed." Both halves of that sentence were wrong for what had happened:
 *
 * - The deck was FINE. A second attempt indexed it in 469 ms. What had stalled
 *   was the embedding provider — an Ollama on a tailnet peer that accepted the
 *   connection and went quiet. Telling someone their document could not be read
 *   sends them to edit, re-export or split a file that was never the problem.
 *
 * - "Nothing was indexed" was NOT KNOWN. The consumer stopped waiting; the Brain
 *   did not stop working, and its sync commits atomically, so it can land after
 *   the response is written. That day nothing was indexed because the sync hung
 *   outright — true by luck, not by knowledge. Asserting an unobserved outcome is
 *   the same defect as a fabricated ready state, pointing the other way.
 *
 * These are behavioural: the route is driven with the Brain timing out and with
 * the Brain refusing, and the response body is read. A source assertion could be
 * satisfied by a comment.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.UPLOAD_ROOT = await mkdtemp(join(tmpdir(), 'migrapilot-index-honesty-'))
process.env.BRAIN_URL ??= 'http://brain.test'

const { POST } = await import('./route')
const { setAuthPort } = await import('@/server/auth')
import type { AppSession, AuthPort } from '@/server/auth/authPort'

const session: AppSession = {
  sessionId: 's1', authUserId: 'index-honesty-user', email: 'u@example.test',
  permissions: [], createdAt: Date.now(), expiresAt: Date.now() + 3_600_000,
}
setAuthPort({
  getSession: async () => session,
  buildLoginRedirect: async () => 'https://auth.example.test/authorize',
  buildSignupRedirect: async () => 'https://auth.example.test/signup',
  buildLogoutRedirect: () => 'https://auth.example.test/logout',
  handleCallback: async () => {},
  clearSession: async () => {},
} as AuthPort)

/**
 * Answers everything up to the sync, then behaves as asked when the SYNC runs.
 *
 * 🚨 THE ROUTE MUST ACTUALLY REACH THE SYNC. The first version of this stub
 * answered the index LIST with an index whose root was `UPLOAD_ROOT`, but the
 * route scopes to `userDirectory()` — a per-user subdirectory — so the match
 * failed, the route went down the create-an-index path instead, and all three
 * tests failed on "Your library could not be prepared." They were asserting
 * against a branch that is not the one under test.
 *
 * So the list comes back EMPTY and the create succeeds: no root has to be
 * guessed, and the route arrives at the sync by its ordinary path.
 */
function brainThatFailsTheSync(how: 'timeout' | 'refuse'): void {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const target = String(url)
    if (target.includes('/sync')) {
      if (how === 'timeout') {
        const error = new Error('The operation was aborted due to timeout')
        error.name = 'TimeoutError'
        throw error
      }
      return new Response(JSON.stringify({ ok: false, code: 'SYNC_FAILED' }), {
        status: 502, headers: { 'content-type': 'application/json' },
      })
    }
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    // Creating the index is a POST to the same collection the listing GETs.
    if ((init?.method ?? 'GET').toUpperCase() === 'POST') return json({ id: 'idx_test' }, 201)
    return json({ indexes: [] })
  }) as typeof fetch
}

// This route's POST takes no Request — it reads the session, not the body.
const runIndex = (): Promise<Response> => POST()

test('🚨 a timeout does not blame the document', async () => {
  brainThatFailsTheSync('timeout')
  const body = (await (await runIndex()).json()) as { message?: string }
  const message = body.message ?? ''

  assert.ok(
    !/could not be read/i.test(message),
    `a provider stall was reported as an unreadable document: "${message}"`,
  )
  assert.match(message, /did not finish in time/i, `the timeout is not named: "${message}"`)
})

test('🚨 a timeout does not claim an outcome the consumer cannot see', async () => {
  brainThatFailsTheSync('timeout')
  const response = await runIndex()
  const body = (await response.json()) as { message?: string }
  const message = body.message ?? ''

  assert.equal(response.status, 504)
  assert.ok(
    !/nothing was indexed/i.test(message),
    `asserted an unobserved outcome — the Brain may still commit after we stop waiting: "${message}"`,
  )
  // And it must point somewhere useful rather than leaving the state a mystery.
  assert.match(message, /may not be searchable yet|index again/i,
    `says what went wrong but not what to do: "${message}"`)
})

test('a refused sync still says nothing NEW was indexed, not that the library is empty', async () => {
  /*
   * A real failure rolls back — the Brain keeps the previous index rather than a
   * corrupted one — so previously indexed documents are still searchable. The old
   * bare "Nothing was indexed." invited the opposite reading.
   */
  brainThatFailsTheSync('refuse')
  const response = await runIndex()
  const body = (await response.json()) as { message?: string }

  assert.equal(response.status, 502)
  assert.match(body.message ?? '', /nothing new was indexed/i)
})
