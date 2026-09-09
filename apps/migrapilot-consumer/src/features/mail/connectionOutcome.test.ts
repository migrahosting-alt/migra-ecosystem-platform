/**
 * What the browser is told after a consent round-trip.
 *
 * The outcome arrives as a token in a query string — which is logged by
 * proxies, kept in history and forwarded in a Referer header. So it carries no
 * provider vocabulary and no indication of WHICH check refused a callback.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { mailOutcomeNotice, MAIL_OUTCOME_PARAM } from './connectionOutcome'

test('a successful connection is stated plainly', () => {
  assert.deepEqual(mailOutcomeNotice('connected'), {
    tone: 'success',
    message: 'Your email is connected.',
  })
})

test('a refusal names the remedy, not the cause', () => {
  const notice = mailOutcomeNotice('failed')
  assert.equal(notice?.tone, 'warning')
  assert.match(notice!.message, /try connecting it again/i)
})

test('🚨 every refusal shares ONE sentence', () => {
  /*
   * The Brain answers forged, replayed, expired and principal-mismatched
   * callbacks identically, because telling a forger which check they failed is
   * a probing oracle. Rebuilding that distinction in the browser would undo it
   * — and a query string is the worst possible place to leak from.
   */
  assert.equal(mailOutcomeNotice('failed')?.message, mailOutcomeNotice('failed')?.message)
  const tokens = ['state_replayed', 'principal_mismatch', 'state_expired', 'invalid_grant']
  for (const token of tokens) {
    assert.equal(mailOutcomeNotice(token), null, `${token} was given its own screen`)
  }
})

test('🚨 an UNKNOWN token renders nothing, not a generic error', () => {
  /*
   * `?mail=` is user-editable and shows up in shared links. Turning anything
   * unrecognised into "something went wrong" lets a pasted URL manufacture a
   * failure for a connection that is working perfectly well.
   */
  for (const token of ['', 'banana', 'CONNECTED', 'connected ', undefined, null, 42, {}]) {
    assert.equal(mailOutcomeNotice(token), null, `${String(token)} produced a notice`)
  }
})

test('needing to sign in is a different notice from a failure', () => {
  assert.notEqual(mailOutcomeNotice('signin')?.message, mailOutcomeNotice('failed')?.message)
  assert.match(mailOutcomeNotice('signin')!.message, /sign in/i)
})

test('🚨 no message names a provider or an OAuth concept', () => {
  for (const token of ['connected', 'failed', 'signin']) {
    const message = mailOutcomeNotice(token)!.message
    assert.ok(!/google|gmail|oauth|token|scope|grant|state/i.test(message),
      `machinery leaked into a user-facing message: ${message}`)
  }
})

test('the parameter name is stated once', () => {
  assert.equal(MAIL_OUTCOME_PARAM, 'mail')
})
