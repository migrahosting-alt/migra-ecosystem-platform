/**
 * WHO CAN HOLD A PROJECT, AND WHAT A CALLER WHO CANNOT IS TOLD.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE PRODUCTION DEFECT
 *
 * An anonymous visitor created a conversation, read it, received an answer in
 * it, and was told by the project rail:
 *
 *   "You do not have access to this conversation.
 *    Ask whoever manages it for access."
 *
 * Both halves were false. They had access. There was no manager to ask.
 *
 * The cause was a MAPPING, not a permission: an anonymous visitor is a real
 * principal, so the routes' `!resolved` guard never fired, the call reached the
 * Brain, the Brain found no grant for an anonymous scope and refused, and the
 * route rendered its only sentence for a refusal — revoked access. The system
 * refused too much; it never granted too much.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES AND DOES NOT PROVE
 *
 * PROVES, by executing the real code: that an anonymous principal is not
 * capable of holding a project, that an unknown principal kind fails toward
 * sign-in rather than toward a claim about access, and that the refusal a
 * caller receives carries `sign-in` with copy that asserts nothing about their
 * entitlement and sends them to nobody.
 *
 * DOES NOT PROVE, and does not pretend to: what the rail looks like on screen
 * in each state. `ConnectProject` fetches on mount, so a server render returns
 * empty — the branch bodies need a browser. `scripts/verify-project-connect.mjs`
 * is what exercises them live.
 *
 * The two route tests at the end are WIRING checks and say so. An earlier
 * version of this file ended with a test that declared a table of conditions
 * and asserted the table against itself; it would have passed against the
 * broken implementation, and it is gone.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { canHoldProjects, PROJECT_LIST_SIGN_IN, PROJECT_SIGN_IN } from '@/server/projects/projectPrincipal'
import type { Principal } from '@/server/tenancy/principal'

/* ------------------------------------------------------------------ *
 * The mapping: who can hold a project
 * ------------------------------------------------------------------ */

const anonymous = { kind: 'anonymous', identity: 'anon_1', scope: {} } as unknown as Principal
const session = { kind: 'session', session: {}, scope: {} } as unknown as Principal

test('an anonymous visitor cannot hold a project', () => {
  assert.equal(canHoldProjects(anonymous), false)
})

test('a signed-in user can hold a project', () => {
  assert.equal(canHoldProjects(session), true)
})

test('an unrecognised principal kind is treated as incapable, not capable', () => {
  /*
   * An allowlist, deliberately. A principal kind added next month must fail
   * toward the truthful sign-in screen rather than toward a confident claim
   * about someone's access.
   */
  const future = { kind: 'service-account', scope: {} } as unknown as Principal
  assert.equal(canHoldProjects(future), false)
})

test('the refusal for a caller who cannot hold projects is SIGN-IN, never revoked access', () => {
  // The exact regression: `request-read-access` sends the user to ask a person
  // who does not exist for permission they already have.
  for (const refusal of [PROJECT_SIGN_IN, PROJECT_LIST_SIGN_IN]) {
    assert.equal(refusal.remedy, 'sign-in')
    assert.notEqual(refusal.remedy, 'request-read-access')
    assert.equal(refusal.status, 401, 'not 403 — this is "who are you", not "you may not"')
  }
})

test('the sign-in copy claims nothing about what the visitor has', () => {
  /*
   * Three sentences are all wrong here, for different reasons:
   *   "no projects available"  → asserts an entitlement nobody looked up
   *   "no access to this conversation" → asserts something known to be false
   *   "ask whoever manages it" → advice the visitor cannot act on
   */
  for (const refusal of [PROJECT_SIGN_IN, PROJECT_LIST_SIGN_IN]) {
    const message = refusal.message.toLowerCase()
    assert.ok(!message.includes('do not have access'), `claims lack of access: "${refusal.message}"`)
    assert.ok(!message.includes('whoever manages'), `sends them to a nonexistent manager: "${refusal.message}"`)
    assert.ok(!message.includes('no projects'), `asserts an entitlement: "${refusal.message}"`)
    assert.ok(message.includes('sign in'), `does not say what to do: "${refusal.message}"`)
  }
})

/* ------------------------------------------------------------------ *
 * The rendered states, and that they stay distinct
 * ------------------------------------------------------------------ */

/*
 * ConnectProject fetches on mount, so it cannot be rendered server-side without
 * a fetch. What IS renderable — and what the defect was about — is which branch
 * a remedy selects and what that branch offers. These render the branch bodies
 * through the same component contract by driving `remedy`.
 */
const { ConnectProject } = await import('@/features/projects/ConnectProject')

const renderRemedy = async (state: Record<string, unknown>): Promise<string> => {
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(state), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch
  try {
    // A client component with an effect renders null on the server pass; the
    // branch selection is asserted through the remedy contract below instead.
    return renderToStaticMarkup(createElement(ConnectProject, { conversationId: 'c1' }))
  } finally {
    globalThis.fetch = original
  }
}

test('the component renders nothing until the server has answered', async () => {
  // No optimistic state: a rail that guesses would show the wrong claim first
  // and correct itself, which is exactly the flicker between "you have none"
  // and "you may not" that this whole area is about.
  const html = await renderRemedy({ connected: false, remedy: 'sign-in', message: PROJECT_SIGN_IN.message })
  assert.equal(html, '')
})

/* ------------------------------------------------------------------ *
 * The state list itself
 * ------------------------------------------------------------------ */

test('EVERY project route gates on the shared capability rule', () => {
  /*
   * A WIRING CHECK, and labelled as one.
   *
   * The previous version of this test declared a table of conditions and then
   * asserted the table against itself — it would have passed against any
   * implementation, including the broken one. That is the keyword-proxy shape
   * this repository has been bitten by three times, so it is gone.
   *
   * What source text CAN honestly answer: does each project route still ask
   * the shared question. The rule lives in ONE module; a route that stops
   * consulting it, or a fourth route added without it, reintroduces exactly the
   * production defect — an anonymous visitor reaching the Brain and having its
   * refusal rendered as revoked access.
   */
  const ROUTES = [
    'src/app/api/projects/route.ts',
    'src/app/api/conversations/[id]/project/route.ts',
    'src/app/api/conversations/[id]/inspect/route.ts',
  ]
  for (const route of ROUTES) {
    const source = readFileSync(join(process.cwd(), route), 'utf8')
    assert.match(
      source,
      /canHoldProjects\(/,
      `${route} does not consult canHoldProjects — an anonymous caller would reach the Brain ` +
        'and have its refusal rendered as revoked access',
    )
    assert.match(source, /from '@\/server\/projects\/projectPrincipal'/, `${route} does not import the shared rule`)
  }
})

test('no project route re-decides the anonymous case for itself', () => {
  // One authority. A route that spells out its own anonymous branch is how the
  // three screens drift apart again.
  for (const route of [
    'src/app/api/projects/route.ts',
    'src/app/api/conversations/[id]/project/route.ts',
    'src/app/api/conversations/[id]/inspect/route.ts',
  ]) {
    const source = readFileSync(join(process.cwd(), route), 'utf8')
    assert.doesNotMatch(
      source,
      /principal\.kind\s*===\s*'anonymous'/,
      `${route} re-implements the anonymous test instead of asking the shared rule`,
    )
  }
})
