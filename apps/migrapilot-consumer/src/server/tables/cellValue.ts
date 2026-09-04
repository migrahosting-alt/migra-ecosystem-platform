/**
 * What a spreadsheet cell actually IS, before anyone does arithmetic on it.
 *
 * 🚨 THE DEFECT THIS SERVES. CSV and TSV were parsed and cited correctly and then
 * the arithmetic was wrong: totals of 473,250 and 473,000 for a column summing to
 * 474,000. A language model was adding numbers out of retrieved text. It is very
 * good at reading a table and unreliable at footing one, and a confidently wrong
 * total is worse than an honest refusal.
 *
 * 🚨 AND THE OPPOSITE DANGER, WHICH IS WORSE. The fix is not "treat everything
 * that looks numeric as a number". A ZIP code, an order id, a version string and
 * a leading-zero part number all look numeric and must never be summed. Silently
 * coercing them produces a total that is not wrong in an obvious way — it is
 * wrong in a way that looks like a real answer. So every cell keeps its ORIGINAL
 * TEXT alongside whatever was parsed, and a cell that is merely numeric-shaped is
 * classified as text.
 */

export type CellKind =
  /** A real quantity. Safe to compute with. */
  | 'number'
  /** A percentage. Its numeric value is the FRACTION, kept separately from the display. */
  | 'percent'
  /** Money. The amount is a number; the symbol is provenance, not data. */
  | 'currency'
  /** Empty. Distinct from zero, and never counted as one. */
  | 'blank'
  /** Numeric-SHAPED but not a quantity: ids, ZIPs, versions, dates. Never summed. */
  | 'identifier'
  /** Anything else. */
  | 'text'

export interface Cell {
  /** Exactly what the file said. Never normalised, always available for display. */
  raw: string
  kind: CellKind
  /**
   * The value to compute with, present only for kinds that are quantities.
   *
   * `undefined` is the honest answer for text, blanks and identifiers — a `0`
   * default would silently drag every average and total toward zero, which is
   * exactly the class of wrong-but-plausible result this module exists to stop.
   */
  value?: number
  /** Why it was classified this way, for the trace and for refusals. */
  note?: string
}

/** Currency symbols seen in real exports. Deliberately small and explicit. */
const CURRENCY = /^([$€£¥₦]|R\$|CHF|USD|EUR|GBP)\s?/i

/**
 * A leading zero means an IDENTIFIER, not a number.
 *
 * `00123` is a part number, `01730` is a ZIP. Anyone who meant one hundred and
 * twenty-three would have written it. Summing these produces a plausible-looking
 * total from data that was never quantitative.
 *
 * 🚨 ALL DIGITS, NO SEPARATOR — and the anchor at the end is the whole fix. This
 * used to strip `.` and `,` before testing, so `0.00` became `000` and matched:
 * every amount under one pound, and zero itself, was read as a code. Measured on
 * a real price column — `$0.00` classified as an identifier, which dragged
 * UnitPrice to 8/9 = 88.9% and disqualified the column outright, silently.
 * `0.50` is money; `007` is a code; `0` is a number.
 */
const LEADING_ZERO = /^0\d+$/

/** `1.2.3`, `2026-08-29`, `08/29/2026` — shaped like numbers, none of them are. */
const VERSION_OR_DATE = /^\d+([.\-/]\d+){2,}$/

/**
 * Thousands separators, in the two conventions that actually collide.
 *
 * `1,234.56` (en) and `1.234,56` (de) mean the same amount and disagree about
 * which mark is which. Both are accepted, but ONLY when the grouping is
 * unambiguous — see `ambiguous` below, which refuses rather than guessing.
 */
const EN_GROUPED = /^\d{1,3}(,\d{3})+(\.\d+)?$/
const DE_GROUPED = /^\d{1,3}(\.\d{3})+(,\d+)?$/
const PLAIN = /^\d+(\.\d+)?$/

/**
 * The markers real exports use for "there is no value here".
 *
 * 🚨 MEASURED DEFECT: these were classified as TEXT, which is technically true
 * and practically wrong. A column is only computable when ≥90% of its non-blank
 * cells are quantities, so ONE `n/a` in a nine-row export dropped a genuine
 * currency column to 87.5% and disqualified it — and the turn then answered
 * about a different column entirely. A missing value is an absence, not a word;
 * counting it as evidence AGAINST the column being numeric inverts its meaning.
 *
 * Deliberately a short, explicit list. Anything not on it stays text, because a
 * loose rule here would start swallowing real values.
 */
const MISSING = /^(n\/?a|na|nil|none|null|nan|-{1,2}|–|—|\?)$/i

export function parseCell(raw: string): Cell {
  const trimmed = raw.trim()
  if (trimmed === '') return { raw, kind: 'blank', note: 'empty cell' }
  if (MISSING.test(trimmed)) return { raw, kind: 'blank', note: `"${trimmed}" means no value` }

  /*
   * NEGATIVES IN BOTH NOTATIONS. Accounting exports write -1234 and (1234) for
   * the same thing, and a parenthesised loss read as text would quietly drop out
   * of a total rather than reduce it.
   */
  let body = trimmed
  let negative = false
  if (/^\(.*\)$/.test(body)) {
    negative = true
    body = body.slice(1, -1).trim()
  }
  if (/^[-−]/.test(body)) {
    negative = true
    body = body.replace(/^[-−]\s*/, '')
  }

  let kind: CellKind = 'number'
  let note: string | undefined

  const currency = CURRENCY.exec(body)
  if (currency) {
    kind = 'currency'
    note = `currency ${currency[1]}`
    body = body.slice(currency[0].length).trim()
  }

  let percent = false
  if (body.endsWith('%')) {
    percent = true
    body = body.slice(0, -1).trim()
  }

  // Identifier checks run on the BARE digits, after symbols are stripped, so
  // `$00123` is still recognised as the identifier it is.
  if (VERSION_OR_DATE.test(body)) {
    return { raw, kind: 'identifier', note: 'looks like a date or version, not a quantity' }
  }
  if (LEADING_ZERO.test(body)) {
    return { raw, kind: 'identifier', note: 'leading zero — an id or code, not a quantity' }
  }

  let numeric: number | undefined
  if (PLAIN.test(body)) {
    numeric = Number(body)
  } else if (EN_GROUPED.test(body)) {
    numeric = Number(body.replace(/,/g, ''))
  } else if (DE_GROUPED.test(body)) {
    numeric = Number(body.replace(/\./g, '').replace(',', '.'))
  } else if (/^\d+,\d+$/.test(body)) {
    /*
     * 🚨 GENUINELY AMBIGUOUS: `1,234` is one thousand two hundred and thirty-four
     * in one convention and one-point-two-three-four in another, and nothing in a
     * bare CSV cell settles it. Refused rather than guessed — a wrong total from a
     * confident guess is the exact failure this file exists to prevent.
     */
    return {
      raw,
      kind: 'text',
      note: 'ambiguous separator: could be thousands or decimal, so it is not treated as a number',
    }
  }

  if (numeric === undefined || !Number.isFinite(numeric)) {
    return { raw, kind: 'text' }
  }

  if (negative) numeric = -numeric
  if (percent) {
    // The FRACTION is the computable value; the display stays in `raw`. Averaging
    // "45%" as 45 and as 0.45 give different answers, and only one is right.
    return { raw, kind: 'percent', value: numeric / 100, note: 'percentage stored as a fraction' }
  }

  return { raw, kind, ...(note ? { note } : {}), value: numeric }
}

/** Cells a calculation may legitimately use. */
export function isQuantitative(cell: Cell): boolean {
  return cell.value !== undefined && (cell.kind === 'number' || cell.kind === 'currency' || cell.kind === 'percent')
}
