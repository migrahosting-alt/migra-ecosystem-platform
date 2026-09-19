/**
 * 🚨 THE DEFECTS THIS MODEL CLOSES, both found in the real product:
 *
 *   "What does the first document say about cancellation?"
 *     → "The first document doesn't say anything about cancellation."
 *        Nothing stated which file was first.
 *
 *   "Use the Q1 Sales sheet. What is the total revenue?"  (correct)
 *   "On that same sheet, which region had the highest revenue?"
 *     → "the question doesn't specify which sheet to look at."
 *        The sheet was named one turn earlier and nothing carried it.
 *
 * The candidates always come from the FILES — real filenames, real sheet names.
 * Nothing here holds a list of things people might say.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { orderAttachments, resolveActiveSheet, referenceEvidence } from './turnReference'

const T = 1_700_000_000_000

test('attachments are numbered by when they arrived, not by name', () => {
  // 🚨 Lexical order would put the workbook first; upload order is the truth.
  const ordered = orderAttachments(
    ['alpha-rates.xlsx', 'zulu-agreement.pdf'],
    { 'zulu-agreement.pdf': T, 'alpha-rates.xlsx': T + 137 },
  )
  assert.deepEqual(ordered.map((a) => a.name), ['zulu-agreement.pdf', 'alpha-rates.xlsx'])
  assert.deepEqual(ordered.map((a) => a.position), [1, 2])
})

test('a sheet named in an earlier turn is the sheet in play', () => {
  const sheets = ['Q1 Sales', 'Q2 Sales', 'Targets']
  const turns = [
    'on that same sheet, which region had the highest revenue?',   // newest
    'Use the Q1 Sales sheet. What is the total revenue?',
  ]
  assert.deepEqual(resolveActiveSheet('book.xlsx', sheets, turns), {
    file: 'book.xlsx',
    sheet: 'Q1 Sales',
  })
})

test('the most recent naming wins', () => {
  const sheets = ['Q1 Sales', 'Q2 Sales']
  const turns = ['now use the Q2 Sales sheet', 'earlier we used Q1 Sales']
  assert.equal(resolveActiveSheet('b.xlsx', sheets, turns)?.sheet, 'Q2 Sales')
})

test('a conversation that never named a sheet resolves to nothing', () => {
  // 🚨 Which is a question to ask, never a sheet to pick.
  assert.equal(resolveActiveSheet('b.xlsx', ['Q1 Sales', 'Q2 Sales'], ['what is the total?']), null)
  assert.equal(resolveActiveSheet('b.xlsx', ['Q1 Sales', 'Q2 Sales'], []), null)
})

test('a turn naming two sheets makes neither of them active', () => {
  // That turn is about both; it does not put either one in play.
  assert.equal(
    resolveActiveSheet('b.xlsx', ['Q1 Sales', 'Q2 Sales'], ['compare Q1 Sales with Q2 Sales']),
    null,
  )
})

test('one sheet is not a choice', () => {
  assert.equal(resolveActiveSheet('b.xlsx', ['Only'], ['the Only sheet']), null)
})

test('the preamble states order and the sheet, and claims nothing about content', () => {
  const text = referenceEvidence({
    attachments: orderAttachments(['a.pdf', 'b.xlsx'], { 'a.pdf': T, 'b.xlsx': T + 1 }),
    activeSheet: { file: 'b.xlsx', sheet: 'Q1 Sales' },
    basis: [],
  })!
  assert.match(text, /1\. a\.pdf/)
  assert.match(text, /2\. b\.xlsx/)
  assert.match(text, /"Q1 Sales"/)
  assert.match(text, /says nothing about what any of them contains/)
})

test('nothing is emitted when there is nothing to resolve', () => {
  // One attachment and no sheet in play needs no preamble in every prompt.
  assert.equal(
    referenceEvidence({ attachments: orderAttachments(['only.pdf'], {}), activeSheet: null, basis: [] }),
    null,
  )
})
