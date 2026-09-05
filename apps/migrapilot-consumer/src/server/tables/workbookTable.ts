import 'server-only'

import { parseCell, type Cell } from './cellValue'
import { buildColumns, TableParseError, type ParsedTable } from './parseTable'
import { type WorkbookCell, type WorkbookSheet } from './readWorkbook'

/**
 * A workbook sheet, expressed as the SAME ParsedTable a CSV becomes.
 *
 * 🚨 THE ARCHITECTURAL RULE. There is no second semantic classifier here. Each
 * cell is rendered to the text a CSV export of that sheet would contain, and
 * then `parseCell` and `buildColumns` — the exact functions the delimited path
 * uses — decide what it is. A workbook reader that re-implemented "is this
 * quantitative" or "is this an identifier" would be a second opinion, and the
 * two would disagree the first time either was tuned. Everything the CSV lane
 * proved (identifier refusal, ambiguity, the 90% column bar, ZipCode by header)
 * therefore applies to .xlsx without being re-argued.
 */

/**
 * 🚨 A DATE IS NOT A QUANTITY, and in a workbook it is a NUMBER.
 *
 * Excel stores 2026-08-29 as the serial 46264 with a date format applied. Render
 * that as "46264" and `parseCell` sees a plain integer, the column reads as 100%
 * numeric, and the product will happily total a column of dates — a figure that
 * is wrong in the way that looks most like an answer. Rendered as an ISO date it
 * matches the existing date shape and is classified as an identifier, which is
 * what a date is for arithmetic purposes.
 *
 * The epoch is 1899-12-30 rather than 1900-01-01 because Excel deliberately
 * reproduces a 1900 leap-year that never happened, and every serial after
 * 1900-02-28 is shifted by one to match it.
 */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)
const MS_PER_DAY = 86_400_000

export function excelSerialToIso(serial: number): string | undefined {
  // Serial 0 and negatives are not dates any spreadsheet displays as one, and
  // absurd futures are more likely a mis-tagged quantity than a real date.
  if (!Number.isFinite(serial) || serial <= 0 || serial > 2_958_465) return undefined
  const whole = Math.floor(serial)

  /*
   * Serial 60 is 1900-02-29 — a day that did not exist. Excel keeps it so that
   * serials agree with Lotus 1-2-3, which is why the offset changes either side
   * of it: 1..59 count from 1899-12-31, and 61 onward from 1899-12-30. Returning
   * a real date for 60 would silently move a value by a day; it is refused, and
   * the caller falls back to treating the cell as the number it is.
   */
  if (whole === 60) return undefined
  const epoch = whole < 60 ? EXCEL_EPOCH_UTC + MS_PER_DAY : EXCEL_EPOCH_UTC

  const date = new Date(epoch + whole * MS_PER_DAY)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString().slice(0, 10)
}

/** Strip the float noise that 0.1275 * 100 introduces. */
function tidy(n: number): string {
  return String(Number(n.toPrecision(12)))
}

/**
 * The text this cell would have in a CSV export of the sheet.
 *
 * This is the ONLY place workbook-specific knowledge turns into something the
 * shared classifier reads, which is what keeps the classifier single.
 */
export function renderCellText(cell: WorkbookCell): string {
  if (cell.number === undefined) return cell.text

  if (cell.format === 'percent') {
    // parseCell reads "12.75%" as a percentage whose VALUE is the fraction,
    // which is the same thing the sheet stores.
    return `${tidy(cell.number * 100)}%`
  }
  if (cell.format === 'date') {
    const iso = excelSerialToIso(cell.number)
    // A serial that is not a plausible date falls back to its digits rather than
    // inventing a date; it is then classified on shape like anything else.
    return iso ?? tidy(cell.number)
  }
  if (cell.format === 'currency' && cell.currencySymbol) {
    return `${cell.currencySymbol}${tidy(cell.number)}`
  }
  // Currency with no symbol in the format code is left as a plain number. The
  // arithmetic is identical, and inventing a symbol would name a currency the
  // file never stated.
  return tidy(cell.number)
}

export interface SheetTable extends ParsedTable {
  /** Which sheet this came from, for provenance. */
  sheetName: string
  /** Column indexes whose cells came from formulas, cached by the spreadsheet. */
  formulaColumns: number[]
}

/**
 * Convert one sheet. Throws TableParseError for the same reasons a CSV would,
 * so the caller's existing handling covers both.
 */
export function sheetToTable(sheet: WorkbookSheet): SheetTable {
  // Leading fully-empty rows are skipped; a sheet whose header is not the first
  // populated row is a different problem and is not guessed at here.
  const rows = sheet.rows.filter((r) => r.some((c) => c.text !== '' || c.number !== undefined))
  if (rows.length < 2) {
    throw new TableParseError(
      `Sheet "${sheet.name}" does not contain a header row and at least one data row.`,
    )
  }

  const headers = rows[0]!.map((c) => c.text.trim())
  if (headers.filter((h) => h !== '').length < 2) {
    throw new TableParseError(
      `Sheet "${sheet.name}" has only one column, so there is nothing to calculate across.`,
    )
  }

  const body = rows.slice(1)
  const malformedRows: number[] = []
  const cells: Cell[][] = body.map((row, i) => {
    // A row longer than the header is RECORDED, exactly as the delimited path
    // records it — not repaired, not dropped.
    if (row.length > headers.length) malformedRows.push(i + 2)
    return headers.map((_, c) => parseCell(renderCellText(row[c] ?? { text: '' })))
  })

  const formulaColumns: number[] = []
  headers.forEach((_, c) => {
    if (body.some((row) => row[c]?.formula)) formulaColumns.push(c)
  })

  return {
    headers,
    columns: buildColumns(headers, cells),
    rows: cells,
    // Nothing was delimited; the field is part of the shared shape and a tab is
    // the honest answer for "not comma-separated".
    delimiter: '\t',
    malformedRows,
    sheetName: sheet.name,
    formulaColumns,
  }
}

/**
 * Choose the sheet a question is about.
 *
 * A named sheet wins outright. With one sheet there is nothing to choose. With
 * several and no name, it REFUSES: "the total" across sheets is a different
 * question, and picking the first would be confidently wrong about which number
 * the user meant — the same rule the delimited path applies to two files.
 */
export type SheetChoice =
  | { kind: 'sheet'; sheet: WorkbookSheet }
  | { kind: 'ambiguous'; names: string[] }
  | { kind: 'none' }

export function chooseSheet(prompt: string, sheets: readonly WorkbookSheet[]): SheetChoice {
  if (sheets.length === 0) return { kind: 'none' }
  const p = prompt.toLowerCase()

  const named = sheets.filter((s) => s.name.trim() !== '' && p.includes(s.name.toLowerCase()))
  if (named.length === 1) return { kind: 'sheet', sheet: named[0]! }
  // Two sheet names both mentioned is a question about both, which this cannot
  // answer and must not pick a side in.
  if (named.length > 1) return { kind: 'ambiguous', names: named.map((s) => s.name) }

  if (sheets.length === 1) return { kind: 'sheet', sheet: sheets[0]! }
  return { kind: 'ambiguous', names: sheets.map((s) => s.name) }
}
