/**
 * Image storage.
 *
 * The parts that are only observable when something goes wrong: a failed write
 * must leave nothing behind, a rewritten file must not be served under a record
 * that no longer describes it, and deleting from the library must be a different
 * act from detaching from a message.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

process.env.IMAGE_ROOT = await mkdtemp(join(tmpdir(), 'migrapilot-images-'))

const { saveImage, listImages, readImageBytes, deleteImage, imageUsage, sweepTemporaries, ImageRejected } =
  await import('./imageStore')
const { setAuthPort, resetAuthPort } = await import('@/server/auth')
import type { AppSession, AuthPort } from '@/server/auth/authPort'

const sessionFor = (user: string): AppSession => ({
  sessionId: `s-${user}`, authUserId: user, email: `${user}@example.test`,
  permissions: [], createdAt: Date.now(), expiresAt: Date.now() + 3_600_000,
})
let current = 'u1'
const port: AuthPort = {
  getSession: async () => sessionFor(current),
  buildLoginRedirect: async () => 'https://auth.example.test/authorize',
  buildSignupRedirect: async () => 'https://auth.example.test/signup',
  buildLogoutRedirect: () => 'https://auth.example.test/logout',
  handleCallback: async () => {},
  clearSession: async () => {},
}
setAuthPort(port)

/** A real PNG of a given size, so dimension checks see genuine headers. */
function png(w: number, h: number, fill = 0): Uint8Array {
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
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]))
}
const buf = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer

test('an image is stored under its canonical id, not the caller name', async () => {
  current = 'store-1'
  const meta = await saveImage('My Holiday Photo!!.png', buf(png(20, 12)))
  assert.match(meta.id, /^img_[0-9a-f]{32}$/)
  assert.equal(meta.width, 20)
  assert.equal(meta.height, 12)
  assert.equal(meta.mime, 'image/png')
  assert.equal(meta.displayName, 'My Holiday Photo!!.png')

  const { dir } = { dir: join(process.env.IMAGE_ROOT!, (await readdir(process.env.IMAGE_ROOT!))[0]!) }
  const files = await readdir(dir)
  assert.ok(files.includes(`${meta.id}.png`), 'bytes are stored under the id')
  assert.ok(!files.some((f) => f.toLowerCase().includes('holiday')), 'the caller name never becomes a path')
})

test('the same bytes de-duplicate instead of writing a second copy', async () => {
  current = 'store-2'
  const a = await saveImage('one.png', buf(png(8, 8, 3)))
  const b = await saveImage('a-totally-different-name.png', buf(png(8, 8, 3)))
  assert.equal(a.id, b.id)
  const listed = await listImages()
  assert.equal(listed.length, 1, 'one identity, one record')
})

test('metadata carries everything provenance needs, and no bytes', async () => {
  current = 'store-3'
  const meta = await saveImage('p.png', buf(png(10, 4)))
  for (const key of ['id', 'mime', 'bytes', 'width', 'height', 'sha256', 'createdAt', 'ownerScope']) {
    assert.ok(key in meta, `${key} must be recorded`)
  }
  const serialised = JSON.stringify(meta)
  assert.ok(serialised.length < 500, 'metadata must not embed the image')
  assert.doesNotMatch(serialised, /iVBOR|data:image/, 'no encoded image content in metadata')
})

test('a rewritten file is refused rather than served under a stale record', async () => {
  /*
   * The hash is re-checked on READ. If the bytes changed underneath their
   * record, serving them would attach the wrong provenance to whatever a model
   * then says about the image.
   */
  current = 'store-4'
  const meta = await saveImage('p.png', buf(png(12, 6)))
  const root = process.env.IMAGE_ROOT!
  const dirs = await readdir(root)
  for (const d of dirs) {
    const files = await readdir(join(root, d))
    if (files.includes(`${meta.id}.png`)) {
      await writeFile(join(root, d, `${meta.id}.png`), Buffer.from(png(12, 6, 9)))
    }
  }
  assert.equal(await readImageBytes(meta.id), null, 'a hash mismatch must not be served')
})

test('a malformed ref never reaches the filesystem', async () => {
  current = 'store-5'
  for (const hostile of ['img_../../etc/passwd', 'nope', '', 'img_' + 'A'.repeat(32)]) {
    assert.equal(await readImageBytes(hostile), null)
    assert.equal(await deleteImage(hostile), false)
  }
})

test('delete removes both the bytes and the record', async () => {
  current = 'store-6'
  const meta = await saveImage('gone.png', buf(png(6, 6)))
  assert.ok(await readImageBytes(meta.id))
  assert.equal(await deleteImage(meta.id), true)
  assert.equal(await readImageBytes(meta.id), null)
  assert.equal((await listImages()).length, 0)
  // Deleting twice is not an error; it is already true.
  assert.equal(await deleteImage(meta.id), false)
})

test('images are scoped per owner', async () => {
  current = 'tenant-a'
  const mine = await saveImage('a.png', buf(png(14, 7)))
  current = 'tenant-b'
  assert.equal((await listImages()).length, 0, "another owner's library is empty")
  assert.equal(await readImageBytes(mine.id), null, "another owner cannot read it by id")
  current = 'tenant-a'
  assert.ok(await readImageBytes(mine.id), 'the owner still can')
})

test('a rejected upload leaves nothing behind', async () => {
  current = 'store-7'
  const notAnImage = new TextEncoder().encode('this is not an image at all, not even close')
  await assert.rejects(() => saveImage('fake.png', buf(notAnImage)), ImageRejected)
  const root = process.env.IMAGE_ROOT!
  for (const d of await readdir(root)) {
    const files = await readdir(join(root, d))
    assert.ok(!files.some((f) => f.startsWith('.tmp-')), 'no temporary artifact survives a rejection')
  }
  current = 'store-7'
  assert.equal((await listImages()).length, 0)
})

test('usage reports real numbers against real limits', async () => {
  current = 'store-8'
  await saveImage('a.png', buf(png(30, 30)))
  const usage = await imageUsage()
  assert.equal(usage.count, 1)
  assert.ok(usage.bytes > 0)
  assert.ok(usage.maxBytes > usage.bytes)
  assert.equal(usage.maxCount, 100)
})

test('stray temporaries are sweepable', async () => {
  current = 'store-9'
  await saveImage('a.png', buf(png(5, 5)))
  const root = process.env.IMAGE_ROOT!
  for (const d of await readdir(root)) {
    const files = await readdir(join(root, d))
    if (files.some((f) => f.endsWith('.meta.json'))) {
      await writeFile(join(root, d, '.tmp-orphan'), 'left by a crashed write')
    }
  }
  assert.equal(await sweepTemporaries(-1), 1, 'an aged temporary is removed')
})

test.after(() => resetAuthPort())
