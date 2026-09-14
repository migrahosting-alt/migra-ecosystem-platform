/**
 * WHAT "COPY" MEANS: THE ANSWER, UNCHANGED.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE DEFECT THIS REPLACES
 *
 * The copy button reconstructed the answer from rendered blocks and then ran a
 * global strip of every double-asterisk over the whole thing, to remove markdown
 * bold. A
 * streamed assistant turn is ONE paragraph block holding the entire response,
 * code fences included — so that regex ran straight through the code:
 *
 *   on screen                          on the clipboard
 *   def f(*args, **kwargs):      ->    def f(*args, kwargs):
 *       return 2 ** 8                      return 2  8
 *
 * Copying a code answer silently produced broken code. Nothing failed, nothing
 * warned, and the corruption is only visible after pasting somewhere else.
 *
 * The fix is not a smarter stripper. It is to stop editing the answer at all:
 * a user who copies an answer wants the answer. Markdown that survives the trip
 * is a feature wherever they paste it, and text that survives the trip is the
 * whole point everywhere else.
 */

import type { Block } from '@/data/types'

/**
 * The exact text of an assistant turn, for the clipboard.
 *
 * 🚨 VERBATIM. No stripping, no normalising, no "tidying". Every transformation
 * applied here is a difference between what the user read and what they pasted,
 * and this codebase has spent a week on the principle that a fact held exactly
 * must reach the user exactly.
 *
 * Lists are joined with their markers restored, because a list is rendered from
 * structure and has no source text to preserve — reconstructing it is the only
 * option, so it reconstructs something a person can actually paste.
 */
export function copyableText(blocks: readonly Block[]): string {
  return blocks
    .map((block) => {
      if (block.type === 'paragraph') return block.text
      const marker = (i: number): string => (block.variant === 'numbered' ? `${i + 1}. ` : '- ')
      const body = block.items.map((item, i) => `${marker(i)}${item}`).join('\n')
      return block.title ? `${block.title}\n${body}` : body
    })
    .filter((part) => part.length > 0)
    .join('\n\n')
}

/**
 * The same content flattened for SPEECH, where markup is noise.
 *
 * Kept separate on purpose: the speech path genuinely wants the symbols gone,
 * and the copy path genuinely does not. One helper serving both is how the
 * clipboard ended up with speech-shaped text in it.
 */
export function speakableText(blocks: readonly Block[]): string {
  return blocks
    .map((block) =>
      block.type === 'paragraph'
        ? block.text
        : [block.title, ...block.items].filter(Boolean).join('. '),
    )
    .join(' ')
    .replace(/\*\*/g, '')
    .replace(/`{1,3}/g, '')
}
