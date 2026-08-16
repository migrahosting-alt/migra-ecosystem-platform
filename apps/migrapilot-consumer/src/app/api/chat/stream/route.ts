/**
 * A streamed chat turn.
 *
 *   browser ── SSE ──► this authenticated route ── SSE ──► Brain ──► model
 *
 * Same trust boundary as the buffered turn: `streamBrain` runs the identical
 * preamble (session → derived scope → closed operation set), so nothing here
 * can widen it. This route re-frames the Brain's stream for the browser; it
 * never forwards the Brain's frames verbatim, because those carry routing and
 * provider detail the browser has no business seeing.
 *
 * WHY STREAM. The buffered turn is correct but the wait is not survivable: a
 * cold model load has exceeded 240 seconds with nothing on screen. Streaming
 * turns that into a `status` frame immediately and tokens as they are produced.
 *
 * PERSISTENCE RULE, and the whole reason this route is careful: the answer is
 * stored ONLY when the stream completes. A partial, interrupted or cancelled
 * stream persists nothing, exactly as the Brain does for its own memory —
 * writing a truncated answer would leave a durable conversation whose history
 * claims the model said something it never finished saying.
 */

import { requireSession } from '@/server/auth'
import { UnauthenticatedError } from '@/server/auth/authPort'
import { appendMessage, chatTurnStream, createConversation } from '@/server/brain/seams'
import type { BrainStreamFrame } from '@/server/brain/gateway'
import type { ConversationSummary } from '@/server/brain/contracts'

export const dynamic = 'force-dynamic'

const json = (status: number, error: string, message: string): Response =>
  Response.json({ error, message }, { status })

function titleFrom(prompt: string): string {
  const line = prompt.trim().split('\n')[0]!.trim()
  return line.length > 60 ? `${line.slice(0, 57)}…` : line
}

/** The failure vocabulary the client renders. Mirrors the buffered route. */
function reasonFor(kind: string): { error: string; message: string } {
  switch (kind) {
    case 'unauthenticated':
      return { error: 'unauthenticated', message: 'Sign in to send a message.' }
    case 'tenancy_unresolved':
      return {
        error: 'tenancy_unresolved',
        message: 'Your account is missing the identity needed to route this request.',
      }
    case 'timeout':
      return {
        error: 'model_timeout',
        message: 'The model did not answer in time. It may still be loading — try again shortly.',
      }
    case 'transport_failure':
      return { error: 'brain_unreachable', message: 'The assistant service is unreachable right now.' }
    case 'not_found':
      return { error: 'not_found', message: 'That conversation no longer exists.' }
    default:
      return { error: 'brain_error', message: 'The assistant service could not complete this request.' }
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireSession()
  } catch (error) {
    if (error instanceof UnauthenticatedError) return json(401, 'unauthenticated', 'Sign in to send a message.')
    throw error
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(400, 'invalid_body', 'Expected a JSON body.')
  }

  const prompt = (body as { prompt?: unknown })?.prompt
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return json(400, 'invalid_prompt', 'A non-empty prompt is required.')
  }

  // Persistence before generation, identical to the buffered route: the user's
  // own message is durable even if the model never answers.
  const requested = (body as { conversationId?: unknown })?.conversationId
  let conversationId = typeof requested === 'string' && requested.trim() ? requested.trim() : undefined

  if (!conversationId) {
    const created = await createConversation(titleFrom(prompt))
    if (created.kind !== 'ok') {
      const reason = reasonFor(created.kind)
      return json(created.kind === 'unauthenticated' ? 401 : 502, reason.error, reason.message)
    }
    conversationId = (created.value as ConversationSummary)?.id
    if (!conversationId) return json(502, 'brain_error', 'The assistant service did not return a conversation.')
  }

  const storedPrompt = await appendMessage(conversationId, 'user', prompt)
  if (storedPrompt.kind !== 'ok') {
    const reason = reasonFor(storedPrompt.kind)
    return json(storedPrompt.kind === 'not_found' ? 404 : 502, reason.error, reason.message)
  }

  const durableId = conversationId
  const summary = (body as { conversationSummary?: unknown })?.conversationSummary
  const conversationSummary = typeof summary === 'string' && summary.trim() ? summary : undefined

  const encoder = new TextEncoder()
  /** Set once the upstream stream opens; stays null if the client leaves first. */
  let frames: AsyncGenerator<BrainStreamFrame> | null = null

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = ''
      let completed = false
      let closed = false

      const emit = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }

      /*
       * FIRST BYTE BEFORE THE BRAIN IS EVEN ASKED. This is the whole point of
       * the route, and getting the order wrong silently defeats it.
       *
       * The Brain's SSE headers are not flushed when it calls `writeHead` —
       * Node sends them with the first `write()`, and the Brain's first write
       * is the `route` frame, which it only emits after pulling the model's
       * first token. So awaiting the Brain's response before replying here
       * meant the browser received NOTHING, not even headers, until the model
       * had already started answering. Measured at 21.7s warm, and well past
       * three minutes on a cold load — exactly the frozen page streaming was
       * supposed to remove.
       *
       * Opening the upstream stream therefore happens INSIDE the body, after
       * this frame is on the wire.
       */
      emit('meta', { conversationId: durableId })

      const opened = await chatTurnStream(prompt, conversationSummary, {
        // The browser going away must stop the model, not just this handler.
        signal: request.signal,
      })

      if (opened.kind !== 'ok') {
        emit('error', reasonFor(opened.kind))
        closed = true
        try {
          controller.close()
        } catch {
          /* already closed */
        }
        return
      }
      frames = opened.frames

      try {
        for await (const frame of opened.frames) {
          switch (frame.event) {
            case 'token': {
              const text = (frame.data as { text?: unknown })?.text
              if (typeof text === 'string' && text.length > 0) {
                answer += text
                emit('token', { text })
              }
              break
            }
            case 'done':
              completed = true
              break
            case 'error': {
              const message = (frame.data as { message?: unknown })?.message
              emit('error', {
                error: 'brain_error',
                message: typeof message === 'string' && message ? message : reasonFor('brain_error').message,
              })
              break
            }
            // `context` and `route` are Brain diagnostics — retrieval detail,
            // model ids, failover history. Deliberately not relayed.
            default:
              break
          }
        }
      } catch {
        // The stream broke mid-flight. `completed` stays false, so nothing is
        // persisted and the client is told rather than shown a partial answer
        // dressed up as a finished one.
        completed = false
      }

      if (completed && answer.trim()) {
        const stored = await appendMessage(durableId, 'assistant', answer)
        if (stored.kind === 'ok') {
          emit('done', { conversationId: durableId })
        } else {
          // The user watched a complete answer arrive that will not survive a
          // reload. Saying so is the only honest option.
          emit('error', {
            error: 'not_saved',
            message: 'The answer arrived but could not be saved, so it will not be here after a reload.',
          })
        }
      } else if (!closed) {
        emit('error', {
          error: 'stream_interrupted',
          message: answer
            ? 'The answer was cut off before it finished, so it was not saved.'
            : 'The model did not produce an answer.',
        })
      }

      closed = true
      try {
        controller.close()
      } catch {
        /* already closed by a client disconnect */
      }
    },

    async cancel() {
      // The browser hung up. Ending the generator releases the reader, which
      // aborts the upstream Brain request so a cancelled turn stops costing
      // model time. Nothing is persisted for it.
      //
      // `frames` is still null when the client leaves before the Brain stream
      // opened, which is now a real window: `meta` goes out first, on purpose.
      await frames?.return(undefined).catch(() => undefined)
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // nginx buffers proxied responses by default, which would hold every
      // token until the turn finished and silently undo the streaming.
      'x-accel-buffering': 'no',
    },
  })
}
