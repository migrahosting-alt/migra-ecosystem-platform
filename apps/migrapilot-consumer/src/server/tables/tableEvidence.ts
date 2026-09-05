import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parseTable, TableParseError, type ParsedTable, type TableColumn } from './parseTable'
import { computeColumn, groupBy, ComputationRefused, type Operation } from './computeTable'
import { readWorkbook, WorkbookError } from './readWorkbook'
import { chooseSheet, sheetToTable } from './workbookTable'

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
function detectOperation(prompt: string): Operation | 'group' | 'describe' | null {
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
  return null
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
          ? only.identifierName
            // Named for what it is: a code, not a measure. Saying THAT is more
            // use than a row count the reader cannot act on.
            ? `"${only.name}" identifies rows rather than measuring them, so totalling it would not mean anything`
            : `"${only.name}" holds ${only.numericCells} value${only.numericCells === 1 ? '' : 's'} that can be` +
              ` calculated with, out of ${table.rows.length - only.blankCells} that are not empty — too few to total`
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
  | { kind: 'workbook'; sheets: readonly import('./readWorkbook').WorkbookSheet[] }
  | { kind: 'refused'; reason: string }
  | { kind: 'none' }

async function loadTable(
  prompt: string,
  fileName: string,
  uploadRoot: string,
  operation: Operation | 'group' | 'describe',
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
    } else if (column.identifierName) {
      lines.push(`  "${column.name}": identifies rows — not a quantity, never totalled`)
    } else {
      /*
       * "text or labels" was true of a date column and useless. The cells know
       * what they are — a date renders as an identifier-shaped value — so this
       * says so rather than flattening everything non-numeric.
       */
      const cells = table.rows.map((r) => r[column.index]).filter(Boolean)
      const filled = cells.filter((c) => c!.kind !== 'blank')
      const idLike = filled.filter((c) => c!.kind === 'identifier').length
      const blank = column.blankCells ? `, ${column.blankCells} blank` : ''
      lines.push(
        filled.length > 0 && idLike / filled.length >= 0.9
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

const DESCRIBE_HEADER = (source: string): string[] => [
  `[Computed directly from ${source} by MigraPilot. This is the file's real`,
  `structure and exact arithmetic, not an impression of it. Use these figures`,
  `verbatim and do not recalculate them. Describe the file to the user from this:]`,
]

/**
 * The boundary, stated inside the evidence for a workbook.
 *
 * 🚨 A USEFUL SUMMARY MUST NOT BECOME AN OVERCLAIM. This description is built
 * from structure and computed values — no text inside the sheet was searched. A
 * model handed only the structure will happily conclude "there is no narrative
 * content here", which is a claim about text nobody read. Saying what the
 * description IS keeps `structured` from quietly reading as `indexed`.
 */
const WORKBOOK_BOUNDARY =
  '  (This description comes from the sheet structure and computed values. ' +
  'MigraPilot cannot search the text inside a spreadsheet, so say that plainly ' +
  'rather than concluding anything about prose the file may contain.)'

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
     * A load-level refusal is stated, not swallowed. An ambiguous workbook is
     * the same shape of problem as an ambiguous column: going quiet leaves the
     * model holding a spreadsheet and a question about a total, which is the
     * situation that produces a confident wrong number.
     */
    return {
      file: fileName,
      operation: `refused:${operation}`,
      text: [
        `[MigraPilot could not calculate this from ${fileName}: ${loaded.reason}.`,
        `Say so plainly. Do NOT add the numbers up yourself and do NOT estimate a total —`,
        `an invented figure here is worse than no answer. You may still describe the file.]`,
        '',
      ].join('\n'),
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
      text: [
        ...DESCRIBE_HEADER(`${fileName} (${loaded.sheets.length} sheets)`),
        ...lines,
        WORKBOOK_BOUNDARY,
        '',
      ].join('\n'),
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
      text: [
        ...DESCRIBE_HEADER(source),
        ...describeLines(table, formulaColumns, source),
        ...(isWorkbook(fileName) ? [WORKBOOK_BOUNDARY] : []),
        '',
      ].join('\n'),
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
      text: [
        `[Computed directly from ${source} by MigraPilot. These figures are exact`,
        `arithmetic over the parsed file, not estimates. Use them verbatim and do not`,
        `recalculate them:]`,
        target
          ? `count of values in "${target.name}": ${filled} (of ${rows(table.rows.length)})`
          : `count of rows: ${filled}`,
        '',
      ].join('\n'),
    }
  }

  const choice = chooseValueColumn(prompt, table)
  if (choice.kind === 'none') return null
  if (choice.kind === 'clarify') {
    return {
      file: fileName,
      ...(sheetName ? { sheet: sheetName } : {}),
      operation: `clarify:${operation}`,
      text: [
        `[MigraPilot did not calculate this from ${source}: the question could mean more than one`,
        `column — ${choice.candidates.map((c) => `"${c}"`).join(', ')}. Ask which one is meant.`,
        `Do NOT add the numbers up yourself and do NOT pick a column on the user's behalf.]`,
        '',
      ].join('\n'),
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
      text: [
        `[MigraPilot could not calculate this from ${source}: ${choice.reason}.`,
        `Say so plainly. Do NOT add the numbers up yourself and do NOT estimate a total —`,
        `an invented figure here is worse than no answer. You may still describe the file.]`,
        '',
      ].join('\n'),
    }
  }
  const value = choice.column

  const lines: string[] = []
  let formulaDerived = false
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
      const detail = [`${rows(p.rowsUsed)} used`]
      if (p.rowsBlank) detail.push(`${p.rowsBlank} blank`)
      if (p.rowsNonNumeric) detail.push(`${p.rowsNonNumeric} non-numeric`)
      if (p.rowsFiltered) detail.push(`${p.rowsFiltered} excluded by ${p.filter!.column}=${p.filter!.equals}`)
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
    operation,
    text: [
      `[Computed directly from ${source} by MigraPilot. These figures are exact`,
      `arithmetic over the parsed file, not estimates. Use them verbatim and do not`,
      `recalculate them:]`,
      ...lines,
      '',
    ].join('\n'),
  }
}
