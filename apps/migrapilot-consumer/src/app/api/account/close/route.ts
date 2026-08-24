/**
 * Closing the MigraTeck account.
 *
 * THIS IS THE ONLY ACTION IN THE PRODUCT THAT ENDS EVERYTHING, so it does two
 * things in a deliberate order: it deletes the conversations MigraPilot holds,
 * then it closes the account at MigraAuth.
 *
 * THE ORDER IS THE POINT. Closing the account first would revoke the very
 * authority needed to reach the Brain, stranding the conversations with no
 * signed-in person left who could ever delete them. Content first, identity
 * last.
 *
 * A FAILURE TO DELETE CONTENT STOPS THE WHOLE THING. Someone closing their
 * account is asking for their data to be gone, not for their ability to reach it
 * to be removed while it stays. If the conversations cannot be deleted, the
 * account stays open and the response says so — recoverable, and honest.
 */

import { deleteConversation, listConversations } from '@/server/brain/seams'
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'
import { migraAuthFetch, persistRenewal } from '@/server/auth/migraAuthApi'
import { getAuthPort } from '@/server/auth'
import type { ConversationSummary } from '@/server/brain/contracts'

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  const resolved = await resolveRequestPrincipal()
  // `session`, not `user` — a signed-out visitor has no MigraTeck account to
  // close, and their conversations are already erasable from Settings.
  if (!resolved || resolved.principal.kind !== 'session') {
    return Response.json(
      { error: 'unauthenticated', message: 'Sign in to close your account.' },
      { status: 401 },
    )
  }

  // Server-checked. A confirmation enforced only in a screen is not enforced for
  // anything that skips the screen.
  const body = (await request.json().catch(() => null)) as { confirm?: unknown } | null
  if (body?.confirm !== 'DELETE') {
    return Response.json(
      { error: 'confirmation_required', message: 'This action needs an explicit confirmation.' },
      { status: 400 },
    )
  }

  /* ── content first ──────────────────────────────────────────────────── */

  const listed = await listConversations({ principal: resolved.principal })
  if (listed.kind !== 'ok') {
    return Response.json(
      {
        error: 'unavailable',
        message:
          'Your conversations could not be read, so nothing was deleted and your account is unchanged.',
      },
      { status: 503 },
    )
  }

  const conversations = (listed.value as { conversations?: ConversationSummary[] })?.conversations ?? []
  let deleted = 0
  const failed: string[] = []
  for (const conversation of conversations) {
    const result = await deleteConversation(conversation.id, { principal: resolved.principal })
    if (result.kind === 'ok' || result.kind === 'not_found') deleted += 1
    else failed.push(conversation.id)
  }

  if (failed.length > 0) {
    return Response.json(
      {
        error: 'partial',
        deleted,
        remaining: failed.length,
        message: `${deleted} conversations were deleted, but ${failed.length} could not be. Your account is still open — nothing was closed.`,
      },
      { status: 207 },
    )
  }

  /* ── identity last ──────────────────────────────────────────────────── */

  const closed = await migraAuthFetch<{ closed: boolean }>('/v1/me/close', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirm: 'DELETE' }),
  })
  await persistRenewal(closed)

  if (closed.kind !== 'ok') {
    /*
     * REPORTED HONESTLY, INCLUDING THE PART THAT IS IRREVERSIBLE. The
     * conversations are already gone and cannot come back; saying only "closing
     * failed" would leave someone believing their data survived.
     */
    return Response.json(
      {
        error: 'account_not_closed',
        deleted,
        message:
          'Your conversations were deleted, but your MigraTeck account could not be closed. It is still open — please try again.',
      },
      { status: 503 },
    )
  }

  // The local session is dropped too. MigraAuth has disabled the account, but
  // this app's own cookie would otherwise keep a closed account looking signed
  // in until it lapsed.
  const port = await getAuthPort()
  await port.clearSession()

  return Response.json({ closed: true, conversationsDeleted: deleted })
}
