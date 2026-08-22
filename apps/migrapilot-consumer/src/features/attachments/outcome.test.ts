/**
 * The rules that stop an attachment from claiming more than happened.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { outcomeOfIndex, outcomeOfUpload } from './outcome'

test('a stored file is INDEXING, never ready', () => {
  // Uploading is not the same as answerable. Only the index step can promote it.
  const outcome = outcomeOfUpload({ saved: [{ name: 'notes.md', bytes: 120 }] })
  assert.equal(outcome.state, 'indexing')
})

test('the server name wins, because it may differ from the picked name', () => {
  const outcome = outcomeOfUpload({ saved: [{ name: 'my-notes-1.md', bytes: 9 }] })
  assert.equal(outcome.state === 'indexing' ? outcome.name : '', 'my-notes-1.md')
})

test("a rejection uses the server's own words", () => {
  const outcome = outcomeOfUpload({
    rejected: [{ name: 'big.md', error: 'too_large', message: 'Files are limited to 2 MB.' }],
  })
  assert.equal(outcome.state, 'failed')
  assert.equal(outcome.state === 'failed' ? outcome.reason : '', 'Files are limited to 2 MB.')
})

test('a 401 guard denial is a failure, not a silent success', () => {
  // It carries neither `saved` nor `rejected`. Reading "no rejection" as success is how an
  // unauthenticated upload would show a tick.
  const outcome = outcomeOfUpload({ error: 'unauthenticated', message: 'Sign in to manage files.' })
  assert.equal(outcome.state, 'failed')
  assert.equal(outcome.state === 'failed' ? outcome.reason : '', 'Sign in to manage files.')
})

test('an empty response fails rather than defaulting to ready', () => {
  assert.equal(outcomeOfUpload({}).state, 'failed')
})

test('only searchable === true becomes ready', () => {
  assert.equal(outcomeOfIndex(true, { searchable: true }).state, 'ready')
  assert.equal(outcomeOfIndex(true, { searchable: false }).state, 'unsearchable')
  // Missing field: unknown is not success.
  assert.equal(outcomeOfIndex(true, {}).state, 'unsearchable')
  // Truthy-but-not-true must not slip through a loose check.
  assert.equal(outcomeOfIndex(true, { searchable: 'yes' as unknown as boolean }).state, 'unsearchable')
})

test('indexed-but-not-searchable keeps the reason it was given', () => {
  const outcome = outcomeOfIndex(true, {
    searchable: false,
    message: 'Your files were read but could not be made searchable yet.',
  })
  assert.equal(
    outcome.state === 'unsearchable' ? outcome.reason : '',
    'Your files were read but could not be made searchable yet.',
  )
})

test('a failed index does not discard the fact that the file IS stored', () => {
  // `unsearchable`, not `failed`: the bytes are in the library and deleting the chip must
  // delete the file. Reporting it as a failed upload would strand a real stored file.
  assert.equal(outcomeOfIndex(false, { message: 'Indexing failed.' }).state, 'unsearchable')
})

/* ── per-file readability ─────────────────────────────────────────────────── */

test('a file the index holds NO chunks for is not Ready', () => {
  // The whitespace-only upload: the library was searchable, so the chip said
  // "Ready — MigraPilot can read this" for a file nothing could be answered from.
  const outcome = outcomeOfIndex(true, { searchable: true, chunkCounts: { 'blank.txt': 0 } }, 'blank.txt')
  assert.equal(outcome.state, 'unsearchable')
  assert.match(outcome.state === 'unsearchable' ? outcome.reason : '', /No readable content/)
})

test('a file WITH chunks is Ready', () => {
  assert.equal(outcomeOfIndex(true, { searchable: true, chunkCounts: { 'notes.md': 3 } }, 'notes.md').state, 'ready')
})

test('a file OMITTED from a present map has no readable content', () => {
  // The indexer never adds a file that yielded nothing, so absence-of-key is the real
  // signal. Checking only for a literal 0 let the whitespace-only upload stay "Ready".
  const outcome = outcomeOfIndex(true, { searchable: true, chunkCounts: { 'other.md': 4 } }, 'blank.txt')
  assert.equal(outcome.state, 'unsearchable')
  assert.match(outcome.state === 'unsearchable' ? outcome.reason : '', /No readable content/)
})

test('ABSENT counts are not read as zero', () => {
  // An older Brain does not report chunkCounts. Treating absent as zero would mark every
  // attachment unreadable on a version skew — the opposite failure, and just as wrong.
  // No `chunkCounts` OBJECT at all — an older Brain cannot tell us, so readiness stands.
  assert.equal(outcomeOfIndex(true, { searchable: true }, 'notes.md').state, 'ready')
})

test('readiness is judged for THIS file, not a sibling', () => {
  // A populated sibling must not vouch for an empty file.
  const outcome = outcomeOfIndex(
    true,
    { searchable: true, chunkCounts: { 'full.md': 9, 'blank.txt': 0 } },
    'blank.txt',
  )
  assert.equal(outcome.state, 'unsearchable')
})
