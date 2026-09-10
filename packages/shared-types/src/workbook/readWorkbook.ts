/*
 * 🚨 NOT A BROWSER MODULE, AND NO LONGER GUARDED BY ONE.
 *
 * This carried Next's `server-only` import while it lived inside the consumer
 * app. It is shared now — the Brain reads the same workbooks, and two readers
 * would disagree about what a sheet says the first time either was tuned — so
 * that guard is gone and the isolation is the package export map: nothing
 * reaches this except an explicit `@migrapilot/shared-types/workbook` import,
 * which no client component makes.
 */
import { ZipError, looksLikeZip, readNamedEntry, readZipEntries } from './zipReader.js'

/**
 * Read the parts of an .xlsx workbook that a table question actually needs.
 *
 * DELIBERATELY NARROW. This is not a spreadsheet library and must not drift into
 * being one. It reads sheet names, shared strings, cell values, and the number
 * formats that decide whether a column is currency or a percentage — and refuses
 * everything else loudly. Macro-enabled packages, encrypted packages, external
 * links and anything with more sheets, rows, columns or cells than a question
 * could sensibly be about are refused rather than partially understood.
 *
 * EVERY LIMIT IS A REFUSAL, NOT A TRUNCATION. Silently reading the first N rows
 * of a larger sheet would produce a total that is confidently wrong about a file
 * the user can see is bigger — the exact failure the surrounding substrate
 * exists to prevent.
 *
 * FORMULAS: the CACHED value is used, and the fact that a cell was a formula is
 * carried through. A workbook records what the spreadsheet last computed, and
 * that is the number the user sees; this does not evaluate formulas, and a
 * formula cell with no cached value is a blank rather than a guess.
 */

export class WorkbookError extends Error {
  constructor(
    readonly code:
      | 'not_a_workbook'
      | 'unsupported_package'
      | 'too_large'
      | 'no_sheets'
      | 'malformed',
    message: string,
  ) {
    super(message)
    this.name = 'WorkbookError'
  }
}

/** Bounds. Each one refuses; none truncates. */
const LIMITS = {
  sheets: 64,
  rowsPerSheet: 200_000,
  columnsPerSheet: 512,
  cellsPerSheet: 2_000_000,
  sharedStrings: 500_000,
  xmlBytes: 48 * 1024 * 1024,
  relationships: 512,
} as const

export interface WorkbookCell {
  /** Displayed text, as the sheet records it. */
  text: string
  /** Numeric value when the cell holds a number. */
  number?: number
  /** True when the cell carried a formula; the value is what was cached. */
  formula?: boolean
  /** The number format's shape, when it tells us something the digits do not. */
  format?: 'currency' | 'percent' | 'date'
  /**
   * The currency symbol the sheet actually formats with.
   *
   * Carried rather than assumed: defaulting to '$' would relabel a euro column
   * as dollars, which is a fabrication in the one field a reader would trust.
   */
  currencySymbol?: string
}

export interface WorkbookSheet {
  name: string
  /** Row-major, ragged. Index 0 is the first row present. */
  rows: WorkbookCell[][]
}

export interface Workbook {
  sheets: WorkbookSheet[]
}

// ── XML: a scanner, not a parser ───────────────────────────────────────────
//
// The subset needed here is machine-generated and regular: attribute lookups on
// known element names, and text content of <t> and <v>. A general XML parser
// would be a larger attack surface for untrusted input than the job requires.
// Everything below operates on bounded, already-decompressed strings.

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m] ?? m)
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)
  return m ? decodeXmlText(m[1]!) : undefined
}

function text(xml: string, limitBytes: number): string {
  if (xml.length > limitBytes) {
    throw new WorkbookError('too_large', 'a workbook part is larger than this reader will read')
  }
  return xml
}

// ── parts ──────────────────────────────────────────────────────────────────

/** `<si>` entries, in order. Index is what a `t="s"` cell refers to. */
function readSharedStrings(xml: string): string[] {
  const out: string[] = []
  // An <si> may hold one <t> or several inside <r> runs; the concatenation of
  // its <t> content is the string the sheet displays.
  for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) {
    const body = si[1] ?? ''
    let value = ''
    for (const t of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) value += decodeXmlText(t[1]!)
    out.push(value)
    if (out.length > LIMITS.sharedStrings) {
      throw new WorkbookError('too_large', 'workbook has more shared strings than this reader will read')
    }
  }
  return out
}

/**
 * numFmtId -> shape, for the formats that change how a number should be read.
 *
 * Built-in ids are fixed by the spec; custom ones are matched on their format
 * code. Only three shapes matter here, and anything else is left undescribed
 * rather than guessed at.
 */
export interface NumberFormat {
  shape: 'currency' | 'percent' | 'date'
  /** Only for currency, and only when the format code actually names one. */
  symbol?: string
}

function readNumberFormats(xml: string | undefined): Map<number, NumberFormat> {
  const byXf = new Map<number, NumberFormat>()
  if (!xml) return byXf

  const custom = new Map<number, NumberFormat>()
  for (const fmt of xml.matchAll(/<numFmt\b[^>]*\/>|<numFmt\b[^>]*>/g)) {
    const id = Number(attr(fmt[0]!, 'numFmtId'))
    const code = attr(fmt[0]!, 'formatCode') ?? ''
    if (!Number.isFinite(id)) continue
    if (/%/.test(code)) custom.set(id, { shape: 'percent' })
    else if (/[$£€¥]|\bUSD\b|\bEUR\b|\bGBP\b/.test(code)) {
      const symbol = /[$£€¥]/.exec(code)?.[0]
      custom.set(id, symbol ? { shape: 'currency', symbol } : { shape: 'currency' })
    } else if (/[dmy]{1,4}[\/\-.]|h:mm|\byyyy\b/i.test(code)) custom.set(id, { shape: 'date' })
  }

  const BUILTIN = new Map<number, NumberFormat>([
    [9, { shape: 'percent' }], [10, { shape: 'percent' }],
    [5, { shape: 'currency' }], [6, { shape: 'currency' }],
    [7, { shape: 'currency' }], [8, { shape: 'currency' }],
    [44, { shape: 'currency' }], [42, { shape: 'currency' }],
    [41, { shape: 'currency' }], [43, { shape: 'currency' }],
    [14, { shape: 'date' }], [15, { shape: 'date' }], [16, { shape: 'date' }],
    [17, { shape: 'date' }], [22, { shape: 'date' }],
  ])

  // cellXfs entries are referenced by a cell's s="" index, in document order.
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? ''
  let index = 0
  for (const xf of cellXfs.matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>/g)) {
    const numFmtId = Number(attr(xf[0]!, 'numFmtId') ?? '0')
    const format = custom.get(numFmtId) ?? BUILTIN.get(numFmtId)
    if (format) byXf.set(index, format)
    index += 1
  }
  return byXf
}

/** Sheet names in workbook order, paired with the relationship id they point at. */
function readSheetIndex(xml: string): { name: string; rid: string }[] {
  const sheets: { name: string; rid: string }[] = []
  for (const s of xml.matchAll(/<sheet\b[^>]*\/>|<sheet\b[^>]*>/g)) {
    const name = attr(s[0]!, 'name')
    const rid = attr(s[0]!, 'r:id') ?? attr(s[0]!, 'id')
    if (!name || !rid) continue
    sheets.push({ name, rid })
    if (sheets.length > LIMITS.sheets) {
      throw new WorkbookError('too_large', `workbook has more than ${LIMITS.sheets} sheets`)
    }
  }
  return sheets
}

/** rId -> part path, resolved against the workbook's own relationships. */
function readRelationships(xml: string | undefined): Map<string, string> {
  const map = new Map<string, string>()
  if (!xml) return map
  let n = 0
  for (const r of xml.matchAll(/<Relationship\b[^>]*\/>|<Relationship\b[^>]*>/g)) {
    const id = attr(r[0]!, 'Id')
    const target = attr(r[0]!, 'Target')
    if (!id || !target) continue
    map.set(id, target)
    n += 1
    if (n > LIMITS.relationships) {
      throw new WorkbookError('too_large', 'workbook declares an unreasonable number of relationships')
    }
  }
  return map
}

/** `B12` -> column index 1. Letters only; anything else is not a reference. */
function columnOf(ref: string): number | undefined {
  const m = /^([A-Z]+)\d+$/.exec(ref)
  if (!m) return undefined
  let n = 0
  for (const ch of m[1]!) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function readSheet(xml: string, shared: string[], formats: Map<number, NumberFormat>): WorkbookCell[][] {
  const rows: WorkbookCell[][] = []
  let cellCount = 0

  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
    const body = rowMatch[1] ?? ''
    const row: WorkbookCell[] = []

    for (const cellMatch of body.matchAll(/<c\b([^>]*)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const tag = cellMatch[1] ?? cellMatch[2] ?? ''
      const inner = cellMatch[3] ?? ''
      const ref = attr(`<c ${tag}>`, 'r')
      const type = attr(`<c ${tag}>`, 't')
      const styleIndex = Number(attr(`<c ${tag}>`, 's') ?? NaN)

      const at = ref ? columnOf(ref) : undefined
      const target = at ?? row.length
      if (target >= LIMITS.columnsPerSheet) {
        throw new WorkbookError('too_large', `a sheet has more than ${LIMITS.columnsPerSheet} columns`)
      }
      while (row.length < target) row.push({ text: '' })

      const isFormula = /<f[\s>]/.test(inner)
      const rawValue = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1]
      const inlineText = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXmlText(m[1]!)).join('')

      let cell: WorkbookCell
      if (type === 's') {
        const idx = Number(rawValue)
        cell = { text: Number.isFinite(idx) ? (shared[idx] ?? '') : '' }
      } else if (type === 'inlineStr') {
        cell = { text: inlineText }
      } else if (type === 'b') {
        cell = { text: rawValue === '1' ? 'TRUE' : 'FALSE' }
      } else if (type === 'e') {
        // An error cell (#DIV/0!, #N/A). It is text, never a number.
        cell = { text: decodeXmlText(rawValue ?? '') }
      } else if (type === 'str') {
        cell = { text: decodeXmlText(rawValue ?? '') }
      } else if (rawValue === undefined) {
        // Includes a formula cell with no cached value: a blank, not a guess.
        cell = { text: '' }
      } else {
        const n = Number(rawValue)
        cell = Number.isFinite(n)
          ? { text: rawValue, number: n }
          : { text: decodeXmlText(rawValue) }
      }
      if (isFormula) cell.formula = true
      const format = Number.isFinite(styleIndex) ? formats.get(styleIndex) : undefined
      if (format && cell.number !== undefined) {
        cell.format = format.shape
        if (format.symbol) cell.currencySymbol = format.symbol
      }

      row[target] = cell
      cellCount += 1
      if (cellCount > LIMITS.cellsPerSheet) {
        throw new WorkbookError('too_large', 'a sheet has more cells than this reader will read')
      }
    }

    rows.push(row)
    if (rows.length > LIMITS.rowsPerSheet) {
      throw new WorkbookError('too_large', `a sheet has more than ${LIMITS.rowsPerSheet} rows`)
    }
  }
  return rows
}

/** Resolve a relationship target against the xl/ part directory. */
function resolveSheetPath(target: string): string {
  const cleaned = target.replace(/^\/+/, '')
  return cleaned.startsWith('xl/') ? cleaned : `xl/${cleaned}`
}

/**
 * Read a workbook from its bytes.
 *
 * Throws WorkbookError for anything it will not read. The caller treats that the
 * way it treats an unparseable CSV: no table evidence, and the turn proceeds as
 * an ordinary grounded answer.
 */
export function readWorkbook(bytes: Buffer): Workbook {
  if (!looksLikeZip(bytes)) {
    throw new WorkbookError('not_a_workbook', 'that file is not an .xlsx workbook')
  }

  let names: string[]
  try {
    names = readZipEntries(bytes).map((e) => e.name)
  } catch (error) {
    if (error instanceof ZipError) throw new WorkbookError('malformed', error.message)
    throw error
  }

  // Refused rather than partially understood.
  if (names.some((n) => n.startsWith('xl/macrosheets/') || n === 'xl/vbaProject.bin')) {
    throw new WorkbookError('unsupported_package', 'macro-enabled workbooks are not supported')
  }
  if (names.some((n) => n === 'EncryptedPackage' || n.startsWith('EncryptionInfo'))) {
    throw new WorkbookError('unsupported_package', 'encrypted workbooks are not supported')
  }

  const read = (name: string): string | undefined => {
    const buf = readNamedEntry(bytes, name)
    return buf ? text(buf.toString('utf8'), LIMITS.xmlBytes) : undefined
  }

  const workbookXml = read('xl/workbook.xml')
  if (!workbookXml) {
    throw new WorkbookError('not_a_workbook', 'that file is a zip archive but not a workbook')
  }

  const shared = readSharedStrings(read('xl/sharedStrings.xml') ?? '')
  const formats = readNumberFormats(read('xl/styles.xml'))
  const rels = readRelationships(read('xl/_rels/workbook.xml.rels'))
  const index = readSheetIndex(workbookXml)
  if (index.length === 0) throw new WorkbookError('no_sheets', 'that workbook has no sheets')

  const sheets: WorkbookSheet[] = []
  for (const { name, rid } of index) {
    const target = rels.get(rid)
    // A sheet whose relationship is missing is skipped rather than guessed at by
    // position: the order of worksheet parts is not guaranteed to match the
    // order of <sheet> entries.
    if (!target) continue
    const xml = read(resolveSheetPath(target))
    if (xml === undefined) continue
    sheets.push({ name, rows: readSheet(xml, shared, formats) })
  }
  if (sheets.length === 0) throw new WorkbookError('no_sheets', 'that workbook has no readable sheets')
  return { sheets }
}
