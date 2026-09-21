// mp-0011 — the Speech Runtime boundary. © MigraTeck LLC.
//
// 🚨 THESE TESTS GUARD A BOUNDARY, NOT A FEATURE. No runtime exists yet. What
// must not happen is the two workflows collapsing into one flag, or Chat being
// able to claim audio works because something somewhere returned a truthy value.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  NO_SPEECH_RUNTIME,
  speechWorkflowAvailable,
  type SpeechRuntimeCapability,
} from './speechRuntime.js'

test('🚨 today, nothing is claimed for either workflow', () => {
  // The honest default. A product that says "audio works" because a type exists
  // is the capability lie this whole contract is written against.
  assert.equal(NO_SPEECH_RUNTIME.state, 'not_configured')
  assert.equal(speechWorkflowAvailable(NO_SPEECH_RUNTIME, 'microphone'), false)
  assert.equal(speechWorkflowAvailable(NO_SPEECH_RUNTIME, 'attachment'), false)
})

test('a runtime that serves ONE workflow does not get credit for the other', () => {
  /*
   * The load-bearing separation. A runtime that transcribes uploaded files is
   * not automatically one that should serve a live microphone — latency,
   * streaming and durability are different problems. One flag for both is how a
   * product promises what it cannot do.
   */
  const attachmentsOnly: SpeechRuntimeCapability = {
    state: 'ready',
    workflows: ['attachment'],
    identity: { runtime: 'speech-a', runtimeVersion: '1.0.0', model: 'some-model' },
  }
  assert.equal(speechWorkflowAvailable(attachmentsOnly, 'attachment'), true)
  assert.equal(speechWorkflowAvailable(attachmentsOnly, 'microphone'), false,
    'an attachment-only runtime claimed the microphone')
})

test('a runtime listed as ready but serving nothing claims nothing', () => {
  const empty: SpeechRuntimeCapability = { state: 'ready', workflows: [] }
  assert.equal(speechWorkflowAvailable(empty, 'attachment'), false)
  assert.equal(speechWorkflowAvailable(empty, 'microphone'), false)
})

test('a not_configured runtime claims nothing even if workflows are listed', () => {
  /*
   * Defence against a half-written capability record: `state` is the authority.
   * A row that lists workflows while saying it is not configured must not be
   * read as partial availability.
   */
  const contradictory: SpeechRuntimeCapability = {
    state: 'not_configured',
    workflows: ['microphone', 'attachment'],
  }
  assert.equal(speechWorkflowAvailable(contradictory, 'microphone'), false)
  assert.equal(speechWorkflowAvailable(contradictory, 'attachment'), false)
})
