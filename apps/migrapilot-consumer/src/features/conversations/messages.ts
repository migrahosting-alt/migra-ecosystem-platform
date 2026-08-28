import type { Message } from '@/data/types'

/**
 * ONE translation from a stored message to a rendered one.
 *
 * The chat provider and the transcript export both need this, and they need it
 * to agree: a transcript is supposed to be what the user saw. Two copies of the
 * mapping is two chances for the file to disagree with the screen — and the file
 * is the one nobody can check afterwards.
 */

/** The wire shape from this app's own routes. Never the Brain's. */
export interface WireMessage {
  id: string | null
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: number | string | null
  /**
   * Images this message actually carried, from the message's OWN record.
   *
   * Never the conversation's current active set: message one must still show the
   * picture it asked about after that picture is detached from the thread, and a
   * transcript rebuilt from today's context is not a history.
   */
  imageRefs?: string[]
  /** Documents this message actually carried, from the message's OWN record. */
  fileRefs?: string[]
  /**
   * Which of those are no longer in the library.
   *
   * Computed at read time against the CURRENT library, because "deleted" is a
   * fact about now rather than about the turn. The record itself never changes.
   */
  missingFileRefs?: string[]
}

import { hasDeliverableContent } from '@/lib/turnContent'

export function timeOf(value: number | string | null): string {
  if (value === null) return ''
  const date = new Date(typeof value === 'number' ? value : Date.parse(value))
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function toMessage(message: WireMessage, index: number): Message {
  const time = timeOf(message.createdAt)
  return message.role === 'user'
    ? {
        id: message.id ?? `u-${index}`,
        role: 'user',
        text: message.content,
        time,
        delivered: true,
        ...(message.imageRefs?.length ? { images: message.imageRefs } : {}),
        ...(message.fileRefs?.length ? { files: message.fileRefs } : {}),
        ...(message.missingFileRefs?.length ? { missingFiles: message.missingFileRefs } : {}),
      }
    : {
        id: message.id ?? `a-${index}`,
        role: 'assistant',
        time,
        /*
         * A PICTURE IS AN ANSWER — on reload too.
         *
         * This branch dropped `imageRefs` and always emitted a paragraph, so a
         * generated image was delivered live and then VANISHED on the next hard
         * refresh: the ref was durably on the message, and the code that rebuilds
         * the thread simply never looked at it for the assistant.
         *
         * That is the same rule missed for the third time — in `producedOutput`,
         * in the client's delivery condition, and here. Every place that decides
         * what an assistant turn contains has to consider images, not just text.
         */
        ...(message.imageRefs?.length ? { images: message.imageRefs } : {}),
        /*
         * PROVENANCE IS PART OF THE ANSWER — on reload too.
         *
         * The same omission as `imageRefs` above, one field over: this branch
         * dropped `fileRefs`, so attribution rendered during the turn and was
         * gone the moment the page reloaded. Attribution is how someone checks
         * an answer against their own document, and it was the half that did not
         * survive.
         *
         * `missingFileRefs` is computed at read time against the CURRENT
         * library, so a source deleted since the turn is shown as deleted rather
         * than as a link the reader would follow to nothing.
         */
        ...(message.fileRefs?.length ? { citedFiles: message.fileRefs } : {}),
        ...(message.missingFileRefs?.length ? { missingCitedFiles: message.missingFileRefs } : {}),
        // No empty paragraph when the answer IS the picture.
        blocks: message.content ? [{ type: 'paragraph', text: message.content }] : [],
      }
}

/**
 * The durable thread for one conversation.
 *
 * Used by export, which can run from History — where the provider holds only
 * titles, because messages are fetched when a conversation is OPENED. Exporting
 * from there produced a file containing a heading and "no messages yet" for a
 * conversation that had plenty. The screen was not wrong; the export was reading
 * a cache that had never been asked to fill.
 */
export async function fetchMessages(conversationId: string): Promise<Message[]> {
  const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`messages unavailable (${response.status})`)
  const { messages } = (await response.json()) as { messages?: WireMessage[] }
  return (messages ?? [])
    /*
     * The FIFTH place this rule was re-encoded. Measuring `content.length` here
     * meant an exported transcript silently omitted a generated image — the turn
     * happened, the artifact is durable, and the record of it was missing.
     */
    .filter(hasDeliverableContent)
    .map(toMessage)
}
