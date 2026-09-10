/**
 * A workbook sheet must reach the SAME verdicts a CSV of that sheet would.
 *
 * The tests that matter are the ones where a workbook could differ from a CSV
 * and must not: an Excel date is a bare number, a percentage is a fraction, and
 * a formula cell carries a cached value. Each of those could turn a column that
 * must never be summed into one that looks perfectly summable.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import { excelSerialToIso, readWorkbook, type WorkbookSheet } from '@migrapilot/shared-types/workbook'
import { chooseSheet, renderCellText, sheetToTable } from './workbookTable'

/*
 * 🚨 THE READER'S OWN FIXTURES, WHERE THE READER LIVES. These four workbooks
 * test how a .xlsx is READ, so they moved into the shared package with it. The
 * `eq_*` corpus stays here: it tests that a sheet and its CSV export classify
 * identically, which is this lane's question, not the reader's.
 */
const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../packages/shared-types/src/workbook/__fixtures__',
)
const load = (name: string): Buffer => readFileSync(join(FIXTURES, name))

const sheet = (name: string, rows: (string | number)[][]): WorkbookSheet => ({
  name,
  rows: rows.map((r) => r.map((v) => (typeof v === 'number' ? { text: String(v), number: v } : { text: v }))),
})

describe('excelSerialToIso', () => {
  it('converts serials the way Excel actually displays them', () => {
    // Verified against the convention rather than assumed: the first version of
    // this test asserted guessed constants and failed against correct code.
    assert.equal(excelSerialToIso(1), '1900-01-01')
    assert.equal(excelSerialToIso(59), '1900-02-28')
    assert.equal(excelSerialToIso(61), '1900-03-01')
    assert.equal(excelSerialToIso(46264), '2026-08-30')
  })

  it('refuses serial 60, the day that never existed', () => {
    // Excel keeps 1900-02-29 to agree with Lotus 1-2-3. Returning a real date
    // for it would silently shift the value by a day.
    assert.equal(excelSerialToIso(60), undefined)
  })

  it('refuses serials that are not plausible dates', () => {
    for (const v of [0, -5, 5_000_000, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(excelSerialToIso(v), undefined, `accepted ${v}`)
    }
  })
})

describe('renderCellText', () => {
  it('renders a percentage as the display text, not the fraction', () => {
    assert.equal(renderCellText({ text: '0.1275', number: 0.1275, format: 'percent' }), '12.75%')
    assert.equal(renderCellText({ text: '-0.0325', number: -0.0325, format: 'percent' }), '-3.25%')
  })

  it('renders currency with the symbol the sheet actually names', () => {
    assert.equal(
      renderCellText({ text: '100000', number: 100000, format: 'currency', currencySymbol: '$' }),
      '$100000',
    )
    assert.equal(
      renderCellText({ text: '50', number: 50, format: 'currency', currencySymbol: '£' }),
      '£50',
    )
  })

  it('does not invent a currency when the format names none', () => {
    // A built-in currency id does not say WHICH currency. Naming one would be a
    // fabrication in the field a reader would most trust.
    assert.equal(renderCellText({ text: '50', number: 50, format: 'currency' }), '50')
  })

  it('renders a date-formatted number as a date', () => {
    assert.equal(renderCellText({ text: '46264', number: 46264, format: 'date' }), '2026-08-30')
  })

  it('leaves text alone', () => {
    assert.equal(renderCellText({ text: 'North' }), 'North')
    assert.equal(renderCellText({ text: '' }), '')
  })
})

describe('sheetToTable', () => {
  it('reaches the same column verdicts as the delimited path', () => {
    const wb = readWorkbook(load('workbook_basic.xlsx'))
    const table = sheetToTable(wb.sheets[0]!)
    assert.equal(table.sheetName, 'Sales')
    assert.deepEqual(table.headers, ['Region', 'Revenue', 'Margin', 'ZipCode', 'ORDERID'])

    const by = (n: string) => table.columns.find((c) => c.name === n)!
    assert.equal(by('Revenue').quantitative, true, 'Revenue must be summable')
    assert.equal(by('Margin').percent, true, 'Margin must read as percentages')

    // 🚨 The property the whole identifier lane exists for, now via .xlsx.
    assert.equal(by('ZipCode').quantitative, false, 'ZipCode must never be summable')
    assert.equal(by('ZipCode').identifierName, true)
    assert.equal(by('ORDERID').quantitative, false, 'ORDERID must never be summable')
    assert.equal(by('ORDERID').identifierName, true)
  })

  it('counts a missing value as blank, never as zero', () => {
    const wb = readWorkbook(load('workbook_basic.xlsx'))
    const table = sheetToTable(wb.sheets[0]!)
    const margin = table.columns.find((c) => c.name === 'Margin')!
    assert.equal(margin.blankCells, 1)
    assert.equal(table.rows[2]![2]!.kind, 'blank')
    assert.equal(table.rows[2]![2]!.value, undefined)
  })

  it('carries the cached formula value and records which column held formulas', () => {
    const wb = readWorkbook(load('workbook_formula.xlsx'))
    const table = sheetToTable(wb.sheets[0]!)
    assert.deepEqual(table.formulaColumns, [1])
    assert.equal(table.rows.at(-1)![1]!.value, 15)
  })

  it('🚨 refuses to make a date column summable', () => {
    // The hazard unique to workbooks: dates are stored as bare numbers.
    const dated: WorkbookSheet = {
      name: 'Log',
      rows: [
        [{ text: 'Event' }, { text: 'When' }],
        [{ text: 'open' }, { text: '46264', number: 46264, format: 'date' }],
        [{ text: 'close' }, { text: '46265', number: 46265, format: 'date' }],
        [{ text: 'audit' }, { text: '46266', number: 46266, format: 'date' }],
      ],
    }
    const table = sheetToTable(dated)
    assert.equal(table.columns[1]!.quantitative, false, 'a date column must not be summable')
  })

  it('refuses a sheet with no data rows', () => {
    assert.throws(() => sheetToTable(sheet('Empty', [['A', 'B']])), /header row and at least one data row/)
  })

  it('refuses a single-column sheet', () => {
    assert.throws(() => sheetToTable(sheet('One', [['Only'], [1], [2]])), /only one column/)
  })

  it('records a row wider than its header rather than repairing it', () => {
    const ragged = sheet('R', [['A', 'B'], [1, 2], [3, 4]])
    ragged.rows[2]!.push({ text: 'extra' })
    assert.deepEqual(sheetToTable(ragged).malformedRows, [3])
  })
})

describe('chooseSheet', () => {
  const sheets = [sheet('Q1', [['A', 'B'], [1, 2]]), sheet('Q2', [['A', 'B'], [3, 4]])]

  it('takes the sheet the question names', () => {
    const choice = chooseSheet('what is the total in Q2', sheets)
    assert.equal(choice.kind, 'sheet')
    assert.equal(choice.kind === 'sheet' && choice.sheet.name, 'Q2')
  })

  it('takes the only sheet when there is one', () => {
    const choice = chooseSheet('what is the total', [sheets[0]!])
    assert.equal(choice.kind, 'sheet')
  })

  it('🚨 refuses rather than picking one of several unnamed sheets', () => {
    const choice = chooseSheet('what is the total', sheets)
    assert.equal(choice.kind, 'ambiguous')
    assert.deepEqual(choice.kind === 'ambiguous' && choice.names, ['Q1', 'Q2'])
  })

  it('refuses when the question names two sheets', () => {
    const choice = chooseSheet('compare Q1 and Q2', sheets)
    assert.equal(choice.kind, 'ambiguous')
  })

  it('reads the real multi-sheet workbook the same way', () => {
    const wb = readWorkbook(load('workbook_multisheet.xlsx'))
    assert.equal(chooseSheet('total amount', wb.sheets).kind, 'ambiguous')
    const named = chooseSheet('total amount in Q2', wb.sheets)
    assert.equal(named.kind === 'sheet' && named.sheet.name, 'Q2')
  })
})
