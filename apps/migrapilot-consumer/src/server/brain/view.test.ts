/**
 * Brain result → renderable state.
 *
 * What matters here is not formatting. It is that the five outcomes stay
 * DISTINGUISHABLE all the way to the screen. "The feature is off", "the Brain is
 * unreachable", "your session ended" and "this build disagrees with the Brain's
 * contract" are four different facts, and a mapper that flattens them lets a surface
 * report a comfortable wrong reason — the failure mode that makes readiness claims
 * untrustworthy.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { toBrainView, governedCodingView } from './view'
import type { BrainResult } from './gateway'
import type { GovernedCodingCapability } from './contracts'

const capability = (
  over: Partial<GovernedCodingCapability> = {},
): BrainResult<{ governedCoding: GovernedCodingCapability }> => ({
  kind: 'ok',
  status: 200,
  value: {
    governedCoding: {
      available: true,
      approvalMode: 'scope',
      progressMode: 'polling',
      workspaceRootsConfigured: 1,
      ...over,
    },
  },
})

test('every failure kind keeps its own identity', () => {
  const cases: [BrainResult<unknown>, string][] = [
    [{ kind: 'ok', status: 200, value: 1 }, 'ready'],
    [{ kind: 'unauthenticated', detail: 'no session' }, 'signed_out'],
    [{ kind: 'tenancy_unresolved', detail: 'no org' }, 'unavailable'],
    [{ kind: 'invalid_operation', detail: 'unknown op' }, 'incompatible'],
    [{ kind: 'not_found' }, 'unavailable'],
    [{ kind: 'conflict', status: 409, body: {} }, 'unavailable'],
    [{ kind: 'brain_error', status: 500, body: {} }, 'unavailable'],
    [{ kind: 'timeout', detail: 'slow' }, 'unreachable'],
    [{ kind: 'transport_failure', detail: 'ECONNREFUSED' }, 'unreachable'],
  ]
  for (const [result, expected] of cases) {
    assert.equal(toBrainView(result).state, expected, `${result.kind} must map to ${expected}`)
  }
})

test('a contract mismatch is refused, not degraded into "off"', () => {
  // An invalid operation means the published contract and this build disagree. If it
  // collapsed to `unavailable`, a bad capability update would look like a feature
  // someone switched off, and nobody would go looking for the version skew.
  const view = toBrainView({ kind: 'invalid_operation', detail: 'codingCapability@v2 unknown' })
  assert.equal(view.state, 'incompatible')
  assert.match(view.state === 'incompatible' ? view.reason : '', /codingCapability@v2/)
})

test('never invents a value when the Brain did not supply one', () => {
  for (const result of [
    { kind: 'timeout', detail: 'x' },
    { kind: 'not_found' },
    { kind: 'unauthenticated', detail: 'x' },
  ] as BrainResult<unknown>[]) {
    assert.equal('value' in toBrainView(result), false)
  }
})

test('ready requires BOTH available and a configured workspace root', () => {
  assert.equal(governedCodingView(capability()).state, 'ready')

  // available, but nowhere to act — a capability that cannot run is not readiness.
  const rootless = governedCodingView(capability({ workspaceRootsConfigured: 0 }))
  assert.equal(rootless.state, 'unavailable')
  assert.match(rootless.state === 'unavailable' ? rootless.reason : '', /workspace root/i)
})

test('an unavailable capability reports the Brain\'s own reason, not a guess', () => {
  const view = governedCodingView(capability({ available: false, unavailableReason: 'feature flag off' }))
  assert.equal(view.state, 'unavailable')
  assert.equal(view.state === 'unavailable' ? view.reason : '', 'feature flag off')
})

test('an unavailable capability with no stated reason still says something true', () => {
  const view = governedCodingView(capability({ available: false }))
  assert.equal(view.state, 'unavailable')
  assert.ok((view.state === 'unavailable' ? view.reason : '').length > 0)
})

test('transport failure does not become "unavailable"', () => {
  // The distinction the whole mapper exists for: an unreachable Brain must never be
  // reported as a switched-off feature.
  assert.equal(governedCodingView({ kind: 'transport_failure', detail: 'ECONNREFUSED' }).state, 'unreachable')
})
