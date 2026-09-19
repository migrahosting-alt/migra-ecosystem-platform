import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { readWorkbook, workbookText, WorkbookError } from '@migrapilot/shared-types/workbook'
import { canAnalyzeStructurally, canIndex, extensionOf } from '@/features/attachments/capability'
import { composeEvidence } from '@/server/evidence/composition'

/**
 * A WORKBOOK THE USER ATTACHED IS PART OF THE CONVERSATION, NOT A CALCULATOR
 * THEY MAY QUERY IF THEY PHRASE IT RIGHT.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE DEFECT THIS EXISTS FOR
 *
 * A freight contract and a rate-review workbook were attached together and
 * asked: "Compare the payment terms in these two files." The answer quoted the
 * PDF's forty-five days correctly and then said
 *
 *     "No payment terms are mentioned in the provided excerpts from the
 *      other file."
 *
 * The workbook's Terms sheet reads `Payment terms | 30`. The turn trace shows
 * `grounding_active: 2` and no `table_computed` at all: both files were active,
 * and the workbook contributed NOTHING, so the model was invited to
 * characterise a file it had never been shown. A user reads that sentence as
 * "the spreadsheet does not mention payment terms", which is false about their
 * own file.
 *
 * The cause is that the workbook only ever reached the model through the
 * COMPUTED path, which fires when `detectOperation` recognises an aggregate.
 * "Compare" is not an aggregate. Neither is "what are the differences", "does
 * it contradict", "which is higher" or any other way two documents get talked
 * about — so the whole cross-file class was invisible.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY THIS IS NOT THE COMPUTED PATH WITH A WIDER VOCABULARY
 *
 * Adding verbs would be phrase-tuning, and it would keep making the workbook's
 * presence conditional on how the question was worded. Showing a document to
 * the model is a different act from calculating with it:
 *
 *   · COMPUTED evidence is arithmetic MigraPilot performed, handed over with
 *     "use these figures verbatim". That still only happens on a recognised
 *     operation, because the model must never derive a total itself.
 *   · CONTENT evidence is the sheet as written. No arithmetic is claimed and
 *     none is performed — it is the same act as putting a PDF's text in front
 *     of the model, which has never needed the user to name an operation.
 *
 * So the two coexist and do not overlap: content is supplied for a workbook the
 * computed path did NOT already speak for, so one turn never carries both a
 * figure and a second opinion about the same cells.
 *
 * ---------------------------------------------------------------------------
 * 🚨 BOUNDED, AND HONEST WHEN IT IS BOUNDED
 *
 * `workbookText` caps at 20,000 cells and reports `complete: false` when the cap
 * cut the workbook short. A truncated sheet must never read as a whole one —
 * "the spreadsheet lists three suppliers" is a different sentence when there
 * were four and the reader stopped at three — so the caveat travels with the
 * evidence rather than being left to the model to infer.
 */

export interface SheetContentEvidence {
  file: string
  /** False when the cap cut the workbook short. */
  complete: boolean
  text: string
  /** The workbook's own sheet names — the candidate set a reference resolves against. */
  sheetNames: string[]
}

/** Files whose only reader is the table layer — a workbook, not a CSV. */
function structuredOnly(files: readonly string[]): string[] {
  return files.filter((name) => {
    const ext = extensionOf(name)
    return canAnalyzeStructurally(ext) && !canIndex(ext)
  })
}

/**
 * The content of every attached workbook the computed path did not speak for.
 *
 * `computedFor` is the file that already produced figures this turn, if any. It
 * is excluded so the prompt never carries MigraPilot's arithmetic and the raw
 * cells behind it as two separate claims about the same numbers.
 *
 * A file that cannot be read produces NOTHING rather than a placeholder. An
 * entry whose text is its own filename is worse than absence: `budget-2026.xlsx`
 * contains the words "budget" and "2026", so a sentence could ground itself in a
 * workbook nobody opened.
 */
export async function sheetContentEvidenceFor(
  activeFiles: readonly string[],
  uploadRoot: string,
  computedFor: string | null = null,
  /**
   * Where each file sits in the conversation's ordering, 1-based.
   *
   * 🚨 THE EVIDENCE CARRIES ITS OWN POSITION. "What budget does the first
   * document give?" was answered with the SECOND document's figure, on a turn
   * whose trace proved the order was resolved correctly and whose model, asked
   * directly, named the right file as number 1. It knew which file was first and
   * still read the wrong block, because the ordinal lived in a preamble and the
   * filename lived on the block — a join the model had to make and sometimes
   * did not.
   *
   * Stating the position ON the evidence removes the join. It is not a hint
   * about phrasing; it is the same identity the preamble already gives, written
   * where the values are.
   */
  positions: Readonly<Record<string, number>> = {},
): Promise<SheetContentEvidence[]> {
  const candidates = structuredOnly(activeFiles).filter((name) => name !== computedFor)
  const out: SheetContentEvidence[] = []

  for (const fileName of candidates) {
    try {
      const workbook = readWorkbook(await readFile(join(uploadRoot, fileName)))
      const rendered = workbookText(workbook.sheets)
      if (rendered.text.trim() === '') continue

      out.push({
        file: fileName,
        complete: rendered.complete,
        sheetNames: workbook.sheets.map((sheet) => sheet.name).filter((n) => n.trim() !== ''),
        text: composeEvidence({
          fact: [
            `[Read directly from ${fileName}${
              positions[fileName] ? ` — this is document ${positions[fileName]} of the attached files` : ''
            } by MigraPilot. These are the stored cell values,`,
            `sheet by sheet, exactly as the file holds them. Use them verbatim.`,
            ...(rendered.complete
              ? []
              : [
                  `🚨 This workbook was TRUNCATED — it holds more than is shown here, so do not`,
                  `describe this as the whole file or count anything as a total of it.`,
                ]),
            `MigraPilot has NOT calculated anything from these cells; state only what is written:]`,
            rendered.text,
          ],
          directives: [],
        }),
      })
    } catch (error) {
      // A workbook that cannot be opened is reported by the paths that own that
      // message. Silence here, never a guess about what it might have said.
      if (error instanceof WorkbookError) continue
      continue
    }
  }

  return out
}
