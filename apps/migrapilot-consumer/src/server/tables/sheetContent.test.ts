/**
 * A WORKBOOK ATTACHED BESIDE A DOCUMENT MUST REACH THE MODEL.
 *
 * 🚨 THE DEFECT. A freight contract and a rate-review workbook were attached
 * together and asked "Compare the payment terms in these two files." The answer
 * quoted the PDF's forty-five days correctly and then said "No payment terms
 * are mentioned in the provided excerpts from the other file" — about a sheet
 * reading `Payment terms | 30`. The turn trace showed `grounding_active: 2` and
 * NO table evidence: both files were active and one of them contributed nothing,
 * so the model was invited to characterise a file it had never seen.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sheetContentEvidenceFor } from './sheetContent'

const dir = mkdtempSync(join(tmpdir(), 'sheet-content-'))
// A .xlsx the reader cannot open is the "unreadable" case; a real one is built
// by the acceptance artifacts. Here the point is WHICH files are selected.
writeFileSync(join(dir, 'notes.txt'), 'plain text')
writeFileSync(join(dir, 'data.csv'), 'a,b\n1,2\n')

test('a CSV is not a structured-only file and is left to the index', async () => {
  // CSV is text-indexed as well as analysable, so the prose path already has it.
  assert.deepEqual(await sheetContentEvidenceFor(['data.csv', 'notes.txt'], dir), [])
})

test('a workbook that cannot be read produces NOTHING, never a placeholder', async () => {
  /*
   * An entry whose text is its own filename is worse than absence:
   * `budget-2026.xlsx` contains the words "budget" and "2026", so a sentence
   * could ground itself in a workbook nobody opened.
   */
  writeFileSync(join(dir, 'broken.xlsx'), 'not a zip at all')
  assert.deepEqual(await sheetContentEvidenceFor(['broken.xlsx'], dir), [])
})

test('the file the computed path already spoke for is excluded', async () => {
  /*
   * Otherwise one turn carries MigraPilot's arithmetic AND the raw cells behind
   * it as two separate claims about the same numbers.
   */
  writeFileSync(join(dir, 'other.xlsx'), 'not a zip either')
  const out = await sheetContentEvidenceFor(['other.xlsx'], dir, 'other.xlsx')
  assert.deepEqual(out, [], 'the computed file must not also be shown raw')
})

test('the evidence states its own position among the attachments', async () => {
  /*
   * 🚨 "What budget does the first document give?" was answered with the SECOND
   * document's figure, on a turn whose trace proved the order was resolved
   * correctly and whose model, asked directly, named the right file as number 1.
   * It knew which file was first and still read the wrong block: the ordinal
   * lived in a preamble and the filename lived on the block, and that join is
   * one the model had to make and sometimes did not.
   */
  const { mkdtempSync, copyFileSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'positions-'))
  const src = join(process.cwd(), '../../.playwright-mcp/alpha-report-v2.xlsx')
  copyFileSync(src, join(dir, 'alpha-report-v2.xlsx'))

  const out = await sheetContentEvidenceFor(['alpha-report-v2.xlsx'], dir, null, {
    'alpha-report-v2.xlsx': 1,
  })
  assert.equal(out.length, 1)
  assert.match(out[0]!.text, /this is document 1 of the attached files/)
})

test('a file with no stated position says nothing about one', async () => {
  const { mkdtempSync, copyFileSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'nopos-'))
  copyFileSync(
    join(process.cwd(), '../../.playwright-mcp/alpha-report-v2.xlsx'),
    join(dir, 'alpha-report-v2.xlsx'),
  )
  const out = await sheetContentEvidenceFor(['alpha-report-v2.xlsx'], dir)
  assert.equal(out.length, 1)
  assert.doesNotMatch(out[0]!.text, /this is document/)
})
