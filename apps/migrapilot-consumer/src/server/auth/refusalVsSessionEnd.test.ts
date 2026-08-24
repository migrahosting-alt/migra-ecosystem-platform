/**
 * A 401 means two different things, and they must not be conflated.
 *
 * "Your session is finished" and "that code was wrong" both arrive as 401.
 * Collapsing both into `reauth_required` told someone who mistyped a recovery
 * code to SIGN IN AGAIN — while their session was perfectly valid, so signing in
 * again fixed nothing and returned them to the same screen with the same
 * failure.
 *
 * CAUGHT LIVE, not by a test: a deliberately wrong code answered "Sign in again
 * to replace your recovery codes" with `sessionStillValid: true` in the same
 * breath. The MFA disable flow had the same defect the whole time, since it
 * relays through the same classifier.
 *
 * The discriminator is MigraAuth's own two response shapes, which are already
 * distinct:
 *   guard refusing the request      {"error":"unauthorized"}          (string)
 *   route refusing a CREDENTIAL     {"error":{"code":…,"message":…}}  (object)
 * A 401 carrying a reason is a refusal worth relaying; one without is an ended
 * session.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(process.cwd(), 'src', 'server', 'auth', 'migraAuthApi.ts'), 'utf8')

/** The classifier, isolated from the transport it lives inside. */
function classify(status: number, body: unknown): 'refused' | 'reauth_required' | 'other' {
  if (status === 401 || status === 403) {
    const err = (body as { error?: unknown } | null)?.error
    if (typeof err === 'object' && err !== null && (err as { code?: string }).code) return 'refused'
    return 'reauth_required'
  }
  return 'other'
}

test('a credential refusal is relayed, not turned into "sign in again"', () => {
  for (const code of ['reauthentication_failed', 'invalid_code', 'reauthentication_required']) {
    assert.equal(
      classify(401, { error: { code, message: 'That did not match.' } }),
      'refused',
      `${code} carries a reason and must reach the user`,
    )
  }
})

test('a genuinely ended session still asks for a new sign-in', () => {
  /*
   * The other half. If this ever starts reading as `refused`, a dead session
   * surfaces as an inscrutable error instead of the one instruction that fixes
   * it — the failure this classifier originally existed to prevent.
   */
  assert.equal(classify(401, { error: 'unauthorized', message: 'Authentication required' }), 'reauth_required')
  assert.equal(classify(401, null), 'reauth_required')
  assert.equal(classify(401, {}), 'reauth_required')
  assert.equal(classify(403, { error: 'forbidden' }), 'reauth_required')
})

test('a reason-shaped body with no code is not a refusal', () => {
  // An empty object under `error` says nothing a user could act on.
  assert.equal(classify(401, { error: {} }), 'reauth_required')
  assert.equal(classify(401, { error: { message: 'no code here' } }), 'reauth_required')
})

test('the shipped classifier inspects the body before deciding', () => {
  /*
   * Structural, because the original bug was a single unconditional line. If a
   * refactor restores `return { kind: 'reauth_required' }` as the whole branch,
   * every credential message silently disappears again.
   */
  const at = source.indexOf('if (response.status === 401 || response.status === 403)')
  assert.ok(at > 0, 'the 401 branch must exist')
  const branch = source.slice(at, at + 500)
  assert.match(branch, /await response\.json\(\)/, 'the body must be read before classifying')
  assert.match(branch, /body\.error\.code/, 'a structured reason marks a refusal')
  assert.match(branch, /kind: 'refused'/)
  assert.match(branch, /kind: 'reauth_required'/, 'an ended session must still be reported')
})
