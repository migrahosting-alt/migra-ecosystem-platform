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
import { appendMessage, chatTurn, createConversation } from '@/server/brain/seams'
import type { ConversationSummary } from '@/server/brain/contracts'

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

/** A conversation title the user will recognise in the sidebar. */
function titleFrom(prompt: string): string {
  const line = prompt.trim().split('\n')[0]!.trim()
  return line.length > 60 ? `${line.slice(0, 57)}…` : line
}

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

  /*
   * Persistence, before the model runs.
   *
   * The conversation and the user's own message are durable FIRST, so a turn
   * that the model then fails to answer is still there on reload. Persisting
   * only on success would silently discard exactly the turns a user most wants
   * to retry.
   *
   * The Brain does not persist a chat turn itself — `chatTurn` is stateless,
   * and appending both sides is this caller's job.
   */
  const requested = (body as { conversationId?: unknown })?.conversationId
  let conversationId = typeof requested === 'string' && requested.trim() ? requested.trim() : undefined

  if (!conversationId) {
    const created = await createConversation(titleFrom(prompt))
    if (created.kind !== 'ok') return brainFailure(created.kind)
    conversationId = (created.value as ConversationSummary)?.id
    if (!conversationId) {
      return fail(502, 'brain_error', 'The assistant service did not return a conversation.')
    }
  }

  // An unknown or foreign id fails here, not silently into a new conversation:
  // the Brain scopes conversations by owner, so another user's id is a 404.
  const storedPrompt = await appendMessage(conversationId, 'user', prompt)
  if (storedPrompt.kind !== 'ok') return brainFailure(storedPrompt.kind)

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
        // The user's message is already durable, so the turn survives to be
        // retried even though no answer was produced.
        return failWithConversation(conversationId, 502, 'empty_answer', 'The model returned an empty answer.')
      }

      // The answer is durable before it is returned. Returning first and
      // persisting after would show the user text that a reload then loses.
      const storedAnswer = await appendMessage(conversationId, 'assistant', content)
      if (storedAnswer.kind !== 'ok') return brainFailure(storedAnswer.kind, conversationId)

      return Response.json({
        conversationId,
        content,
        ...(typeof reply.model === 'string' ? { model: reply.model } : {}),
        ...(typeof reply.provider === 'string' ? { provider: reply.provider } : {}),
      })
    }

    case 'invalid_operation':
      return failWithConversation(conversationId, 400, 'invalid_request', result.detail)

    default:
      return brainFailure(result.kind, conversationId)
  }
}

/**
 * One mapping from a gateway outcome to a status, used by every Brain call in
 * this route so a persistence failure and a model failure cannot drift apart.
 *
 * `conversationId` is echoed when one exists: the turn is already durable, so
 * the client can keep the user on that conversation instead of starting a new
 * one on the retry.
 */
function brainFailure(kind: string, conversationId?: string): Response {
  switch (kind) {
    case 'unauthenticated':
      return failWithConversation(conversationId, 401, 'unauthenticated', 'Sign in to send a message.')

    case 'tenancy_unresolved':
      // The session exists but carries no canonical identity to scope on. This
      // fails closed rather than falling back to a shared bucket.
      return failWithConversation(
        conversationId,
        403,
        'tenancy_unresolved',
        'Your account is missing the identity needed to route this request.',
      )

    case 'timeout':
      // Expected while a cold model loads: the first turn after an idle period
      // pays a full model load before it generates a token.
      return failWithConversation(
        conversationId,
        504,
        'model_timeout',
        'The model did not answer in time. It may still be loading — try again shortly.',
      )

    case 'transport_failure':
      return failWithConversation(
        conversationId,
        503,
        'brain_unreachable',
        'The assistant service is unreachable right now.',
      )

    case 'not_found':
      return failWithConversation(conversationId, 404, 'not_found', 'That conversation no longer exists.')

    default:
      return failWithConversation(
        conversationId,
        502,
        'brain_error',
        'The assistant service could not complete this request.',
      )
  }
}

function failWithConversation(
  conversationId: string | undefined,
  status: number,
  error: string,
  message: string,
): Response {
  return Response.json({ error, message, ...(conversationId ? { conversationId } : {}) }, { status })
}
