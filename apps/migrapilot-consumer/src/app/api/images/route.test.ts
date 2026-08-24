/**
 * The image upload boundary.
 *
 * The route's job is to authenticate, check the request SHAPE, and delegate.
 * These pin the two things that are only true at this layer: that nothing
 * internal leaks outward, and that "saved" is never reported as "readable".
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

process.env.IMAGE_ROOT = await mkdtemp(join(tmpdir(), 'migrapilot-imgroute-'))

const { POST, GET, DELETE } = await import('./route')
const { setAuthPort, resetAuthPort } = await import('@/server/auth')
import type { AppSession, AuthPort } from '@/server/auth/authPort'

const session: AppSession = {
  sessionId: 's1', authUserId: 'route-user', email: 'r@example.test',
  permissions: [], createdAt: Date.now(), expiresAt: Date.now() + 3_600_000,
}
let authenticated = true
setAuthPort({
  getSession: async () => (authenticated ? session : null),
  buildLoginRedirect: async () => 'https://auth.example.test/authorize',
  buildSignupRedirect: async () => 'https://auth.example.test/signup',
  buildLogoutRedirect: () => 'https://auth.example.test/logout',
  handleCallback: async () => {},
  clearSession: async () => {},
} as AuthPort)

/** The Brain, answering the vision registry exactly as production does. */
function brainVision(payload: unknown, ok = true) {
  const original = globalThis.fetch
  globalThis.fetch = (async (url: string | URL) => {
    if (String(url).includes('vision-registry')) {
      return ok
        ? new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response('nope', { status: 503 })
    }
    return new Response('{}', { status: 404 })
  }) as typeof globalThis.fetch
  return () => { globalThis.fetch = original }
}

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

const upload = (bytes: Uint8Array, name = 'p.png') => {
  const form = new FormData()
  form.append('image', new File([bytes as unknown as BlobPart], name, { type: 'image/png' }))
  return new Request('https://app.test/api/images', { method: 'POST', body: form })
}

test('a stored image returns an opaque ref and nothing internal', async () => {
  const restore = brainVision({ count: 4, default: null })
  try {
    const res = await POST(upload(png(20, 10)))
    assert.equal(res.status, 201)
    const body = await res.json() as { image: Record<string, unknown> }

    assert.match(String(body.image.imageId), /^img_[0-9a-f]{32}$/)
    assert.equal(body.image.width, 20)
    assert.equal(body.image.height, 10)
    assert.equal(body.image.mime, 'image/png')
    assert.ok(typeof body.image.bytes === 'number' && typeof body.image.createdAt === 'number')

    /*
     * NOTHING INTERNAL CROSSES THE BOUNDARY. A path or an owner key would be a
     * detail the browser could come to depend on, and a hash path would tell it
     * where bytes live.
     */
    const serialised = JSON.stringify(body)
    for (const leak of ['/var/lib', 'ownerScope', 'sha256', 'storedName', 'IMAGE_ROOT', process.env.IMAGE_ROOT!]) {
      assert.ok(!serialised.includes(leak), `${leak} must not reach the browser`)
    }
  } finally { restore() }
})

test('"saved" is never reported as "readable"', async () => {
  /*
   * Production today: four vision models installed, none qualified, default
   * null. An upload succeeds and the image still cannot be understood — the
   * response has to carry both facts or a UI will promise the second.
   */
  const restore = brainVision({ count: 4, enforced: true, default: null })
  try {
    const res = await POST(upload(png(8, 8, 1)))
    const body = await res.json() as { vision: { state: string; model: string | null; message: string } }
    assert.equal(res.status, 201, 'the upload itself succeeded')
    assert.equal(body.vision.state, 'no_qualified_model')
    assert.equal(body.vision.model, null)
    assert.match(body.vision.message, /saved/i)
    assert.match(body.vision.message, /not enabled yet|not available/i)
  } finally { restore() }
})

test('a qualified model reports ready, and names it', async () => {
  const restore = brainVision({ count: 4, enforced: true, default: { id: 'qwen2.5vl:7b' } })
  try {
    const res = await POST(upload(png(9, 9, 2)))
    const body = await res.json() as { vision: { state: string; model: string } }
    assert.equal(body.vision.state, 'ready')
    assert.equal(body.vision.model, 'qwen2.5vl:7b')
  } finally { restore() }
})

test('an unreachable Brain is unknown, not unavailable', async () => {
  /*
   * Reporting "not available" when the Brain cannot be asked would be as much an
   * invention as reporting "ready".
   */
  const restore = brainVision(null, false)
  try {
    const res = await POST(upload(png(7, 7, 3)))
    const body = await res.json() as { vision: { state: string } }
    assert.equal(body.vision.state, 'unknown')
  } finally { restore() }
})

test('the same bytes return the same id without a second file', async () => {
  const restore = brainVision({ count: 0, default: null })
  try {
    const a = await (await POST(upload(png(11, 6, 4), 'first.png'))).json() as { image: { imageId: string } }
    const b = await (await POST(upload(png(11, 6, 4), 'second.png'))).json() as { image: { imageId: string } }
    assert.equal(a.image.imageId, b.image.imageId)

    const listed = await (await GET()).json() as { images: { imageId: string }[] }
    assert.equal(listed.images.filter((i) => i.imageId === a.image.imageId).length, 1)
  } finally { restore() }
})

test('each failure has its own truthful code and status', async () => {
  const restore = brainVision({ count: 0, default: null })
  try {
    const notMultipart = await POST(new Request('https://app.test/api/images', { method: 'POST', body: 'plain' }))
    assert.equal((await notMultipart.json() as { error: string }).error, 'invalid_body')

    const noFile = await POST(new Request('https://app.test/api/images', { method: 'POST', body: new FormData() }))
    assert.equal((await noFile.json() as { error: string }).error, 'no_image')

    const notAnImage = await POST(upload(new TextEncoder().encode('definitely not an image at all')))
    const nb = await notAnImage.json() as { error: string }
    assert.equal(notAnImage.status, 400)
    assert.ok(['not_an_image', 'type_mismatch'].includes(nb.error))

    // Dimension overflow is a 413, distinct from a plain bad request.
    const huge = await POST(upload(png(12001, 4), 'huge.png'))
    assert.equal(huge.status, 413)
    assert.equal((await huge.json() as { error: string }).error, 'dimensions_too_large')
  } finally { restore() }
})

test('a declared body far over the ceiling is refused before buffering', async () => {
  const req = new Request('https://app.test/api/images', {
    method: 'POST',
    headers: { 'content-length': String(500 * 1024 * 1024) },
    body: 'x',
  })
  const res = await POST(req)
  assert.equal(res.status, 413)
  assert.equal((await res.json() as { error: string }).error, 'too_large')
})

test('an unauthenticated caller is refused before anything is read', async () => {
  authenticated = false
  try {
    for (const res of [await POST(upload(png(4, 4))), await GET(), await DELETE(new Request('https://app.test/api/images?imageId=img_' + 'a'.repeat(32), { method: 'DELETE' }))]) {
      assert.equal(res.status, 401)
      assert.equal((await res.json() as { error: string }).error, 'unauthenticated')
    }
  } finally { authenticated = true }
})

test('deleting an unknown id is a truthful 404', async () => {
  const res = await DELETE(new Request('https://app.test/api/images?imageId=img_' + 'b'.repeat(32), { method: 'DELETE' }))
  assert.equal(res.status, 404)
  assert.equal((await res.json() as { error: string }).error, 'not_found')
})

test.after(() => resetAuthPort())
