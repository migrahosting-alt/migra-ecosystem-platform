/**
 * 🚨 THE DEFECT. "What does the first document say about cancellation?" over a
 * contract and a workbook was answered "The first document doesn't say anything
 * about cancellation" — while the citation on that same answer read
 * `meridian-agreement.pdf · pages 2-5`, and that contract's page 4 is headed
 * "Page 4 - Cancellation".
 *
 * Naming the file instead of its position answered correctly, which is what
 * proved the evidence was complete and the ORDINAL had nothing to resolve
 * against.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { attachmentOrderEvidence } from './attachmentOrder'

const T = 1_700_000_000_000

test('two files are numbered in the order they were provided', () => {
  const text = attachmentOrderEvidence(
    ['meridian-rate-review-2026.xlsx', 'meridian-agreement.pdf'],
    { 'meridian-agreement.pdf': T, 'meridian-rate-review-2026.xlsx': T + 137 },
  )
  assert.ok(text)
  // Upload time decides, not the order the array happened to arrive in.
  assert.match(text, /1\. meridian-agreement\.pdf/)
  assert.match(text, /2\. meridian-rate-review-2026\.xlsx/)
  assert.ok(
    text.indexOf('meridian-agreement.pdf') < text.indexOf('meridian-rate-review-2026.xlsx'),
  )
})

test('a single attachment gets no preamble', () => {
  // "The first document" is unambiguous with one file, and a roll-call on every
  // single-file turn is noise in every prompt that never needed it.
  assert.equal(attachmentOrderEvidence(['only.pdf'], { 'only.pdf': T }), null)
  assert.equal(attachmentOrderEvidence([], {}), null)
})

test('it states order and claims nothing about content', () => {
  const text = attachmentOrderEvidence(['a.pdf', 'b.xlsx'], { 'a.pdf': T, 'b.xlsx': T + 1 })!
  assert.match(text, /says nothing about what any of them contains/)
})

test('a file with no timestamp keeps its given position', () => {
  // An unknown time is not a claim that it came first.
  const text = attachmentOrderEvidence(['known.pdf', 'untimed.xlsx'], { 'known.pdf': T })!
  assert.match(text, /1\. known\.pdf/)
  assert.match(text, /2\. untimed\.xlsx/)
})
