/**
 * CSV and TSV into one canonical table.
 *
 * Deliberately hand-written rather than a dependency: the parsing this needs is
 * RFC4180 quoting and a delimiter choice, and the interesting decisions are all
 * in `cellValue.ts`. A parser that silently repairs malformed rows would hide
 * exactly the ambiguity this pipeline has to refuse.
 */

import { parseCell, isQuantitative, type Cell } from './cellValue'

export interface TableColumn {
  name: string
  index: number
  /**
   * Whether this column may be computed on.
   *
   * Decided from the CELLS, not the header. A column called "Revenue" whose
   * values are all identifiers is not quantitative, and a column called "Q3"
   * whose values are all amounts is.
   */
  quantitative: boolean
  /** How many rows actually carried a usable quantity. Reported, never assumed. */
  numericCells: number
  blankCells: number
}

export interface ParsedTable {
  headers: string[]
  columns: TableColumn[]
  /** Row-major, header row excluded. */
  rows: Cell[][]
  delimiter: ',' | '\t'
  /** Rows whose column count disagreed with the header. Kept and reported. */
  malformedRows: number[]
}

export class TableParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TableParseError'
  }
}

/**
 * Split one delimited line, honouring RFC4180 quoting.
 *
 * `"Smith, John",42` is two fields, not three. Splitting on the delimiter
 * without this shifts every later column by one and produces a table that parses
 * cleanly and means something else entirely.
 */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1 } // escaped quote
        else quoted = false
      } else field += ch
    } else if (ch === '"') {
      quoted = true
    } else if (ch === delimiter) {
      out.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  out.push(field)
  return out
}

/**
 * Comma or tab, chosen by which one actually structures the file.
 *
 * The extension is a hint and is routinely wrong — plenty of `.csv` exports are
 * tab-delimited. Consistency across lines is the evidence: the right delimiter
 * produces the same field count on every row.
 */
function detectDelimiter(lines: string[]): ',' | '\t' {
  const score = (d: string) => {
    const counts = lines.slice(0, 20).map((l) => splitLine(l, d).length)
    if (counts.length === 0 || counts[0]! < 2) return -1
    const consistent = counts.filter((c) => c === counts[0]).length
    return consistent * counts[0]!
  }
  return score('\t') > score(',') ? '\t' : ','
}

export function parseTable(text: string): ParsedTable {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '')
  if (lines.length < 2) {
    throw new TableParseError('This file does not contain a header row and at least one data row.')
  }

  const delimiter = detectDelimiter(lines)
  const headers = splitLine(lines[0]!, delimiter).map((h) => h.trim().replace(/^"|"$/g, ''))
  if (headers.length < 2) {
    throw new TableParseError('This file has only one column, so there is nothing to calculate across.')
  }

  const rows: Cell[][] = []
  const malformedRows: number[] = []

  for (let i = 1; i < lines.length; i += 1) {
    const fields = splitLine(lines[i]!, delimiter)
    /*
     * A row with the wrong shape is RECORDED, not repaired and not dropped
     * silently. Padding it would invent blanks that later count as real rows;
     * discarding it without saying so would quietly change every total.
     */
    if (fields.length !== headers.length) malformedRows.push(i + 1)
    const cells = headers.map((_, c) => parseCell(fields[c] ?? ''))
    rows.push(cells)
  }

  const columns: TableColumn[] = headers.map((name, index) => {
    const cells = rows.map((r) => r[index]!).filter(Boolean)
    const numericCells = cells.filter(isQuantitative).length
    const blankCells = cells.filter((c) => c.kind === 'blank').length
    const considered = cells.length - blankCells
    return {
      name,
      index,
      /*
       * A column is quantitative when the cells that HAVE values are
       * overwhelmingly quantities. The threshold is deliberately high: one
       * stray number in a text column must not make the column summable, and a
       * column of ids must not qualify because ids are numeric-shaped.
       */
      quantitative: considered > 0 && numericCells / considered >= 0.9,
      numericCells,
      blankCells,
    }
  })

  return { headers, columns, rows, delimiter, malformedRows }
}
