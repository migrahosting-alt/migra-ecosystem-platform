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
import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { readFile, rm } from 'node:fs/promises'
import { PNG } from 'pngjs'

process.env.IMAGE_ROOT = await mkdtemp(join(tmpdir(), 'migrapilot-images-'))

const { saveImage, listImages, readImageBytes, readModelImage, deleteImage, imageUsage, sweepTemporaries, ImageRejected } =
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


/* ---- the copy the model reads ---- */

/** The directory this user's images landed in, whichever it is. */
async function dirHolding(id: string): Promise<string> {
  const root = process.env.IMAGE_ROOT!
  for (const entry of await readdir(root)) {
    const files = await readdir(join(root, entry)).catch(() => [] as string[])
    if (files.some((f) => f.startsWith(id))) return join(root, entry)
  }
  throw new Error(`no directory holds ${id}`)
}

test('a large image is prepared for the model at upload, not on the turn', async () => {
  current = 'model-copy'
  // 1.8s of decode on the production CPU. Paid here it is hidden behind the user
  // still typing; paid on the turn it is added to every answer about this image.
  const meta = await saveImage('screenshot.png', buf(png(1600, 1200, 90)))

  assert.ok(meta.modelSha256, 'the derived copy is recorded on the image record')
  assert.ok(meta.modelBytes! < meta.bytes, 'and it is smaller than what was stored')

  const dir = await dirHolding(meta.id)
  const files = await readdir(dir)
  assert.ok(
    files.includes(`${meta.id}.model-1024.png`),
    `the cap belongs in the name so changing it invalidates the cache: ${files.join(', ')}`,
  )

  const prepared = await readModelImage(meta.id)
  assert.ok(prepared)
  assert.equal(prepared.fromCache, true, 'the turn reads it, it does not compute it')
  assert.equal(prepared.downscaled, true)
  const decoded = PNG.sync.read(prepared.bytes)
  assert.equal(Math.max(decoded.width, decoded.height), 1024)

  // The library still holds the user's real picture, untouched.
  const original = await readImageBytes(meta.id)
  assert.equal(original!.bytes.byteLength, meta.bytes)
  const full = PNG.sync.read(original!.bytes)
  assert.equal(full.width, 1600)
})

test('an image already small enough is never re-encoded', async () => {
  current = 'model-small'
  const meta = await saveImage('small.png', buf(png(300, 200, 40)))
  assert.equal(meta.modelSha256, undefined, 'no derived copy is written for it')

  const prepared = await readModelImage(meta.id)
  assert.equal(prepared!.downscaled, false)
  const original = await readImageBytes(meta.id)
  assert.ok(prepared!.bytes.equals(original!.bytes), 'the stored bytes go as they are')
})

test('a cached copy that no longer verifies is rebuilt, never served', async () => {
  current = 'model-tamper'
  const meta = await saveImage('shot.png', buf(png(1600, 1200, 120)))
  const dir = await dirHolding(meta.id)
  const cachePath = join(dir, `${meta.id}.model-1024.png`)

  const honest = await readFile(cachePath)
  // A different picture entirely, planted under the cached name.
  await writeFile(cachePath, Buffer.from(png(64, 64, 255)))

  const prepared = await readModelImage(meta.id)
  assert.ok(prepared)
  assert.equal(prepared.fromCache, false, 'the tampered copy is rejected')
  const decoded = PNG.sync.read(prepared.bytes)
  assert.equal(Math.max(decoded.width, decoded.height), 1024, 'and the real one is rebuilt')
  // Rebuilt deterministically from the same verified original.
  assert.ok(prepared.bytes.equals(honest))
  assert.ok((await readFile(cachePath)).equals(honest), 'the good copy is written back')
})

test('an image stored before the cache existed derives once, then reads warm', async () => {
  current = 'model-cold'
  const meta = await saveImage('legacy.png', buf(png(1600, 1200, 200)))
  const dir = await dirHolding(meta.id)

  // Exactly the shape of an older record: bytes present, no derived copy.
  await rm(join(dir, `${meta.id}.model-1024.png`), { force: true })
  const legacy = { ...meta }
  delete (legacy as { modelSha256?: string }).modelSha256
  delete (legacy as { modelBytes?: number }).modelBytes
  await writeFile(join(dir, `${meta.id}.meta.json`), JSON.stringify(legacy))

  const first = await readModelImage(meta.id)
  assert.equal(first!.fromCache, false, 'the first turn pays for it')
  assert.equal(first!.downscaled, true)

  const second = await readModelImage(meta.id)
  assert.equal(second!.fromCache, true, 'every turn after it does not')
  assert.ok(second!.bytes.equals(first!.bytes))
})

test('deleting an image takes its derived copy with it', async () => {
  current = 'model-delete'
  const meta = await saveImage('gone.png', buf(png(1600, 1200, 33)))
  const dir = await dirHolding(meta.id)
  assert.ok((await readdir(dir)).includes(`${meta.id}.model-1024.png`))

  assert.equal(await deleteImage(meta.id), true)
  const left = await readdir(dir)
  assert.ok(!left.some((f) => f.startsWith(meta.id)), `nothing is left behind: ${left.join(', ')}`)
  assert.equal(await readModelImage(meta.id), null)
})
