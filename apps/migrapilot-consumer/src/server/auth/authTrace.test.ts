// mp-0013 — an auth log that explains a logout without leaking one. © MigraTeck LLC.
//
// 🚨 THE DEFECT WAS THE SILENCE. A live staging session became unauthenticated
// with no auth line, no refresh line and no 401 in the log for the entire
// window. Two hypotheses were disproven from code alone; the third could not be
// tested, because the event leaves no trace and cannot be reproduced on demand.
//
// These tests hold the two properties that make this safe to ship: it must say
// enough to diagnose, and it must be STRUCTURALLY incapable of saying a secret.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { logAuthEvent, secondsBetween } from './authTrace'

/** Capture what reaches the log. */
function captured(run: () => void): string[] {
  const lines: string[] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(' ')) }
  try { run() } finally { console.warn = original }
  return lines
}

test('every event is one greppable structured line', () => {
  const lines = captured(() => logAuthEvent('session_expired', { livedSeconds: 1234.6 }))
  assert.equal(lines.length, 1)
  assert.match(lines[0]!, /^\[auth\] \{/, 'not greppable by a single prefix')
  const payload = JSON.parse(lines[0]!.replace('[auth] ', '')) as Record<string, unknown>
  assert.equal(payload.event, 'session_expired')
  assert.equal(payload.livedSeconds, 1235, 'durations are rounded, not raw floats')
})

test('🚨 a caller CANNOT smuggle a credential through it', () => {
  /*
   * The load-bearing property. The payload is built from NAMED fields, never a
   * spread, so an extra property a caller happened to hold — a token, a cookie,
   * an authorization header — has no path into the line. This is why the
   * function takes durations and booleans rather than an object it forwards.
   */
  const lines = captured(() => {
    logAuthEvent('refresh_failed', {
      status: 401,
      clientSecretConfigured: false,
      // Deliberately hostile: these are not fields of AuthEventFields.
      accessToken: 'SECRET-ACCESS-TOKEN',
      refresh_token: 'SECRET-REFRESH-TOKEN',
      cookie: 'migrapilot_consumer_session=SECRET',
    } as never)
  })
  const line = lines[0]!
  for (const secret of ['SECRET-ACCESS-TOKEN', 'SECRET-REFRESH-TOKEN', 'migrapilot_consumer_session=']) {
    assert.ok(!line.includes(secret), `a credential reached the log: ${secret}`)
  }
  assert.match(line, /"status":401/, 'the diagnosable part was lost')
  assert.match(line, /"clientSecretConfigured":false/, 'the fact that explains a 401 was lost')
})

test('a free-text reason is bounded, so an issuer body cannot flood the log', () => {
  // An issuer error body can echo input. It is capped rather than trusted.
  const lines = captured(() => logAuthEvent('refresh_failed', { reason: 'x'.repeat(500) }))
  const payload = JSON.parse(lines[0]!.replace('[auth] ', '')) as { reason: string }
  assert.ok(payload.reason.length <= 120, 'an unbounded reason reached the log')
})

test('the stages an operator needs are all expressible', () => {
  /*
   * The owner's requirement: distinguish expired -> attempted -> succeeded/failed
   * -> persisted/failed -> reauth required, without exposing credentials.
   */
  const stages = [
    'token_expired', 'refresh_attempted', 'refresh_succeeded',
    'refresh_failed', 'renewal_persist_failed', 'reauth_required',
  ] as const
  const lines = captured(() => { for (const stage of stages) logAuthEvent(stage) })
  assert.equal(lines.length, stages.length)
  for (const stage of stages) {
    assert.ok(lines.some((l) => l.includes(`"event":"${stage}"`)), `${stage} is not expressible`)
  }
})

test('logging never throws, whatever it is handed', () => {
  // A log line must not be the thing that fails a request.
  const circular: Record<string, unknown> = {}
  circular.self = circular
  assert.doesNotThrow(() => logAuthEvent('session_absent', circular as never))
})

test('secondsBetween is signed, so "overdue" is distinguishable from "remaining"', () => {
  assert.equal(secondsBetween(1_000_000, 1_060_000), 60)
  assert.equal(secondsBetween(1_060_000, 1_000_000), -60)
})
