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
}

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
      }
    : {
        id: message.id ?? `a-${index}`,
        role: 'assistant',
        time,
        blocks: [{ type: 'paragraph', text: message.content }],
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
    .filter((message) => typeof message.content === 'string' && message.content.length > 0)
    .map(toMessage)
}
