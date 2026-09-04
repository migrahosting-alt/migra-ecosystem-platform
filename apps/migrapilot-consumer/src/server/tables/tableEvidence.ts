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
 * The column the question is about.
 *
 * Named columns win. Otherwise, if exactly ONE column is quantitative there is
 * nothing to be ambiguous about; with several, this returns null and the turn
 * falls back rather than picking one and being confidently wrong about which
 * number the user meant.
 */
function chooseValueColumn(prompt: string, table: ParsedTable): TableColumn | null {
  const p = prompt.toLowerCase()
  const named = table.columns.filter((c) => c.name && p.includes(c.name.toLowerCase()))
  const namedQuantitative = named.filter((c) => c.quantitative)
  if (namedQuantitative.length === 1) return namedQuantitative[0]!

  const quantitative = table.columns.filter((c) => c.quantitative)
  return quantitative.length === 1 ? quantitative[0]! : null
}

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

  const value = chooseValueColumn(prompt, table)
  if (!value) return null

  const lines: string[] = []
  try {
    if (operation === 'group') {
      const groupCol = table.columns.find((c) => !c.quantitative)
      if (!groupCol) return null
      const groups = groupBy(table, groupCol, value)
      if (groups.length === 0) return null
      lines.push(`${value.name} by ${groupCol.name}:`)
      for (const g of groups) lines.push(`  ${g.group}: ${fmt(g.value)} (${g.rows} rows)`)
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
      lines.push(`${operation} of "${value.name}": ${fmt(result.value)}${label}`)

      const p = result.provenance
      const detail = [`${p.rowsUsed} rows used`]
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
