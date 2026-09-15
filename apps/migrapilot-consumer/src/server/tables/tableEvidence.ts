import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parseTable, TableParseError, type ParsedTable, type TableColumn } from './parseTable'
import { computeColumn, groupBy, isTotalsLabel, ComputationRefused, type Operation } from './computeTable'
import { readWorkbook, WorkbookError } from '@migrapilot/shared-types/workbook'
import { chooseSheet, sheetToTable } from './workbookTable'
import { composeEvidence } from '@/server/evidence/composition'

/**
 * Answering a quantitative question with arithmetic instead of prediction.
 *
 * 🚨 THE RULE THIS ENFORCES: the model does not foot the table. It was reading
 * CSV correctly and then returning 473,250 and 473,000 for a column that sums to
 * 474,000. Here the figures are COMPUTED, handed to the model as evidence, and
 * the model's remaining job is to say them in a sentence.
 *
 * IT REFUSES RATHER THAN GUESSES. A question this cannot map onto a column, a
 * column that is not quantitative, a file that will not parse — each returns
 * nothing, and the turn proceeds as an ordinary grounded answer. Producing a
 * confident number from an uncertain reading is the failure being removed, and
 * doing it in a new place would not be an improvement.
 */

const TABLE_EXTENSIONS = /\.(csv|tsv|xlsx)$/i
const WORKBOOK_EXTENSION = /\.xlsx$/i

/** Which operation the question is asking for, if any. */
function detectOperation(prompt: string): Operation | 'group' | 'describe' | 'list' | 'lookup' | null {
  const p = prompt.toLowerCase()
  /*
   * 🚨 "SUMMARISE THIS SPREADSHEET" IS A QUESTION THIS CAN ANSWER.
   *
   * It used to fall through to null, so a workbook produced no evidence and the
   * turn was refused with "general document search inside spreadsheets is not
   * available yet" — truthful about prose retrieval, and useless, because the
   * sheet, its columns, its row count and its totals were all sitting right
   * there. Refusing something the deterministic layer can do is the same defect
   * as a dead control: the capability exists and was not offered.
   *
   * Checked FIRST: "summarise the revenue" is still a summary of the file, and
   * the describe evidence names every column including that one.
   */
  if (/\b(summar(y|ise|ize|ised|ized)|describe|overview|walk me through|what.s in|whats in|tell me about)\b/.test(p)) {
    return 'describe'
  }
  if (/\b(per|by|each|breakdown|group)\b/.test(p) && /\b(total|sum|revenue|amount)\b/.test(p)) return 'group'
  if (/\b(total|sum|summed|altogether|combined|add up)\b/.test(p)) return 'sum'
  if (/\b(average|mean|avg)\b/.test(p)) return 'average'
  if (/\b(highest|largest|biggest|max|maximum|most|top)\b/.test(p)) return 'max'
  if (/\b(lowest|smallest|min|minimum|least)\b/.test(p)) return 'min'
  if (/\bhow many\b|\bcount\b|\bnumber of rows\b/.test(p)) return 'count'

  /*
   * 🚨 ENUMERATION IS A STRUCTURED OPERATION, NOT DOCUMENT SEARCH.
   *
   * MEASURED, in the real product. Asked
   *
   *   "List the four Revenue values from the spreadsheet, exactly as they appear."
   *
   * nothing above matched, `detectOperation` returned null, no evidence was
   * produced, and the turn was refused with "general document-style text search
   * inside spreadsheets is not available yet … Ask about a total, a column or a
   * sheet instead."
   *
   * The user HAD asked about a column. The refusal advised doing the thing that
   * had just been done, which tells someone the product is broken and gives
   * them nowhere to go. Worse, the capability existed the whole time: the cells
   * were parsed, typed and sitting in memory.
   *
   * LAST, deliberately. "List the total by region" is a grouped total that
   * happens to start with "list", and "show me the highest value" is a max —
   * an explicit aggregation always wins over the enumeration phrasing.
   */
  if (/\b(list|enumerate)\b/.test(p)) return 'list'
  if (/\bexactly as they appear\b|\bverbatim\b/.test(p)) return 'list'
  if (/\b(what|which) are the\b/.test(p) && /\bvalues?\b/.test(p)) return 'list'
  if (/\bshow (me )?(all |the )*(values|entries)\b/.test(p)) return 'list'
  if (/\ball (of )?the values\b/.test(p)) return 'list'

  /*
   * 🚨 A ROW LOOKUP IS THE MOST ORDINARY SPREADSHEET QUESTION THERE IS.
   *
   * "On the Q1 Sales sheet, what revenue is listed for East?" named no
   * aggregation, so nothing above matched, no evidence was produced, and the
   * turn reached the model with a workbook it could not see. It answered
   * "$54,212" about a cell reading 25443.75 — a figure invented out of nothing.
   * The refusal that now stands in its place is honest but still a "no" to a
   * question any spreadsheet tool answers.
   *
   * THIS PATTERN DECIDES NOTHING. It is a cheap gate that says "worth opening
   * the file", and it is deliberately weak because the real question — is a row
   * named here? — cannot be answered from the prompt alone. `findRowByLabel`
   * answers it from the FILE, and returns null when the prompt names no row, at
   * which point the turn falls back to the truthful refusal exactly as before.
   *
   * That is why a trailing question mark is enough to try: "Flange on hand?" is
   * an ordinary question with no interrogative in it, and letting it through
   * costs nothing — "What is the capital of France?" trips the same gate and
   * still comes back with nothing, because no row of the file is named in it.
   */
  if (/\b(what|which|how much|how many|what's|whats)\b/.test(p) || /\?\s*$/.test(p)) return 'lookup'
  return null
}

/**
 * Which ROW is this question about?
 *
 * 🚨 DECIDED FROM THE FILE, NOT FROM THE PHRASING. The prompt is searched for
 * values that actually appear in a label column, so "what revenue is listed for
 * East", "East revenue?" and "how much did East do" all resolve by the same
 * mechanism — the row is named — while a question that names no row resolves to
 * nothing and is refused rather than guessed at.
 *
 * Three guards, each paid for by a failure this codebase has already had:
 *  · a totals row is never a lookup target — it is a summary, not an observation
 *  · labels shorter than three characters are skipped, because "NY" or "A"
 *    appear inside ordinary words and would match half the prompts ever written
 *  · MORE than one matching row is ambiguity, and ambiguity is reported rather
 *    than resolved by picking the first — the same rule the column choice follows
 */
function findRowByLabel(
  prompt: string,
  table: ParsedTable,
): { kind: 'row'; index: number; label: string } | { kind: 'ambiguous'; labels: string[] } | null {
  const haystack = prompt.toLowerCase()
  const labelColumns = table.columns.filter((c) => !c.quantitative)
  const hits = new Map<number, string>()

  table.rows.forEach((row, i) => {
    for (const column of labelColumns) {
      const raw = (row[column.index]?.raw ?? '').trim()
      if (raw.length < 3 || isTotalsLabel(raw)) continue
      // Whole-word, so "East" does not match "Easter" and a label that happens
      // to be a substring of another word is not a hit.
      const escaped = raw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack)) {
        hits.set(i, raw)
        return
      }
    }
  })

  if (hits.size === 0) return null
  if (hits.size > 1) return { kind: 'ambiguous', labels: [...hits.values()] }
  const [index, label] = [...hits.entries()][0]!
  return { kind: 'row', index, label }
}


/**
 * The column to ENUMERATE — which is not the same question as which column to
 * compute with.
 *
 * `chooseValueColumn` requires `quantitative`, and rightly: summing postcodes
 * is meaningless. Listing them is not. "What are the ZIP codes in this file"
 * is an ordinary question with an exact answer, so enumeration accepts any
 * column and keeps identifier semantics where they belong — on arithmetic.
 *
 * Ambiguity is handled identically to computation: named wins, several named
 * asks, none named with several columns asks. Never a guess.
 */
function chooseListColumn(prompt: string, table: ParsedTable): ColumnChoice {
  const p = prompt.toLowerCase()
  const named = table.columns.filter((c) => c.name && p.includes(c.name.toLowerCase()))
  if (named.length === 1) return { kind: 'column', column: named[0]! }
  if (named.length > 1) return { kind: 'clarify', candidates: named.map((c) => c.name) }
  if (table.columns.length === 1) return { kind: 'column', column: table.columns[0]! }
  return { kind: 'clarify', candidates: table.columns.map((c) => c.name) }
}

/**
 * The column the question is about — or an explicit refusal.
 *
 * A named column wins. A named column that CANNOT be computed refuses; it never
 * falls through to another one. Only a question that named nothing may take the
 * "exactly one quantitative column" shortcut, and with several it declines
 * rather than picking one and being confidently wrong about which number the
 * user meant.
 */
function chooseValueColumn(prompt: string, table: ParsedTable): ColumnChoice {
  const p = prompt.toLowerCase()
  const named = table.columns.filter((c) => c.name && p.includes(c.name.toLowerCase()))
  const namedQuantitative = named.filter((c) => c.quantitative)
  if (namedQuantitative.length === 1) return { kind: 'column', column: namedQuantitative[0]! }

  /*
   * 🚨 A NAMED COLUMN IS NEVER SILENTLY SWAPPED FOR ANOTHER ONE.
   *
   * MEASURED, in the real product: asked "What is the total Revenue in this
   * file?" over a file whose Revenue column had one `n/a`, this fell through to
   * the branch below and computed the sum of the ZIPCODE column — then handed it
   * to the model as "exact arithmetic … use verbatim and do not recalculate".
   * The user asked about revenue and was answered about postcodes, with an
   * authority claim attached.
   *
   * If the question names columns, the answer comes from one of THOSE or from
   * nowhere. `refused` carries the reason so the turn can say what it could not
   * do, rather than going quiet and letting the model foot the table itself —
   * which is the exact failure this whole module exists to remove.
   */
  if (named.length > 0) {
    if (namedQuantitative.length > 1) {
      return { kind: 'refused', reason: `the question names more than one column that could be totalled` }
    }
    const [only] = named
    return {
      kind: 'refused',
      reason:
        named.length === 1 && only
          // Named for WHAT IT IS — an identifier, a date, text — because a
          // generic reason gets restated as a specific and wrong one.
          ? refusalReasonFor(table, only)
          : `no column named in the question holds values that can be calculated with`,
    }
  }

  const quantitative = table.columns.filter((c) => c.quantitative)
  if (quantitative.length === 1) return { kind: 'column', column: quantitative[0]! }

  /*
   * 🚨 AMBIGUITY IS ASKED ABOUT, NOT GUESSED AT — AND NOT PASSED OVER IN SILENCE.
   *
   * MEASURED: "What is the total?" over a file with Revenue AND Cost produced no
   * evidence, correctly — and the model then footed the table itself and
   * answered "$60,000". It was right, on three rows. On the five-thousand-row
   * file it is the original defect, and nothing here would have stopped it.
   *
   * The same reasoning that made a refusal SPEAK applies here and was not
   * applied: silence leaves the model holding a table and a question about a
   * total. So the candidates are named and the turn asks which was meant.
   */
  if (quantitative.length > 1) {
    return { kind: 'clarify', candidates: quantitative.map((c) => c.name) }
  }
  return { kind: 'none' }
}

/**
 * Which column to compute, or why not.
 *
 * `none` means the question did not point at anything — an ordinary turn, no
 * evidence, nothing to say. `refused` means it DID point somewhere and that
 * place cannot be totalled, which the model must be told so it does not invent
 * a figure instead.
 */
type ColumnChoice =
  | { kind: 'column'; column: TableColumn }
  | { kind: 'refused'; reason: string }
  /** Several columns could be meant and none was named. Ask, never pick. */
  | { kind: 'clarify'; candidates: string[] }
  | { kind: 'none' }

/** A label column for min/max — the first non-quantitative column, which is
 *  overwhelmingly the name/region/category the user wants back. */
function chooseLabelColumn(table: ParsedTable, exclude: TableColumn): TableColumn | undefined {
  return table.columns.find((c) => !c.quantitative && c.index !== exclude.index)
}

/** `where status=active` / `for active rows` — only the explicit, unambiguous form. */
function detectFilter(prompt: string, table: ParsedTable): { column: TableColumn; equals: string } | null {
  const m = /\b(?:where|with|for)\s+([A-Za-z_][\w ]{0,30}?)\s*(?:=|is|equals)\s*"?([\w-]+)"?/i.exec(prompt)
  if (!m) return null
  const column = table.columns.find((c) => c.name.toLowerCase() === m[1]!.trim().toLowerCase())
  return column ? { column, equals: m[2]! } : null
}

const fmt = (n: number): string =>
  Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 6 })

/**
 * A figure in the units the FILE used.
 *
 * 🚨 A percentage is stored as its fraction so that averaging it is correct, and
 * that fraction was reaching the model undressed: the average of a Margin column
 * arrived as `0.1275` and the answer said 0.1275 about a file that says 12.75%.
 * Computation and presentation want different forms of the same number.
 */
const fmtIn = (n: number, column: TableColumn): string =>
  column.percent ? `${fmt(Number((n * 100).toFixed(6)))}%` : fmt(n)

/** "1 rows" reaches the model verbatim, so it is written the way a person would. */
const rows = (n: number): string => `${n} row${n === 1 ? '' : 's'}`

export interface TableEvidence {
  /** Prepended to the model's prompt. Never stored as the user's message. */
  text: string
  /** For the turn trace. */
  file: string
  operation: string
  /** Which sheet the figures came from, when the source was a workbook. */
  sheet?: string
  /**
   * This description was built from a workbook's structure, with no cell text read.
   *
   * Structured metadata for the same reason `formulaDerived` is: the evidence
   * already ASKED the model to state the boundary and it complied on one prompt
   * and not another, answering "there are no written commentary or narrative
   * paragraphs" — a claim about text nobody read. For this file that happened to
   * be true; for a workbook with prose in its cells it would be a fabrication.
   */
  workbookBoundary?: boolean
  /**
   * The figures came from values a spreadsheet computed and SAVED.
   *
   * Structured metadata, not a sentence in the prompt. The provenance line was
   * already in the evidence text and the model simply did not repeat it, so the
   * user was told "The total Amount is 30" with no indication the number came
   * from stored formula results. A disclosure that depends on the model choosing
   * to make it is not a disclosure.
   */
  formulaDerived?: boolean
  /**
   * How many rows the AUTHOR labelled "Total" were left out of the arithmetic.
   *
   * Structured for the same reason `formulaDerived` is: the provenance line was
   * already in the evidence text and a model that does not repeat it leaves the
   * user with a figure that silently disagrees with the total printed in their
   * own sheet. A disclosure that depends on the model choosing to make it is not
   * a disclosure.
   */
  summaryRowsExcluded?: number
}


/**
 * Load the attached table, whatever container it arrived in.
 *
 * ONE DOWNSTREAM PATH. A workbook becomes the same ParsedTable a CSV becomes, so
 * column selection, the identifier rules, the 90% bar, ambiguity and the
 * arithmetic below are literally the same code for both. The only thing that
 * differs is what had to be read to get here.
 */
type LoadedTable =
  | { kind: 'table'; table: ParsedTable; sheetName?: string; formulaColumns: number[] }
  /** Every sheet, for a whole-workbook description. */
  | { kind: 'workbook'; sheets: readonly import('@migrapilot/shared-types/workbook').WorkbookSheet[] }
  | { kind: 'refused'; reason: string }
  | { kind: 'none' }

async function loadTable(
  prompt: string,
  fileName: string,
  uploadRoot: string,
  // 'list' is accepted but only compared against 'describe' below: an
  // ambiguous workbook cannot be enumerated either, so it takes the same
  // "which sheet did you mean" refusal rather than picking one.
  operation: Operation | 'group' | 'describe' | 'list' | 'lookup',
): Promise<LoadedTable> {
  const path = join(uploadRoot, fileName)

  if (!WORKBOOK_EXTENSION.test(fileName)) {
    try {
      return { kind: 'table', table: parseTable(await readFile(path, 'utf8')), formulaColumns: [] }
    } catch (error) {
      // A parse failure is not an answer. The turn continues as ordinary grounding.
      if (error instanceof TableParseError) return { kind: 'none' }
      return { kind: 'none' }
    }
  }

  let workbook
  try {
    workbook = readWorkbook(await readFile(path))
  } catch (error) {
    /*
     * A workbook that cannot be read is STATED rather than passed over. The user
     * attached a spreadsheet and asked about a total; silence there invites the
     * model to read the file some other way and produce a figure, which is the
     * failure this whole lane exists to prevent. The message says what kind of
     * problem it is without describing internals.
     */
    if (error instanceof WorkbookError) {
      return { kind: 'refused', reason: error.message }
    }
    return { kind: 'none' }
  }

  const choice = chooseSheet(prompt, workbook.sheets)
  if (choice.kind === 'none') return { kind: 'none' }
  /*
   * 🚨 AMBIGUITY MATTERS FOR A TOTAL, NOT FOR A SUMMARY.
   *
   * "The total Amount" across two sheets is genuinely ambiguous and must refuse.
   * "Summarise this workbook" is not — the honest answer covers every sheet, and
   * refusing it repeats the mistake of declining something the deterministic
   * layer can do perfectly well.
   */
  if (choice.kind === 'ambiguous' && operation === 'describe') {
    return { kind: 'workbook', sheets: workbook.sheets }
  }
  if (choice.kind === 'ambiguous') {
    /*
     * NEVER SILENTLY SUBSTITUTE ANOTHER SHEET. "The total" across sheets is a
     * different question, and taking the first one would be confidently wrong
     * about which number was meant — the same rule the delimited path applies
     * when two files are attached.
     */
    const names = choice.names.map((n) => `"${n}"`).join(', ')
    return {
      kind: 'refused',
      reason: `the workbook has more than one sheet (${names}) and the question does not say which one`,
    }
  }

  try {
    const table = sheetToTable(choice.sheet)
    return {
      kind: 'table',
      table,
      sheetName: table.sheetName,
      formulaColumns: table.formulaColumns,
    }
  } catch (error) {
    if (error instanceof TableParseError) return { kind: 'none' }
    return { kind: 'none' }
  }
}


/**
 * What a sheet IS: its shape, what each column holds, and the totals that are
 * genuinely quantities. Shared by the single-sheet and whole-workbook cases so
 * the two can never describe the same column differently.
 */
function describeLines(table: ParsedTable, formulaColumns: readonly number[], label: string): string[] {
  const lines: string[] = [`${label} — ${rows(table.rows.length)}, ${table.headers.length} columns.`]
  for (const column of table.columns) {
    if (!column.name) continue
    if (column.quantitative) {
      try {
        const total = computeColumn(table, column, 'sum')
        const blank = total.provenance.rowsBlank ? `, ${total.provenance.rowsBlank} blank` : ''
        lines.push(
          `  "${column.name}": ${column.percent ? 'percentages' : 'numeric'}, ` +
          `totals ${fmtIn(total.value, column)} over ${rows(total.provenance.rowsUsed)}${blank}`,
        )
      } catch (error) {
        if (!(error instanceof ComputationRefused)) throw error
        lines.push(`  "${column.name}": numeric`)
      }
    } else {
      /*
       * ONE CLASSIFIER, read here and by the refusal path. These used to decide
       * separately: the description knew `Booked` was "dates or codes" while the
       * refusal called it "too few to total", and the model believed the refusal.
       */
      const blank = column.blankCells ? `, ${column.blankCells} blank` : ''
      const kind = classifyNonQuantitative(table, column)
      lines.push(
        kind === 'identifier-name'
          ? `  "${column.name}": identifies rows — not a quantity, never totalled`
          : kind === 'dates-or-codes'
            ? `  "${column.name}": dates or codes — not a quantity, never totalled${blank}`
            : `  "${column.name}": text or labels${blank}`,
      )
    }
  }
  if (formulaColumns.length > 0) {
    const named = formulaColumns.map((i) => `"${table.headers[i] ?? i}"`).join(', ')
    lines.push(`  ${named} hold values the spreadsheet computed and saved; MigraPilot did not recalculate them.`)
  }
  return lines
}

/**
 * WHY a column cannot be computed on — the cause, not a symptom of it.
 *
 * 🚨 THE DEFECT THIS EXISTS TO FIX. `chooseValueColumn` had exactly two refusal
 * reasons for a named column: "identifies rows" when the HEADER said so, and
 * otherwise a numeric-scarcity sentence — "holds 0 values that can be calculated
 * with, out of 4 that are not empty — too few to total".
 *
 * A date column is neither. `Booked` holds four perfectly good dates, so it fell
 * to the scarcity branch, and production said:
 *
 *     "The 'Booked' column contains 4 non-empty values, but none of them can be
 *      used to calculate a total. There is not enough data to provide an
 *      accurate answer."
 *
 * Every clause traceable to our reason, and the conclusion false. The file is
 * not short of data. Dates are simply not a thing you total — a categorically
 * different fact from "too few values", and one that blames the user's file for
 * a limit that is ours.
 *
 * A reason that is true-but-generic gets restated as something specific and
 * wrong. So the cause is classified once, here, and both the description and the
 * refusal read it — they cannot disagree about what a column is.
 */
/**
 * What the model is told to do with a refusal — ONE copy, read by every refusal site.
 *
 * 🚨 THE SUBSTITUTION IS THE DEFECT. The directive used to say only "say so
 * plainly", and a date-column refusal came back as "There is not enough data to
 * provide an accurate answer" — the model swapping our reason for a plausible
 * one, which blamed the user's file for a limit that is ours. Naming the wrong
 * answer explicitly is the only version that has held.
 *
 * There were two refusal sites and they had drifted; a fix applied to one would
 * have left the other saying the old thing.
 */
const REFUSAL_DIRECTIVE = [
  `Give THAT reason to the user — do not substitute a different one.`,
  `Never say the file lacks data, is missing values, has too few values, or that any of its`,
  `cells are invalid, bad or wrong. Values MigraPilot cannot total are still perfectly good`,
  `entries — "pending" in a readings column is data, not an error. The limit is MigraPilot's,`,
  `never a fault in their file.`,
  `Do NOT add the numbers up yourself and do NOT estimate a total —`,
  `an invented figure here is worse than no answer. You may still describe the file.]`,
]

export type ColumnRefusalKind = 'identifier-name' | 'dates-or-codes' | 'text' | 'mixed-with-text'

export function classifyNonQuantitative(table: ParsedTable, column: TableColumn): ColumnRefusalKind {
  // The header settles this one: `94105` is a fine number and a fine ZIP code.
  if (column.identifierName) return 'identifier-name'

  const filled = table.rows
    .map((r) => r[column.index])
    .filter((c): c is NonNullable<typeof c> => Boolean(c) && c!.kind !== 'blank')

  if (filled.length === 0) return 'text'
  const idLike = filled.filter((c) => c.kind === 'identifier').length
  if (idLike / filled.length >= 0.9) return 'dates-or-codes'
  /*
   * Some numbers among text. NOT a shortage — a MIXTURE. Framing it as "too few"
   * implies the file would work with more numbers, which is an accusation about
   * the user's data; the truth is that a column mixing prose with quantities is
   * not a quantity column at all.
   */
  if (column.numericCells > 0) return 'mixed-with-text'
  return 'text'
}

/** The refusal sentence for a named column that cannot be totalled. */
export function refusalReasonFor(table: ParsedTable, column: TableColumn): string {
  const notEmpty = table.rows.length - column.blankCells
  switch (classifyNonQuantitative(table, column)) {
    case 'identifier-name':
      return `"${column.name}" identifies rows rather than measuring them, so totalling it would not mean anything`
    case 'dates-or-codes':
      // Names the cause. "Not enough data" is not available as a paraphrase of
      // this sentence, which is the entire point of it.
      return `"${column.name}" holds dates or codes, not quantities — adding them together would not mean anything`
    case 'text':
      return `"${column.name}" holds text rather than numbers, so there is nothing to total`
    case 'mixed-with-text':
      /*
       * 🚨 MEASURED IN PRODUCTION. This used to read "holds 1 value that can be
       * calculated with, out of 5 that are not empty — too few to total", and the
       * reply came back: "the data lacks the necessary quantity of numeric
       * entries … the remaining 4 cells contain non-numeric or INVALID data".
       *
       * Both halves wrong. The cells hold "pending", "not taken", "sensor
       * offline" — ordinary, valid entries in a column someone keeps by hand.
       * Nothing about them is invalid, and the column is not short of anything.
       * It simply is not a column of quantities.
       */
      return (
        `"${column.name}" mixes text with numbers — only ${column.numericCells} of its ${notEmpty} ` +
        `entries is a quantity, and the rest are ordinary text — so it is not a column that can be totalled`
      )
  }
}

const DESCRIBE_HEADER = (source: string): string[] => [
  `[Computed directly from ${source} by MigraPilot. This is the file's real`,
  `structure and exact arithmetic, not an impression of it. Use these figures`,
  `verbatim and do not recalculate them. Describe the file to the user from this:]`,
]

/**
 * The boundary, stated inside the evidence for a workbook.
 *
 * 🚨 A USEFUL SUMMARY MUST NOT BECOME AN OVERCLAIM — IN EITHER DIRECTION. The
 * description is built from structure, labels and computed values, so a model
 * handed it will happily conclude "there is no narrative content here", a claim
 * about prose nobody retrieved.
 *
 * The first version of this note over-corrected. It told the model "MigraPilot
 * cannot search the text inside a spreadsheet", and production came back with
 * "no text content within cells is accessible … it cannot process or interpret
 * text within spreadsheet cells" — false, and contradicted by the sheet names
 * and column labels in the same reply, all of which are cell text this layer
 * read. A directive phrased as a capability denial gets restated as a bigger
 * one.
 *
 * So this states the boundary as a fact about RETRIEVAL and explicitly forbids
 * the denial. The user-facing sentence is appended by the route regardless; this
 * only stops the model contradicting it.
 */
const WORKBOOK_BOUNDARY =
  '  (This description comes from the sheet structure, labels and computed values above. ' +
  'Those labels ARE cell text, so never say MigraPilot cannot read, process or interpret ' +
  'the text in cells — it can. What does not exist yet is document-style text search across ' +
  'a spreadsheet, so draw no conclusion about prose elsewhere in the file.)'

const isWorkbook = (fileName: string): boolean => WORKBOOK_EXTENSION.test(fileName)

/**
 * Compute an answer for a quantitative question over one attached table.
 *
 * Returns null whenever anything is uncertain — no table attached, no
 * recognisable operation, no unambiguous column, a parse failure, a refusal.
 */
export async function tableEvidenceFor(
  prompt: string,
  activeFiles: readonly string[],
  uploadRoot: string,
): Promise<TableEvidence | null> {
  const tables = activeFiles.filter((f) => TABLE_EXTENSIONS.test(f))
  // Exactly one, deliberately: "the total" across two files is a different
  // question and guessing which one is meant is how this went wrong before.
  if (tables.length !== 1) return null

  const operation = detectOperation(prompt)
  if (!operation) return null

  const fileName = tables[0]!
  const loaded = await loadTable(prompt, fileName, uploadRoot, operation)
  if (loaded.kind === 'none') return null
  if (loaded.kind === 'refused') {
    /*
     * 🚨 EXCEPT FOR A SPECULATIVE LOOKUP, WHICH STAYS SILENT.
     *
     * Every other operation was named by the user — "the total", "the highest" —
     * so a load failure is genuinely about their question and saying so helps.
     * `lookup` is different: it is reached by a weak gate that any "what…"
     * question trips, so "What is the capital of France?" with a workbook
     * attached would otherwise inject "MigraPilot could not calculate this from
     * regional-sales-2026.xlsx" into a turn that was never about the file.
     */
    if (operation === 'lookup') return null
    /*
     * A load-level refusal is stated, not swallowed. An ambiguous workbook is
     * the same shape of problem as an ambiguous column: going quiet leaves the
     * model holding a spreadsheet and a question about a total, which is the
     * situation that produces a confident wrong number.
     */
    return {
      file: fileName,
      operation: `refused:${operation}`,
      text: composeEvidence({
        fact: [`[MigraPilot could not calculate this from ${fileName}: ${loaded.reason}.`],
        directives: REFUSAL_DIRECTIVE,
      }),
    }
  }
  if (loaded.kind === 'workbook') {
    const lines: string[] = []
    for (const sheet of loaded.sheets) {
      try {
        const sheetTable = sheetToTable(sheet)
        lines.push(...describeLines(sheetTable, sheetTable.formulaColumns, `sheet "${sheet.name}"`))
      } catch (error) {
        // A sheet that is not a table is REPORTED, not skipped silently.
        if (error instanceof TableParseError) {
          lines.push(`sheet "${sheet.name}" — not a table with a header row and data.`)
        } else throw error
      }
    }
    return {
      file: fileName,
      operation: 'describe',
      workbookBoundary: true,
      text: composeEvidence({
        fact: [...DESCRIBE_HEADER(`${fileName} (${loaded.sheets.length} sheets)`), ...lines],
        directives: [WORKBOOK_BOUNDARY],
      }),
    }
  }

  const { table, sheetName, formulaColumns } = loaded
  /** Names the workbook AND the sheet, so a figure can be traced to where it came from. */
  const source = sheetName ? `${fileName} (sheet "${sheetName}")` : fileName

  /*
   * 🚨 COUNTING NEEDS NO VALUE COLUMN, and requiring one silenced it entirely.
   *
   * "How many rows are in this file?" resolved to `count`, then fell through
   * column selection — several columns were quantitative, none was named — and
   * produced NO evidence at all, so the one operation that is impossible to get
   * wrong was answered by the model from raw text.
   *
   * A count is also not arithmetic ON the values, so an identifier column is a
   * perfectly good thing to count: "how many order ids are there" is a real
   * question and refusing it would be pedantry. It counts what is THERE, and
   * says which of the two things it counted.
   */
  /*
   * A STRUCTURAL SUMMARY, COMPUTED — never a model's impression of the file.
   *
   * Says what the sheet IS: how many rows, what each column holds, and the total
   * of anything genuinely quantitative. Identifier and date columns are named as
   * such rather than totalled, which is the same rule every other operation here
   * obeys.
   */
  if (operation === 'describe') {
    return {
      file: fileName,
      ...(sheetName ? { sheet: sheetName } : {}),
      ...(formulaColumns.length > 0 ? { formulaDerived: true } : {}),
      ...(isWorkbook(fileName) ? { workbookBoundary: true } : {}),
      operation: 'describe',
      text: composeEvidence({
        fact: [...DESCRIBE_HEADER(source), ...describeLines(table, formulaColumns, source)],
        directives: isWorkbook(fileName) ? [WORKBOOK_BOUNDARY] : [],
      }),
    }
  }

  /*
   * 🚨 "HOW MANY UNITS FOR WEST" IS A LOOKUP WEARING A COUNT'S CLOTHES.
   *
   * `detectOperation` sees "how many" and returns `count`, which asks how many
   * ROWS there are — a question about the table as a whole. Naming one row
   * contradicts that: nobody asks how many rows there are and then says which
   * row they mean. So when a count names exactly one row, the row wins.
   *
   * Only `count`, and only for an unambiguous single row. "The total revenue for
   * East" is a genuine aggregate with a filter and must stay one.
   */
  const countNamesOneRow =
    operation === 'count' && findRowByLabel(prompt, table)?.kind === 'row'

  if (operation === 'lookup' || countNamesOneRow) {
    const found = findRowByLabel(prompt, table)
    if (!found) return null

    if (found.kind === 'ambiguous') {
      return {
        file: fileName,
        ...(sheetName ? { sheet: sheetName } : {}),
        operation: 'clarify:lookup',
        text: composeEvidence({
          fact: [
            `[MigraPilot did not read a row out of ${source}: the question names more than one`,
            `row — ${found.labels.map((l) => `"${l}"`).join(', ')}.`,
          ],
          directives: [
            `Ask which one is meant. Do NOT read values out of the file yourself and do NOT pick a row on the user's behalf.]`,
          ],
        }),
      }
    }

    const row = table.rows[found.index]!
    const cells = table.columns.map((c) => {
      const raw = (row[c.index]?.raw ?? '').trim()
      return `  ${c.name}: ${raw === '' ? '(blank)' : raw}`
    })
    const isFormula = table.columns.some((c) => formulaColumns.includes(c.index))

    return {
      file: fileName,
      ...(sheetName ? { sheet: sheetName } : {}),
      ...(isFormula ? { formulaDerived: true } : {}),
      operation: 'lookup',
      text: composeEvidence({
        fact: [
          `[Read directly from ${source} by MigraPilot. This is the one row labelled`,
          `"${found.label}", cell by cell, exactly as the file stores it. Answer the question`,
          `from these values verbatim; do not recalculate them and do not use any other row:]`,
          `row "${found.label}":`,
          ...cells,
        ],
        directives: [],
      }),
    }
  }

  if (operation === 'count') {
    const named = table.columns.filter((c) => c.name && prompt.toLowerCase().includes(c.name.toLowerCase()))
    const target = named.length === 1 ? named[0]! : undefined
    const filled = target
      ? table.rows.filter((r) => r[target.index] && r[target.index]!.kind !== 'blank').length
      : table.rows.length
    return {
      file: fileName,
      ...(sheetName ? { sheet: sheetName } : {}),
      operation: 'count',
      text: composeEvidence({
        fact: [
          `[Computed directly from ${source} by MigraPilot. These figures are exact`,
          `arithmetic over the parsed file, not estimates. Use them verbatim and do not`,
          `recalculate them:]`,
          target
            ? `count of values in "${target.name}": ${filled} (of ${rows(table.rows.length)})`
            : `count of rows: ${filled}`,
        ],
        directives: [],
      }),
    }
  }

  /*
   * ENUMERATION — the values themselves, exactly as the file wrote them.
   *
   * `cell.raw` is used rather than the parsed number precisely because the
   * question is usually "as they appear": "$12,500" must come back as
   * "$12,500", not 12500. Reformatting here would answer a question nobody
   * asked and quietly discard the currency symbol, which is provenance.
   *
   * Bounded, and truthful about the bound. A 5,000-row column cannot go into a
   * prompt, and silently sending the first 50 as if they were all of them is
   * the fabrication this module exists to prevent — so the cap is stated and
   * the true row count travels with it.
   */
  /*
   * A SINGLE ROW, CELL BY CELL, EXACTLY AS STORED.
   *
   * The whole row rather than one guessed column: "what revenue is listed for
   * East", "how many units for East" and "tell me about East" are the same
   * lookup, and choosing a column on the user's behalf is the ambiguity this
   * module refuses everywhere else. Handing over every cell answers all of them
   * from evidence and leaves nothing to infer.
   *
   * `cell.raw` for the same reason the `list` path uses it: the stored literal
   * is what the file says, and a value re-rendered even slightly differently is
   * one the grounding gate can no longer find.
   */
  if (operation === 'list') {
    const picked = chooseListColumn(prompt, table)
    if (picked.kind === 'clarify') {
      return {
        file: fileName,
        ...(sheetName ? { sheet: sheetName } : {}),
        operation: 'clarify:list',
        text: composeEvidence({
          fact: [
            `[MigraPilot did not list values from ${source}: the question could mean more than one`,
            `column — ${picked.candidates.map((c) => `"${c}"`).join(', ')}.`,
          ],
          directives: [
            `Ask which one is meant. Do NOT read the values out of the file yourself and do NOT pick a column on the user's behalf.]`,
          ],
        }),
      }
    }
    if (picked.kind !== 'column') return null

    const column = picked.column
    const LIST_LIMIT = 50
    const all = table.rows.map((r) => r[column.index])
    const shown = all.slice(0, LIST_LIMIT)
    const truncated = all.length > LIST_LIMIT
    const isFormula = formulaColumns.includes(column.index)

    const values = shown.map((cell, i) => {
      /*
       * 🚨 EMPTINESS IS ABOUT THE TEXT, NOT THE ARITHMETIC KIND.
       *
       * `kind === 'blank'` covers a truly empty cell AND written non-values
       * like "n/a" — correct for computation, where neither may become a zero.
       * Keying the LABEL off it printed "(blank)" where the file says "n/a",
       * which is a fabrication in a list whose entire promise is "exactly as
       * they appear". The author wrote something; it gets reproduced.
       *
       * A genuinely empty cell is still NAMED rather than left as an empty
       * slot, because an unlabelled gap in a numbered list shifts nothing but
       * reads as an error — and a dropped row would shift every position after
       * it, so the nth value listed would stop being the nth row of the file.
       */
      const raw = cell?.raw ?? ''
      return `  ${i + 1}. ${raw.trim() === '' ? '(blank)' : raw}`
    })

    return {
      file: fileName,
      ...(sheetName ? { sheet: sheetName } : {}),
      ...(isFormula ? { formulaDerived: true } : {}),
      operation: 'list',
      text: composeEvidence({
        fact: [
          `[Read directly from ${source} by MigraPilot. These are the stored cell values,`,
          `reproduced exactly as the file writes them. Use them verbatim and do not reformat,`,
          `round or re-order them:]`,
          `values in "${column.name}" (${rows(all.length)}):`,
          ...values,
          ...(truncated
            ? [`… ${all.length - LIST_LIMIT} further row(s) not listed. This is the first ${LIST_LIMIT} of ${all.length}.`]
            : []),
          ...(isFormula
            ? [`Note: "${column.name}" is formula-derived; these are the values last cached in the workbook.`]
            : []),
        ],
        directives: truncated
          ? [`Say plainly that only the first ${LIST_LIMIT} of ${all.length} rows are shown. Do NOT present them as the complete set.]`]
          : [],
      }),
    }
  }

  const choice = chooseValueColumn(prompt, table)
  if (choice.kind === 'none') return null
  if (choice.kind === 'clarify') {
    return {
      file: fileName,
      ...(sheetName ? { sheet: sheetName } : {}),
      operation: `clarify:${operation}`,
      text: composeEvidence({
        fact: [
          `[MigraPilot did not calculate this from ${source}: the question could mean more than one`,
          `column — ${choice.candidates.map((c) => `"${c}"`).join(', ')}.`,
        ],
        directives: [
          // Kept on ONE line: the phrase is asserted whole, and a reflow that
          // splits it changes nothing semantically and breaks the guard anyway.
          `Ask which one is meant. Do NOT add the numbers up yourself and do NOT pick a column on the user's behalf.]`,
        ],
      }),
    }
  }
  if (choice.kind === 'refused') {
    /*
     * SAY WHAT COULD NOT BE DONE, rather than nothing at all.
     *
     * Going quiet here leaves the model holding a table and a question about a
     * total, which is precisely the situation that produced 473,250 and 367,500
     * for a column summing to 474,000. A stated limit is the one thing that
     * reliably stops it: it cannot be "used verbatim" into a wrong number.
     */
    return {
      file: fileName,
      ...(sheetName ? { sheet: sheetName } : {}),
      operation: `refused:${operation}`,
      text: composeEvidence({
        fact: [`[MigraPilot could not calculate this from ${source}: ${choice.reason}.`],
        directives: REFUSAL_DIRECTIVE,
      }),
    }
  }
  const value = choice.column

  const lines: string[] = []
  let formulaDerived = false
  let summaryRowsExcluded = 0
  try {
    if (operation === 'group') {
      const groupCol = table.columns.find((c) => !c.quantitative)
      if (!groupCol) return null
      const groups = groupBy(table, groupCol, value)
      if (groups.length === 0) return null
      lines.push(`${value.name} by ${groupCol.name}:`)
      for (const g of groups) lines.push(`  ${g.group}: ${fmtIn(g.value, value)} (${rows(g.rows)})`)
    } else {
      const filter = detectFilter(prompt, table)
      const result = computeColumn(table, value, operation, {
        ...(operation === 'max' || operation === 'min'
          ? { labelColumn: chooseLabelColumn(table, value) }
          : {}),
        ...(filter ? { filter } : {}),
      })

      const label = result.labels?.length
        ? ` (${result.tied ? 'tied: ' : ''}${result.labels.join(', ')})`
        : ''
      lines.push(`${operation} of "${value.name}": ${fmtIn(result.value, value)}${label}`)

      const p = result.provenance
      if (p.rowsSummary) summaryRowsExcluded = Math.max(summaryRowsExcluded, p.rowsSummary)
      const detail = [`${rows(p.rowsUsed)} used`]
      if (p.rowsBlank) detail.push(`${p.rowsBlank} blank`)
      if (p.rowsNonNumeric) detail.push(`${p.rowsNonNumeric} non-numeric`)
      if (p.rowsFiltered) detail.push(`${p.rowsFiltered} excluded by ${p.filter!.column}=${p.filter!.equals}`)
      if (p.rowsSummary) detail.push(`${p.rowsSummary} total row${p.rowsSummary > 1 ? 's' : ''} excluded`)
      if (p.malformedRows?.length) detail.push(`malformed rows: ${p.malformedRows.join(', ')}`)
      lines.push(`  (${detail.join(', ')})`)
      /*
       * 🚨 SAY WHERE A FORMULA'S VALUE CAME FROM. MigraPilot does not evaluate
       * spreadsheet formulas — there is no qualified calculation engine here, and
       * a partial one would be worse than none. What it read is the result the
       * spreadsheet itself last stored, so the provenance says exactly that
       * rather than implying the figure was recomputed.
       */
      if (formulaColumns.includes(value.index)) {
        formulaDerived = true
        lines.push(
          `  (values in "${value.name}" are the workbook's stored formula results, read as saved, not recalculated by MigraPilot)`,
        )
      }
    }
  } catch (error) {
    /*
     * A refusal is deliberate and specific — a non-quantitative column, or
     * nothing usable to compute. It is NOT turned into a number, and it is not
     * turned into a fabricated explanation either: the turn simply proceeds
     * without computed evidence.
     */
    if (error instanceof ComputationRefused) return null
    throw error
  }

  return {
    file: fileName,
    ...(sheetName ? { sheet: sheetName } : {}),
    ...(formulaDerived ? { formulaDerived: true } : {}),
    ...(summaryRowsExcluded > 0 ? { summaryRowsExcluded } : {}),
    operation,
    text: composeEvidence({
      fact: [
        `[Computed directly from ${source} by MigraPilot. These figures are exact`,
        `arithmetic over the parsed file, not estimates. Use them verbatim and do not`,
        `recalculate them:]`,
        ...lines,
      ],
      directives: [],
    }),
  }
}
