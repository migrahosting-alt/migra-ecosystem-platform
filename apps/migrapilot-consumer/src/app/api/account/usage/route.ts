/**
 * What this account has actually used.
 *
 * COUNTED, NOT ESTIMATED. Every number here is derived by reading the
 * conversations and messages the Brain holds for this principal. Nothing is
 * cached, extrapolated, or rounded into a friendlier shape — a usage figure that
 * disagrees with what the person can see in their own history is worse than no
 * figure at all.
 *
 * THERE IS NO BILLING DATA HERE, AND THAT IS NOT AN OVERSIGHT. MigraAuth's
 * billing endpoints are org-scoped: every one of them requires an `x-org-id` and
 * resolves entitlements for an organisation. A consumer signing in to
 * chat.migrateck.com has no organisation, so there is no subscription, no
 * entitlement and no invoice that belongs to them. Calling those endpoints for
 * an individual would return `missing_org_id`, and inventing an org to satisfy
 * them would fabricate a billing relationship that does not exist.
 */

import { listConversations, listMessages } from '@/server/brain/seams'
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'
import type { ConversationSummary } from '@/server/brain/contracts'

export const dynamic = 'force-dynamic'

interface Message {
  role?: string
}

export async function GET(): Promise<Response> {
  const resolved = await resolveRequestPrincipal()
  if (!resolved) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const principal = resolved.principal

  const listed = await listConversations({ principal })
  if (listed.kind !== 'ok') {
    /*
     * A FAILED COUNT IS NOT A COUNT OF ZERO. Returning zeros would render a
     * confident "0 conversations" to someone who has hundreds, which is exactly
     * the sort of quietly-wrong number that makes a usage panel untrustworthy.
     */
    return Response.json(
      { error: 'unavailable', message: 'Your usage could not be read just now.' },
      { status: 503 },
    )
  }

  const conversations =
    (listed.value as { conversations?: ConversationSummary[] })?.conversations ?? []

  let messages = 0
  let yours = 0
  let unreadable = 0

  for (const conversation of conversations) {
    const result = await listMessages(conversation.id, { principal })
    if (result.kind !== 'ok') {
      // Tracked rather than skipped silently, and reported below — a total
      // assembled from partial reads must say it is partial.
      unreadable += 1
      continue
    }
    const list = (result.value as { messages?: Message[] })?.messages ?? []
    messages += list.length
    yours += list.filter((m) => m.role === 'user').length
  }

  return Response.json({
    conversations: conversations.length,
    messages,
    messagesFromYou: yours,
    /*
     * Present and non-zero only when something genuinely could not be read. The
     * card shows a caveat when it appears, so a number that is short says why
     * instead of just being wrong.
     */
    unreadableConversations: unreadable,
    oldestConversationAt:
      conversations.length > 0
        ? conversations
            .map((c) => c.createdAt ?? null)
            .filter((value): value is string => typeof value === 'string')
            .sort()[0] ?? null
        : null,
  })
}
