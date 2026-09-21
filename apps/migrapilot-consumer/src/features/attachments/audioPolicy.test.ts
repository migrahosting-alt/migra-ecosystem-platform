// mp-0010 — audio is recognised by name and refused for a named reason.
// © MigraTeck LLC.
//
// 🚨 A SPECIFIC REFUSAL IS NOT SUPPORT. Audio was absent from the policy table
// entirely, so attaching an .mp3 produced the generic "cannot read this format"
// — true, and useless. That reads as "this will never work", when the real
// answer is "the thing that would read it is not running yet". Those lead a
// person to opposite actions: one gives up, the other asks when.
//
// These tests exist to hold BOTH halves: the message must be specific, and the
// capability must stay refused. A future change that makes audio attachable
// without a Speech Runtime behind it has to fail here.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canAttach, canIndex, canAnalyzeStructurally, canUseForVision, refusalFor } from './capability'

const AUDIO = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'wma', 'aiff', 'amr'] as const

test('🚨 audio stays UNSUPPORTED — this slice is honesty, not capability', () => {
  for (const ext of AUDIO) {
    assert.equal(canAttach(ext), false, `${ext} became attachable without a runtime`)
    assert.equal(canIndex(ext), false, ext)
    assert.equal(canAnalyzeStructurally(ext), false, ext)
    assert.equal(canUseForVision(ext), false, ext)
  }
})

test('the refusal names AUDIO and names the missing dependency', () => {
  /*
   * The whole point of the slice. "Cannot read this format" tells a person the
   * file is wrong; "transcription is not configured" tells them the product is
   * incomplete, which is the truth and the actionable one.
   */
  const message = refusalFor('interview.mp3')
  assert.match(message, /audio/i, 'the refusal does not say it recognised audio')
  assert.match(message, /transcription is not configured/i, 'the refusal does not name what is missing')
})

test('every audio format gets the SAME specific refusal, not a generic one', () => {
  const generic = refusalFor('mystery.xyz')
  for (const ext of AUDIO) {
    const message = refusalFor(`clip.${ext}`)
    assert.notEqual(message, generic, `.${ext} fell through to the generic refusal`)
    assert.match(message, /transcription is not configured/i, `.${ext} lost the specific reason`)
  }
})

test('a transcript the user already has IS accepted', () => {
  // The refusal suggests attaching a transcript, so that suggestion must work.
  assert.equal(canAttach('txt'), true)
  assert.equal(canIndex('txt'), true)
})
