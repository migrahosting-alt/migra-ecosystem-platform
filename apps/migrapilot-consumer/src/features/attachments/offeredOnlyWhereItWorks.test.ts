/**
 * A control is offered where it works, or it says why not — in the user's words.
 *
 * 🚨 THE SAME DEFECT, FOUND A THIRD AND FOURTH TIME. The operation audience table
 * is closed by default, so a capability nobody listed is refused — and the
 * surfaces above it kept rendering as though it were available:
 *
 *   · Listen was live on every answer for signed-out visitors and blamed the
 *     voice service for a decision about accounts. (fixed 2026-09-04)
 *   · "Files & documents" in the composer's action menu was live for the same
 *     visitors: choosing a file produced `POST /api/files -> 401`, a chip reading
 *     "Sign in to manage files", and a Retry that could never succeed — one row
 *     below "Photos & images", which was already gated.
 *   · The microphone tooltip showed users a raw internal string:
 *     `'transcriptionCapability' is not available without an account.`
 *
 * The detail on a principal refusal names the operation ON PURPOSE, for whoever
 * has to find it in a log. It is not a sentence to put in front of a person.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { micAvailability, refusedForWantOfAnAccount } from '@/server/brain/view'
import { documentDisabledReason } from './useDocumentAvailability'

// ── the microphone, which was leaking an operation name ─────────────────────

const refusal = {
  kind: 'forbidden_for_principal' as const,
  detail: "'transcriptionCapability' is not available without an account. Sign in to use it.",
}

test('🚨 an internal operation name never reaches the user', () => {
  const availability = micAvailability(refusal)
  assert.equal(availability.state, 'disabled')
  assert.ok('reason' in availability && availability.reason)
  const reason = 'reason' in availability ? availability.reason : ''
  assert.doesNotMatch(reason, /transcriptionCapability/, 'that identifier is for the logs')
  assert.doesNotMatch(reason, /operation/i)
})

test('and what replaces it tells the reader what to do', () => {
  const availability = micAvailability(refusal)
  assert.equal('cause' in availability ? availability.cause : '', 'signed_out')
  assert.match('reason' in availability ? availability.reason : '', /^Sign in to use voice input\.$/)
})

test('the developer detail is still recognisable at the boundary', () => {
  // The mapping is deliberate, not a blanket swallow: the kind is what surfaces
  // branch on, so the reason a control is off stays derivable in code.
  assert.equal(refusedForWantOfAnAccount(refusal), true)
  assert.equal(refusedForWantOfAnAccount({ kind: 'timeout' }), false)
  assert.equal(refusedForWantOfAnAccount({ kind: 'ok' }), false)
})

test('a genuine outage is still described as an outage, not as a sign-in problem', () => {
  const availability = micAvailability({ kind: 'transport_failure', detail: 'connect ECONNREFUSED' })
  const reason = 'reason' in availability ? availability.reason : ''
  assert.doesNotMatch(reason, /sign in/i)
})

// ── the documents action, which was a dead control ──────────────────────────

test('documents unavailable states the actionable reason', () => {
  assert.equal(documentDisabledReason({ ready: false, reason: 'Sign in to attach documents.' }),
    'Sign in to attach documents.')
})

test('an unanswered probe reads as CHECKING, not as unavailable', () => {
  // The two resolve differently: one on its own, one only if the user acts.
  assert.match(documentDisabledReason(null), /checking/i)
})

test('and an available capability needs no excuse', () => {
  assert.equal(documentDisabledReason({ ready: true, reason: '' }), '')
})

// ── the wiring, which is what actually removed the dead control ─────────────

const src = (rel: string): string => {
  const raw = readFileSync(join(process.cwd(), 'src', ...rel.split('/')), 'utf8')
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
const composer = src('components/chat/Composer.tsx')
const hook = src('features/attachments/useDocumentAvailability.ts')

test('🚨 BOTH ROWS OF THE ACTION MENU ARE GATED, not just the one that was noticed', () => {
  const hub = composer.slice(composer.indexOf('const hubActions'), composer.indexOf('const active ='))
  const gates = [...hub.matchAll(/unavailableReason:/g)]
  assert.equal(gates.length, 2, 'photos AND files — a menu is only as honest as its least-gated row')
  assert.match(hub, /id: 'image'[\s\S]*?unavailableReason: visionReason/)
  assert.match(hub, /id: 'file'[\s\S]*?unavailableReason: documentsReason/)
})

test('the gate is a real probe of the real route, not a guess about sign-in state', () => {
  assert.match(hook, /fetch\('\/api\/files'/)
  assert.match(hook, /response\.status === 401/, 'a 401 is the answer, not a failed probe')
})

test('a probe that FAILS is not a probe still running', () => {
  /*
   * Leaving the state null on failure renders "Checking…" forever — the exact
   * mistake the vision hook carries a comment about.
   */
  const failure = hook.slice(hook.indexOf('.catch('))
  assert.match(failure.slice(0, 400), /setAvailability\(\{ ready: false/)
})
