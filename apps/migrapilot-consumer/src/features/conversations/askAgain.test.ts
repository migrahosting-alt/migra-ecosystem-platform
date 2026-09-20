/**
 * Asking a question again, and rewriting one before asking it.
 *
 * 🚨 THE CONSTRAINT THAT SHAPES THIS WHOLE SLICE: the conversation store is
 * APPEND-ONLY. The Brain can create a conversation, append a message, list the
 * messages and delete the whole thing — there is no remove-one-message, no
 * truncate-after, no parent or branch. So the "regenerate" and "edit" of other
 * chat products (the old answer disappears behind a 2-of-2 arrow) are not
 * capabilities MigraPilot has, and building them anyway would give a transcript
 * that rearranges itself on reload: one answer in the browser, two in the
 * durable record, and no way for the reader to tell which they were looking at.
 *
 * What is asserted here is therefore the honest subset — and the labels, because
 * a control named "Regenerate" would make the promise the storage cannot keep.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Message } from '@/data/types'
import { askAgainOptions, canAskAgain, lastQuestionOf } from './askAgain'

const user = (text: string, extra: Partial<Message> = {}): Message => ({
  id: `u-${text}`, role: 'user', text, time: '10:00', ...extra,
})
const answer = (text: string, extra: Partial<Message> = {}): Message => ({
  id: `a-${text}`, role: 'assistant', time: '10:01', blocks: [{ type: 'paragraph', text }], ...extra,
})

// ── which question a repeat repeats ─────────────────────────────────────────

test('the LAST question is the one repeated, never the first', () => {
  /*
   * A retry appends to the bottom of the thread. Repeating an older question
   * would drop its answer underneath a conversation that has moved past it.
   */
  const messages = [user('what is a compiler'), answer('a program that…'), user('and a linker'), answer('it joins…')]
  assert.equal(lastQuestionOf(messages)?.text, 'and a linker')
})

test('a conversation with no question yet has none to repeat', () => {
  assert.equal(lastQuestionOf([]), undefined)
  assert.equal(lastQuestionOf([answer('an opening line')]), undefined)
})

// ── when the control is offered ─────────────────────────────────────────────

test('offered once an answer has arrived', () => {
  assert.equal(canAskAgain({ messages: [user('why'), answer('because')], pending: false }), true)
})

test('NEVER while a turn is still streaming', () => {
  /*
   * A second turn fired into a running one is the exact defect the Stop control
   * exists to prevent. This would be another door into it.
   */
  assert.equal(canAskAgain({ messages: [user('why'), answer('bec')], pending: true }), false)
})

test('not while the question is still the newest thing on screen', () => {
  // The first attempt has not finished; "try again" would be about nothing.
  assert.equal(canAskAgain({ messages: [user('why')], pending: false }), false)
})

test('not on an empty conversation', () => {
  assert.equal(canAskAgain({ messages: [], pending: false }), false)
})

test('not when the question carries no text to repeat', () => {
  // An image-only turn has nothing for this control to send.
  const messages = [user('', { images: ['img_' + 'a'.repeat(32)] }), answer('a photo of a cat')]
  assert.equal(canAskAgain({ messages, pending: false }), false)
})

test('whitespace is not a question', () => {
  assert.equal(canAskAgain({ messages: [user('   '), answer('…')], pending: false }), false)
})

// ── what a repeat carries ───────────────────────────────────────────────────

test('🚨 THE SAME QUESTION MEANS THE SAME EVIDENCE', () => {
  /*
   * A retry that silently dropped the attached document would ask a DIFFERENT
   * question and then present the difference as the model's second opinion.
   */
  const question = user('summarise this', {
    files: ['contract.pdf'],
    images: ['img_' + 'b'.repeat(32)],
  })
  assert.deepEqual(askAgainOptions(question, 'forge'), {
    attachments: ['contract.pdf'],
    images: ['img_' + 'b'.repeat(32)],
    modelFamily: 'forge',
  })
})

test('a plain question carries nothing it did not have', () => {
  // Empty keys would be sent to the server as claims about attachments.
  assert.deepEqual(askAgainOptions(user('hello'), undefined), {})
})

test('the chosen family rides along, so a repeat is not silently rerouted', () => {
  assert.deepEqual(askAgainOptions(user('hello'), 'core'), { modelFamily: 'core' })
})

test('the options are copies — a repeat cannot mutate the transcript', () => {
  const question = user('summarise this', { files: ['contract.pdf'] })
  const options = askAgainOptions(question, undefined)
  options.attachments?.push('smuggled.pdf')
  assert.deepEqual(question.files, ['contract.pdf'])
})

// ── the labels, which are the honesty ───────────────────────────────────────

const src = (rel: string): string => {
  const raw = readFileSync(join(process.cwd(), 'src', ...rel.split('/')), 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
const message = src('components/chat/Message.tsx')
const chatPage = src('screens/ChatPage.tsx')
const composer = src('components/chat/Composer.tsx')

test('🚨 NOTHING CLAIMS TO REPLACE AN ANSWER', () => {
  /*
   * "Regenerate" says the answer you are looking at is about to be replaced.
   * Append-only storage cannot do that, and the reload would expose it.
   */
  assert.doesNotMatch(message, /Regenerate/i)
  assert.match(message, /<span>Try again<\/span>/)
})

test('and nothing claims to edit a question that has already been asked', () => {
  // A bare "Edit" says the original is about to change. It does not.
  assert.match(message, /Edit and ask again/)
  assert.doesNotMatch(message, /aria-label="Edit message"/)
})

test('the repeat is offered on the LAST message only', () => {
  assert.match(chatPage, /index === messages\.length - 1 && offerAskAgain/)
})

test('an exhausted visitor gets a reason, not a control that silently fails', () => {
  assert.match(chatPage, /retryDisabledReason: 'You have used all your free messages/)
  assert.match(message, /disabled=\{Boolean\(retryDisabledReason\)\}/)
})

test('the repeat is refused in the handler too, not only in the rendering', () => {
  // A disabled button is a convenience; the guard is what actually holds.
  assert.match(chatPage, /if \(!question \|\| outOfTurns\) return/)
})

test('🚨 loading a question back is keyed on a TOKEN, not on the text', () => {
  /*
   * Asking the same question twice is ordinary. A bare string would look
   * unchanged to React the second time and the composer would quietly do
   * nothing — a control that works once and then appears broken.
   */
  assert.match(chatPage, /setDraft\(\{ text, token: Date\.now\(\) \}\)/)
  assert.match(composer, /\}, \[draft\?\.token\]\)/)
})

test('loading a question REPLACES the composer rather than appending to it', () => {
  // Appending would merge two questions into one nobody asked.
  const effect = composer.slice(composer.indexOf('if (!draft) return'))
  assert.match(effect.slice(0, 200), /setValue\(draft\.text\)/)
  assert.doesNotMatch(effect.slice(0, 200), /setValue\(\(current\)/)
})

// ── a stopped answer is still an answer ─────────────────────────────────────

test('Try again is offered on a STOPPED answer', () => {
  /*
   * A stopped response is an assistant turn that happens to be incomplete, and
   * wanting another attempt at it is the most ordinary reason to press the
   * control at all. Withholding it would leave the reader with an unfinished
   * answer and no way forward except retyping their own question.
   *
   * 🚨 AND THE APPEND-ONLY STORE IS WHAT MAKES THIS SAFE. Retry here sends the
   * same question again and APPENDS the result; it cannot mutate, overwrite or
   * hide the stopped turn, because no operation to do so exists. The stopped
   * record keeps its text and its status, and the new answer is its own turn.
   */
  const messages: Message[] = [
    { id: 'u1', role: 'user', text: 'explain containerisation', time: '', delivered: true },
    { id: 'a1', role: 'assistant', text: 'Malcom McLean began', time: '', stopped: true },
  ]
  assert.equal(canAskAgain({ messages, pending: false }), true)
  assert.equal(lastQuestionOf(messages)?.text, 'explain containerisation',
    'the retry must repeat the question above the stopped answer')
})

test('Try again is NOT offered while the stopped turn is still streaming', () => {
  // `pending` is the guard that stops a second turn entering a running one.
  const messages: Message[] = [
    { id: 'u1', role: 'user', text: 'explain containerisation', time: '', delivered: true },
    { id: 'a1', role: 'assistant', text: 'Malcom McLean began', time: '', stopped: true },
  ]
  assert.equal(canAskAgain({ messages, pending: true }), false)
})
