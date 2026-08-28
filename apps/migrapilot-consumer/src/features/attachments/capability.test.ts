import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ATTACHMENT_TYPES, DOCUMENT_PICKER_ACCEPT, INDEXED_EXTENSIONS,
  attachmentCapability, isIndexable, refusalFor,
} from './capability'

/*
 * THE DEFECT THIS SLICE EXISTS TO KILL. The picker offered 48 extensions while
 * storage accepted 27, so a person could choose .xlsx from a menu MigraPilot
 * presented and be refused on upload. These two can only agree now because they
 * are the same list — this asserts that they still are.
 */
test('every offered extension is one the product actually accepts', () => {
  const offered = DOCUMENT_PICKER_ACCEPT.split(',').map((e) => e.replace(/^\./, ''))
  const accepted = new Set(INDEXED_EXTENSIONS)
  const broken = offered.filter((e) => !accepted.has(e))
  assert.deepEqual(broken, [], 'the picker offers types storage would refuse')
  assert.equal(offered.length, INDEXED_EXTENSIONS.length, 'and offers all of them')
})

test('nothing unsupported leaks into the picker', () => {
  const offered = new Set(DOCUMENT_PICKER_ACCEPT.split(',').map((e) => e.replace(/^\./, '')))
  for (const t of ATTACHMENT_TYPES.filter((x) => x.support === 'unsupported')) {
    assert.equal(offered.has(t.ext), false, `${t.ext} is refused but still offered`)
  }
})

/*
 * A refusal has to be worth reading. "Unsupported file type" tells someone
 * holding a spreadsheet nothing they can act on.
 */
test('a refused type explains itself in a way the user can act on', () => {
  assert.match(refusalFor('budget.xlsx'), /CSV/, 'says what to do instead')
  assert.match(refusalFor('deck.pptx'), /cannot read/i)
  assert.match(refusalFor('backup.zip'), /files inside/i)
  assert.match(refusalFor('dump.sql'), /dumps/i)
  // Unknown types still get something specific rather than a shrug.
  assert.match(refusalFor('thing.xyz'), /\.xyz/)
  assert.match(refusalFor('noextension'), /no extension/i)
})

test('every unsupported type carries a reason', () => {
  for (const t of ATTACHMENT_TYPES.filter((x) => x.support === 'unsupported')) {
    assert.ok(t.reason && t.reason.length > 20, `${t.ext} is refused with no reason`)
  }
})

test('spreadsheets and presentations are refused deliberately, not accidentally', () => {
  // Held back because spreadsheet ANALYSIS is a known open defect. If someone
  // later flips these on, this test should make them think about why they were
  // off rather than assume it was an oversight.
  for (const ext of ['xlsx', 'xls', 'ods', 'pptx', 'ppt', 'odp']) {
    assert.equal(isIndexable(ext), false, `${ext} must stay refused until its path is real`)
  }
})

test('plain-text code types are supported, because the indexer really reads them', () => {
  for (const ext of ['c', 'cpp', 'php', 'swift', 'kt', 'tsv']) {
    assert.equal(isIndexable(ext), true, `${ext} is plain text and indexes fine`)
  }
})

test('the published contract matches the enforced list', () => {
  const c = attachmentCapability()
  assert.deepEqual([...c.accepted], [...INDEXED_EXTENSIONS])
  assert.equal(c.accept, DOCUMENT_PICKER_ACCEPT)
  assert.ok(c.refused.every((r) => r.reason), 'the contract explains every refusal too')
})

/*
 * 🚨 THE SMUGGLING CASE, found live. An .xlsx renamed to .csv passed validation
 * and stored a zip archive as a text file — the indexer then skipped it on its
 * first NUL byte, leaving a file that looked accepted and could never be read.
 * The extension is a claim; the bytes are the evidence.
 */
test('a binary file wearing a text extension is refused', async () => {
  const { contentMismatch } = await import('./capability')
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])

  assert.match(contentMismatch('budget.csv', zip) ?? '', /zip archive/i)
  assert.match(contentMismatch('notes.txt', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])) ?? '', /Office/i)
  assert.match(contentMismatch('data.json', new Uint8Array([0x25, 0x50, 0x44, 0x46])) ?? '', /PDF/i)
})

test('real text passes, and real binary formats are left alone', async () => {
  const { contentMismatch } = await import('./capability')
  const text = new TextEncoder().encode('region,amount\nPort-au-Prince,1904000\n')
  assert.equal(contentMismatch('report.csv', text), null)
  assert.equal(contentMismatch('main.cpp', new TextEncoder().encode('int main(){}')), null)

  // PDF and DOCX are legitimately binary and have real extractors. The rule is
  // "no binary wearing a text file's name", not "no binary".
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])
  const docxZip = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
  assert.equal(contentMismatch('report.pdf', pdf), null)
  assert.equal(contentMismatch('report.docx', docxZip), null)
})

test('a NUL byte in a text file is refused even without a known signature', async () => {
  const { contentMismatch } = await import('./capability')
  const sneaky = new Uint8Array([0x61, 0x62, 0x00, 0x63])
  assert.match(contentMismatch('log.txt', sneaky) ?? '', /binary data/i)
})
