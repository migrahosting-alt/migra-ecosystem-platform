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

test('the reason distinguishes a check in flight from a check that failed', () => {
  /*
   * THE PRODUCTION SYMPTOM. `GET /api/images` was 500ing because the image
   * directory was read-only under `ProtectSystem=strict`, the probe left the
   * state null, and the control sat greyed out saying "Checking whether images
   * can be read…" — a spinner that never finishes — while the Brain reported
   * vision.general qualified and live.
   *
   * Failing closed is right. Describing the failure as an unfinished check is not.
   */
  assert.match(visionDisabledReason(null), /checking/i)
  const failed: VisionCapability = {
    state: 'unknown', model: null, installed: 0,
    message: 'We could not check whether images can be read right now.',
    digest: null, objectCounting: { qualified: false, model: null },
  }
  assert.doesNotMatch(visionDisabledReason(failed), /checking/i)
  assert.match(visionDisabledReason(failed), /could not check/i)
})

test('a qualified capability enables the control', () => {
  // The mapping the whole trace was about: governed qualified -> ready -> enabled.
  assert.equal(ready.state, 'ready')
  assert.equal(visionDisabledReason(ready), '', 'an enabled control needs no excuse')
})
