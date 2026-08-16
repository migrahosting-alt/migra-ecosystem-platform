/**
 * Brain scope derivation.
 *
 * These headers decide whose data an answer is grounded in, and the Brain trusts
 * them unconditionally. The property that matters most here is not that the
 * format is right — it is that **two different users can never produce the same
 * workspace**, because the Brain selects a semantic index by workspace alone.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  deriveBrainScope,
  isDerivedOwnerScope,
  TenancyError,
  OWNER_PREFIX,
  ORG_WORKSPACE_PREFIX,
  PERSONAL_WORKSPACE_PREFIX,
} from './ownerScope'
import type { AppSession } from '../auth/authPort'

const session = (over: Partial<AppSession> = {}): AppSession => ({
  sessionId: 's-1',
  authUserId: 'auth-user-AAA',
  email: 'user@example.test',
  permissions: [],
  createdAt: Date.now(),
  expiresAt: Date.now() + 3_600_000,
  ...over,
})

// ── the isolation property ──────────────────────────────────────────────────

test('two org-less users never share a workspace', async () => {
  /*
   * REGRESSION. The workspace used to be the constant `personal` for every user
   * without org context — which is every consumer user today. Conversations
   * survived it because the Brain scopes those by owner AND workspace, but
   * semantic indexes are selected by workspace ALONE (`approvedIndexFor`), so
   * one user's uploaded documents would have been retrieved as grounding
   * evidence for another user's question the moment any index was approved.
   */
  const alpha = deriveBrainScope(session({ authUserId: 'auth-user-ALPHA' }))
  const beta = deriveBrainScope(session({ authUserId: 'auth-user-BETA' }))

  assert.notEqual(alpha.owner, beta.owner)
  assert.notEqual(alpha.workspace, beta.workspace, 'org-less users must not share a workspace')
})

test('the same user is stable across sessions, so their own data is findable', async () => {
  const first = deriveBrainScope(session({ sessionId: 's-1' }))
  const second = deriveBrainScope(session({ sessionId: 's-2' }))
  assert.deepEqual(first, second)
})

test('an org narrows the workspace and never widens it', async () => {
  const personal = deriveBrainScope(session())
  const inOrg = deriveBrainScope(session({ activeOrgId: 'org-111' }))

  assert.equal(inOrg.workspace, `${ORG_WORKSPACE_PREFIX}org-111`)
  assert.notEqual(inOrg.workspace, personal.workspace)
  // Owner stays the user: losing org context degrades to a narrower namespace,
  // never to one shared across users.
  assert.equal(inOrg.owner, personal.owner)
})

test('two users in the same org still have distinct owners', async () => {
  const alpha = deriveBrainScope(session({ authUserId: 'auth-user-ALPHA', activeOrgId: 'org-111' }))
  const beta = deriveBrainScope(session({ authUserId: 'auth-user-BETA', activeOrgId: 'org-111' }))

  assert.equal(alpha.workspace, beta.workspace, 'a shared org is a shared workspace by design')
  assert.notEqual(alpha.owner, beta.owner)
})

test('a personal workspace cannot collide with an org workspace', async () => {
  // Distinct prefixes, so a user id can never be read as an org id.
  const personal = deriveBrainScope(session({ authUserId: 'org-111' }))
  const org = deriveBrainScope(session({ activeOrgId: 'org-111' }))
  assert.notEqual(personal.workspace, org.workspace)
  assert.ok(personal.workspace.startsWith(PERSONAL_WORKSPACE_PREFIX))
  assert.ok(org.workspace.startsWith(ORG_WORKSPACE_PREFIX))
})

// ── fails closed ────────────────────────────────────────────────────────────

test('no session yields no scope', async () => {
  assert.throws(() => deriveBrainScope(null), TenancyError)
  assert.throws(() => deriveBrainScope(undefined), TenancyError)
})

test('a missing or non-canonical subject fails closed rather than degrading', async () => {
  // Degrading to a default would drop the caller into a shared bucket, which is
  // the exact failure this module exists to prevent.
  for (const authUserId of ['', '   ', 'has space', 'has/slash', 'has:colon', 'a'.repeat(129)]) {
    assert.throws(
      () => deriveBrainScope(session({ authUserId })),
      TenancyError,
      `${JSON.stringify(authUserId)} should be refused`,
    )
  }
})

test('a non-canonical org id fails closed rather than being sanitised', async () => {
  assert.throws(() => deriveBrainScope(session({ activeOrgId: 'org/../other' })), TenancyError)
})

// ── format contract ─────────────────────────────────────────────────────────

test('the owner is the OIDC subject, never an email or display name', async () => {
  const scope = deriveBrainScope(session({ email: 'someone@example.test', displayName: 'Someone' }))
  assert.equal(scope.owner, `${OWNER_PREFIX}auth-user-AAA`)
  assert.ok(!scope.owner.includes('someone@example.test'))
  assert.ok(!scope.owner.includes('Someone'))
})

test('a derived owner scope is recognisable as derived', async () => {
  assert.equal(isDerivedOwnerScope(deriveBrainScope(session()).owner), true)
  // The gateway uses this to refuse anything it did not build itself.
  for (const forged of ['personal', 'user:', 'org:org-111', 'auth-user-AAA', '']) {
    assert.equal(isDerivedOwnerScope(forged), false, `${forged} must not read as derived`)
  }
})

test('scope values are safe to place in a header', async () => {
  const scope = deriveBrainScope(session({ activeOrgId: 'org-111' }))
  for (const value of [scope.owner, scope.workspace]) {
    assert.ok(!/[\r\n]/.test(value), 'no header injection')
    assert.equal(value.trim(), value)
    assert.ok(value.length > 0)
  }
})
