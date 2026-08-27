/**
 * "Regenerate it" must do the work or refuse — never describe the picture again.
 *
 * Both halves of the shipped defect are pinned here: the turn was classified as
 * a question about the attached image, so the model described it to someone who
 * had asked for a new one, which is neither doing the work nor declining it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { wantsRegeneration } from './regenerate'

test('the phrasings people actually use are recognised', () => {
  for (const q of [
    'regenerate it', 'can you regenerate it?', 'make it again', 'remake it',
    'redo this', 'same one', 'do it again', 'generate that again',
    'make something similar', 'try again', 'another version',
  ]) {
    assert.equal(wantsRegeneration(q), true, `should ask for regeneration: ${q}`)
  }
})

test('questions and edits are NOT regeneration', () => {
  // These must keep their existing routes: understanding and transform. Treating
  // a question as a regeneration would replace an answer with a picture.
  for (const q of [
    'what is in this image?', 'describe the picture', 'how many people are there?',
    'remove the person on the left', 'make it brighter', 'crop it',
    'generate an image of a blue car',
  ]) {
    assert.equal(wantsRegeneration(q), false, `should not be regeneration: ${q}`)
  }
})

test('an empty prompt asks for nothing', () => {
  assert.equal(wantsRegeneration('   '), false)
})
