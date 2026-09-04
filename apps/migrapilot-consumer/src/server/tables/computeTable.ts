/**
 * The arithmetic, done by arithmetic.
 *
 * 🚨 THE MODEL DOES NOT CALCULATE HERE. It reads the table correctly and then
 * foots it wrong — 473,250 and 473,000 for a column that sums to 474,000. Every
 * number this module returns is computed from parsed cells, and the model's job
 * is to explain the result, not to produce it.
 *
 * EVERY RESULT CARRIES ITS PROVENANCE: which column, how many rows contributed,
 * how many were skipped and why. A total with no account of what went into it is
 * indistinguishable from a guess, which is the thing being replaced.
 */

import { isQuantitative } from './cellValue'
import type { ParsedTable, TableColumn } from './parseTable'

export type Operation = 'sum' | 'min' | 'max' | 'average' | 'count'

export interface ComputationProvenance {
  column: string
  operation: Operation
  /** Rows that contributed a real quantity. */
  rowsUsed: number
  /** Rows skipped, and why — blanks and non-numeric cells are different facts. */
  rowsBlank: number
  rowsNonNumeric: number
  /** Rows excluded by a filter, when one was applied. */
  rowsFiltered?: number
  filter?: { column: string; equals: string }
  malformedRows?: number[]
}

export interface ComputationResult {
  value: number
  /** For min/max: the label(s) from the chosen label column. Plural when tied. */
  labels?: string[]
  /** 🚨 A TIE IS A FACT, not a coin toss. "the highest" with two maxima is ambiguous. */
  tied?: boolean
  provenance: ComputationProvenance
}

export class ComputationRefused extends Error {
  constructor(readonly reason: string) {
    super(reason)
    this.name = 'ComputationRefused'
  }
}

/** Exact to the cent. Floating point sums drift; money does not. */
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

export function computeColumn(
  table: ParsedTable,
  column: TableColumn,
  operation: Operation,
  options: { labelColumn?: TableColumn; filter?: { column: TableColumn; equals: string } } = {},
): ComputationResult {
  if (!column.quantitative && operation !== 'count') {
    throw new ComputationRefused(
      `The column "${column.name}" does not hold quantities, so it cannot be totalled. ` +
      `Its values look like text, identifiers or codes.`,
    )
  }

  let rowsFiltered = 0
  const candidate = table.rows.filter((row) => {
    if (!options.filter) return true
    // Compared on RAW text, case-insensitively. A filter value is a label, and
    // parsing it as a number would make status="0" match a blank.
    const cell = row[options.filter.column.index]
    const match = (cell?.raw ?? '').trim().toLowerCase() === options.filter.equals.trim().toLowerCase()
    if (!match) rowsFiltered += 1
    return match
  })

  const cells = candidate.map((r) => r[column.index]!).filter(Boolean)
  const usable = cells.filter(isQuantitative)
  const rowsBlank = cells.filter((c) => c.kind === 'blank').length
  const rowsNonNumeric = cells.length - usable.length - rowsBlank

  const provenance: ComputationProvenance = {
    column: column.name,
    operation,
    rowsUsed: usable.length,
    rowsBlank,
    rowsNonNumeric,
    ...(options.filter ? { rowsFiltered, filter: { column: options.filter.column.name, equals: options.filter.equals } } : {}),
    ...(table.malformedRows.length > 0 ? { malformedRows: table.malformedRows } : {}),
  }

  if (operation === 'count') {
    return { value: candidate.length, provenance: { ...provenance, rowsUsed: candidate.length } }
  }

  if (usable.length === 0) {
    throw new ComputationRefused(
      `No rows in "${column.name}" contained a value that can be calculated with` +
      `${options.filter ? ' after the filter was applied' : ''}.`,
    )
  }

  const values = usable.map((c) => c.value!)

  if (operation === 'sum') return { value: round(values.reduce((a, b) => a + b, 0)), provenance }
  if (operation === 'average') {
    /*
     * The denominator is the rows that HAD a value. Counting blanks would divide
     * by rows that contributed nothing and quietly pull every average down — the
     * denominator is where averages usually go wrong.
     */
    return { value: round(values.reduce((a, b) => a + b, 0) / values.length), provenance }
  }

  const target = operation === 'max' ? Math.max(...values) : Math.min(...values)
  const winners = candidate.filter((r) => {
    const c = r[column.index]
    return c && isQuantitative(c) && c.value === target
  })

  const labels = options.labelColumn
    ? winners.map((r) => r[options.labelColumn!.index]?.raw ?? '').filter((s) => s !== '')
    : undefined

  return {
    value: round(target),
    ...(labels && labels.length > 0 ? { labels } : {}),
    ...(winners.length > 1 ? { tied: true } : {}),
    provenance,
  }
}

/**
 * Totals per group — "revenue by region".
 *
 * Groups on RAW text so `North` and `north` are one group but `0` and `` are
 * not, and returns them in descending order of value because that is the order
 * every question about groups actually wants.
 */
export function groupBy(
  table: ParsedTable,
  groupColumn: TableColumn,
  valueColumn: TableColumn,
  operation: 'sum' | 'average' = 'sum',
): { group: string; value: number; rows: number }[] {
  if (!valueColumn.quantitative) {
    throw new ComputationRefused(`The column "${valueColumn.name}" does not hold quantities.`)
  }
  const buckets = new Map<string, number[]>()
  for (const row of table.rows) {
    const key = (row[groupColumn.index]?.raw ?? '').trim()
    if (key === '') continue
    const cell = row[valueColumn.index]
    if (!cell || !isQuantitative(cell)) continue
    const list = buckets.get(key) ?? []
    list.push(cell.value!)
    buckets.set(key, list)
  }
  return [...buckets.entries()]
    .map(([group, values]) => ({
      group,
      value: round(operation === 'sum'
        ? values.reduce((a, b) => a + b, 0)
        : values.reduce((a, b) => a + b, 0) / values.length),
      rows: values.length,
    }))
    .sort((a, b) => b.value - a.value)
}
