import { listFeedback, putFeedback, removeFeedback } from '@/server/brain/seams'

/**
 * Feedback on an answer.
 *
 * 🚨 THE THUMBS USED TO DO NOTHING. They were browser state with no route and no
 * row, so a vote vanished on reload and the cheapest quality signal the product
 * could collect was discarded every single time. This is the path that makes
 * them true.
 *
 * NOTHING HERE TOUCHES THE ANSWER. Feedback is evidence: it does not edit,
 * regenerate or re-rank anything. A button that silently changed your answer
 * would be a worse defect than one that did nothing at all.
 *
 * FAILURE IS NEVER SILENT. A write that does not land returns an error, and the
 * caller must not paint a saved state over it — the whole point of this slice is
 * that the control stops lying about what was recorded.
 */
export const dynamic = 'force-dynamic'

const REASONS = new Set([
  'incorrect', 'misunderstood_request', 'poor_quality',
  'unsafe_or_unhelpful', 'tool_failure', 'other',
])

export async function GET(request: Request): Promise<Response> {
  const conversationId = new URL(request.url).searchParams.get('conversationId')
  if (!conversationId) {
    return Response.json({ error: 'invalid_request', message: 'A conversation is required.' }, { status: 400 })
  }
  const result = await listFeedback(conversationId)
  if (result.kind !== 'ok') {
    return Response.json({ error: 'unavailable', message: 'Your feedback could not be loaded.' }, { status: 503 })
  }
  return Response.json({ feedback: result.value?.feedback ?? [] })
}

export async function PUT(request: Request): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'invalid_request', message: 'Malformed request.' }, { status: 400 })
  }

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
  const messageId = typeof body.messageId === 'string' ? body.messageId : ''
  const rating = body.rating
  if (!conversationId || !messageId) {
    return Response.json({ error: 'invalid_request', message: 'A message is required.' }, { status: 400 })
  }
  if (rating !== 'up' && rating !== 'down') {
    return Response.json({ error: 'invalid_request', message: 'Choose a rating.' }, { status: 400 })
  }
  /*
   * A reason belongs only to a negative vote. Allowing one on a thumbs-up would
   * file "incorrect" against an answer somebody liked, and every later count of
   * that reason would be wrong in a way nobody could see.
   */
  const reason = typeof body.reason === 'string' ? body.reason : undefined
  if (reason && (!REASONS.has(reason) || rating !== 'down')) {
    return Response.json({ error: 'invalid_request', message: 'That reason cannot be used here.' }, { status: 400 })
  }

  const result = await putFeedback({
    conversationId,
    messageId,
    rating,
    ...(reason ? { reason } : {}),
    ...(typeof body.detail === 'string' && body.detail.trim() ? { detail: body.detail.trim() } : {}),
    ...(typeof body.requestId === 'string' ? { requestId: body.requestId } : {}),
    ...(typeof body.modelId === 'string' ? { modelId: body.modelId } : {}),
    ...(typeof body.providerId === 'string' ? { providerId: body.providerId } : {}),
    ...(body.turnContext && typeof body.turnContext === 'object'
      ? { turnContext: body.turnContext as Record<string, unknown> }
      : {}),
  })

  if (result.kind !== 'ok' || !result.value?.feedback) {
    return Response.json(
      { error: 'not_saved', message: 'Your feedback could not be saved. Try again in a moment.' },
      { status: 503 },
    )
  }
  return Response.json({ feedback: result.value.feedback })
}

export async function DELETE(request: Request): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'invalid_request', message: 'Malformed request.' }, { status: 400 })
  }
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
  const messageId = typeof body.messageId === 'string' ? body.messageId : ''
  if (!conversationId || !messageId) {
    return Response.json({ error: 'invalid_request', message: 'A message is required.' }, { status: 400 })
  }

  const result = await removeFeedback(conversationId, messageId)
  if (result.kind !== 'ok') {
    return Response.json(
      { error: 'not_saved', message: 'Your feedback could not be withdrawn. Try again in a moment.' },
      { status: 503 },
    )
  }
  return Response.json({ removed: result.value?.removed ?? false })
}
