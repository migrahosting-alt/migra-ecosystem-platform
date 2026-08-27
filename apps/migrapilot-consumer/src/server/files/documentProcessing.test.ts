/**
 * Uploaded is not searchable.
 *
 * The point of reading a document in the background is that it is NOT readable
 * yet. Letting it ground an answer early would produce citations to text nobody
 * has recovered.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { contributesToAnswers, type ProcessingStatus } from './documentProcessing'

const status = (state: ProcessingStatus['state']): ProcessingStatus => ({
  fileName: 'book.pdf', state, description: '', readable: false, polling: false,
})

test('only the readable terminal states may ground an answer', () => {
  assert.equal(contributesToAnswers(status('ready')), true)
  assert.equal(contributesToAnswers(status('ready_with_unplaced_pages')), true,
    'unplaced pages limit ORDERING, not readability')
})

test('a file being read contributes NOTHING yet', () => {
  for (const state of ['stored', 'processing'] as const) {
    assert.equal(contributesToAnswers(status(state)), false, `${state} must not be searchable`)
  }
})

test('every failure state contributes nothing', () => {
  for (const state of ['no_text_layer', 'ocr_failed', 'corrupt', 'encrypted', 'too_large_to_process'] as const) {
    assert.equal(contributesToAnswers(status(state)), false, `${state} must not be searchable`)
  }
})

test('a document with no processing record is an ordinary fast-path file', () => {
  // A text-layer PDF, a markdown note, a CSV — none of them ever enter the
  // background reader, and treating "absent" as "not ready" would make every
  // ordinary document unsearchable.
  assert.equal(contributesToAnswers(null), true)
  assert.equal(contributesToAnswers(undefined), true)
})
