/**
 * Copied is not verified.
 *
 * A migration that only copies cannot answer the three questions that matter
 * when it is interrupted: what moved, what has been PROVEN to have moved, and
 * what is left. These tests are about the difference between those states.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LocalMediaStorage } from './localMediaStorage'
import { MigrationLedger, migrateArtifact } from './migrationLedger'
import type { MediaStorage } from './mediaStorage'

const fresh = (): MediaStorage => new LocalMediaStorage(mkdtempSync(join(tmpdir(), 'migrapilot-mig-')))
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const KEY = 'abc123/img_one.png'
const ID = 'img_one'

const run = (source: MediaStorage, destination: MediaStorage, expectedHash: string) =>
  migrateArtifact({
    artifactId: ID, key: KEY, expectedHash, source, destination,
    sourceProvider: 'local', destinationProvider: 'object',
    ledger: new MigrationLedger(destination),
  })

test('a clean copy is recorded as verified, with the hash it proved', async () => {
  const source = fresh()
  const destination = fresh()
  const bytes = Buffer.from('the artifact')
  await source.put(KEY, bytes)

  const { record, proven } = await run(source, destination, sha(bytes))
  assert.equal(proven, true)
  assert.equal(record.status, 'verified')
  assert.equal(record.verifiedHash, sha(bytes))
  assert.equal(record.bytes, bytes.byteLength)
  assert.ok((await destination.read(KEY))?.equals(bytes))
})

test('the ledger is durable and answers "has this been proven?"', async () => {
  const source = fresh()
  const destination = fresh()
  const bytes = Buffer.from('durable')
  await source.put(KEY, bytes)
  await run(source, destination, sha(bytes))

  // A FRESH ledger over the same storage — the answer must survive the process
  // that produced it, or a resumed migration learns nothing.
  const ledger = new MigrationLedger(destination)
  assert.equal(await ledger.isVerified(ID), true)
  assert.equal(await ledger.isVerified('img_never'), false)
  const all = await ledger.all()
  assert.equal(all.length, 1)
  assert.equal(all[0]!.artifactId, ID)
  assert.equal(all[0]!.destinationKey, KEY)
})

test('a source that does not match its recorded hash is never copied', async () => {
  /*
   * Copying it anyway would propagate a corruption into the destination and call
   * it a migration — and the ledger would then vouch for it.
   */
  const source = fresh()
  const destination = fresh()
  await source.put(KEY, Buffer.from('actual bytes'))

  const { record, proven } = await run(source, destination, sha(Buffer.from('what the record claims')))
  assert.equal(proven, false)
  assert.equal(record.status, 'failed')
  assert.match(record.error ?? '', /missing or does not match/)
  assert.equal(await destination.read(KEY), null, 'nothing was written')
})

test('a missing source artifact fails rather than silently succeeding', async () => {
  const source = fresh()
  const destination = fresh()
  const { record, proven } = await run(source, destination, sha(Buffer.from('x')))
  assert.equal(proven, false)
  assert.equal(record.status, 'failed')
})

test('verification reads BACK from the destination, not from memory', async () => {
  /*
   * The point of the whole exercise. A destination that accepts a write and
   * returns something else must be caught — otherwise the ledger proves the
   * write call returned, not that the bytes are retrievable.
   */
  const source = fresh()
  const bytes = Buffer.from('written')
  await source.put(KEY, bytes)

  const real = fresh()
  const lying: MediaStorage = {
    ...real,
    put: (k, b, o) => real.put(k, b, o),
    read: async (key) => (key.startsWith('_migration/') ? real.read(key) : Buffer.from('something else')),
    stat: (k) => real.stat(k), exists: (k) => real.exists(k), delete: (k) => real.delete(k),
    list: (p) => real.list(p), sweepIncomplete: (p, a) => real.sweepIncomplete(p, a),
  }

  const { record, proven } = await run(source, lying, sha(bytes))
  assert.equal(proven, false)
  assert.equal(record.status, 'failed')
  assert.match(record.error ?? '', /different bytes/)
  assert.notEqual(record.verifiedHash, record.expectedHash)
})

test('an unreadable ledger entry means unproven, never proven', async () => {
  // A record nobody can parse is not evidence. Treating it as absent makes the
  // artifact be re-migrated and re-proven rather than trusted.
  const destination = fresh()
  await destination.put('_migration/media/img_broken.json', Buffer.from('{not json'))
  const ledger = new MigrationLedger(destination)
  assert.equal(await ledger.isVerified('img_broken'), false)
  assert.deepEqual(await ledger.all(), [], 'and it does not hide the others')
})


test('every mirrored record says it is evidence, not authority', async () => {
  /*
   * The authoritative ledger is in the Brain's PostgreSQL. This copy travels
   * with the bytes so a restored bucket carries its own account of how it was
   * filled — but someone recovering from an incident at 3am must be able to tell
   * in one line that it is not the source of truth. Where the two disagree,
   * PostgreSQL is right and this is a clue about what happened.
   */
  const source = fresh()
  const destination = fresh()
  const bytes = Buffer.from('stamped')
  await source.put(KEY, bytes)
  await run(source, destination, sha(bytes))

  const raw = await destination.read('_migration/media/img_one.json')
  const parsed = JSON.parse(raw!.toString('utf8')) as { authority?: string; status: string }
  assert.equal(parsed.authority, 'evidence_only')
  assert.equal(parsed.status, 'verified')
})

test('the marker describes where the record is, not what a caller claims', async () => {
  // Stamped on write, never taken from the caller.
  const destination = fresh()
  const ledger = new MigrationLedger(destination)
  await ledger.record({
    artifactId: 'img_claimed', sourceProvider: 'local', destinationProvider: 'object',
    destinationKey: 'k', expectedHash: 'h', bytes: 1, status: 'verified', migratedAt: 1,
    authority: 'canonical' as never,
  })
  const raw = await destination.read('_migration/media/img_claimed.json')
  assert.equal((JSON.parse(raw!.toString('utf8')) as { authority: string }).authority, 'evidence_only')
})
