/**
 * Uploading a document is what starts it being read.
 *
 * Every stage of the scanned-PDF pipeline — classification, rasterisation, OCR,
 * folio reconstruction, validation, persistence — was built, deployed and
 * working while remaining invisible to anyone who only uploaded a file: nothing
 * asked the Brain to read it until an index pass happened to run. The library
 * showed a stored file that no answer could use, and no sign that a step was
 * missing.
 *
 * These pin the trigger itself, so the wire cannot be removed without a failure.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.UPLOAD_ROOT = await mkdtemp(join(tmpdir(), 'migrapilot-upload-read-'))
process.env.BRAIN_URL ??= 'http://brain.test'

const { POST } = await import('./route')
const { setAuthPort } = await import('@/server/auth')
import type { AppSession, AuthPort } from '@/server/auth/authPort'

const session: AppSession = {
  sessionId: 's1', authUserId: 'upload-user', email: 'u@example.test',
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
 * Records every operation the route asks the Brain to perform.
 *
 * Keyed on the URL, because that is where the gateway puts the operation — the
 * request body carries only its arguments. An earlier version of this test
 * matched a `kind` field in the body and passed nothing, silently: it recorded
 * calls it could never identify.
 */
const READ_ENDPOINT = '/api/ai/documents/process'

function recordBrain(behaviour: 'ok' | 'down' = 'ok') {
  const calls: { url: string; fileName?: string; path?: string }[] = []
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    let body: Record<string, unknown> = {}
    try { body = JSON.parse(String(init?.body ?? '{}')) } catch { /* not JSON */ }
    calls.push({ url: String(url), ...(body as { fileName?: string; path?: string }) })
    if (behaviour === 'down') return new Response('unavailable', { status: 503 })
    return new Response(
      JSON.stringify({ document: { fileName: body.fileName, state: 'queued', description: 'Queued.', readable: false, polling: true } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch
  return calls
}

const upload = (name: string, bytes: Uint8Array): Promise<Response> => {
  const form = new FormData()
  form.append('file', new File([bytes as BlobPart], name))
  return POST(new Request('http://app.test/api/files', { method: 'POST', body: form }))
}

const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n')
const TEXT = new TextEncoder().encode('plain notes\n')

test('an uploaded PDF is handed to the reader, by name and by real path', async () => {
  const calls = recordBrain()
  const response = await upload('scan.pdf', PDF)
  assert.equal(response.status, 200)

  const read = calls.find((call) => call.url.endsWith(READ_ENDPOINT))
  assert.ok(read, 'upload must ask the Brain to read the document')
  assert.equal(read.fileName, 'scan.pdf')
  /*
   * The path is the whole contract: the Brain opens this file directly. A name
   * without the per-user directory resolves to nothing on the Brain's disk, and
   * the read fails long after the upload reported success.
   */
  assert.ok(read.path?.startsWith(process.env.UPLOAD_ROOT!), 'the reader needs the real on-disk path')
  assert.ok(read.path?.endsWith('/scan.pdf'))
})

test('the pending state is recorded BEFORE the upload responds', async () => {
  /*
   * Not a timing detail. The library polls immediately after upload; if the
   * response can arrive before the Brain has accepted the work, that poll shows
   * a stored file with nothing happening to it, which is the exact silence this
   * whole change exists to remove.
   */
  let accepted = false
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    void init
    if (String(url).endsWith('/api/ai/documents/process')) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      accepted = true
    }
    return new Response(JSON.stringify({ document: null }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

  await upload('slow.pdf', PDF)
  assert.equal(accepted, true, 'the upload response must not outrun the acceptance it implies')
})

test('a file with its own text layer is not sent down the OCR path by this route', async () => {
  /*
   * The route escalates PDFs only, matching the indexer. Classification itself
   * belongs to the Brain — which reads a text-layer PDF with pdftotext and never
   * rasterises it — so this asserts only that non-PDFs are not queued at all.
   */
  const calls = recordBrain()
  await upload('notes.txt', TEXT)
  assert.equal(calls.filter((call) => call.url.endsWith(READ_ENDPOINT)).length, 0)
})

test('a saved file is never reported as failed because the reader was unreachable', async () => {
  /*
   * The bytes are on disk. An upload that succeeded and then reported failure
   * would push the user to upload again, duplicating a document the library
   * already holds.
   */
  recordBrain('down')
  const response = await upload('brain-down.pdf', PDF)
  assert.equal(response.status, 200)
  const body = await response.json() as { saved: { name: string }[]; rejected: unknown[] }
  assert.deepEqual(body.saved.map((file) => file.name), ['brain-down.pdf'])
  assert.deepEqual(body.rejected, [])
})

test('a rejected file is not queued for reading', async () => {
  /*
   * Nothing was written, so there is nothing to open. Queuing a read for a
   * refused upload sends the Brain to a path that does not exist and puts a
   * document in the reading list that the library will never show.
   */
  const calls = recordBrain()
  const response = await upload('installer.exe', TEXT)
  assert.equal(response.status, 400)
  assert.equal(calls.filter((call) => call.url.endsWith(READ_ENDPOINT)).length, 0)
})
