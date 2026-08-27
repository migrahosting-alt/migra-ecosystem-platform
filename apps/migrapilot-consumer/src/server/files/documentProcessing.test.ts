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

/*
 * ── THE ORDERING CAVEAT ─────────────────────────────────────────────────────
 *
 * Both conditions are required. Warning on everything teaches the user to skip
 * the warning; warning on nothing presents an incomplete order as fact.
 */

import { sequenceNoteFor, isOrderingQuestion } from './documentProcessing'

const incomplete: ProcessingStatus = {
  fileName: 'book.pdf', state: 'ready_with_unplaced_pages', description: '',
  readable: true, polling: false, sequenceComplete: false,
  sequenceNote: 'I can answer from the ordered pages, but some readable pages are unplaced.',
}
const complete: ProcessingStatus = { ...incomplete, state: 'ready', sequenceComplete: true }

test('an ordering question on an incomplete document gets the note', () => {
  assert.equal(sequenceNoteFor('What comes after section 33?', [incomplete]), incomplete.sequenceNote)
  assert.equal(sequenceNoteFor('Teach me the next lesson in order.', [incomplete]), incomplete.sequenceNote)
})

test('a CONTENT question on the same document gets nothing', () => {
  // This is most of what a language book is used for; a caveat here would make a
  // fully usable document sound unreliable.
  assert.equal(sequenceNoteFor('What is the Creole word for chocolate?', [incomplete]), null)
  assert.equal(sequenceNoteFor('Find examples of this phrase.', [incomplete]), null)
})

test('a COMPLETE document never gets the note', () => {
  assert.equal(sequenceNoteFor('What comes after section 33?', [complete]), null)
})

test('a document with no processing record never gets the note', () => {
  assert.equal(sequenceNoteFor('What comes after section 33?', [null]), null)
})

test('ordering language is recognised, ordinary questions are not', () => {
  for (const q of ['what comes next', 'summarise it sequentially', 'build a curriculum', 'the first chapter']) {
    assert.equal(isOrderingQuestion(q), true, `should be ordering: ${q}`)
  }
  for (const q of ['what does it say about food', 'translate kakawo', 'how is this spelled']) {
    assert.equal(isOrderingQuestion(q), false, `should be content: ${q}`)
  }
})
