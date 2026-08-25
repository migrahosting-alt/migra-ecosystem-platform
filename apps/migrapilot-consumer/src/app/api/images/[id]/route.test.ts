/**
 * The thumbnail request, end to end.
 *
 * WHY THIS FILE EXISTS. Every backend test said the image was stored, and the
 * user still got a broken-image icon: the composer read `image.id` from a
 * response whose field is `imageId`, built `/api/images/undefined`, and rendered
 * a 404 into an `<img>` — with the filename beside it, so it still looked like an
 * attachment. "The image exists" is not the claim that matters. "The URL the
 * browser will actually request returns bytes a browser can draw" is.
 *
 * So this uploads real encoded bytes, takes the ref FROM the upload response the
 * way the client does, requests that exact URL, and asserts what an <img> needs:
 * 200, an image content-type, and a non-empty body that round-trips.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'

process.env.IMAGE_ROOT = await mkdtemp(join(tmpdir(), 'migrapilot-thumb-'))

const { POST } = await import('../route')
const { GET } = await import('./route')
const { setAuthPort, resetAuthPort } = await import('@/server/auth')
import type { AppSession, AuthPort } from '@/server/auth/authPort'

const session: AppSession = {
  sessionId: 's1', authUserId: 'thumb-user', email: 't@example.test',
  permissions: [], createdAt: Date.now(), expiresAt: Date.now() + 3_600_000,
}
let signedInAs: string | null = 'thumb-user'
setAuthPort({
  getSession: async () => (signedInAs ? { ...session, authUserId: signedInAs } : null),
  buildLoginRedirect: async () => 'https://auth.example.test/authorize',
  buildSignupRedirect: async () => 'https://auth.example.test/signup',
  buildLogoutRedirect: () => 'https://auth.example.test/logout',
  handleCallback: async () => {},
  clearSession: async () => {},
} as AuthPort)

/** A real, decodable PNG — not a stub. The route sniffs and measures it. */
function png(w: number, h: number, fill = 0x40): Uint8Array {
  const raw = Buffer.concat(Array.from({ length: h }, () =>
    Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, fill)])))
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const byte of buf) c = table[(c ^ byte) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}

const IMAGE_REF = /^img_[0-9a-f]{32}$/

async function upload(bytes: Uint8Array, name = 'photo.png') {
  const form = new FormData()
  form.append('image', new File([bytes as BlobPart], name, { type: 'image/png' }))
  const response = await POST(new Request('http://localhost/api/images', { method: 'POST', body: form }))
  return { status: response.status, body: await response.json() as Record<string, never> }
}

const thumbnail = (ref: string) =>
  GET(new Request(`http://localhost/api/images/${ref}`), { params: Promise.resolve({ id: ref }) })

test('the upload returns a CANONICAL ref, and it is the field a client reads', async () => {
  /*
   * The exact bug: `image.id` is not a field. Asserting the NAME as well as the
   * shape is the point — a rename here has to break this test, not a thumbnail.
   */
  const { status, body } = await upload(png(8, 6))
  assert.equal(status, 201)
  const image = body.image as unknown as Record<string, unknown>
  assert.equal('id' in image, false, 'there is no `id` field; clients must read `imageId`')
  assert.match(String(image.imageId), IMAGE_REF)
  assert.equal(image.displayName, 'photo.png', 'the filename is display only')
})

test('the URL the browser builds returns bytes a browser can draw', async () => {
  const { body } = await upload(png(10, 10, 0x7f))
  const ref = String((body.image as unknown as { imageId: string }).imageId)

  const response = await thumbnail(ref)
  assert.equal(response.status, 200, 'a 404 rendered into an <img> is a broken icon')

  const type = response.headers.get('content-type')
  assert.equal(type, 'image/png', 'must be the sniffed MIME, never JSON or HTML')
  assert.doesNotMatch(String(type), /json|html/)

  const served = Buffer.from(await response.arrayBuffer())
  assert.ok(served.byteLength > 0, 'an empty body draws nothing')
  // The magic number: proof this is really an image and not an error page.
  assert.deepEqual([...served.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert.equal(String(response.headers.get('content-length')), String(served.byteLength))
})

test('what is served is byte-identical to what was stored', async () => {
  // The id IS the content hash, so this is also the hash re-check passing on read.
  const bytes = png(12, 9, 0x21)
  const { body } = await upload(bytes)
  const ref = String((body.image as unknown as { imageId: string }).imageId)

  const served = Buffer.from(await (await thumbnail(ref)).arrayBuffer())
  assert.equal(createHash('sha256').update(served).digest('hex'),
    createHash('sha256').update(bytes).digest('hex'))
})

test('a non-canonical ref is refused before the store is asked', async () => {
  // `/api/images/undefined` is exactly what the broken composer requested.
  for (const bad of ['undefined', 'null', '9a39fd9e-2daf-42e1-9f0e-000000000000', '../../etc/passwd', '']) {
    const response = await thumbnail(bad)
    assert.equal(response.status, 404, `${bad || '(empty)'} must not reach the store`)
    assert.doesNotMatch(String(response.headers.get('content-type')), /^image\//)
  }
})

test('scope comes from the session — another account cannot fetch the bytes', async () => {
  const { body } = await upload(png(7, 7))
  const ref = String((body.image as unknown as { imageId: string }).imageId)
  assert.equal((await thumbnail(ref)).status, 200)

  signedInAs = 'a-different-user'
  const theirs = await thumbnail(ref)
  // 404, not 403: telling them the id exists is telling them about someone
  // else's library.
  assert.equal(theirs.status, 404)

  signedInAs = null
  assert.equal((await thumbnail(ref)).status, 401)
  signedInAs = 'thumb-user'
})

test('an unreadable image is never served as a partial or a placeholder', async () => {
  const { body } = await upload(png(6, 6))
  const ref = String((body.image as unknown as { imageId: string }).imageId)

  const { writeFile, readdir, stat } = await import('node:fs/promises')
  const root = process.env.IMAGE_ROOT!
  /*
   * Find the bucket that actually HOLDS this file. An earlier test signs in as a
   * second user, so there is more than one bucket and taking the first wrote to
   * the wrong directory — the real bytes stayed intact and the route correctly
   * returned 200, which read as the hash check failing to fire.
   */
  let target: string | null = null
  for (const bucket of await readdir(root)) {
    const candidate = join(root, bucket, `${ref}.png`)
    if (await stat(candidate).then(() => true, () => false)) { target = candidate; break }
  }
  assert.ok(target, 'the uploaded file must be findable before it can be corrupted')
  // Corrupt the bytes under their metadata: the stored hash must no longer match.
  await writeFile(target, Buffer.from('not a png at all'))

  const response = await thumbnail(ref)
  assert.equal(response.status, 404, 'bytes that changed under the record are not that image')
})

test.after(() => resetAuthPort())
