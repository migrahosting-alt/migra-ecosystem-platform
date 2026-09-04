/**
 * Asking a question again.
 *
 * 🚨 THE STORE IS APPEND-ONLY, AND THAT DECIDES THE FEATURE. MigraPilot's
 * conversation API can create a conversation, append a message, read the
 * messages and delete the whole thing. There is no operation to remove one
 * message, truncate after a point, or fork a thread — so "regenerate" and
 * "edit" in the sense other chat products mean them (the old answer vanishes
 * behind a "2 of 2" arrow) are not capabilities this product has.
 *
 * Building them anyway would produce a transcript that rearranges itself on
 * reload: the browser would show one answer, the durable record would hold two,
 * and the reader would have no way to know which they were looking at.
 *
 * So what is offered is what is true — ask the same question again, or rewrite
 * it and ask that. Both append. Both are visible. Real branch semantics need a
 * Brain-side message model that does not exist yet.
 */

import type { Message } from '@/data/types'

/**
 * The question a retry would repeat: the LAST one asked.
 *
 * Not the first, and not the one above the answer being looked at. A retry
 * appends to the bottom of the thread, so repeating anything other than the
 * most recent question would drop an answer to an old question underneath a
 * conversation that has moved on.
 */
export function lastQuestionOf(messages: readonly Message[]): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'user') return message
  }
  return undefined
}

/**
 * May this conversation be asked again right now?
 *
 * Three conditions, each for its own reason:
 *   · not already streaming — a second turn into a running one is the defect
 *     the Stop control exists to prevent, and this would be another door to it.
 *   · the last message is an ANSWER — offering "try again" while the question is
 *     still the newest thing on screen means the first attempt has not finished.
 *   · there is a question with text to repeat — an image-only turn has nothing
 *     for this control to send.
 */
export function canAskAgain(input: { messages: readonly Message[]; pending: boolean }): boolean {
  if (input.pending) return false
  const last = input.messages[input.messages.length - 1]
  if (last?.role !== 'assistant') return false
  return Boolean(lastQuestionOf(input.messages)?.text?.trim())
}

/**
 * What a repeat carries with it.
 *
 * THE SAME QUESTION MEANS THE SAME EVIDENCE. A retry that quietly dropped the
 * attached document or picture would ask a different question and then present
 * the difference as the model's second opinion.
 */
export function askAgainOptions(
  question: Message | undefined,
  modelFamily: string | undefined,
): { attachments?: string[]; images?: string[]; modelFamily?: string } {
  return {
    ...(question?.files?.length ? { attachments: [...question.files] } : {}),
    ...(question?.images?.length ? { images: [...question.images] } : {}),
    ...(modelFamily ? { modelFamily } : {}),
  }
}
