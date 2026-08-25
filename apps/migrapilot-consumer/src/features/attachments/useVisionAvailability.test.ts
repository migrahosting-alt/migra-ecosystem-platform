/**
 * The image control must reflect a governed decision, not an assumption.
 *
 * These are about the two ways a UI can lie: offering a capability that has not
 * been approved, and offering `ready` as if it covered every visual question.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { visionDisabledReason, visionCaveat } from './useVisionAvailability'
import type { VisionCapability } from '@/server/files/visionCapability'

const ready: VisionCapability = {
  state: 'ready',
  model: 'qwen2.5vl:7b',
  installed: 4,
  message: 'Images can be read in a conversation.',
  digest: 'sha256:5ced39df',
  objectCounting: { qualified: false, model: null },
}

test('an unanswered probe leaves the control disabled, not open', () => {
  /*
   * Defaulting to enabled while the answer is in flight would offer a capability
   * that may not exist — the over-claim the governance exists to prevent,
   * reproduced in the UI.
   */
  assert.notEqual(visionDisabledReason(null), '', 'null must produce a reason, which keeps it off')
})

test('a ready capability needs no excuse', () => {
  assert.equal(visionDisabledReason(ready), '')
})

test('an unqualified model explains itself in the server’s words', () => {
  const blocked: VisionCapability = {
    ...ready, state: 'no_qualified_model', model: null, digest: null,
    message: 'Your image is saved. Reading images in a conversation is not enabled yet — no vision model has been approved for use.',
  }
  assert.equal(visionDisabledReason(blocked), blocked.message)
})

test('an unreachable Brain is reported as unknown, never as unavailable', () => {
  const unknown: VisionCapability = { ...ready, state: 'unknown', model: null, digest: null }
  assert.match(visionDisabledReason(unknown), /could not check/i)
})

test('ready does NOT imply counting, and the UI says so before it is asked', () => {
  /*
   * The model reads an invoice perfectly and miscounts what is on it, every run,
   * with no hedge. A UI treating `ready` as permission to promise "count these"
   * offers the one operation the qualification explicitly excluded.
   */
  const caveat = visionCaveat(ready)
  assert.ok(caveat)
  assert.match(caveat, /cannot give you an exact count/i)
})

test('the caveat disappears once counting is actually qualified', () => {
  assert.equal(visionCaveat({ ...ready, objectCounting: { qualified: true, model: 'detector:v1' } }), null)
})

test('no caveat is offered when vision is not usable at all', () => {
  // Warning about counting on a control nobody can use is noise.
  assert.equal(visionCaveat({ ...ready, state: 'no_qualified_model' }), null)
  assert.equal(visionCaveat(null), null)
})
