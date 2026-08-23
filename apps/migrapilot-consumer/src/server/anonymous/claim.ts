import 'server-only'

/**
 * Signing in keeps the conversation you were already having.
 *
 * A visitor asks four questions, hits the limit, signs in — and the thread they
 * were reading has to still be there, at the same URL, under their account. A
 * sign-in that empties the screen is indistinguishable from losing the work, and
 * it is the moment a person decides whether the product is trustworthy.
 *
 * THE VERIFIED SESSION COMES FIRST, THEN THE CLAIM. Order is not a preference:
 * the account being claimed INTO must be established by a completed sign-in
 * before anything is moved. A claim that ran on the strength of a request
 * parameter would be a way to ask for someone else's conversation.
 *
 * BOTH HALVES COME FROM ONE COOKIE. The anonymous session id and its owner scope
 * are derived here from a single verified HMAC, never read from a body. The
 * Brain re-checks that they agree, because a mismatched pair is the signature of
 * a caller assembling a claim rather than deriving it.
 *
 * THE ID IS PRESERVED. The Brain moves the rows and keeps the primary key, so
 * `/chat/<id>` still resolves after the transfer. That is the whole point: the
 * person is looking at a conversation, and signing in must not swap it for a
 * different one.
 */

import { cookies } from 'next/headers'
import type { AppSession } from '../auth/authPort'
import { deriveBrainScope } from '../tenancy/ownerScope'
import {
  ANONYMOUS_COOKIE_NAME,
  verifyAnonymousCookie,
  type AnonymousIdentity,
} from '../tenancy/anonymousIdentity'
import { deriveAnonymousScope, type Principal } from '../tenancy/principal'
import { anonymousSecret, clearAnonymousIdentity } from '../tenancy/requestPrincipal'
import { claimAnonymousConversation, listConversations } from '../brain/seams'
import type { ConversationSummary } from '../brain/contracts'

export interface ClaimOutcome {
  /** Conversation ids now owned by the account, in the order they were moved. */
  claimed: string[]
  /** Ids that could not be moved. Never fatal — the sign-in still succeeded. */
  failed: string[]
  /** True when this browser had a verifiable anonymous identity to begin with. */
  hadAnonymousIdentity: boolean
}

const NOTHING: ClaimOutcome = { claimed: [], failed: [], hadAnonymousIdentity: false }

/** The anonymous identity this browser is carrying, if we really issued it. */
async function anonymousIdentityFromCookie(): Promise<AnonymousIdentity | null> {
  const secret = anonymousSecret()
  if (!secret) return null
  try {
    const jar = await cookies()
    const raw = jar.get(ANONYMOUS_COOKIE_NAME)?.value
    if (!raw) return null
    return verifyAnonymousCookie(raw, secret)
  } catch {
    // A cookie we cannot prove we issued claims nothing. Failing closed here
    // costs a visitor their pre-sign-in history in the rare tampered case, and
    // that is strictly better than moving rows on an unverified assertion.
    return null
  }
}

/**
 * Move everything this browser wrote while signed out into the account.
 *
 * ALL of it, not just the thread on screen. The limit is a handful of turns, so
 * there are at most a few conversations, and a sign-in that rescued one of them
 * and silently dropped the rest would be a worse outcome than either extreme.
 *
 * A failure to claim any single conversation is logged and skipped rather than
 * thrown: the sign-in has already succeeded, and turning a completed
 * authentication into an error page over a data move would be the wrong trade.
 */
export async function claimAnonymousWorkInto(session: AppSession): Promise<ClaimOutcome> {
  const identity = await anonymousIdentityFromCookie()
  if (!identity) return NOTHING

  const anonymous: Principal = {
    kind: 'anonymous',
    identity,
    scope: deriveAnonymousScope(identity),
  }
  const account: Principal = {
    kind: 'session',
    session,
    scope: deriveBrainScope(session),
  }

  // Read as the VISITOR — their scope is the only one these rows are visible in.
  const listed = await listConversations({ principal: anonymous })
  if (listed.kind !== 'ok') {
    console.warn('[anonymous] could not list conversations to claim:', listed.kind)
    /*
     * THE IDENTITY IS KEPT. Revoking it here destroyed the visitor's work: the
     * conversations were still in the anonymous scope, and the only credential
     * that could reach them had just been thrown away. The listing failing is a
     * transient condition — the ledger being briefly unreachable — and the
     * correct response to "we could not read it" is to try again, which
     * `pendingClaim` on the quota route makes the client do.
     */
    return { claimed: [], failed: [], hadAnonymousIdentity: true }
  }

  const conversations = (listed.value as { conversations?: ConversationSummary[] })?.conversations ?? []
  const claimed: string[] = []
  const failed: string[] = []

  for (const conversation of conversations) {
    if (!conversation?.id) continue
    // Made AS THE ACCOUNT, with the anonymous side named. The deps carry the
    // session principal deliberately — a claim sent as the visitor is refused.
    const result = await claimAnonymousConversation(
      {
        conversationId: conversation.id,
        anonymousSessionId: identity.anonymousSessionId,
        anonymousOwner: identity.ownerScope,
      },
      { principal: account },
    )

    if (result.kind === 'ok' && result.value?.claimed) claimed.push(conversation.id)
    else {
      failed.push(conversation.id)
      console.warn(
        '[anonymous] claim refused',
        JSON.stringify({ conversationId: conversation.id, kind: result.kind }),
      )
    }
  }

  /*
   * REVOKE THE ANONYMOUS AUTHORITY — but ONLY once nothing is left behind.
   *
   * When every conversation moved, the durable side is already closed by the
   * Brain: the rows have left the anonymous scope and the quota row is marked
   * claimed, so a replayed cookie can neither read them back nor buy a second
   * allowance. Removing the browser's copy then is pure hygiene.
   *
   * When something did NOT move, the cookie is the ONLY thing that can still
   * reach it. Revoking regardless is how signing in silently destroyed a
   * visitor's history: the transfer was refused, the credential was discarded,
   * and the conversations became unreachable by anyone. So a partial claim keeps
   * the identity, `pendingClaim` stays true, and the client retries until there
   * is nothing left to lose.
   */
  if (failed.length === 0) await clearAnonymousIdentity()
  else {
    console.warn(
      '[anonymous] keeping the visitor identity: work remains unclaimed',
      JSON.stringify({ claimed: claimed.length, failed: failed.length }),
    )
  }

  return { claimed, failed, hadAnonymousIdentity: true }
}
