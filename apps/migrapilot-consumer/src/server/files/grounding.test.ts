/**
 * Durable grounding must be reconciled against reality before it is trusted.
 *
 * The set outlives the files in it. One stale name is enough to send groundingMode
 * "approved" for a document that no longer exists — durable state that is never checked
 * is a stale claim with a database behind it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.UPLOAD_ROOT = await mkdtemp(join(tmpdir(), 'migrapilot-grounding-'))

const { saveFile, deleteFile, userDirectory } = await import('./storage')
const { reconcileGrounding } = await import('./grounding')
const { setAuthPort, resetAuthPort } = await import('@/server/auth')
import type { AppSession, AuthPort } from '@/server/auth/authPort'

const session: AppSession = {
  sessionId: 's1', authUserId: 'u1', email: 'u1@example.test',
  permissions: [], createdAt: Date.now(), expiresAt: Date.now() + 3_600_000,
}
const port: AuthPort = {
  getSession: async () => session,
  buildLoginRedirect: async () => 'https://auth.example.test/authorize',
  buildLogoutRedirect: () => 'https://auth.example.test/logout',
  handleCallback: async () => {},
  clearSession: async () => {},
}

/** Stubs the Brain so index state is controllable. */
function brainWith(state: string | null) {
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string | URL) => {
    const href = String(url)
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } })
    if (href.includes('/api/ai/indexes') && !href.includes('/status')) {
      const root = await userDirectory()
      return state === null ? json({ indexes: [] }) : json({ indexes: [{ id: 'ix1', root, state }] })
    }
    if (href.includes('/status')) return json({ state })
    return new Response('{}', { status: 404 })
  }) as typeof globalThis.fetch
  return () => { globalThis.fetch = original }
}

test('an approved index with the file present grounds', async () => {
  setAuthPort(port)
  const restore = brainWith('approved')
  await saveFile('notes.md', new TextEncoder().encode('hello').buffer as ArrayBuffer)

  const r = await reconcileGrounding(['notes.md'])
  assert.deepEqual(r.available, ['notes.md'])
  assert.deepEqual(r.missing, [])
  assert.equal(r.grounded, true)

  restore(); resetAuthPort()
})

test('A DELETED FILE STOPS GROUNDING, and is reported missing', async () => {
  // The case the owner called out: a stale filename must not silently keep granting
  // grounding after the file is gone.
  setAuthPort(port)
  const restore = brainWith('approved')
  await saveFile('gone.md', new TextEncoder().encode('bye').buffer as ArrayBuffer)
  await deleteFile('gone.md')

  const r = await reconcileGrounding(['gone.md'])
  assert.deepEqual(r.available, [])
  assert.deepEqual(r.missing, ['gone.md'])
  assert.equal(r.grounded, false)

  restore(); resetAuthPort()
})

test('one surviving file still grounds when another was deleted', async () => {
  setAuthPort(port)
  const restore = brainWith('approved')
  await saveFile('kept.md', new TextEncoder().encode('here').buffer as ArrayBuffer)

  const r = await reconcileGrounding(['kept.md', 'never-existed.md'])
  assert.deepEqual(r.available, ['kept.md'])
  assert.deepEqual(r.missing, ['never-existed.md'])
  assert.equal(r.grounded, true)

  restore(); resetAuthPort()
})

test('an unsearchable index grounds nothing but KEEPS the set', async () => {
  // Different fact from deletion: the files are still there and searchability can
  // return. Erasing the set here would silently discard the user's own choice.
  setAuthPort(port)
  const restore = brainWith('candidate')
  await saveFile('pending.md', new TextEncoder().encode('x').buffer as ArrayBuffer)

  const r = await reconcileGrounding(['pending.md'])
  assert.equal(r.grounded, false)
  assert.equal(r.searchable, false)
  assert.deepEqual(r.available, ['pending.md'], 'the file is still available; only the index is not ready')
  assert.deepEqual(r.missing, [])

  restore(); resetAuthPort()
})

test('no index at all grounds nothing', async () => {
  setAuthPort(port)
  const restore = brainWith(null)
  await saveFile('orphan.md', new TextEncoder().encode('x').buffer as ArrayBuffer)

  assert.equal((await reconcileGrounding(['orphan.md'])).grounded, false)

  restore(); resetAuthPort()
})

test('an empty set short-circuits without consulting the Brain', async () => {
  setAuthPort(port)
  let called = false
  const original = globalThis.fetch
  globalThis.fetch = (async () => { called = true; return new Response('{}', { status: 200 }) }) as typeof globalThis.fetch

  const r = await reconcileGrounding([])
  assert.equal(r.grounded, false)
  assert.equal(called, false, 'an ungrounded turn must not cost an index lookup')

  globalThis.fetch = original; resetAuthPort()
})

test('an unreadable library reports NOTHING missing, so the set is never erased', async () => {
  // Proven on the canary: with the upload root unreadable for one turn, a grounded
  // conversation lost its document — and restoring the library did not bring it
  // back. The user had to re-attach a file they had never removed.
  //
  // The cause was this function reporting the names as `missing`, which the caller
  // correctly treats as "deleted, drop it permanently". An unreadable library is
  // not evidence of deletion; it is evidence of nothing.
  setAuthPort(port)
  const brain = brainWith('approved')
  const realRoot = process.env.UPLOAD_ROOT

  // A library that genuinely cannot be read. A missing directory is NOT enough —
  // listFiles treats that as an empty library, which is a different (and correct)
  // answer. Pointing the root at a FILE makes the directory read throw for real,
  // which is what an unreadable upload root does in production.
  const notADirectory = join(await mkdtemp(join(tmpdir(), 'migrapilot-notdir-')), 'blocker')
  await writeFile(notADirectory, 'not a directory')
  process.env.UPLOAD_ROOT = notADirectory

  const r = await reconcileGrounding(['notes.md'])

  assert.equal(r.libraryUnreadable, true, 'the unreadable case must be distinguishable')
  assert.deepEqual(r.missing, [], 'nothing may be reported missing when nothing could be read')
  assert.equal(r.grounded, false, 'and this turn still grounds nothing')

  process.env.UPLOAD_ROOT = realRoot
  brain()
  resetAuthPort()
})

test('a genuinely deleted file IS still reported missing', async () => {
  // The guard above must not blunt the real case: a file that is actually gone
  // has to leave the set permanently, or a deleted document keeps being quoted.
  setAuthPort(port)
  const brain = brainWith('approved')

  await saveFile('temporary.md', new TextEncoder().encode('# temp').buffer as ArrayBuffer)
  await deleteFile('temporary.md')

  const r = await reconcileGrounding(['temporary.md'])
  assert.equal(r.libraryUnreadable, false)
  assert.deepEqual(r.missing, ['temporary.md'], 'a deleted file still leaves the set')

  brain()
  resetAuthPort()
})
