import 'server-only'

import { canAnalyzeStructurally, canIndex, extensionOf } from '@/features/attachments/capability'

import { assessDocumentIntent, isGeneralQuestion } from './documentIntent'

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
  /**
   * Named for this turn but not actually in the library.
   *
   * `activeFiles` includes whatever the client attached, and a name with no file
   * behind it is still a name. Counting it as a usable attachment let "summarise
   * my documents" reach the model with nothing behind it — the exact ungrounded
   * answer this whole path exists to refuse.
   */
  missingFiles?: readonly string[]
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
  const { prompt, activeFiles, unreadableFiles = [], missingFiles = [], hasTableEvidence = false } = input

  // Computed figures mean the question was answered. Nothing else applies.
  if (hasTableEvidence) return { kind: 'indexed' }

  // A name with no file behind it is not an attachment.
  const present = activeFiles.filter((name) => !missingFiles.includes(name))

  if (present.length === 0) {
    // Only a question that actually asks something of a document is refused for
    // the lack of one; "how do I write a runbook" is not about a file.
    return asksOfDocument(prompt) ? { kind: 'absent' } : { kind: 'indexed' }
  }

  const structured = structuredOnly(present)
  if (structured.length === present.length) {
    /*
     * Every attachment is a table-only file, and the deterministic layer above
     * produced nothing for this question — `hasTableEvidence` already returned
     * for the answerable case. So there is no evidence about this file and no
     * prose index that could ever hold any.
     *
     * 🚨 THE GATE USED TO BE `asksOfDocument(prompt)`, AND THAT FABRICATED DATA.
     *
     * That helper answers a DIFFERENT question — "the user asks about a document
     * and NONE is attached" — and infers from vocabulary because in that case
     * there is no file to look at. Its noun list holds `spreadsheet` and `csv`
     * but not `workbook`, `sheet` or `xlsx`, so for an attached workbook it
     * answered false for EVERY spreadsheet question, including "Summarize this
     * workbook" and "What is the total revenue?". This branch therefore never
     * fired, the truthful refusal was unreachable, and the turn went to the
     * model with no evidence about a file whose chip was on screen.
     *
     * Measured on staging: "On the Q1 Sales sheet, what revenue is listed for
     * East?" over a workbook whose East row reads 25443.75 was answered
     * "Revenue for East on the Q1 Sales sheet is $54,212." — a fabricated
     * figure, with a currency the workbook does not use, stated without a
     * caveat. There is no worse failure available to this product.
     *
     * The fix is not more nouns. With a file ACTUALLY ATTACHED, whether the turn
     * concerns it is not a question the prompt's vocabulary gets to answer — the
     * user attached it. What survives is the craft escape hatch, which is about
     * the QUESTION rather than the file: "how do I build a budget spreadsheet"
     * is a general question whoever has attached what.
     *
     * The residual cost is a user who attaches a workbook and asks something
     * unrelated in the same turn, who is told what the workbook can be asked
     * instead of being answered. That is a redundant sentence naming their file.
     * The alternative is inventing their numbers.
     */
    return isGeneralQuestion(prompt)
      ? { kind: 'indexed' }
      : { kind: 'structured_only', files: [...present] }
  }

  const unreadable = present.filter((name) => unreadableFiles.includes(name))
  if (unreadable.length === present.length && unreadable.length > 0) {
    return { kind: 'unreadable', files: unreadable }
  }

  return { kind: 'indexed' }
}
