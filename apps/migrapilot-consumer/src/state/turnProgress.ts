/**
 * WHEN THE TURN'S PROGRESS SURFACE IS SHOWN — and, more importantly, when it
 * has to be gone.
 *
 * ---------------------------------------------------------------------------
 * THE SECOND SURFACE
 *
 * `pending` stays true for the whole turn: it is set before the request opens
 * and cleared only after the stream loop ends. Rendering the indicator on
 * `pending` alone therefore leaves it running UNDERNEATH the answer while the
 * answer is being written — the assistant's bubble filling in, and a second
 * floating bubble of dots below it, both describing the same turn.
 *
 * Once the first token lands, the growing bubble IS the progress. Anything else
 * on screen is a duplicate.
 *
 * ---------------------------------------------------------------------------
 * WHY "AN ASSISTANT MESSAGE EXISTS" IS NOT THE TEST
 *
 * The streaming message is created by the first `paint`, and a first token can
 * legitimately be an empty delta — so an assistant bubble can exist with
 * nothing in it. Hiding progress then would leave the user with NO indication
 * anything was happening, which is the original complaint in reverse.
 *
 * So the question this asks is whether the answer has actually STARTED
 * ARRIVING: text with something in it, or a picture. A picture counts for the
 * same reason it counts everywhere else in this codebase — an image-generation
 * turn produces no text and is still an answer.
 * ---------------------------------------------------------------------------
 */

import type { Message } from '@/data/types'

export function showsTurnProgress(input: { messages: readonly Message[]; pending: boolean }): boolean {
  if (!input.pending) return false

  const last = input.messages[input.messages.length - 1]
  // Still the user's question on screen: the turn has produced nothing yet.
  if (last?.role !== 'assistant') return true

  const hasText = (last.blocks ?? []).some(
    (block) => block.type === 'paragraph' && block.text.trim().length > 0,
  )
  const hasImage = (last.images?.length ?? 0) > 0
  return !(hasText || hasImage)
}
