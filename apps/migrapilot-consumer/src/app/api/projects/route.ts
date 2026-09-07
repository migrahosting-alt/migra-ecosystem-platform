/**
 * The projects this signed-in user may actually use.
 *
 * A thin pass-through. The list, the emptiness, and every permission behind it
 * belong to the Brain's registry — the consumer's only jobs are to know who is
 * asking and to keep "we could not reach the service" from being reported as
 * "you have no projects", which are opposite claims about the same user.
 */

import { callBrain } from '@/server/brain/gateway'
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const resolved = await resolveRequestPrincipal()
  if (!resolved) {
    return Response.json(
      // NOT an empty list. An empty list says "you have none"; this says
      // "we do not know who you are", and they are not the same screen.
      { error: 'unauthenticated', message: 'Sign in to see your projects.', remedy: 'sign-in' },
      { status: 401 },
    )
  }

  const result = await callBrain({ kind: 'listProjects' }, { principal: resolved.principal })
  if (result.kind !== 'ok') {
    if (result.kind === 'transport_failure' || result.kind === 'timeout') {
      return Response.json(
        {
          error: 'brain_unavailable',
          message: 'Your projects could not be loaded right now. Try again shortly.',
          remedy: 'retry',
        },
        { status: 503 },
      )
    }
    return Response.json(
      { error: 'brain_error', message: 'Your projects could not be loaded.', remedy: 'retry' },
      { status: 502 },
    )
  }
  return Response.json(result.value)
}
