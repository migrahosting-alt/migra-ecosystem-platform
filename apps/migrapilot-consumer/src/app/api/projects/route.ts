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
import { PROJECT_LIST_SIGN_IN, canHoldProjects } from '@/server/projects/projectPrincipal'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const resolved = await resolveRequestPrincipal()
  // NOT an empty list. An empty list says "you have none"; this says "we do not
  // know who you are", and they are not the same screen. An ANONYMOUS visitor
  // lands here too: they are a real principal, but not one that can hold a
  // project, and telling them the list is empty would assert an entitlement
  // nobody looked up.
  if (!resolved || !canHoldProjects(resolved.principal)) {
    return Response.json(
      {
        error: PROJECT_LIST_SIGN_IN.error,
        message: PROJECT_LIST_SIGN_IN.message,
        remedy: PROJECT_LIST_SIGN_IN.remedy,
      },
      { status: PROJECT_LIST_SIGN_IN.status },
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
