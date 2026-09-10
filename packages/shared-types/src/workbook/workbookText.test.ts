/**
 * A WORKBOOK, AS EVIDENCE — exactly.
 *
 * 🚨 THESE ASSERT LITERAL STRINGS, NOT PARSED NUMBERS. A test that compared
 * `Number(cell)` would pass against the very defect this module exists to
 * avoid: a value that re-renders differently from the file is a value the
 * grounding gate cannot find, and the user is told their spreadsheet does not
 * say what it plainly says.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { deflateRawSync, crc32 } from 'node:zlib'

import { readWorkbook } from './readWorkbook.js'
import { workbookText } from './workbookText.js'

/* ------------------------------------------------------------------ *
 * A real .xlsx — real zip bytes, real parts
 * ------------------------------------------------------------------ */

function zip(files: Array<{ name: string; body: string }>): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const raw = Buffer.from(f.body, 'utf8')
    const deflated = deflateRawSync(raw)
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)              // deflate
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, deflated)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt16LE(8, 10)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(deflated.length, 20)
    dir.writeUInt32LE(raw.length, 24)
    dir.writeUInt16LE(name.length, 28)
    dir.writeUInt32LE(offset, 42)
    central.push(dir, name)

    offset += local.length + name.length + deflated.length
  }

  const body = Buffer.concat(locals)
  const dirBytes = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(dirBytes.length, 12)
  end.writeUInt32LE(body.length, 16)
  return Buffer.concat([body, dirBytes, end])
}

interface SheetSpec { name: string; part: string; rows: string }

function workbook(sheets: SheetSpec[], opts: { shared?: string[]; styles?: string } = {}): Buffer {
  const files = [
    {
      name: 'xl/workbook.xml',
      body: `<workbook><sheets>${sheets
        .map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      body: `<Relationships>${sheets
        .map((s, i) => `<Relationship Id="rId${i + 1}" Target="${s.part}"/>`)
        .join('')}</Relationships>`,
    },
    ...sheets.map((s) => ({
      name: `xl/${s.part}`,
      body: `<worksheet><sheetData>${s.rows}</sheetData></worksheet>`,
    })),
  ]
  if (opts.shared) {
    files.push({
      name: 'xl/sharedStrings.xml',
      body: `<sst>${opts.shared.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`,
    })
  }
  if (opts.styles) files.push({ name: 'xl/styles.xml', body: opts.styles })
  return zip(files)
}

const one = (rows: string, name = 'Sheet1'): SheetSpec => ({ name, part: 'worksheets/sheet1.xml', rows })
const textOf = (bytes: Buffer) => workbookText(readWorkbook(bytes).sheets)

/* ------------------------------------------------------------------ *
 * 🚨 Values are copied, not re-rendered
 * ------------------------------------------------------------------ */

test('🚨 a stored number reaches the evidence as the SAME string, digit for digit', () => {
  const bytes = workbook([one(
    '<row r="1">'
    + '<c r="A1"><v>48273.55</v></c>'
    // Beyond 2^53: any round-trip through Number() drops the last digits.
    + '<c r="B1"><v>900719925474099123</v></c>'
    // A trailing zero is meaningful on an invoice and vanishes under tidying.
    + '<c r="C1"><v>1.10</v></c>'
    + '</row>',
  )])

  assert.equal(textOf(bytes).text, '## Sheet1\n48273.55\t900719925474099123\t1.10')
})

test('🚨 an omitted empty cell does not slide the next value left a column', () => {
  /*
   * Excel writes NOTHING for an empty cell. Appending in encounter order puts
   * the total in column B — where an answer citing "column D" quotes a real
   * number from the wrong place.
   */
  const bytes = workbook(
    [one('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="D1"><v>48273.55</v></c></row>')],
    { shared: ['Total'] },
  )

  assert.equal(textOf(bytes).text, '## Sheet1\nTotal\t\t\t48273.55')
})

test('an inline string, a cached formula result, a boolean and an error all render', () => {
  const bytes = workbook([one(
    '<row r="1">'
    + '<c r="A1" t="inlineStr"><is><t>Inline</t></is></c>'
    + '<c r="B1" t="str"><f>A1</f><v>computed</v></c>'
    + '<c r="C1" t="b"><v>1</v></c>'
    + '<c r="D1" t="e"><v>#DIV/0!</v></c>'
    + '</row>',
  )])

  assert.equal(textOf(bytes).text, '## Sheet1\nInline\tcomputed\tTRUE\t#DIV/0!')
})

/* ------------------------------------------------------------------ *
 * 🚨 Formats
 * ------------------------------------------------------------------ */

test('🚨 a date-formatted number becomes a date; an identical money value does not', () => {
  /*
   * Both cells hold the SAME NUMBER. Only the format separates them, which is
   * why the format is read from the file rather than guessed from the value.
   */
  const styles = '<styleSheet>'
    + '<numFmts><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>'
    + '<cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs>'
    + '</styleSheet>'
  const bytes = workbook(
    [one('<row r="1"><c r="A1" s="1"><v>46266</v></c><c r="B1" s="2"><v>46266</v></c></row>')],
    { styles },
  )

  assert.equal(textOf(bytes).text, '## Sheet1\n2026-09-01\t$46266')
})

test('a percentage renders as the sheet DISPLAYS it, not as the fraction it stores', () => {
  // The file holds 0.1275 and shows 12.75%. "A 12.75% fee" must be groundable.
  const styles = '<styleSheet><cellXfs><xf numFmtId="10"/></cellXfs></styleSheet>'
  const bytes = workbook([one('<row r="1"><c r="A1" s="0"><v>0.1275</v></c></row>')], { styles })

  assert.equal(textOf(bytes).text, '## Sheet1\n12.75%')
})

/* ------------------------------------------------------------------ *
 * 🚨 Structure and limits
 * ------------------------------------------------------------------ */

test('🚨 the sheet named first is read from the part the RELATIONSHIP names', () => {
  /*
   * After a sheet is deleted the first sheet is commonly sheet3.xml. Guessing
   * "sheet1.xml" reads whichever sheet still holds that filename and labels it
   * with this one's name — a confident answer about a sheet never opened.
   */
  const bytes = workbook([
    { name: 'Summary', part: 'worksheets/sheet3.xml', rows: '<row r="1"><c r="A1"><v>111</v></c></row>' },
    { name: 'Detail', part: 'worksheets/sheet1.xml', rows: '<row r="1"><c r="A1"><v>222</v></c></row>' },
  ])

  const result = textOf(bytes)
  assert.deepEqual(result.sheets, ['Summary', 'Detail'])
  assert.equal(result.text, '## Summary\n111\n## Detail\n222')
})

test('a workbook read in full reports complete', () => {
  assert.equal(textOf(workbook([one('<row r="1"><c r="A1"><v>1</v></c></row>')])).complete, true)
})

test('🚨 a workbook past the cell cap is INCOMPLETE, not silently truncated', () => {
  const rows = Array.from({ length: 40 }, (_, r) => `<row r="${r + 1}">${
    Array.from({ length: 10 }, (_, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}"><v>${r}</v></c>`).join('')
  }</row>`).join('')

  const result = workbookText(readWorkbook(workbook([one(rows)])).sheets, { maxCells: 100 })
  assert.equal(result.complete, false, 'a capped workbook reported itself complete')
  assert.ok(result.text.length > 0, 'the cap produced no text at all')
})
