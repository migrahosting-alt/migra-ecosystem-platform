import 'server-only'

import { canAnalyzeStructurally, canIndex, extensionOf } from '@/features/attachments/capability'

import { assessDocumentIntent } from './documentIntent'

/**
 * What can this turn actually answer from?
 *
 * 🚨 FOUR STATES, KEPT DISTINCT, BECAUSE COLLAPSING THEM PRODUCED FALSE
 * STATEMENTS ABOUT FILES THE USER WAS LOOKING AT.
 *
 * Each of these was said in production about an attached, working workbook:
 *   · "I do not have that document attached to this conversation"
 *   · "No readable content was found in this file"
 *   · "I cannot summarize a document as no document was provided"
 *
 * The last one is the reason this module exists. The decision used to be gated
 * on `assessDocumentIntent(prompt, grounded)`, and that helper short-circuits to
 * "no document needed" the moment the account owns an approved index — which is
 * true of every real account and of no fresh test one. So the structured branch
 * fired in testing and never in production, and the turn reached the model with
 * no context at all.
 *
 * The rule this encodes: whether a question ASKS something of a document is a
 * property of the question. Whether a document can ANSWER it is a property of
 * the attachments. Mixing the two is what made the product lie.
 */
export type AttachmentTurnState =
  /** Nothing attached and nothing in the thread to answer from. */
  | { kind: 'absent' }
  /** At least one attachment whose text can be retrieved. Answer normally. */
  | { kind: 'indexed' }
  /** Everything attached is analysable as tables but holds no prose. */
  | { kind: 'structured_only'; files: string[] }
  /** Attachments exist but nothing can be read from them. */
  | { kind: 'unreadable'; files: string[] }

export interface AttachmentStateInput {
  prompt: string
  /** The files this turn is actually grounded on, index-independent. */
  activeFiles: readonly string[]
  /** Files the approved index holds no chunks for. */
  unreadableFiles?: readonly string[]
  /** The deterministic table layer already produced figures for this turn. */
  hasTableEvidence?: boolean
}

/** Does the question itself ask something of a document? Index state plays no part. */
export function asksOfDocument(prompt: string): boolean {
  // `false` on purpose: we want the question's own shape, not a verdict that
  // depends on what happens to be indexed.
  return assessDocumentIntent(prompt, false).needsAttachedDocument
}

export function structuredOnly(files: readonly string[]): string[] {
  return files.filter((name) => {
    const ext = extensionOf(name)
    return canAnalyzeStructurally(ext) && !canIndex(ext)
  })
}

/**
 * Decide the turn's attachment state.
 *
 * A table question about a workbook is ANSWERABLE, so `hasTableEvidence` wins
 * over everything: the deterministic layer already produced the figures and no
 * refusal may speak over them.
 */
export function decideAttachmentState(input: AttachmentStateInput): AttachmentTurnState {
  const { prompt, activeFiles, unreadableFiles = [], hasTableEvidence = false } = input

  // Computed figures mean the question was answered. Nothing else applies.
  if (hasTableEvidence) return { kind: 'indexed' }

  if (activeFiles.length === 0) {
    // Only a question that actually asks something of a document is refused for
    // the lack of one; "how do I write a runbook" is not about a file.
    return asksOfDocument(prompt) ? { kind: 'absent' } : { kind: 'indexed' }
  }

  const structured = structuredOnly(activeFiles)
  if (structured.length === activeFiles.length) {
    // Every attachment is a table-only file. A prose question cannot be served
    // from it, and saying so is the only truthful answer.
    return asksOfDocument(prompt)
      ? { kind: 'structured_only', files: [...activeFiles] }
      : { kind: 'indexed' }
  }

  const unreadable = activeFiles.filter((name) => unreadableFiles.includes(name))
  if (unreadable.length === activeFiles.length && unreadable.length > 0) {
    return { kind: 'unreadable', files: unreadable }
  }

  return { kind: 'indexed' }
}
