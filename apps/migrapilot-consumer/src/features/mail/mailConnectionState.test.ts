/**
 * What the account screen may claim about a mailbox.
 *
 * The distinction under test is one a UI erases by default: "could not check"
 * and "not connected" look identical and mean opposite things. Rendering an
 * unreachable server as "not connected" shows a Connect button to someone whose
 * mailbox IS connected, and walks them through a consent screen to re-grant
 * access they already gave.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { mailCardState, offersConnect, offersDisconnect } from './mailConnectionState'

/* ------------------------------------------------------------------ *
 * 🚨 Unreachable is never an answer about the connection
 * ------------------------------------------------------------------ */

test('🚨 a 503 is UNKNOWN, not "not connected"', () => {
  const state = mailCardState(503, { error: 'brain_unavailable' })
  assert.equal(state.kind, 'unknown')
  assert.notEqual(state.kind, 'not_connected')
})

test('🚨 a 200 with an UNRECOGNISED state is unknown, not an invitation to connect', () => {
  /*
   * A newer engine reporting a state this build has not learned must not render
   * as "connect your account" to someone who already has.
   */
  const state = mailCardState(200, { state: 'quantum_entangled' })
  assert.equal(state.kind, 'unknown')
})

test('a missing body is unknown', () => {
  assert.equal(mailCardState(200, null).kind, 'unknown')
})

test('signed out is its own state, with its own remedy', () => {
  const state = mailCardState(401, { reason: 'Sign in to connect your email.' })
  assert.equal(state.kind, 'signed_out')
  // Not "not connected": nothing can be said about an account we cannot identify.
  assert.notEqual(state.kind, 'not_connected')
})

/* ------------------------------------------------------------------ *
 * The real states
 * ------------------------------------------------------------------ */

test('connected reports the address for display', () => {
  const state = mailCardState(200, {
    state: 'connected', account: 'alice@example.com', scopes: { read: true },
  })
  assert.deepEqual(state, { kind: 'connected', account: 'alice@example.com', canRead: true })
})

test('🚨 connected WITHOUT read permission is still connected, and says so', () => {
  // Hiding the distinction would promise search that is refused at dispatch.
  const state = mailCardState(200, { state: 'connected', account: 'a@b.test', scopes: { read: false } })
  assert.equal(state.kind, 'connected')
  if (state.kind === 'connected') assert.equal(state.canRead, false)
})

test('an expired grant is distinct from never having connected', () => {
  const expired = mailCardState(200, { state: 'authorization_expired', reason: 'needs reconnecting' })
  const never = mailCardState(200, { state: 'not_connected' })
  assert.notEqual(expired.kind, never.kind)
})

test('not_configured is an operator state, distinct from not_connected', () => {
  assert.equal(mailCardState(200, { state: 'not_configured' }).kind, 'not_configured')
})

/* ------------------------------------------------------------------ *
 * 🚨 Which controls appear
 * ------------------------------------------------------------------ */

test('connect is offered only where connecting helps', () => {
  assert.equal(offersConnect({ kind: 'not_connected' }), true)
  assert.equal(offersConnect({ kind: 'expired', reason: 'x' }), true)

  // Nothing the user does fixes these, so no control.
  assert.equal(offersConnect({ kind: 'not_configured', reason: 'x' }), false)
  assert.equal(offersConnect({ kind: 'provider_unavailable', reason: 'x' }), false)
  assert.equal(offersConnect({ kind: 'unknown', reason: 'x' }), false,
    'a Connect button was offered while the connection state was unknown')
  assert.equal(offersConnect({ kind: 'checking' }), false)
  assert.equal(offersConnect({ kind: 'connected', account: 'a', canRead: true }), false)
})

test('🚨 disconnect is offered for an EXPIRED grant too', () => {
  /*
   * The row still exists and we still hold a refresh token. Hiding the control
   * there strands a dead connection with no way to clear it.
   */
  assert.equal(offersDisconnect({ kind: 'expired', reason: 'x' }), true)
  assert.equal(offersDisconnect({ kind: 'connected', account: 'a', canRead: true }), true)
  assert.equal(offersDisconnect({ kind: 'provider_unavailable', reason: 'x' }), true)
})

test('🚨 disconnect is NOT offered when there is nothing to disconnect', () => {
  // Or when we do not know — pressing it would act on a guess.
  assert.equal(offersDisconnect({ kind: 'not_connected' }), false)
  assert.equal(offersDisconnect({ kind: 'unknown', reason: 'x' }), false)
  assert.equal(offersDisconnect({ kind: 'checking' }), false)
  assert.equal(offersDisconnect({ kind: 'signed_out', reason: 'x' }), false)
  assert.equal(offersDisconnect({ kind: 'not_configured', reason: 'x' }), false)
})

test('🚨 both controls appear together ONLY for an expired grant', () => {
  /*
   * 🚨 THIS TEST FIRST ASSERTED THEY NEVER COEXIST, AND THAT WAS WRONG.
   *
   * For an expired grant both actions are genuinely available: reconnect to
   * restore access, or disconnect to give up and remove it. Neither is
   * "guaranteed to be wrong", so forbidding the pair would have removed a real
   * choice — the premise was mine, not the code's.
   *
   * Everywhere else the pair IS a contradiction: a card offering both while it
   * does not know what it is looking at has one button that must be wrong.
   */
  const states = [
    { kind: 'checking' },
    { kind: 'not_configured', reason: 'x' },
    { kind: 'unknown', reason: 'x' },
    { kind: 'signed_out', reason: 'x' },
    { kind: 'not_connected' },
    { kind: 'connected', account: 'a', canRead: true },
    { kind: 'expired', reason: 'x' },
    { kind: 'provider_unavailable', reason: 'x' },
  ] as const
  for (const state of states) {
    const both = offersConnect(state) && offersDisconnect(state)
    if (state.kind === 'expired') {
      assert.ok(both, 'an expired grant must offer BOTH reconnecting and removing')
      continue
    }
    assert.ok(!both, `${state.kind} offered both Connect and Disconnect`)
  }
})

test('no message names a provider or an OAuth concept', () => {
  const states = [
    mailCardState(503, {}),
    mailCardState(200, { state: 'quantum' }),
    mailCardState(401, {}),
  ]
  for (const state of states) {
    const reason = 'reason' in state ? state.reason : ''
    assert.ok(!/google|gmail|oauth|token|scope/i.test(reason), `machinery leaked: ${reason}`)
  }
})
