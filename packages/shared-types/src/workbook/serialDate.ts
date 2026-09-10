/**
 * EXCEL'S DATE SERIALS — the one place that knows the epoch.
 *
 * 🚨 SHARED BECAUSE BOTH LANES CONVERT THEM. The consumer's classifier needs a
 * date to stop looking like a quantity it may total; the Brain's evidence
 * renderer needs a date a reader can recognise. Two copies of the leap-year
 * rule below would drift, and a date off by one day is wrong in the way that
 * looks most like an answer.
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

