import 'server-only'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parseTable, TableParseError, type ParsedTable, type TableColumn } from './parseTable'
import { computeColumn, groupBy, ComputationRefused, type Operation } from './computeTable'

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

const TABLE_EXTENSIONS = /\.(csv|tsv)$/i

/** Which operation the question is asking for, if any. */
function detectOperation(prompt: string): Operation | 'group' | null {
  const p = prompt.toLowerCase()
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
}

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
  let table: ParsedTable
  try {
    table = parseTable(await readFile(join(uploadRoot, fileName), 'utf8'))
  } catch (error) {
    // A parse failure is not an answer. The turn continues as ordinary grounding.
    if (error instanceof TableParseError) return null
    return null
  }

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
  if (operation === 'count') {
    const named = table.columns.filter((c) => c.name && prompt.toLowerCase().includes(c.name.toLowerCase()))
    const target = named.length === 1 ? named[0]! : undefined
    const filled = target
      ? table.rows.filter((r) => r[target.index] && r[target.index]!.kind !== 'blank').length
      : table.rows.length
    return {
      file: fileName,
      operation: 'count',
      text: [
        `[Computed directly from ${fileName} by MigraPilot. These figures are exact`,
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
      operation: `clarify:${operation}`,
      text: [
        `[MigraPilot did not calculate this from ${fileName}: the question could mean more than one`,
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
      operation: `refused:${operation}`,
      text: [
        `[MigraPilot could not calculate this from ${fileName}: ${choice.reason}.`,
        `Say so plainly. Do NOT add the numbers up yourself and do NOT estimate a total —`,
        `an invented figure here is worse than no answer. You may still describe the file.]`,
        '',
      ].join('\n'),
    }
  }
  const value = choice.column

  const lines: string[] = []
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
    operation,
    text: [
      `[Computed directly from ${fileName} by MigraPilot. These figures are exact`,
      `arithmetic over the parsed file, not estimates. Use them verbatim and do not`,
      `recalculate them:]`,
      ...lines,
      '',
    ].join('\n'),
  }
}
