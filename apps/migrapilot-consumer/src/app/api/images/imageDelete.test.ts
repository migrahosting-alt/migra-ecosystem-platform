/**
 * Removing an image from the library.
 *
 * WHY THIS EXISTS SEPARATELY FROM DETACHING. Deleting from the LIBRARY destroys
 * the artifact; detaching from a message only stops that turn referring to it.
 * Conflating them would make "remove this from the message" quietly destroy an
 * image used elsewhere, which is the kind of loss a user cannot undo.
 *
 * It also exists because the Media Library offers a Delete control, and a
 * control that does not work is worse than a missing one.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

process.env.IMAGE_ROOT = mkdtempSync(join(tmpdir(), 'migrapilot-media-'))

const { DELETE } = await import('./[id]/route')
const { saveImage, listImages } = await import('@/server/files/imageStore')
const { setAuthPort, resetAuthPort } = await import('@/server/auth')
import type { AppSession, AuthPort } from '@/server/auth/authPort'

const sessionFor = (user: string): AppSession => ({
  sessionId: `s-${user}`,
  authUserId: user,
  email: `${user}@example.test`,
  permissions: [],
  createdAt: Date.now(),
  expiresAt: Date.now() + 3_600_000,
})
let current: string | null = 'owner'
const port: AuthPort = {
  getSession: async () => (current ? sessionFor(current) : null),
  buildLoginRedirect: async () => 'https://auth.example.test/authorize',
  buildSignupRedirect: async () => 'https://auth.example.test/signup',
  buildLogoutRedirect: () => 'https://auth.example.test/logout',
  handleCallback: async () => {},
  clearSession: async () => {},
}
setAuthPort(port)

/** A real PNG, so intake's magic-byte check sees genuine bytes. */
function png(w: number, h: number, fill: number): ArrayBuffer {
  const raw = Buffer.concat(
    Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, fill)])),
  )
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
    const len = Buffer.alloc(4)
    len.writeUInt32BE(d.length)
    const body = Buffer.concat([Buffer.from(t, 'ascii'), d])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

const del = (id: string) =>
  DELETE(new Request(`https://chat.example.test/api/images/${id}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  })

test('an image the caller owns is really removed', async () => {
  current = 'owner'
  const stored = await saveImage('holiday.png', png(12, 8, 40))
  assert.ok((await listImages()).some((i) => i.id === stored.id))

  const response = await del(stored.id)
  assert.equal(response.status, 200)
  assert.equal((await listImages()).some((i) => i.id === stored.id), false, 'gone from the library')
})

test('deleting something that is not there is 404, never a cheerful ok', async () => {
  // Reporting success for an id that was never present would tell a caller their
  // delete worked on someone else's image.
  current = 'owner'
  const response = await del('img_' + 'a'.repeat(32))
  assert.equal(response.status, 404)
})

test("another account cannot delete this account's image", async () => {
  current = 'owner'
  const stored = await saveImage('private.png', png(10, 10, 90))

  current = 'stranger'
  assert.equal((await del(stored.id)).status, 404, 'a stranger is told nothing exists')

  current = 'owner'
  assert.ok((await listImages()).some((i) => i.id === stored.id), 'and it is still there')
})

test('a signed-out caller is refused before anything is touched', async () => {
  current = 'owner'
  const stored = await saveImage('keep.png', png(9, 9, 12))

  current = null
  assert.equal((await del(stored.id)).status, 401)

  current = 'owner'
  assert.ok((await listImages()).some((i) => i.id === stored.id))
  resetAuthPort()
})

test('a malformed id is refused without being turned into a path', async () => {
  current = 'owner'
  setAuthPort(port)
  for (const id of ['../../etc/passwd', 'img_short', 'not-an-id']) {
    assert.equal((await del(id)).status, 404, id)
  }
  resetAuthPort()
})
