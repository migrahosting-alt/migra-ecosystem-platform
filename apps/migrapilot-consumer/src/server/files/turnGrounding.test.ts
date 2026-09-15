import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { selectTurnGrounding } from './turnGrounding'

/**
 * Conversation-scoped grounding isolation.
 *
 * 🚨 EVERY CASE HERE IS A REPRODUCTION OF A PRODUCTION FAILURE, not a
 * hypothetical. Attaching a scanned PDF to an existing thread and asking about
 * it answered from an unrelated earlier document; a CSV question cited a DOCX.
 * The same files in a fresh conversation answered correctly, which is what
 * proved extraction was fine and SELECTION was not.
 */

test('🚨 a newly attached file is what the turn answers from', () => {
  // The exact production sequence: File A earlier, File B now.
  const selection = selectTurnGrounding(
    'what does this file say?',
    ['B_scanned.pdf'],
    ['A_earlier.pdf'],
  )
  assert.deepEqual(selection.active, ['B_scanned.pdf'])
  assert.deepEqual(selection.withheld, ['A_earlier.pdf'])
  assert.equal(selection.reason, 'attached_this_turn')
})

test('🚨 a CSV question does not drag in an unrelated DOCX', () => {
  const selection = selectTurnGrounding(
    'what is the total revenue?',
    ['05_structured_data.csv'],
    ['04_reference_document.docx', '03_large_digital.pdf'],
  )
  assert.deepEqual(selection.active, ['05_structured_data.csv'])
  assert.equal(selection.withheld.length, 2)
})

test('an explicitly named historical file is reactivated', () => {
  // "explicitly referenced historical attachments can be reactivated"
  const selection = selectTurnGrounding(
    'what did we discuss earlier about 04_reference_document.docx?',
    [],
    ['04_reference_document.docx', '05_structured_data.csv'],
  )
  assert.deepEqual(selection.active, ['04_reference_document.docx'])
  assert.equal(selection.reason, 'named_in_prompt')
})

test('a named file matches by stem and by spaced stem', () => {
  const files = ['reference_document.docx']
  for (const prompt of [
    'what does reference_document.docx say',
    'summarise the reference_document',
    'what was in the reference document',
  ]) {
    assert.deepEqual(selectTurnGrounding(prompt, [], files).active, files, prompt)
  }
})

test('a very short stem never matches incidentally', () => {
  /*
   * `a.txt` would otherwise match the letter "a" in any sentence and quietly
   * reactivate itself on every turn — the defect this file exists to remove,
   * arriving through the fix.
   */
  const selection = selectTurnGrounding('what is a good approach here', [], ['a.txt'])
  assert.equal(selection.reason, 'conversation_default')
})

test('attaching one file while naming another activates BOTH', () => {
  // "how does this compare with the invoice?" is a real question and needs two
  // documents. Narrowing to the attachment alone would break it.
  const selection = selectTurnGrounding(
    'how does this compare with invoices.csv?',
    ['new_report.pdf'],
    ['invoices.csv', 'unrelated.docx'],
  )
  assert.deepEqual(selection.active.sort(), ['invoices.csv', 'new_report.pdf'])
  assert.deepEqual(selection.withheld, ['unrelated.docx'])
})

test('a bare follow-up in a one-document thread still works', () => {
  /*
   * With nothing attached and nothing named, the conversation's set stands.
   * History cannot answer "summarise it" about a document's CONTENTS, so
   * narrowing to nothing here would replace contamination with amnesia.
   */
  const selection = selectTurnGrounding('summarise it', [], ['only_doc.pdf'])
  assert.deepEqual(selection.active, ['only_doc.pdf'])
  assert.equal(selection.reason, 'conversation_default')
  assert.deepEqual(selection.withheld, [])
})

test('an empty conversation grounds on nothing and says so', () => {
  const selection = selectTurnGrounding('hello', [], [])
  assert.deepEqual(selection.active, [])
  assert.equal(selection.reason, 'none')
})

/*
 * 🚨 THE FIELD THAT WAS NEVER SENT.
 *
 * The consumer had no `conversationId` on a chat turn, so the Brain's entire
 * durable-memory path — which is gated on exactly that value — never activated.
 * Chat had NO cross-turn memory: "Remember ZULU-4417" was acknowledged and the
 * next turn invented a Python function. These pin the wiring at every layer that
 * has historically dropped a field, because excess properties are not checked
 * through a spread and the omission compiles silently.
 */
const src = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8')

test('conversationId is declared and forwarded at every layer', () => {
  const ops = src('server/brain/operations.ts')
  assert.match(ops, /kind: 'chatTurn'[\s\S]{0,1200}conversationId\?: string/,
    'the operation type must declare it')
  assert.match(ops, /\.\.\.\(op\.conversationId \? \{ conversationId: op\.conversationId \} : \{\}\)/,
    'and the request body must carry it')

  const seams = src('server/brain/seams.ts')
  assert.match(seams, /conversationId\?: string/, 'the seam must declare it')
  assert.match(seams, /\.\.\.\(options\.conversationId \? \{ conversationId: options\.conversationId \} : \{\}\)/,
    'and pass it into the operation')

  const route = src('app/api/chat/stream/route.ts')
  assert.match(route, /\n {10}conversationId,/, 'the stream route must forward it to the Brain')
})

test('the turn sends the ACTIVE grounding set, not the whole thread', () => {
  const route = src('app/api/chat/stream/route.ts')
  assert.match(route, /groundingFiles: turnGrounding\.active/,
    'the retrieval boundary is the selected set')
  assert.doesNotMatch(route, /groundingFiles: reconciled\.available/,
    'sending every file the thread ever had is the contamination defect')
})

/*
 * 🚨 FOUND IN LIVE ACCEPTANCE, MINUTES AFTER THE MEMORY FIX SHIPPED.
 *
 * Sending `conversationId` gave the Brain a thread to write to, and it had been
 * asking to write all along (`store: true`). The consumer ALSO appends every
 * message — prompt, answer, refusals, image and file refs. Result: six messages,
 * twelve rows, every turn rendered twice in the transcript.
 *
 * `store: true` was invisible while the id was missing. That is the shape of
 * this whole repair: a field that was never sent hid the behaviour of the fields
 * that were.
 */
test('the Brain retrieves conversation history but never writes it', () => {
  const ops = src('server/brain/operations.ts')
  assert.match(ops, /memoryPolicy: \{ mode: 'durable', retrieve: true, store: false \}/,
    'two writers on one conversation duplicates every message')
  assert.doesNotMatch(ops, /memoryPolicy: \{ mode: 'durable', retrieve: true, store: true \}/)
})

test('the consumer remains the sole writer of both halves of a turn', () => {
  // If this ever stops being true, `store: false` above would mean the
  // conversation stops being written at all — silent data loss rather than
  // duplication. The two facts have to move together.
  const route = src('app/api/chat/stream/route.ts')
  assert.match(route, /appendMessage\(\s*\n?\s*conversationId, 'user', prompt/,
    'the prompt is persisted by the consumer')
  assert.match(route, /appendMessage\(durableId, 'assistant'/,
    'and so is the answer')
})

/*
 * 🚨 FOUND IN LIVE GATE 4. "What did we discuss earlier about the first PDF?"
 * answered CORRECTLY from conversation history but cited an unrelated six-page
 * scan alongside the right file, because the no-signal fallback activated the
 * whole thread. Over-broad evidence is the defect this module exists to remove,
 * even when the prose happens to be right.
 */
test('a bare follow-up in a MULTI-file thread grounds on one file, not all', () => {
  const selection = selectTurnGrounding(
    'what did we discuss earlier about the first PDF?',
    [],
    ['01_small_text_reference.pdf', '02_scanned_image_only_6pages.pdf'],
  )
  assert.equal(selection.active.length, 1, 'never the whole thread')
  assert.deepEqual(selection.active, ['02_scanned_image_only_6pages.pdf'], 'the most recent')
  assert.deepEqual(selection.withheld, ['01_small_text_reference.pdf'])
})

test('a bare follow-up in a ONE-file thread still uses that file', () => {
  // Grounding on nothing here would replace contamination with amnesia.
  const selection = selectTurnGrounding('summarise it', [], ['only_doc.pdf'])
  assert.deepEqual(selection.active, ['only_doc.pdf'])
  assert.equal(selection.reason, 'conversation_default')
})

test('naming an older file still beats recency', () => {
  // The escape hatch that makes the recency default safe.
  const selection = selectTurnGrounding(
    'what is in 01_small_text_reference.pdf?',
    [],
    ['01_small_text_reference.pdf', '02_scanned_image_only_6pages.pdf'],
  )
  assert.deepEqual(selection.active, ['01_small_text_reference.pdf'])
  assert.equal(selection.reason, 'named_in_prompt')
})

// ── files attached TOGETHER stay together ──────────────────────────────────

/*
 * 🚨 THE DEFECT. A contract and a rate-review workbook were attached in one
 * picker action and compared successfully — `attached_this_turn`, two files
 * active. The very next question, a follow-up about the same pair, came back
 * `conversation_default, active 1, withheld 1`: this rule kept the last name in
 * a flat list and dropped the other half of the set. The answer then reported
 * the dropped file as not mentioning a figure printed on its page 3.
 *
 * Measured: two files chosen in one picker action land 137 ms apart.
 */
const T = 1_700_000_000_000

test('a pair attached together survives the next turn', () => {
  const selection = selectTurnGrounding(
    'Which document gives the higher aggregate monthly charge?',
    [],
    ['meridian-agreement.pdf', 'meridian-rate-review-2026.xlsx'],
    { 'meridian-agreement.pdf': T, 'meridian-rate-review-2026.xlsx': T + 137 },
  )
  assert.deepEqual(
    selection.active.sort(),
    ['meridian-agreement.pdf', 'meridian-rate-review-2026.xlsx'],
  )
  assert.deepEqual(selection.withheld, [])
  assert.equal(selection.reason, 'conversation_default')
})

test('an older unrelated file still stays out — the original defect', () => {
  /*
   * This is what the narrowing exists for: attaching a document to an existing
   * thread and asking about it must not reactivate a scan from an hour ago.
   */
  const selection = selectTurnGrounding(
    'What does it say about cancellation?',
    [],
    ['02_scanned_image_only_6pages.pdf', 'meridian-agreement.pdf'],
    { '02_scanned_image_only_6pages.pdf': T, 'meridian-agreement.pdf': T + 3_600_000 },
  )
  assert.deepEqual(selection.active, ['meridian-agreement.pdf'])
  assert.deepEqual(selection.withheld, ['02_scanned_image_only_6pages.pdf'])
})

test('a slow multi-file upload still counts as one attachment', () => {
  // A 37 MB scan beside a small sheet is written sequentially, not instantly.
  const selection = selectTurnGrounding(
    'Compare them.',
    [],
    ['big-scan.pdf', 'rates.xlsx'],
    { 'big-scan.pdf': T, 'rates.xlsx': T + 80_000 },
  )
  assert.equal(selection.active.length, 2)
})

test('with no timestamps it narrows exactly as before', () => {
  // A caller that cannot supply times must not silently lose the narrowing.
  const selection = selectTurnGrounding('What does it say?', [], ['a-file.pdf', 'b-file.pdf'])
  assert.deepEqual(selection.active, ['b-file.pdf'])
  assert.deepEqual(selection.withheld, ['a-file.pdf'])
})
