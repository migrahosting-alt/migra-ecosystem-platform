/**
 * A LOGOUT MUST SAY WHICH LOGOUT IT WAS.
 *
 * 🚨 MY OWN DEFECT, measured on staging 2026-09-27. The trace was written to end
 * the silence around sessions ending, and it logged `session_absent` with
 * `cookie_present_but_no_session` for a session that had simply EXPIRED. Two
 * problems, both mine:
 *
 *  - `session_expired`, the event written for exactly this, never fires in
 *    production: `@migrateck/auth-client` returns null for a session past
 *    `expiresAt`, so it is already null before `isLive` can measure it; and
 *  - `cookie_present_but_no_session` lumps an EXPIRED session together with a
 *    REJECTED one, and those have opposite causes — the TTL doing its job versus
 *    a rotated `APP_SESSION_SECRET` or a tampered cookie, the second of which
 *    invalidates every user at once and is worth alerting on.
 *
 * The cookie is `base64url(JSON).hmac` — signed, not encrypted — so the payload's
 * timestamps are readable without the secret and the cases can be separated.
 *
 * 🚨 AND THE PAYLOAD IS UNTRUSTED. Its signature is deliberately NOT checked
 * here, which means anything in it is attacker-controlled. The tests below pin
 * that only DURATIONS ever reach a log: the one thing worse than an
 * undiagnosable logout is a log that faithfully repeats whatever a forged cookie
 * put in it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.APP_SESSION_SECRET ??= 'test-secret-not-used-by-these-tests'
process.env.MIGRAAUTH_CLIENT_ID ??= 'test-client'
process.env.MIGRAAUTH_REDIRECT_URI ??= 'http://127.0.0.1:3000/api/auth/callback'
process.env.APP_BASE_URL ??= 'http://127.0.0.1:3000'
process.env.MIGRAAUTH_BASE_URL ??= 'http://127.0.0.1:4000'

const { setAuthPort, getSession } = await import('./index')
import type { AuthPort } from './authPort'

/** A cookie body exactly as the auth client seals it, minus a valid signature. */
function cookie(payload: Record<string, unknown>, signature = 'not-a-valid-signature'): string {
  return `${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.${signature}`
}

test('🚨 the payload is decoded for DIAGNOSIS and never returned as a session', async () => {
  /*
   * The signature is not verified, so a forged cookie must not become a session.
   * `getSession` has to return null no matter how well-formed the payload looks.
   */
  const forged = cookie({
    sessionId: 'forged', authUserId: 'attacker', email: 'attacker@example.test',
    permissions: ['admin'], createdAt: Date.now(), expiresAt: Date.now() + 3_600_000,
  })
  void forged
  setAuthPort({
    getSession: async () => null,
    buildLoginRedirect: async () => 'x',
    buildSignupRedirect: async () => 'x',
    buildLogoutRedirect: () => 'x',
    handleCallback: async () => {},
    clearSession: async () => {},
  } as AuthPort)

  assert.equal(await getSession(), null, 'an unverified payload became a session')
})

// ─────────────────────────────────────────────────────────────────────────────
// The classification itself, exercised directly. `getSession` needs a Next
// request scope that a unit test does not have, and the branch under test is the
// pure function inside it.
// ─────────────────────────────────────────────────────────────────────────────

const { cookieDiagnosisForTest } = await import('./index')

test('🚨 an EXPIRED session is named as expired, with how long it lived', () => {
  const created = Date.now() - 12 * 60 * 60 * 1000
  const expired = Date.now() - 90 * 1000
  const d = cookieDiagnosisForTest(cookie({ createdAt: created, expiresAt: expired }))

  assert.equal(d.reason, 'session_expired_before_read',
    'an ordinary expiry is still indistinguishable from a rejection')
  assert.ok((d.livedSeconds ?? 0) > 43_000, `livedSeconds=${d.livedSeconds} cannot show whether the TTL is right`)
  assert.ok((d.remainingSeconds ?? 0) < 0, 'an expired session reported time remaining')
});

test('🚨 a REJECTED but unexpired session is named differently — it is the alertable one', () => {
  // A rotated APP_SESSION_SECRET invalidates every user at once. An expiry does
  // not. Reporting both the same way is what made the staging logout unreadable.
  const d = cookieDiagnosisForTest(cookie({ createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 }))
  assert.equal(d.reason, 'signature_rejected_while_unexpired')
  assert.ok((d.remainingSeconds ?? 0) > 0)
});

test('🚨 nothing from the untrusted payload reaches the log but durations', () => {
  /*
   * The payload is attacker-controlled. This asserts on the SERIALISED
   * diagnosis, so a field added later without thinking is caught here rather
   * than in a log that has already shipped an address.
   */
  const d = cookieDiagnosisForTest(cookie({
    createdAt: Date.now() - 1000, expiresAt: Date.now() - 1,
    email: 'victim@example.test', authUserId: 'user-42', sessionId: 'sess-abc',
    permissions: ['admin'], note: '<script>alert(1)</script>',
  }))
  const serialised = JSON.stringify(d)

  for (const leak of ['victim@example.test', 'user-42', 'sess-abc', 'admin', 'script']) {
    assert.ok(!serialised.includes(leak), `the diagnosis carried "${leak}" out of an unsigned payload`)
  }
  assert.deepEqual(
    Object.keys(d).sort(),
    ['livedSeconds', 'reason', 'remainingSeconds'],
    `unexpected fields in the diagnosis: ${serialised}`,
  )
});

test('malformed cookies are classified, never thrown on', () => {
  // This runs on a path that is already failing. A diagnostic that can break the
  // request it describes is worse than no diagnostic.
  for (const [raw, expected] of [
    ['', 'cookie_malformed_no_payload'],
    ['%%%not-base64%%%.sig', 'cookie_unreadable'],
    [`${Buffer.from('not json', 'utf8').toString('base64url')}.sig`, 'cookie_unreadable'],
    [`${Buffer.from('"a string"', 'utf8').toString('base64url')}.sig`, 'cookie_payload_not_an_object'],
    [cookie({ createdAt: 1 }), 'cookie_payload_has_no_expiry'],
  ] as const) {
    assert.equal(cookieDiagnosisForTest(raw).reason, expected, `misclassified: ${JSON.stringify(raw)}`)
  }
});
