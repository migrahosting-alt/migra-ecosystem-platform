/**
 * Resolving opaque refs to bytes.
 *
 * The boundary being tested: what the browser sends is a ref and nothing else,
 * and a ref that cannot produce verified bytes for THIS caller produces none.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isImageId } from './images'

test('only content-addressed refs are eligible to be looked up', () => {
  /*
   * Anything else is refused before the store is asked. Looking it up anyway is
   * how a path or a filename gets interpreted as a name.
   */
  assert.equal(isImageId('img_' + 'a'.repeat(32)), true)
  for (const bad of [
    '../../etc/passwd',
    '/var/lib/migrapilot/images/x.png',
    'photo.png',
    'img_' + 'a'.repeat(31),
    'img_' + 'A'.repeat(32),
    'IMG_' + 'a'.repeat(32),
    '',
  ]) {
    assert.equal(isImageId(bad), false, `${bad || '(empty)'} must not be treated as a ref`)
  }
})

/*
 * SECURITY ACCEPTANCE — only resolved refs leave the consumer.
 *
 * A conversation's active image ref is a bare id carried forward so a follow-up
 * needs no reattachment. The Brain must therefore receive ONLY refs this caller
 * could actually resolve: resolution IS the authorization step, and anything it
 * could not produce verified bytes for must not travel any further.
 */

import { deflateSync } from 'node:zlib'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.IMAGE_ROOT = await mkdtemp(join(tmpdir(), 'migrapilot-resolve-'))

const { resolveTurnImages } = await import('./resolveTurnImages')
const { saveImage } = await import('./imageStore')
const { setAuthPort, resetAuthPort } = await import('@/server/auth')
import type { AppSession, AuthPort } from '@/server/auth/authPort'

let who = 'resolve-owner'
setAuthPort({
  getSession: async (): Promise<AppSession> => ({
    sessionId: `s-${who}`, authUserId: who, email: `${who}@example.test`,
    permissions: [], createdAt: Date.now(), expiresAt: Date.now() + 3_600_000,
  }),
  buildLoginRedirect: async () => 'https://auth.example.test/authorize',
  buildSignupRedirect: async () => 'https://auth.example.test/signup',
  buildLogoutRedirect: () => 'https://auth.example.test/logout',
  handleCallback: async () => {},
  clearSession: async () => {},
} as AuthPort)

/** A minimal real PNG, so the store's header checks see genuine bytes. */
function tinyPng(fill: number): ArrayBuffer {
  const w = 8, h = 8
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
  const out = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
}

test('SECURITY: a ref belonging to another account resolves to nothing', async () => {
  who = 'resolve-owner'
  const mine = await saveImage('mine.png', tinyPng(11))

  who = 'resolve-intruder'
  const resolution = await resolveTurnImages([mine.id])

  assert.equal(resolution.attachments.length, 0, 'nothing may be sent onward')
  assert.equal(resolution.dropped.length, 1)
  // Indistinguishable from "never existed": telling the caller an id is real but
  // theirs would confirm the contents of someone else's library.
  assert.equal(resolution.dropped[0]!.reason, 'not_found')
})

test('SECURITY: a mixed set sends only the refs that actually resolved', async () => {
  /*
   * The realistic shape of the bug: a conversation carries several active refs
   * and one has been deleted or was never this caller's. The survivors must go
   * and the rest must not — a partial set is correct, a leaked one is not.
   */
  who = 'mixed-owner'
  const ok = await saveImage('ok.png', tinyPng(22))

  who = 'mixed-other'
  const theirs = await saveImage('theirs.png', tinyPng(33))

  who = 'mixed-owner'
  const resolution = await resolveTurnImages([ok.id, theirs.id, 'img_' + 'f'.repeat(32), '../../etc/passwd'])

  assert.equal(resolution.attachments.length, 1, 'exactly the one this caller owns')
  assert.equal(resolution.dropped.length, 3)
  assert.equal(
    resolution.dropped.some((d) => d.reason === 'not_an_image_ref'),
    true,
    'the traversal attempt was refused on shape, before any lookup',
  )
})

test.after(() => resetAuthPort())
