/**
 * Document storage safety.
 *
 * This module writes attacker-influenced names to a real filesystem and hands
 * the resulting directory to the Brain as an index root, so the two properties
 * worth pinning are: **nothing escapes the caller's directory**, and **one
 * caller cannot see or touch another's files**.
 *
 * The type allowlist is a truthfulness property rather than a safety one: the
 * Brain's indexer excludes PDF as binary, so accepting one would put a file in
 * the library that silently contributes nothing to any answer.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.UPLOAD_ROOT = await mkdtemp(join(tmpdir(), 'migrapilot-files-'))

const { FileRejected, deleteFile, listFiles, safeName, saveFile, userDirectory, MAX_FILE_BYTES } =
  await import('./storage')
const { setAuthPort, resetAuthPort } = await import('@/server/auth')
import type { AppSession, AuthPort } from '@/server/auth/authPort'

// ── harness ─────────────────────────────────────────────────────────────────

const sessionFor = (authUserId: string): AppSession => ({
  sessionId: `s-${authUserId}`,
  authUserId,
  email: `${authUserId}@example.test`,
  permissions: [],
  createdAt: Date.now(),
  expiresAt: Date.now() + 3_600_000,
})

const portFor = (authUserId: string): AuthPort => ({
  getSession: async () => sessionFor(authUserId),
  buildLoginRedirect: async () => 'https://auth.example.test/authorize',
  buildLogoutRedirect: () => 'https://auth.example.test/logout',
  handleCallback: async () => {},
  clearSession: async () => {},
})

const asUser = (authUserId: string) => setAuthPort(portFor(authUserId))
const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer

// ── names cannot escape ─────────────────────────────────────────────────────

test('path separators are stripped, so traversal is impossible by construction', () => {
  // Not a blocklist: every separator is removed, so there is no encoding of
  // "go up a directory" left to smuggle through.
  assert.equal(safeName('../../etc/passwd'), 'etcpasswd')
  assert.equal(safeName('..\\..\\windows\\system32'), 'windowssystem32')
  assert.equal(safeName('/absolute/path.txt'), 'absolutepath.txt')
  assert.equal(safeName('.hidden.txt'), 'hidden.txt')
  for (const name of [safeName('../../etc/passwd'), safeName('/absolute/path.txt')]) {
    assert.ok(!name.includes('/') && !name.includes('\\') && !name.startsWith('.'))
  }
})

test('a name that reduces to nothing is refused rather than guessed at', () => {
  for (const raw of ['', '   ', '..', '/', '///', '.']) {
    assert.throws(() => safeName(raw), FileRejected, `"${raw}" should be refused`)
  }
})

test('a traversal name writes inside the caller directory or not at all', async () => {
  asUser('user-traversal')
  await saveFile('../../escaped.txt', bytes('nope'))

  const dir = await userDirectory()
  const entries = await readdir(dir)
  assert.deepEqual(entries, ['escaped.txt'])
  assert.equal(await readFile(join(dir, 'escaped.txt'), 'utf8'), 'nope')

  // And nothing landed above it.
  const above = await readdir(process.env.UPLOAD_ROOT!)
  assert.ok(!above.includes('escaped.txt'))
  resetAuthPort()
})

// ── tenancy ─────────────────────────────────────────────────────────────────

test('one user cannot see or delete another user\'s files', async () => {
  asUser('user-alpha')
  await saveFile('alpha-notes.md', bytes('alpha only'))
  const alphaDir = await userDirectory()

  asUser('user-beta')
  const betaDir = await userDirectory()
  assert.notEqual(alphaDir, betaDir, 'each principal gets its own directory')
  assert.deepEqual(await listFiles(), [], 'beta must not see alpha files')
  assert.equal(await deleteFile('alpha-notes.md'), false, 'beta must not delete alpha files')

  asUser('user-alpha')
  assert.deepEqual(
    (await listFiles()).map((file) => file.name),
    ['alpha-notes.md'],
    'alpha keeps its file',
  )
  resetAuthPort()
})

test('the directory is derived from the session, not from any argument', async () => {
  asUser('user-stable')
  const first = await userDirectory()
  const second = await userDirectory()
  assert.equal(first, second)
  assert.ok(first.startsWith(process.env.UPLOAD_ROOT!))
  // A canonical id is hashed rather than used as a path component, so no
  // identifier shape can introduce a separator.
  assert.ok(!first.slice(process.env.UPLOAD_ROOT!.length + 1).includes('/'))
  resetAuthPort()
})

// ── the allowlist is about honesty ──────────────────────────────────────────

test('formats the indexer cannot read are refused, not silently stored', async () => {
  asUser('user-types')
  // The Brain excludes PDF as a binary extension. Storing one would put a file
  // in the library that contributes nothing to any answer.
  for (const name of ['report.pdf', 'sheet.xlsx', 'deck.pptx', 'photo.png', 'archive.zip', 'notes']) {
    await assert.rejects(() => saveFile(name, bytes('x')), FileRejected, `${name} should be refused`)
  }
  assert.deepEqual(await listFiles(), [])
  resetAuthPort()
})

test('text and code documents are accepted and read back byte-exact', async () => {
  asUser('user-accept')
  for (const name of ['notes.md', 'data.csv', 'config.yaml', 'script.ts']) {
    const stored = await saveFile(name, bytes(`content of ${name}`))
    assert.equal(stored.name, name)
  }
  const listed = await listFiles()
  assert.deepEqual(listed.map((file) => file.name).sort(), ['config.yaml', 'data.csv', 'notes.md', 'script.ts'])

  const dir = await userDirectory()
  assert.equal(await readFile(join(dir, 'notes.md'), 'utf8'), 'content of notes.md')
  resetAuthPort()
})

// ── limits ──────────────────────────────────────────────────────────────────

test('an oversized file is refused and leaves nothing behind', async () => {
  asUser('user-size')
  const tooBig = new ArrayBuffer(MAX_FILE_BYTES + 1)
  await assert.rejects(() => saveFile('big.txt', tooBig), FileRejected)
  assert.deepEqual(await listFiles(), [])
  resetAuthPort()
})

test('an empty file is refused', async () => {
  asUser('user-empty')
  await assert.rejects(() => saveFile('empty.txt', new ArrayBuffer(0)), FileRejected)
  resetAuthPort()
})

test('re-uploading a name replaces it rather than accumulating duplicates', async () => {
  asUser('user-replace')
  await saveFile('same.md', bytes('first'))
  await saveFile('same.md', bytes('second version'))

  const listed = await listFiles()
  assert.equal(listed.length, 1)
  const dir = await userDirectory()
  assert.equal(await readFile(join(dir, 'same.md'), 'utf8'), 'second version')
  resetAuthPort()
})

test('deleting reports whether anything was actually removed', async () => {
  asUser('user-delete')
  await saveFile('gone.txt', bytes('bye'))

  assert.equal(await deleteFile('gone.txt'), true)
  assert.equal(await deleteFile('gone.txt'), false, 'a second delete removed nothing')
  assert.deepEqual(await listFiles(), [])
  resetAuthPort()
})

test('reported sizes are measured, not declared', async () => {
  asUser('user-sizes')
  const content = 'exactly this many bytes'
  await saveFile('measured.txt', bytes(content))

  const [file] = await listFiles()
  assert.equal(file!.bytes, new TextEncoder().encode(content).byteLength)
  resetAuthPort()
})
