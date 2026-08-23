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

import { appendMessage, chatTurn, createConversation } from '@/server/brain/seams'
import { resolveRequestPrincipal } from '@/server/tenancy/requestPrincipal'
import { reserveTurnFor, settleTurnFor } from '@/server/anonymous/turnQuota'
import type { Principal } from '@/server/tenancy/principal'
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
  /*
   * ONE principal for the whole request — a verified session, or a signed
   * anonymous visitor. Resolved here rather than inside each Brain call: a
   * cookie-less visitor would otherwise get a different anonymous identity for
   * the conversation, the prompt, the turn and the answer.
   *
   * The gateway re-checks this; that check is the security boundary. This one
   * exists so a caller with no identity at all gets a 401 rather than a 502
   * describing a Brain it never reached.
   */
  const resolved = await resolveRequestPrincipal()
  if (!resolved) return fail(401, 'unauthenticated', 'Sign in to send a message.')
  if (!resolved.identityPersisted) {
    return fail(503, 'session_unavailable', 'A session could not be started. Try again shortly.')
  }
  const principal: Principal = resolved.principal

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

  /*
   * THE ALLOWANCE, BEFORE ANYTHING IS SPENT — ahead of the conversation, the
   * stored prompt and the model. A visitor who is out of turns must cost
   * nothing and must leave no half-written thread behind.
   */
  const allowance = await reserveTurnFor(principal, conversationId)
  if (allowance.kind === 'exhausted') {
    return Response.json(
      {
        error: 'quota_exhausted',
        message:
          'You have used all your free messages. Sign in or create an account to keep going — this conversation comes with you.',
        quota: allowance.quota,
      },
      { status: 429 },
    )
  }
  if (allowance.kind === 'unavailable') {
    return fail(allowance.status, allowance.error, allowance.message)
  }
  const reservationId = allowance.kind === 'reserved' ? allowance.reservationId : null

  /** Give the turn back. Every failure BEFORE useful output goes through here. */
  const release = async (reason: string): Promise<void> => {
    if (!reservationId) return
    await settleTurnFor(principal, { reservationId, producedOutput: false, failure: reason })
  }

  if (!conversationId) {
    const created = await createConversation(titleFrom(prompt), { principal })
    if (created.kind !== 'ok') {
      await release('persistence_unavailable')
      return brainFailure(created.kind)
    }
    conversationId = (created.value as ConversationSummary)?.id
    if (!conversationId) {
      await release('persistence_unavailable')
      return fail(502, 'brain_error', 'The assistant service did not return a conversation.')
    }
  }

  // An unknown or foreign id fails here, not silently into a new conversation:
  // the Brain scopes conversations by owner, so another user's id is a 404.
  const storedPrompt = await appendMessage(conversationId, 'user', prompt, { principal })
  if (storedPrompt.kind !== 'ok') {
    await release('persistence_unavailable')
    return brainFailure(storedPrompt.kind)
  }

  const summary = (body as { conversationSummary?: unknown })?.conversationSummary
  const result = await chatTurn(
    prompt,
    typeof summary === 'string' && summary.trim() ? summary : undefined,
    { principal },
  )

  switch (result.kind) {
    case 'ok': {
      const reply = result.value as BrainChatReply
      const content = typeof reply?.content === 'string' ? reply.content : ''
      // A 200 carrying no content is still a failed turn. Rendering an empty
      // assistant bubble would read as "the model had nothing to say".
      if (!content.trim()) {
        // A 200 carrying nothing is not useful output, so the turn goes back.
        // The user's message stays durable, so it survives to be retried.
        await release('no_output')
        return failWithConversation(conversationId, 502, 'empty_answer', 'The model returned an empty answer.')
      }

      // The answer is durable before it is returned. Returning first and
      // persisting after would show the user text that a reload then loses.
      const storedAnswer = await appendMessage(conversationId, 'assistant', content, { principal })
      /*
       * The answer exists, so the turn is spent — including when the save
       * failed. The user received real generated text either way, and refunding
       * it for a storage fault would make the limit meaningless in exactly the
       * case people would learn to reproduce.
       */
      const settlement = reservationId
        ? await settleTurnFor(principal, { reservationId, producedOutput: true })
        : null
      if (storedAnswer.kind !== 'ok') return brainFailure(storedAnswer.kind, conversationId)

      return Response.json({
        conversationId,
        content,
        ...(typeof reply.model === 'string' ? { model: reply.model } : {}),
        ...(typeof reply.provider === 'string' ? { provider: reply.provider } : {}),
        ...(settlement?.quota ? { quota: settlement.quota } : {}),
      })
    }

    case 'invalid_operation':
      await release('no_output')
      return failWithConversation(conversationId, 400, 'invalid_request', result.detail)

    default:
      await release(result.kind === 'timeout' ? 'model_timeout' : 'brain_unreachable')
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

    case 'forbidden_for_principal':
      // The principal is KNOWN and simply may not do this. Not a 401: telling a
      // signed-in user to sign in sends them in a circle.
      return failWithConversation(
        conversationId,
        403,
        'requires_account',
        'That needs an account. Sign in to continue this conversation.',
      )

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
