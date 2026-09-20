// mp-0008 — a stop is a decision; an abort is not. © MigraTeck LLC.
//
// 🚨 MEASURED ON STAGING. A mid-stream RELOAD persisted `status: 'stopped'`,
// and the transcript then told the user they had deliberately stopped an answer
// they never stopped. Stop, reload, tab close and a dropped network all abort
// the request identically, so reading `aborted` as intent was a guess presented
// as a fact about a person.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  declareStop,
  consumeStopDeclaration,
  awaitStopDeclaration,
  resetStopDeclarations,
} from './stopIntent'

const OWNER = 'user:alice'

test('an undeclared abort is NOT a stop', () => {
  // The reload case. Nothing declared, so nothing may be claimed.
  resetStopDeclarations()
  assert.equal(consumeStopDeclaration('req-1', OWNER), false)
})

test('a declared stop is a stop', () => {
  resetStopDeclarations()
  declareStop('req-1', OWNER)
  assert.equal(consumeStopDeclaration('req-1', OWNER), true)
})

test('🚨 one caller cannot relabel another caller’s turn', () => {
  // The declaration is scoped, so a forged call cannot reach across principals.
  resetStopDeclarations()
  declareStop('req-1', OWNER)
  assert.equal(consumeStopDeclaration('req-1', 'user:mallory'), false, 'a foreign caller consumed it')
  assert.equal(consumeStopDeclaration('req-1', OWNER), true, 'and the real owner lost theirs')
})

test('a declaration is consumed once, not reusable', () => {
  /*
   * A request id names ONE turn. Leaving the declaration behind would let a
   * later interruption inherit an intent that was never expressed for it.
   */
  resetStopDeclarations()
  declareStop('req-1', OWNER)
  assert.equal(consumeStopDeclaration('req-1', OWNER), true)
  assert.equal(consumeStopDeclaration('req-1', OWNER), false, 'the declaration was reusable')
})

test('a stale declaration expires rather than lingering', () => {
  resetStopDeclarations()
  const t0 = 1_000_000
  declareStop('req-1', OWNER, t0)
  assert.equal(consumeStopDeclaration('req-1', OWNER, t0 + 61_000), false, 'an expired intent was honoured')
})

test('the wait resolves as soon as a racing declaration lands', async () => {
  /*
   * The declaration and the abort race across the network. The loser would be
   * recorded as an interruption the user would recognise as their own Stop, so
   * the route waits briefly — and only on a turn already aborted with text.
   */
  resetStopDeclarations()
  setTimeout(() => declareStop('req-2', OWNER), 30)
  assert.equal(await awaitStopDeclaration('req-2', OWNER, { timeoutMs: 500, stepMs: 10 }), true)
})

test('the wait gives up, so a disconnect is never held open', async () => {
  resetStopDeclarations()
  const started = Date.now()
  assert.equal(await awaitStopDeclaration('req-3', OWNER, { timeoutMs: 60, stepMs: 10 }), false)
  assert.ok(Date.now() - started < 1000, 'the wait outlived its own timeout')
})
