/**
 * READ-ONLY inspection, through the project this conversation is connected to.
 *
 * ---------------------------------------------------------------------------
 * 🚨 NO PATH CROSSES THIS BOUNDARY
 *
 * The body carries an operation and, at most, a sub-path INSIDE the project.
 * It cannot carry a root: the Brain takes that from the grant it resolves, and
 * a root from a browser would be a directory on a server the caller chose.
 *
 * Read-only by construction — there is no write operation to ask for. Applying
 * changes waits on an explicit authorization decision and the durable
 * idempotency primitive, and neither is wired.
 * ---------------------------------------------------------------------------
 */

import { callBrain } from '@/server/brain/gateway'
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'

export const dynamic = 'force-dynamic'

/** The read-only operations the product offers. A closed list, deliberately. */
const OPS = new Set(['list', 'read', 'find', 'search', 'git_status', 'git_branch', 'git_head', 'git_remotes', 'pkg_manager'])

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params
  const resolved = await resolveRequestPrincipal()
  if (!resolved) {
    return Response.json({ ok: false, error: 'Sign in to work with a project.', remedy: 'sign-in' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ ok: false, error: 'That is not a valid request.' }, { status: 400 })
  }
  const { op, query, path } = (body ?? {}) as { op?: unknown; query?: unknown; path?: unknown }
  if (typeof op !== 'string' || !OPS.has(op)) {
    return Response.json({ ok: false, error: 'That inspection is not available.' }, { status: 400 })
  }

  const result = await callBrain(
    {
      kind: 'inspectProject',
      conversationId: id,
      op,
      ...(typeof query === 'string' ? { query } : {}),
      ...(typeof path === 'string' ? { path } : {}),
    },
    { principal: resolved.principal },
  )

  if (result.kind !== 'ok') {
    if (result.kind === 'transport_failure' || result.kind === 'timeout') {
      return Response.json(
        { ok: false, error: 'The assistant service is unreachable right now.', remedy: 'retry' },
        { status: 503 },
      )
    }
    /*
     * The Brain's refusals here are ANSWERS — no project connected, access
     * withdrawn, project gone — each with its own remedy. Passed through, since
     * replacing them with a generic failure is exactly how "ask for access"
     * becomes "something went wrong".
     */
    if (result.kind === 'brain_error' && (result.status === 403 || result.status === 409)) {
      return Response.json(result.body, { status: result.status })
    }
    if (result.kind === 'conflict') {
      return Response.json(result.body, { status: result.status })
    }
    return Response.json({ ok: false, error: 'That could not be read.', remedy: 'retry' }, { status: 502 })
  }
  return Response.json(result.value)
}
