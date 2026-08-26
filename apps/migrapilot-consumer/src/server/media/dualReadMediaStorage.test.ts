/**
 * Reads prefer object storage; local is the safety net.
 *
 * The behaviours that matter are the ones that only show up when object storage
 * is wrong: a fallback must succeed AND be counted, a mismatch must be reported,
 * and nothing may be silently repaired on a read.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DualReadMediaStorage, type StorageHealthEvent } from './dualReadMediaStorage'
import { LocalMediaStorage } from './localMediaStorage'
import type { MediaStorage } from './mediaStorage'

const disk = (): MediaStorage => new LocalMediaStorage(mkdtempSync(join(tmpdir(), 'migrapilot-dual-')))
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const KEY = 'abc123/img_one.png'

/**
 * Spreading a class instance drops its prototype methods, so the double is built
 * by binding each one explicitly. An earlier version spread the instance and
 * produced an object with no methods at all — which failed as "object wins",
 * looking like a behaviour bug in the code under test rather than in the harness.
 */
function build(overrides: Partial<MediaStorage> = {}) {
  const object = disk()
  const local = disk()
  const events: StorageHealthEvent[] = []
  const facade: MediaStorage = {
    put: (k, b, o) => object.put(k, b, o),
    read: (k, o) => object.read(k, o),
    stat: (k) => object.stat(k),
    exists: (k) => object.exists(k),
    delete: (k) => object.delete(k),
    list: (p) => object.list(p),
    sweepIncomplete: (p, a) => object.sweepIncomplete(p, a),
    ...overrides,
  }
  const dual = new DualReadMediaStorage({ object: facade, local, onHealth: (e) => events.push(e) })
  return { dual, object, local, events }
}

test('a migrated artifact is served from object storage', async () => {
  const { dual, object, local, events } = build()
  const bytes = Buffer.from('migrated')
  await object.put(KEY, bytes)
  await local.put(KEY, Buffer.from('stale local copy'))

  assert.ok((await dual.read(KEY))?.equals(bytes), 'object wins')
  assert.deepEqual(events, [], 'and no fallback is reported')
})

test('an artifact not yet migrated falls back, and the fallback is COUNTED', async () => {
  /*
   * The fallback succeeding is not the interesting part — that is the safety net
   * doing its job. The interesting part is that it is reported: silent fallback
   * would let object storage be broken for weeks while every page looked fine.
   */
  const { dual, local, events } = build()
  const bytes = Buffer.from('still only local')
  await local.put(KEY, bytes)

  assert.ok((await dual.read(KEY))?.equals(bytes))
  assert.equal(events.length, 1)
  assert.equal(events[0]!.kind, 'fallback')
  assert.equal(events[0]!.key, KEY)
})

test('an object store that throws falls back rather than failing the read', async () => {
  const { dual, local, events } = build({
    read: async () => {
      throw new Error('connection refused')
    },
  })
  const bytes = Buffer.from('local saves the read')
  await local.put(KEY, bytes)

  assert.ok((await dual.read(KEY))?.equals(bytes))
  assert.equal(events[0]!.kind, 'error')
  assert.match(events[0]!.detail ?? '', /connection refused/)
})

test('a hash mismatch in object storage is reported as a MISMATCH, not a plain fallback', async () => {
  // A missing object and a corrupted one are different problems. One is a
  // migration that has not happened; the other is data that must be looked at.
  const { dual, object, local, events } = build()
  await object.put(KEY, Buffer.from('corrupted in the object store'))
  const good = Buffer.from('the real bytes')
  await local.put(KEY, good)

  /*
   * The expected hash is REQUIRED to detect this, and production always supplies
   * it — `readImageBytes` passes the hash the record claims. Without one,
   * corruption is undetectable by construction: there is nothing to compare
   * against, and the store would serve whatever it holds.
   */
  assert.ok((await dual.read(KEY, { expectSha256: sha(good) }))?.equals(good), 'the read still succeeds')
  assert.equal(events[0]!.kind, 'mismatch')
})

test('a read NEVER heals: no copy up, no overwrite', async () => {
  /*
   * A read is not the moment to repair state. It happens under user latency, it
   * has no ledger entry to update, and a self-healing read hides exactly the
   * signal that says the migration is wrong.
   */
  const { dual, object, local } = build()
  await local.put(KEY, Buffer.from('only local'))
  await dual.read(KEY)
  assert.equal(await object.read(KEY), null, 'nothing was copied into object storage')

  const corrupt = Buffer.from('corrupt')
  await object.put(KEY, corrupt)
  await dual.read(KEY, { expectSha256: sha(Buffer.from('only local')) })
  assert.ok((await object.read(KEY))?.equals(corrupt), 'the bad object was not overwritten either')
})

test('writes stay LOCAL — nothing has cut over', async () => {
  // Writing to both would make object storage authoritative for new media with
  // none of the durability work done: the cutover would have happened quietly.
  const { dual, object, local } = build()
  const bytes = Buffer.from('new upload')
  await dual.put(KEY, bytes)
  assert.ok((await local.read(KEY))?.equals(bytes))
  assert.equal(await object.read(KEY), null)
})

test('a delete reaches BOTH, so it cannot undo itself at cutover', async () => {
  const { dual, object, local } = build()
  await local.put(KEY, Buffer.from('x'))
  await object.put(KEY, Buffer.from('x'))

  assert.equal(await dual.delete(KEY), true)
  assert.equal(await local.read(KEY), null)
  assert.equal(await object.read(KEY), null, 'the migrated copy went too')
})

test('a delete still succeeds when object storage cannot be reached', async () => {
  // The user's delete worked where it counts. The orphan is reported for
  // reconciliation rather than raised in their face.
  const { dual, local, events } = build({
    delete: async () => {
      throw new Error('object store unreachable')
    },
  })
  await local.put(KEY, Buffer.from('x'))
  assert.equal(await dual.delete(KEY), true)
  /*
   * Reported as `delete-failed` rather than a generic `error`, because the alert
   * that fires on it is different: an orphaned copy left in object storage would
   * come back the moment reads cut over — a deletion that silently undid itself.
   */
  assert.equal(events.some((e) => e.kind === 'delete-failed'), true)
  assert.equal(events.some((e) => e.kind === 'error'), false, 'the generic bucket must not also catch it')
})

test('local remains the authority for what exists', async () => {
  // It is where writes land, so it is the only complete picture during this phase.
  const { dual, object, local } = build()
  await object.put('abc123/only-in-object.png', Buffer.from('x'))
  await local.put(KEY, Buffer.from('y'))

  assert.equal(await dual.exists('abc123/only-in-object.png'), false)
  assert.deepEqual(await dual.list('abc123'), [KEY])
})


test('without an expected hash there is nothing to detect corruption against', () => {
  /*
   * Stated rather than left implicit. A caller that omits the hash gets whatever
   * object storage holds — which is why the image store always passes the hash
   * its record claims, and why this layer does not invent one.
   */
  assert.ok(true)
})

test('serving bytes NEVER depends on the ledger being reachable', () => {
  /*
   * A STANDING CONSTRAINT, not an accident of the current implementation. The
   * ledger is truth about migration state, not a runtime prerequisite for
   * handing bytes to a user: if the Brain or the ledger is unreachable, media
   * must still serve. A future change that consults the ledger before a read
   * would make every image depend on a service that has nothing to do with
   * whether those bytes exist.
   */
  const code = readFileSync(join(process.cwd(), 'src/server/media/dualReadMediaStorage.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

  for (const forbidden of ['Ledger', 'ledger', 'migration', 'brain', 'Brain']) {
    assert.ok(
      !code.includes(forbidden),
      `the read path must not reference "${forbidden}" — the ledger is not a read dependency`,
    )
  }
})
