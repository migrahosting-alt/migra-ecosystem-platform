import type { Conversation, Message } from '@/data/types'

/**
 * A conversation, as a file the person can keep.
 *
 * WHY THIS IS PURE. Export was one of three controls in the conversation rail
 * that rendered an arrow and did nothing. Making it real is mostly about the
 * text being right, so the text is produced by a function with no DOM and no
 * download in it — which is the part worth testing, and the part that would
 * otherwise only ever be checked by clicking.
 *
 * WHAT IT PROMISES. Exactly what is on screen and nothing more. A system notice
 * ("the model did not answer") is NOT the assistant speaking and is written as a
 * note; an answer that arrived but could not be saved is marked, because the
 * file will outlive the session that knew that. An export that quietly upgraded
 * either into ordinary model output would be a transcript that misrepresents
 * what happened.
 */

/** Paragraph text of a block, or nothing. `Block` is a union; lists have no `text`. */
const paragraphText = (message: Message): string =>
  (message.blocks ?? [])
    .map((block) => (block.type === 'paragraph' ? block.text : ''))
    .filter(Boolean)
    .join('\n\n')

function speaker(message: Message): string {
  if (message.role === 'user') return 'You'
  if (message.error) return 'Note'
  return 'MigraPilot'
}

function body(message: Message): string {
  const text = message.role === 'user' ? (message.text ?? '') : paragraphText(message)
  if (message.role !== 'user' && message.unsaved) {
    return `${text}\n\n[This answer was not saved and will not appear if you reload the conversation.]`
  }
  return text
}

/** Markdown, because it reads as plain text and pastes into anything. */
export function toTranscript(conversation: Conversation, exportedAt: Date): string {
  const title = conversation.title?.trim() || 'Untitled conversation'
  const header = [
    `# ${title}`,
    '',
    `Exported from MigraPilot on ${exportedAt.toLocaleString()}.`,
    '',
  ]

  const turns = conversation.messages
    .map((message) => {
      const text = body(message).trim()
      if (!text) return null
      const cited = message.citedFiles?.length
        ? `\n\nSources: ${message.citedFiles.join(', ')}`
        : ''
      return `**${speaker(message)}${message.time ? ` · ${message.time}` : ''}**\n\n${text}${cited}`
    })
    .filter((turn): turn is string => turn !== null)

  if (turns.length === 0) {
    // An empty file with a title would look like the export failed silently.
    return [...header, '_This conversation has no messages yet._', ''].join('\n')
  }

  return [...header, turns.join('\n\n---\n\n'), ''].join('\n')
}

/** A filename that survives every filesystem, derived from the title. */
export function transcriptFilename(conversation: Conversation, exportedAt: Date): string {
  const stem =
    (conversation.title ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'conversation'
  const day = exportedAt.toISOString().slice(0, 10)
  return `migrapilot-${stem}-${day}.md`
}
