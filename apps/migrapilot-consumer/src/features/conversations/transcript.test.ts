/**
 * The exported transcript.
 *
 * Export is the one action in the conversation menu that produces something the
 * user keeps and reads later, away from the app. So the risk is not that it
 * fails — it is that it succeeds and says something slightly untrue, in a file
 * that outlives every bit of context that would have corrected it.
 *
 * Two things are asserted above all: a SYSTEM NOTICE is never presented as the
 * model speaking, and an answer that was never saved says so.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { toTranscript, transcriptFilename } from './transcript'
import type { Conversation } from '@/data/types'

const AT = new Date('2026-08-23T18:00:00Z')

const base = (messages: Conversation['messages']): Conversation => ({
  id: 'conv_1',
  title: 'Cloud migration questions',
  preview: '',
  time: '2:00 PM',
  group: 'Today',
  icon: 'chat',
  tone: 'blue',
  messages,
})

test('both sides of the conversation are attributed by name', () => {
  const out = toTranscript(
    base([
      { id: 'u1', role: 'user', text: 'What is a cloud migration?', time: '2:00 PM', delivered: true },
      { id: 'a1', role: 'assistant', time: '2:01 PM', blocks: [{ type: 'paragraph', text: 'Moving systems to hosted infrastructure.' }] },
    ]),
    AT,
  )

  assert.match(out, /# Cloud migration questions/)
  assert.match(out, /\*\*You · 2:00 PM\*\*/)
  assert.match(out, /\*\*MigraPilot · 2:01 PM\*\*/)
  assert.match(out, /Moving systems to hosted infrastructure\./)
})

test('a system notice is a NOTE, never the assistant speaking', () => {
  /*
   * These are the app telling the user something failed. Exporting them as
   * MigraPilot's own words would put sentences in the model's mouth that it
   * never produced — in a file that will be read without any of this context.
   */
  const out = toTranscript(
    base([
      { id: 'u1', role: 'user', text: 'hello', time: '2:00 PM', delivered: true },
      {
        id: 'a1',
        role: 'assistant',
        time: '2:01 PM',
        error: true,
        blocks: [{ type: 'paragraph', text: 'The model did not answer in time.' }],
      },
    ]),
    AT,
  )

  assert.match(out, /\*\*Note · 2:01 PM\*\*/)
  assert.ok(!/\*\*MigraPilot/.test(out), 'no part of this was the assistant')
})

test('an answer that was never saved carries that fact into the file', () => {
  // The file outlives the session that knew this. If it does not say so here,
  // nothing ever will.
  const out = toTranscript(
    base([
      {
        id: 'a1',
        role: 'assistant',
        time: '2:01 PM',
        unsaved: true,
        blocks: [{ type: 'paragraph', text: 'A complete answer.' }],
      },
    ]),
    AT,
  )

  assert.match(out, /A complete answer\./)
  assert.match(out, /was not saved/)
})

test('cited files travel with the answer that cited them', () => {
  const out = toTranscript(
    base([
      {
        id: 'a1',
        role: 'assistant',
        time: '2:01 PM',
        citedFiles: ['notes.md', 'plan.txt'],
        blocks: [{ type: 'paragraph', text: 'According to your documents…' }],
      },
    ]),
    AT,
  )
  assert.match(out, /Sources: notes\.md, plan\.txt/)
})

test('an empty conversation says so rather than exporting a bare title', () => {
  // A file containing only a heading reads as a failed export.
  const out = toTranscript(base([]), AT)
  assert.match(out, /no messages yet/)
})

test('a message with no renderable text is skipped, not exported blank', () => {
  const out = toTranscript(
    base([
      { id: 'u1', role: 'user', text: '', time: '2:00 PM', delivered: true },
      { id: 'u2', role: 'user', text: 'real question', time: '2:01 PM', delivered: true },
    ]),
    AT,
  )
  assert.equal(out.match(/\*\*You/g)?.length, 1)
})

test('the filename is derived from the title and is safe everywhere', () => {
  assert.equal(
    transcriptFilename(base([]), AT),
    'migrapilot-cloud-migration-questions-2026-08-23.md',
  )
  assert.equal(
    transcriptFilename({ ...base([]), title: '  ///  ' }, AT),
    'migrapilot-conversation-2026-08-23.md',
    'a title made only of separators still yields a usable name',
  )
  const long = transcriptFilename({ ...base([]), title: 'x'.repeat(300) }, AT)
  assert.ok(long.length < 90, 'and a very long title is bounded')
})
