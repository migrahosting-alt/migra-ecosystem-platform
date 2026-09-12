/**
 * "Too large to read" must not be reported as "no readable content".
 *
 * ---------------------------------------------------------------------------
 * 🚨 MEASURED ON STAGING
 *
 * A 28.6 MB file of plain, repeated ASCII was uploaded successfully (HTTP 200,
 * 29,952,000 bytes stored) and then produced, when asked about:
 *
 *   insufficient_evidence
 *   "No readable content was found in huge.txt, so there is nothing to answer
 *    from. Attach a file with text in it, or ask about a different document."
 *
 * Every word of that is wrong in the way that matters. The file is full of
 * readable text; the user can open it and see so. What actually happened is
 * that it sits above the extract ceiling, so it was never handed to the parser
 * and the index holds zero chunks for it — the same zero a genuinely empty
 * document produces.
 *
 * "Attach a file with text in it" is advice the user cannot act on, because
 * they already did.
 *
 * This is the identical shape to the spreadsheet case already handled beside
 * it: one zero, several causes, and only one of them is a statement about the
 * file's contents.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { MAX_EXTRACT_BYTES } from './storage'

test('the extract ceiling is a real, positive limit worth naming to a user', () => {
  assert.ok(MAX_EXTRACT_BYTES > 0)
  // The message divides by 1 MiB and floors; a ceiling under 1 MB would render
  // as "0 MB", which is worse than saying nothing.
  assert.ok(Math.floor(MAX_EXTRACT_BYTES / 1_048_576) >= 1)
})

/**
 * The narrowing itself, in isolation from the filesystem.
 *
 * `reconcileGrounding` does exactly this: intersect the files the index holds
 * nothing for with the files storage flagged as above the ceiling. Reproduced
 * here so the RULE is pinned even if the surrounding I/O is refactored.
 */
function narrowTooLarge(
  unreadable: readonly string[],
  listed: ReadonlyArray<{ name: string; tooLargeToProcess?: boolean }>,
): string[] {
  const oversize = new Set(listed.filter((f) => f.tooLargeToProcess).map((f) => f.name))
  return unreadable.filter((name) => oversize.has(name))
}

test('an oversized file is separated from a genuinely empty one', () => {
  const listed = [
    { name: 'huge.txt', tooLargeToProcess: true },
    { name: 'blank.txt' },
  ]
  assert.deepEqual(narrowTooLarge(['huge.txt', 'blank.txt'], listed), ['huge.txt'])
})

test('a file that is unreadable for some OTHER reason is not blamed on size', () => {
  // If size were assumed, every unreadable file would get the wrong sentence —
  // which is the defect this replaces, pointed the other way.
  const listed = [{ name: 'blank.txt' }]
  assert.deepEqual(narrowTooLarge(['blank.txt'], listed), [])
})

test('the size sentence only applies when EVERY unreadable file is oversized', () => {
  // The caller requires `oversized.length === unreadable.length` before using
  // the size message. A mixed set must fall through to the general sentence,
  // because naming only the big one would leave the other unexplained.
  const listed = [
    { name: 'huge.txt', tooLargeToProcess: true },
    { name: 'blank.txt' },
  ]
  const unreadable = ['huge.txt', 'blank.txt']
  const oversized = narrowTooLarge(unreadable, listed)
  assert.notEqual(oversized.length, unreadable.length)
})

test('nothing attached means nothing to narrow', () => {
  assert.deepEqual(narrowTooLarge([], [{ name: 'huge.txt', tooLargeToProcess: true }]), [])
})
