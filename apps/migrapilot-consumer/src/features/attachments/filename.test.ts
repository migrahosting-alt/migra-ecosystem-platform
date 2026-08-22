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
  assert.notEqual(rejectionFor({ name: '.env', size: 10 }, limits), null)
})

test('a genuinely unsupported type is still refused, and names itself with a dot', () => {
  const rejection = rejectionFor({ name: 'photo.png', size: 10 }, limits)
  assert.equal(rejection?.code, 'unsupported_type')
  assert.match(String(rejection?.message), /^\.png is not supported/)
})

test('an extensionless file is refused without claiming a type', () => {
  const rejection = rejectionFor({ name: 'Makefile', size: 10 }, limits)
  assert.match(String(rejection?.message), /^That file type is not supported/)
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
