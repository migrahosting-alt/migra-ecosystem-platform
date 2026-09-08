/**
 * WHAT THE ENGINE CAN DO FOR THIS CALLER.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BROWSER DOES NOT ASK THE BRAIN DIRECTLY
 *
 * The principal is resolved here, server-side, and the engine answers in that
 * scope. A browser reaching the engine would be a client choosing its own
 * scope, which is the boundary every other capability in this product already
 * refuses to cross.
 *
 * ---------------------------------------------------------------------------
 * 🚨 UNAVAILABLE CAPABILITIES ARE INCLUDED ON PURPOSE
 *
 * The engine's default listing answers "what can run right now". The hub needs
 * a different question — "what EXISTS, and why can it not run" — because a
 * capability that disappears whenever its backend is missing teaches people it
 * was never built, which is a worse untruth than "not set up yet".
 *
 * ---------------------------------------------------------------------------
 * WHAT IS FORWARDED, AND WHAT IS NOT
 *
 * Presentation metadata and the engine's own reason. Not the grant list, not
 * schema versions, not the category taxonomy — none of which a person reads,
 * and all of which would be internal vocabulary leaking into a client. The
 * consumer cannot render what it never receives.
 */

import { callBrain } from '@/server/brain/gateway'
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'

export const dynamic = 'force-dynamic'

/** Exactly what a row needs. Everything else stays in the engine. */
interface PublicCapability {
  id: string
  displayName: string
  description: string
  category: string
  readOnly: boolean
  approvalRequired: boolean
  available: boolean
  unavailableReason?: string
}

export async function GET(): Promise<Response> {
  const resolved = await resolveRequestPrincipal()
  if (!resolved) {
    /*
     * NOT an empty list. Empty says "you have no capabilities"; this says "we
     * do not know who you are". The resolver treats them the same way — it
     * invents no rows for either — but only one of them is a claim about the
     * caller, and the distinction belongs in the response.
     */
    return Response.json(
      { error: 'unauthenticated', message: 'Sign in to see what MigraPilot can do.' },
      { status: 401 },
    )
  }

  const result = await callBrain({ kind: 'listCapabilities' }, { principal: resolved.principal })
  if (result.kind !== 'ok') {
    // Unreachable is not "you have none", for the same reason as above.
    return Response.json(
      { error: 'brain_unavailable', message: 'MigraPilot could not be reached right now.' },
      { status: 503 },
    )
  }

  const tools = (result.value as { tools?: unknown[] })?.tools ?? []
  const capabilities: PublicCapability[] = tools
    .filter((tool): tool is Record<string, unknown> => typeof tool === 'object' && tool !== null)
    .map((tool) => ({
      id: String(tool.id ?? ''),
      displayName: String(tool.displayName ?? ''),
      description: String(tool.description ?? ''),
      category: String(tool.category ?? ''),
      readOnly: tool.readOnly === true,
      approvalRequired: tool.approvalRequired === true,
      available: tool.available === true,
      ...(typeof tool.unavailableReason === 'string' && tool.unavailableReason
        ? { unavailableReason: tool.unavailableReason }
        : {}),
    }))
    .filter((capability) => capability.id.length > 0)

  return Response.json({ capabilities })
}
