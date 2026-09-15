import 'server-only'

import { composeEvidence } from '@/server/evidence/composition'

/**
 * "THE FIRST DOCUMENT" IS A FACT ABOUT THE CONVERSATION, NOT A GUESS.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE DEFECT THIS EXISTS FOR
 *
 * A contract and a workbook were attached together and asked:
 *
 *     "What does the first document say about cancellation?"
 *
 * The answer was "The first document doesn't say anything about cancellation."
 * The contract's page 4 is headed "Page 4 - Cancellation" and states a ninety
 * day notice period, and the citation on that very answer read
 * `meridian-agreement.pdf · pages 2-5` — so the text had been retrieved and put
 * in front of the model.
 *
 * Asking the same question with the FILE NAMED answered it correctly. Nothing
 * was missing from the evidence; what was missing was any statement of which
 * file is first. Chunks arrive labelled with a filename and content evidence
 * names its workbook, but nothing anywhere says the ORDER they were provided
 * in — so an ordinal reference has nothing to resolve against and the model
 * picks one, or answers about neither.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY A STATEMENT AND NOT AN INFERENCE
 *
 * The alternative is to resolve "first" ourselves and rewrite the prompt, which
 * puts a guess where a boundary belongs — the same mistake `turnGrounding`
 * refuses when it declines to infer which file a question is "really" about.
 *
 * Order is something the product KNOWS: the upload time of each file, from the
 * same library listing that decides what is available. So it is stated as a
 * fact and the model resolves the reference, exactly as a person reading the
 * conversation would.
 *
 * Ordered by upload time rather than array position, because the stored
 * grounding list is a set the conversation appends to and its order is a
 * side effect rather than a record.
 */

/**
 * The ordered roll-call of what this turn can answer from.
 *
 * Returns null for fewer than two files: with one document "the first document"
 * is unambiguous without help, and a preamble on every single-file turn is
 * noise in every prompt that never needed it.
 */
export function attachmentOrderEvidence(
  activeFiles: readonly string[],
  uploadedAt: Readonly<Record<string, number>> = {},
): string | null {
  if (activeFiles.length < 2) return null

  /*
   * A file with no timestamp keeps its position in the given order rather than
   * sorting to one end: an unknown time is not a claim that it came first.
   */
  const ordered = [...activeFiles].sort((a, b) => {
    const ta = uploadedAt[a]
    const tb = uploadedAt[b]
    if (ta === undefined || tb === undefined) return 0
    return ta - tb
  })

  return composeEvidence({
    fact: [
      `[The files attached to this conversation, in the order they were provided:`,
      ...ordered.map((name, i) => `  ${i + 1}. ${name}`),
      `That numbering is what "the first document", "the second file" and similar`,
      `references mean here. It says nothing about what any of them contains.]`,
    ],
    directives: [],
  })
}
