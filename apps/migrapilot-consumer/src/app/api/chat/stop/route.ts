/**
 * "I am stopping this answer on purpose."
 *
 * The browser calls this immediately before aborting a streaming turn, so the
 * server can tell a DECISION from a DISCONNECT — see `server/chat/stopIntent`
 * for why it cannot tell them apart on its own.
 *
 * It records a fact and returns. It never writes a message, never touches the
 * transcript, and cannot create a turn: the stream route is still the only
 * thing that persists anything, and a declaration only ever changes the LABEL
 * on a turn that was already aborted with text.
 */

import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'
import { declareStop } from '@/server/chat/stopIntent'

export async function POST(request: Request): Promise<Response> {
  const resolved = await resolveRequestPrincipal()
  // Not an error worth surfacing: an unauthenticated caller simply has no turn
  // to declare about, and the stream route will record an interruption.
  if (!resolved) return new Response(null, { status: 204 })

  let requestId = ''
  try {
    const body = (await request.json()) as { requestId?: unknown }
    if (typeof body?.requestId === 'string') requestId = body.requestId.trim()
  } catch {
    /* A malformed declaration is simply no declaration. */
  }
  if (!requestId) return new Response(null, { status: 204 })

  declareStop(requestId, resolved.principal.scope.owner)

  /*
   * 204, and deliberately no body. The browser is about to abort and is not
   * waiting on this; anything returned here would be read by nobody, and a
   * status the client cannot act on invites it to start acting on one.
   */
  return new Response(null, { status: 204 })
}
