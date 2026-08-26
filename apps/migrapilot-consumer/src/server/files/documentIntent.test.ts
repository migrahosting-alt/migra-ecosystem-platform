/**
 * Refusing to answer a document question from nothing.
 *
 * THE DEFECT. Asked for the rollback marker in an indexed runbook that was never
 * attached to the conversation, MigraPilot answered that the command "might be
 * `./rollback.sh`" and that the script "typically undoes the changes made during
 * the cutover". Fluent, confident, invented. The file existed and the Files page
 * said "Ready", so the user had every reason to believe it had been read.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { assessDocumentIntent } from './documentIntent'

const ungrounded = (prompt: string) => assessDocumentIntent(prompt, false).needsAttachedDocument
const grounded = (prompt: string) => assessDocumentIntent(prompt, true).needsAttachedDocument

test('THE REGRESSION: asking what an unattached document says is refused', () => {
  for (const prompt of [
    'what is the rollback marker in the cutover runbook?',
    'what does my runbook say about rollback?',
    'quote the line from my notes with the passphrase',
    'summarise the attached report',
    'how many rows are in my csv?',
    'find the invoice total in my spreadsheet',
    'according to the document, who owns the rehearsal?',
  ]) {
    assert.equal(ungrounded(prompt), true, prompt)
  }
})

test('the same questions are ANSWERED once documents are attached', () => {
  // The refusal is about missing context, never about the shape of the question.
  for (const prompt of [
    'what does my runbook say about rollback?',
    'how many rows are in my csv?',
  ]) {
    assert.equal(grounded(prompt), false, prompt)
  }
})

test('ordinary conversation is never refused', () => {
  /*
   * The cost asymmetry runs the other way here than in the image classifier:
   * refusing a normal question is a visible annoyance, so the bar for firing is
   * an explicit reference to a document.
   */
  for (const prompt of [
    'what is the capital of France',
    'explain recursion',
    'write me a haiku about storage',
    'how do I write a runbook?',
    'what is a changelog?',
    'draft a report about Q3',
    'generate an image of a lighthouse',
  ]) {
    assert.equal(ungrounded(prompt), false, prompt)
  }
})

test('a document named without a question is not a retrieval request', () => {
  // "My notes are a mess" asks nothing of the notes.
  assert.equal(ungrounded('my notes are a mess'), false)
  assert.equal(ungrounded('I should organise my files'), false)
})

test('an indefinite article is a topic, a possessive is an artefact', () => {
  /*
   * "Write a report" is a task; "what does my report say" needs a file. The
   * difference is one word, and getting it wrong either refuses ordinary work or
   * invents answers about real documents.
   */
  assert.equal(ungrounded('write a report on failover'), false)
  assert.equal(ungrounded('what does my report say about failover'), true)
})

test('the decision explains itself', () => {
  const d = assessDocumentIntent('what does my runbook say?', false)
  assert.equal(d.needsAttachedDocument, true)
  assert.ok(d.reason.length > 0)
  assert.ok(d.evidence && d.evidence.length > 0)
})

test('an empty prompt asks for nothing', () => {
  assert.equal(ungrounded('   '), false)
})
