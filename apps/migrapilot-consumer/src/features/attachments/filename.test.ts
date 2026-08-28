/**
 * Real filenames, not extension constants.
 *
 * The bug that motivated this passed every "is json allowed?" style check, because the
 * allowlist was fine — what was broken was turning "pilot-upload-test.json" INTO "json".
 * A test that starts from an extension can never catch that; it has to start from a name a
 * user would actually pick.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { acceptAttribute, extensionOf, rejectionFor } from './filename'
import { ALLOWED_EXTENSIONS, extensionOf as serverExtensionOf } from '@/server/files/storage'

const limits = { allowedExtensions: ALLOWED_EXTENSIONS, maxFileBytes: 2 * 1024 * 1024 }

/** Names a person would actually upload, including the one that failed in production. */
const REAL_NAMES = [
  'pilot-upload-test.json',
  'notes.md',
  'README.md',
  'meeting notes 2026-08-21.txt',
  'data.export.v2.csv',
  'Screenshot 2026-08-21 at 10.42.31.png',
  'archive.tar.gz',
  'docker-compose.yml',
  '.env',
  'Makefile',
  'UPPERCASE.JSON',
]

test('THE PRODUCTION FAILURE: pilot-upload-test.json is accepted', () => {
  // It was rejected before it ever left the browser, with "That file type is not supported"
  // naming a type the server would have taken.
  assert.equal(extensionOf('pilot-upload-test.json'), 'json')
  assert.equal(rejectionFor({ name: 'pilot-upload-test.json', size: 1024 }, limits), null)
})

test('client and server extract extensions IDENTICALLY for real filenames', () => {
  // The actual defect was two implementations of one rule disagreeing. This is the guard:
  // neither is checked in isolation, they are checked against each other.
  for (const name of REAL_NAMES) {
    assert.equal(extensionOf(name), serverExtensionOf(name), `disagreement on "${name}"`)
  }
})

test('.txt and .md upload — they were always allowed server-side', () => {
  for (const name of ['notes.txt', 'notes.md', 'README.md']) {
    assert.equal(rejectionFor({ name, size: 10 }, limits), null, name)
  }
})

test('a dot in the middle does not confuse the extension', () => {
  assert.equal(extensionOf('data.export.v2.csv'), 'csv')
  assert.equal(rejectionFor({ name: 'data.export.v2.csv', size: 10 }, limits), null)
})

test('case is normalised', () => {
  assert.equal(extensionOf('UPPERCASE.JSON'), 'json')
  assert.equal(rejectionFor({ name: 'UPPERCASE.JSON', size: 10 }, limits), null)
})

test('a dotfile is a NAME, not an extension', () => {
  // `.env` must not be read as "extension env" — that would walk a secrets file straight
  // through a check written to stop it.
  assert.equal(extensionOf('.env'), '')
})

/*
 * 🚨 THE PROTECTION MOVED; IT DID NOT GO AWAY.
 *
 * The client no longer refuses by type — that mirror rejected supported files
 * before classification and is what made a JPEG "unsupported". `.env` is still
 * refused, now by the canonical classifier and the server, which are the layers
 * that can actually be trusted.
 */
test('a secrets file is still refused, by the classifier', async () => {
  const { classifyAttachment } = await import('./capability')
  const verdict = classifyAttachment('.env', 'text/plain', new TextEncoder().encode('KEY=x'))
  assert.equal(verdict.ok, false)
})

/*
 * 🚨 THIS TEST USED TO ENCODE THE BUG.
 *
 * It asserted that `photo.png` was refused as an unsupported type — which is
 * exactly what a user saw when they chose a photo through "Files". A PNG is
 * supported; it belongs on the image pipeline. The assertion is now the
 * opposite, and that is the fix.
 */
test('a PNG chosen through Files becomes an image, not an error', async () => {
  const { classifyAttachment } = await import('./capability')
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const verdict = classifyAttachment('photo.png', 'image/png', png)
  assert.equal(verdict.ok, true)
  assert.equal(verdict.ok && verdict.pipeline, 'image')
})

test('a genuinely unsupported type is still refused, with a usable reason', async () => {
  const { classifyAttachment } = await import('./capability')
  const verdict = classifyAttachment('sheet.xlsx', 'application/vnd.ms-excel', new Uint8Array([0x50, 0x4b, 3, 4]))
  assert.equal(verdict.ok, false)
  assert.match(verdict.ok ? '' : verdict.message, /CSV/, 'says what to do instead')
})

test('an extensionless file is refused without claiming a type', async () => {
  // Moved to the classifier with the rest of the type decision. The message must
  // still not invent an extension it never saw.
  const { classifyAttachment } = await import('./capability')
  const verdict = classifyAttachment('Makefile', 'text/plain', new TextEncoder().encode('all:'))
  assert.equal(verdict.ok, false)
  assert.match(verdict.ok ? '' : verdict.message, /no extension/i)
})

test('oversize is caught, but only for an otherwise-allowed type', () => {
  assert.equal(rejectionFor({ name: 'big.json', size: 3 * 1024 * 1024 }, limits)?.code, 'too_large')
})

test('with no limits fetched the client defers to the server rather than guessing', () => {
  assert.equal(rejectionFor({ name: 'anything.png', size: 10 }, null), null)
})

test('the accept attribute carries leading dots, as the browser requires', () => {
  const accept = acceptAttribute(ALLOWED_EXTENSIONS)
  assert.ok(accept.startsWith('.'), accept.slice(0, 24))
  assert.ok(accept.includes('.json'))
  assert.ok(!/(^|,)[a-z]/.test(accept), 'no bare extension may appear')
})
