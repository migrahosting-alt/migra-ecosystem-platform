/**
 * The gateway resolves WHO, and then authorizes WHAT.
 *
 * These two decisions used to be one: "there is a session" was the whole check,
 * and every operation was reachable behind it. Admitting signed-out visitors to
 * chat without splitting them would have made every Brain capability — files,
 * indexes, coding, transcription — reachable from the public internet by anyone
 * who loaded the page.
 *
 * So the properties asserted here are:
 *
 *   an anonymous visitor reaches chat, under an `anon:` scope this server signed
 *   an anonymous visitor reaches NOTHING else, and no request leaves
 *   an account reaches the claim; a visitor does not
 *   an account does not hold an anonymous allowance
 *   an operation nobody listed is closed, which is what makes tomorrow's
 *     capability safe today
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { callBrain, type BrainResult, type FetchLike } from './gateway'
import { mintAnonymousIdentity } from '../tenancy/anonymousIdentity'
import { deriveAnonymousScope, type Principal } from '../tenancy/principal'
import { deriveBrainScope } from '../tenancy/ownerScope'
import type { AppSession } from '../auth/authPort'
import type { BrainOperation } from './operations'

const SECRET = 'gateway-principal-test-secret-value'

const session: AppSession = {
  sessionId: 's-1',
  authUserId: 'auth-user-AAA',
  email: 'a@example.com',
  permissions: [],
  createdAt: Date.now(),
  expiresAt: Date.now() + 3_600_000,
}

const accountPrincipal: Principal = {
  kind: 'session',
  session,
  scope: deriveBrainScope(session),
}

function visitor(): Principal {
  const { identity } = mintAnonymousIdentity(SECRET)
  return { kind: 'anonymous', identity, scope: deriveAnonymousScope(identity) }
}

function recordingFetch(
  status = 200,
  body: unknown = { ok: true },
): { calls: { url: string; init: RequestInit }[]; fetchImpl: FetchLike } {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { calls, fetchImpl }
}

const scopeOf = (init: RequestInit): string | null =>
  new Headers(init.headers).get('x-owner-scope')

/** Every operation a signed-out visitor must NOT be able to perform. */
const CLOSED_TO_VISITORS: BrainOperation[] = [
  { kind: 'listIndexes' },
  { kind: 'createDocsIndex', root: '/var/lib/migrapilot/uploads/x' },
  { kind: 'syncIndex', indexId: 'ix1' },
  { kind: 'approveIndex', indexId: 'ix1' },
  { kind: 'codingCapability' },
  { kind: 'getCodingRun', runId: 'run1' },
  { kind: 'transcriptionCapability' },
  { kind: 'transcribe', audioBase64: 'AAAA', audioMime: 'audio/webm' },
  { kind: 'setConversationGrounding', conversationId: 'c1', files: ['a.md'] },
  { kind: 'answer', prompt: 'hi' },
  { kind: 'claimAnonymousConversation', conversationId: 'c1', anonymousSessionId: 'a'.repeat(22), anonymousOwner: `anon:${'a'.repeat(22)}` },
]

/** What "try it before you sign in" actually needs, and nothing more. */
const OPEN_TO_VISITORS: BrainOperation[] = [
  { kind: 'listConversations' },
  { kind: 'createConversation' },
  { kind: 'getConversation', conversationId: 'c1' },
  { kind: 'listMessages', conversationId: 'c1' },
  { kind: 'appendMessage', conversationId: 'c1', role: 'user', content: 'hi' },
  /*
   * MOVED UP FROM THE CLOSED LIST. A visitor's conversations live in the
   * visitor's own scope, so renaming or deleting one never leaves that
   * boundary — and closing them only produced controls that failed silently for
   * everyone who had not signed in. The claim stays closed just below, because
   * that one is performed AS the account and does cross scopes.
   */
  { kind: 'renameConversation', conversationId: 'c1', title: 'x' },
  { kind: 'deleteConversation', conversationId: 'c1' },
  { kind: 'chatTurn', prompt: 'hi' },
  { kind: 'chatTurn', prompt: 'hi', stream: true },
  { kind: 'anonymousQuota' },
  { kind: 'reserveAnonymousTurn', reservationId: 'r-1' },
  { kind: 'settleAnonymousTurn', reservationId: 'r-1', producedOutput: true },
]

test('a signed-out visitor reaches chat under a scope this server signed', async () => {
  const principal = visitor()
  const { calls, fetchImpl } = recordingFetch()

  const result = await callBrain({ kind: 'chatTurn', prompt: 'hello' }, { fetchImpl, principal })

  assert.equal(result.kind, 'ok')
  assert.equal(calls.length, 1)
  assert.equal(scopeOf(calls[0]!.init), principal.scope.owner)
  assert.match(scopeOf(calls[0]!.init) ?? '', /^anon:[A-Za-z0-9_-]{22,64}$/)
})

test('everything a visitor is allowed reaches the Brain', async () => {
  for (const operation of OPEN_TO_VISITORS) {
    const { calls, fetchImpl } = recordingFetch()
    const result: BrainResult<unknown> = await callBrain(operation, {
      fetchImpl,
      principal: visitor(),
    })
    assert.equal(result.kind, 'ok', `${operation.kind} must be reachable anonymously`)
    assert.equal(calls.length, 1, `${operation.kind} must actually be sent`)
  }
})

test('everything else is refused, and NO request leaves the process', async () => {
  for (const operation of CLOSED_TO_VISITORS) {
    const { calls, fetchImpl } = recordingFetch()
    const result: BrainResult<unknown> = await callBrain(operation, {
      fetchImpl,
      principal: visitor(),
    })

    assert.equal(
      result.kind,
      'forbidden_for_principal',
      `${operation.kind} must be refused for a signed-out visitor`,
    )
    assert.equal(calls.length, 0, `${operation.kind} must not reach the Brain at all`)
  }
})

test('a refusal is not "unauthenticated" — the remedy is different', async () => {
  const { fetchImpl } = recordingFetch()
  const result = await callBrain({ kind: 'listIndexes' }, { fetchImpl, principal: visitor() })

  assert.equal(result.kind, 'forbidden_for_principal')
  // The operation is named, because a capability refusal nobody can locate
  // becomes a bug report about "chat being broken".
  assert.match((result as { detail: string }).detail, /listIndexes/)
})

test('an unknown operation is closed by default, not open by omission', async () => {
  const { calls, fetchImpl } = recordingFetch()
  const result = await callBrain(
    { kind: 'somethingShippedNextWeek' } as unknown as BrainOperation,
    { fetchImpl, principal: visitor() },
  )

  assert.equal(result.kind, 'forbidden_for_principal')
  assert.equal(calls.length, 0)
})

test('an account may claim; a visitor may not', async () => {
  const anonymousSessionId = 'z'.repeat(24)
  const claim: BrainOperation = {
    kind: 'claimAnonymousConversation',
    conversationId: 'conv_1',
    anonymousSessionId,
    anonymousOwner: `anon:${anonymousSessionId}`,
  }

  const asAccount = recordingFetch(200, { ok: true, conversationId: 'conv_1', claimed: true })
  const allowed = await callBrain(claim, {
    fetchImpl: asAccount.fetchImpl,
    principal: accountPrincipal,
  })
  assert.equal(allowed.kind, 'ok')
  // Made AS THE ACCOUNT: the Brain refuses a claim carrying an anonymous scope.
  assert.equal(scopeOf(asAccount.calls[0]!.init), 'user:auth-user-AAA')

  const asVisitor = recordingFetch()
  const refused = await callBrain(claim, {
    fetchImpl: asVisitor.fetchImpl,
    principal: visitor(),
  })
  assert.equal(refused.kind, 'forbidden_for_principal')
  assert.equal(asVisitor.calls.length, 0)
})

test('an account holds no anonymous allowance, and is told so rather than 400d by the Brain', async () => {
  for (const operation of [
    { kind: 'anonymousQuota' },
    { kind: 'reserveAnonymousTurn', reservationId: 'r-1' },
    { kind: 'settleAnonymousTurn', reservationId: 'r-1', producedOutput: true },
  ] as BrainOperation[]) {
    const { calls, fetchImpl } = recordingFetch()
    const result: BrainResult<unknown> = await callBrain(operation, {
      fetchImpl,
      principal: accountPrincipal,
    })

    assert.equal(result.kind, 'forbidden_for_principal', `${operation.kind} is visitor-only`)
    assert.equal(calls.length, 0)
  }
})

test('a claim naming one session and a different owner is refused before it is sent', async () => {
  const { calls, fetchImpl } = recordingFetch()

  const result = await callBrain(
    {
      kind: 'claimAnonymousConversation',
      conversationId: 'conv_1',
      anonymousSessionId: 'a'.repeat(24),
      // The signature of a caller ASSEMBLING a claim rather than deriving both
      // halves from one verified cookie.
      anonymousOwner: `anon:${'b'.repeat(24)}`,
    },
    { fetchImpl, principal: accountPrincipal },
  )

  assert.equal(result.kind, 'invalid_operation')
  assert.equal(calls.length, 0)
})

test('an anonymous session id this server never issues cannot be claimed', async () => {
  const { calls, fetchImpl } = recordingFetch()

  const result = await callBrain(
    {
      kind: 'claimAnonymousConversation',
      conversationId: 'conv_1',
      // Too short to be a minted id, so it is not one.
      anonymousSessionId: 'short',
      anonymousOwner: 'anon:short',
    },
    { fetchImpl, principal: accountPrincipal },
  )

  assert.equal(result.kind, 'invalid_operation')
  assert.equal(calls.length, 0)
})
