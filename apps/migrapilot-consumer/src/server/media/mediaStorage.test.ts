/**
 * The storage seam.
 *
 * These are the behaviours the object-store implementation will have to match,
 * so they are written against the INTERFACE rather than the filesystem: same
 * suite, two backends, no argument later about what "the same" means.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LocalMediaStorage } from './localMediaStorage'
import { MediaIntegrityError, assertSafeKey, type MediaStorage } from './mediaStorage'

const storage = (): MediaStorage => new LocalMediaStorage(mkdtempSync(join(tmpdir(), 'migrapilot-media-')))
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const KEY = 'users/abc123/images/img_one.png'

test('bytes come back exactly as they went in', async () => {
  const s = storage()
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
  await s.put(KEY, bytes)
  const read = await s.read(KEY)
  assert.ok(read?.equals(bytes))
})

test('a missing object is absent, not an error', async () => {
  // Absence is a fact a caller can act on. It must be distinguishable from a
  // failure to look, which throws.
  const s = storage()
  assert.equal(await s.read('users/abc123/images/nothing.png'), null)
  assert.equal(await s.stat('users/abc123/images/nothing.png'), null)
  assert.equal(await s.exists('users/abc123/images/nothing.png'), false)
  assert.equal(await s.delete('users/abc123/images/nothing.png'), false)
})

test('a hash that does not match is refused BEFORE the write', async () => {
  /*
   * An object existing is not enough if its bytes are not the ones the record
   * describes. Catching it on write means metadata never vouches for corruption.
   */
  const s = storage()
  const bytes = Buffer.from('real bytes')
  await assert.rejects(() => s.put(KEY, bytes, { sha256: sha(Buffer.from('different')) }), MediaIntegrityError)
  assert.equal(await s.exists(KEY), false, 'and nothing was written')
})

test('a matching hash is accepted', async () => {
  const s = storage()
  const bytes = Buffer.from('real bytes')
  await s.put(KEY, bytes, { sha256: sha(bytes) })
  assert.ok((await s.read(KEY))?.equals(bytes))
})

test('bytes that changed underneath their record read as ABSENT', async () => {
  /*
   * Not as an error and not as data. They are not the artifact the record
   * describes, and serving them would attach the wrong provenance to whatever is
   * said about them next.
   */
  const s = storage()
  await s.put(KEY, Buffer.from('original'))
  const read = await s.read(KEY, { expectSha256: sha(Buffer.from('something else')) })
  assert.equal(read, null)
})

test('stat reports size without reading the object', async () => {
  const s = storage()
  const bytes = Buffer.alloc(2048, 7)
  await s.put(KEY, bytes)
  const info = await s.stat(KEY)
  assert.equal(info?.bytes, 2048)
  assert.ok(info!.modifiedAt > 0)
})

test('delete removes bytes and says whether it did', async () => {
  const s = storage()
  await s.put(KEY, Buffer.from('x'))
  assert.equal(await s.delete(KEY), true)
  assert.equal(await s.exists(KEY), false)
  // Reporting true for something that was not there would tell a caller their
  // delete worked on an object they never had.
  assert.equal(await s.delete(KEY), false)
})

test('list returns keys under a prefix, never in-flight writes', async () => {
  const s = storage()
  await s.put('users/abc123/images/one.png', Buffer.from('1'))
  await s.put('users/abc123/images/two.png', Buffer.from('2'))
  await s.put('users/other/images/three.png', Buffer.from('3'))

  const listed = (await s.list('users/abc123/images')).sort()
  assert.deepEqual(listed, ['users/abc123/images/one.png', 'users/abc123/images/two.png'])
  assert.deepEqual(await s.list('users/nobody/images'), [], 'an empty prefix is empty, not an error')
})

test('a key that could escape the store is refused, never sanitised', async () => {
  /*
   * A key becomes a path in one backend and an object name in another. A
   * "sanitised" key is a DIFFERENT key, and silently reading or writing a
   * different object is worse than failing.
   */
  for (const key of ['../etc/passwd', '/absolute', 'users//double', 'a/../../b', '', 'has space', 'back\\slash']) {
    assert.throws(() => assertSafeKey(key), /Unsafe media key/, JSON.stringify(key))
  }
  const s = storage()
  await assert.rejects(() => s.read('../escape'))
  await assert.rejects(() => s.put('../escape', Buffer.from('x')))
})

test('an interrupted write leaves no object under the canonical key', async () => {
  // Atomicity is why: a reader never observes a half-written object.
  const s = storage()
  const big = Buffer.alloc(1024 * 512, 3)
  await s.put(KEY, big)
  assert.equal((await s.stat(KEY))?.bytes, big.length)
  assert.deepEqual(
    (await s.list('users/abc123/images')).filter((k) => k.includes('.tmp-')),
    [],
    'no temporary is ever listed as an object',
  )
})


test('an incomplete write is swept by storage, not by its callers', async () => {
  /*
   * `list` hides in-flight writes so they can never be mistaken for objects,
   * which means nothing above this layer can see them to clean them up — nor
   * should it. On a filesystem these are temporaries from a crashed write; in an
   * object store they are incomplete multipart uploads. Same problem, different
   * mechanism, and the caller should not have to know which.
   */
  const root = mkdtempSync(join(tmpdir(), 'migrapilot-media-'))
  const s = new LocalMediaStorage(root)
  await s.put('bucket/real.png', Buffer.from('kept'))

  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(join(root, 'bucket'), { recursive: true })
  writeFileSync(join(root, 'bucket', '.tmp-orphan'), 'left by a crashed write')

  assert.deepEqual(await s.list('bucket'), ['bucket/real.png'], 'never listed as an object')
  assert.equal(await s.sweepIncomplete('bucket', -1), 1, 'and swept when aged')
  assert.ok((await s.read('bucket/real.png')), 'the real object is untouched')
})

test('a young incomplete write belongs to a write happening right now', async () => {
  const root = mkdtempSync(join(tmpdir(), 'migrapilot-media-'))
  const s = new LocalMediaStorage(root)
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(join(root, 'bucket'), { recursive: true })
  writeFileSync(join(root, 'bucket', '.tmp-inflight'), 'being written')
  assert.equal(await s.sweepIncomplete('bucket', 60_000), 0, 'not swept out from under it')
})
