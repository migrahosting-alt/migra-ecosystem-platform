/**
 * A chat turn.
 *
 * Browser → this authenticated route → `chatTurn` seam → `callBrain` → Brain.
 * The browser never learns where the Brain is and never reaches it directly;
 * `BRAIN_BASE_URL` is server-only and the gateway builds its own outbound
 * headers, so tenancy comes from the verified session and nothing else.
 *
 * This route adds no Brain knowledge of its own: no path, no scope header, no
 * model choice. It converts a JSON body into a seam call and a `BrainResult`
 * into a status code.
 *
 * NOTHING here may invent an answer. Every failure is reported as a failure —
 * the placeholder this replaced was removed precisely because a fabricated
 * assistant reply on a public site is a false capability claim.
 */

import { requireSession } from '@/server/auth'
import { UnauthenticatedError } from '@/server/auth/authPort'
import { chatTurn } from '@/server/brain/seams'

export const dynamic = 'force-dynamic'

/** The Brain's buffered chat reply (`apps/brain-service/src/engine/aiRoutes.ts`). */
interface BrainChatReply {
  ok?: boolean
  content?: unknown
  model?: unknown
  provider?: unknown
}

const fail = (status: number, error: string, message: string): Response =>
  Response.json({ error, message }, { status })

export async function POST(request: Request): Promise<Response> {
  // The session is required here as well as inside the gateway. The gateway's
  // check is the security boundary; this one exists so an unauthenticated
  // caller gets a 401 rather than a 502 describing a Brain it never reached.
  try {
    await requireSession()
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return fail(401, 'unauthenticated', 'Sign in to send a message.')
    }
    throw error
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return fail(400, 'invalid_body', 'Expected a JSON body.')
  }

  const prompt = (body as { prompt?: unknown })?.prompt
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return fail(400, 'invalid_prompt', 'A non-empty prompt is required.')
  }

  const summary = (body as { conversationSummary?: unknown })?.conversationSummary
  const result = await chatTurn(
    prompt,
    typeof summary === 'string' && summary.trim() ? summary : undefined,
  )

  switch (result.kind) {
    case 'ok': {
      const reply = result.value as BrainChatReply
      const content = typeof reply?.content === 'string' ? reply.content : ''
      // A 200 carrying no content is still a failed turn. Rendering an empty
      // assistant bubble would read as "the model had nothing to say".
      if (!content.trim()) {
        return fail(502, 'empty_answer', 'The model returned an empty answer.')
      }
      return Response.json({
        content,
        ...(typeof reply.model === 'string' ? { model: reply.model } : {}),
        ...(typeof reply.provider === 'string' ? { provider: reply.provider } : {}),
      })
    }

    case 'unauthenticated':
      return fail(401, 'unauthenticated', 'Sign in to send a message.')

    case 'tenancy_unresolved':
      // The session exists but carries no canonical identity to scope on. This
      // fails closed rather than falling back to a shared bucket.
      return fail(403, 'tenancy_unresolved', 'Your account is missing the identity needed to route this request.')

    case 'invalid_operation':
      return fail(400, 'invalid_request', result.detail)

    case 'timeout':
      // Expected while a cold model loads: the first turn after an idle period
      // pays a full model load before it generates a token.
      return fail(504, 'model_timeout', 'The model did not answer in time. It may still be loading — try again shortly.')

    case 'not_found':
    case 'conflict':
    case 'brain_error':
      return fail(502, 'brain_error', 'The assistant service could not complete this request.')

    case 'transport_failure':
      return fail(503, 'brain_unreachable', 'The assistant service is unreachable right now.')
  }
}
