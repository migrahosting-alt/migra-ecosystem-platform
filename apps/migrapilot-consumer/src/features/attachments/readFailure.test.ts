/**
 * The six causes that were one sentence, pinned apart.
 *
 * The measured failure, on staging: a PDF the reader could not render was
 * reported as "No readable content was found in <file>. Attach a file with text
 * in it" — while the reader's own record said "the page renderer is not
 * available on this server". The file was fine. The server was not.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { READ_FAILURE, describeReadFailures } from './readFailure'

const GENERIC = /No readable content was found/

test('🚨 a missing renderer is the SERVER\'s failure, and says so', () => {
  const out = describeReadFailures(
    ['book.pdf'],
    [{ name: 'book.pdf', state: 'reader_unavailable', failureReason: 'the page renderer is not available on this server' }],
  )
  assert.ok(out)
  assert.equal(out.error, 'document_reader_unavailable')
  // The reader's own sentence, verbatim — not re-authored here.
  assert.ok(out.message.includes('the page renderer is not available on this server'))
  // And the half that changes what the user does about it.
  assert.match(out.message, /Nothing is wrong with your file/)
  // It must NOT say the document was empty, and must not send them elsewhere.
  assert.doesNotMatch(out.message, GENERIC)
  assert.doesNotMatch(out.message, /Attach a file with text in it/)
})

test('the missing text RECOGNISER is also the server, not the document', () => {
  const out = describeReadFailures(
    ['scan.pdf'],
    [{ name: 'scan.pdf', state: 'reader_unavailable', failureReason: 'the text recogniser is not available on this server' }],
  )
  assert.ok(out)
  assert.equal(out.error, 'document_reader_unavailable')
  assert.ok(out.message.includes('the text recogniser is not available on this server'))
})

test('a scan with no text layer is not an empty document', () => {
  const out = describeReadFailures(['scan.pdf'], [{ name: 'scan.pdf', state: 'no_text_layer' }])
  assert.ok(out)
  assert.equal(out.error, 'pdf_has_no_text_layer')
  assert.match(out.message, /no text layer/)
  assert.match(out.message, /images of text/)
  assert.doesNotMatch(out.message, GENERIC)
})

test('OCR that ran and failed is distinct from OCR that never ran', () => {
  const ran = describeReadFailures(['a.pdf'], [{ name: 'a.pdf', state: 'ocr_failed' }])
  const never = describeReadFailures(['a.pdf'], [{ name: 'a.pdf', state: 'reader_unavailable' }])
  assert.ok(ran && never)
  assert.notEqual(ran.error, never.error)
  assert.match(ran.message, /no readable text could be recognised/)
  // The difference that matters: one asks for a better scan, the other asks
  // for nothing because it is not the user's problem.
  assert.match(ran.message, /clearer scan/)
  assert.match(never.message, /ours to fix, not yours/)
})

test('a damaged file and a locked file are different problems with different fixes', () => {
  const corrupt = describeReadFailures(['x.pdf'], [{ name: 'x.pdf', state: 'corrupt' }])
  const locked = describeReadFailures(['y.pdf'], [{ name: 'y.pdf', state: 'encrypted' }])
  assert.ok(corrupt && locked)
  assert.equal(corrupt.error, 'document_corrupt')
  assert.equal(locked.error, 'document_encrypted')
  assert.match(corrupt.message, /damaged/)
  assert.match(corrupt.message, /Re-export or download it again/)
  assert.match(locked.message, /password-protected/)
  assert.match(locked.message, /Remove the password/)
})

test('too large to process names the parser, not the contents', () => {
  const out = describeReadFailures(['big.pdf'], [{ name: 'big.pdf', state: 'too_large_to_process' }])
  assert.ok(out)
  assert.equal(out.error, 'file_too_large_to_read')
  assert.doesNotMatch(out.message, GENERIC)
})

/* ── the refusals to over-claim ─────────────────────────────────────────── */

test('🚨 an unexplained file gets the GENERIC sentence, not a borrowed one', () => {
  // Nothing recorded for this file. Returning null is what makes the caller
  // fall back to the wording that claims less.
  assert.equal(describeReadFailures(['mystery.txt'], []), null)
})

test('🚨 a partial explanation must not stand in for the files it does not describe', () => {
  // One file explained, one not. Answering "b.pdf is password-protected" would
  // leave the user believing that covered a.pdf too.
  const out = describeReadFailures(
    ['a.pdf', 'b.pdf'],
    [{ name: 'b.pdf', state: 'encrypted' }],
  )
  assert.equal(out, null)
})

test('an unrecognised state is not guessed at', () => {
  assert.equal(describeReadFailures(['a.pdf'], [{ name: 'a.pdf', state: 'some_future_state' }]), null)
  // …and a state that means the file is FINE is not a failure either.
  assert.equal(describeReadFailures(['a.pdf'], [{ name: 'a.pdf', state: 'ready' }]), null)
})

test('nothing unreadable produces no verdict at all', () => {
  assert.equal(describeReadFailures([], [{ name: 'a.pdf', state: 'corrupt' }]), null)
})

/* ── several files, several causes ──────────────────────────────────────── */

test('one shared cause keeps its specific code', () => {
  const out = describeReadFailures(
    ['a.pdf', 'b.pdf'],
    [{ name: 'a.pdf', state: 'encrypted' }, { name: 'b.pdf', state: 'encrypted' }],
  )
  assert.ok(out)
  assert.equal(out.error, 'document_encrypted')
  assert.ok(out.message.includes('a.pdf') && out.message.includes('b.pdf'))
})

test('🚨 mixed causes must not let one of them speak for the others', () => {
  const out = describeReadFailures(
    ['a.pdf', 'b.pdf'],
    [
      { name: 'a.pdf', state: 'encrypted' },
      { name: 'b.pdf', state: 'reader_unavailable', failureReason: 'the page renderer is not available on this server' },
    ],
  )
  assert.ok(out)
  // Neither specific code may win — that would assert a cause about a file it
  // does not describe.
  assert.equal(out.error, 'documents_could_not_be_read')
  assert.match(out.message, /for different reasons/)
  assert.match(out.message, /a\.pdf: it is password-protected/)
  assert.ok(out.message.includes('b.pdf: the page renderer is not available on this server'))
})

/* ── the contract itself ────────────────────────────────────────────────── */

test('every class carries a code, a reason and something to do about it', () => {
  for (const [state, klass] of Object.entries(READ_FAILURE)) {
    assert.ok(klass.code, `${state} has no code`)
    assert.ok(klass.reason.length > 10, `${state} has no reason`)
    assert.ok(klass.advice.length > 10, `${state} has no advice`)
    // A reason that reads as a verdict on the file would undo the point.
    assert.doesNotMatch(klass.reason, GENERIC)
  }
})

test('the six owner-named causes are all distinguishable', () => {
  for (const state of ['reader_unavailable', 'no_text_layer', 'ocr_failed', 'corrupt', 'encrypted', 'too_large_to_process']) {
    assert.ok(READ_FAILURE[state], `missing class: ${state}`)
  }
  const codes = Object.values(READ_FAILURE).map((k) => k.code)
  assert.equal(new Set(codes).size, codes.length, 'two causes share a code')
})
