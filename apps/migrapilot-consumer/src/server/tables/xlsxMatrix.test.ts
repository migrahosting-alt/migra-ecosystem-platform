/**
 * THE STRUCTURED-DATA ACCEPTANCE MATRIX, RUN AGAINST .XLSX.
 *
 * The same matrix the delimited lane passes, over workbooks. It asserts on the
 * EVIDENCE — what the model is handed — never on what a model said about it,
 * because the rule is that the deterministic layer produces the number and the
 * model only explains it.
 *
 * Expected values are computed independently of the reader (python, when the
 * fixtures were built) rather than copied from this code's own output. An
 * earlier test in this lane asserted guessed date constants and failed against
 * correct code; assertions here are verified numbers, not recollections.
 *
 * Fixtures are built by python's zipfile, so the bytes come from a different
 * implementation than the one under test. Rebuild with:
 *   python3 src/server/tables/__fixtures__/build_fixtures.py src/server/tables/__fixtures__
 */

import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import { deniesCellText } from '@/features/attachments/spreadsheetDisclosure'

import { tableEvidenceFor } from './tableEvidence'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')
const ask = (question: string, file: string) => tableEvidenceFor(question, [file], DIR)

/** Every computed answer must say where it came from, down to the sheet. */
function assertProvenance(text: string, file: string, sheet: string): void {
  assert.ok(text.includes(file), `evidence does not name the workbook: ${text}`)
  assert.ok(text.includes(`sheet "${sheet}"`), `evidence does not name the sheet: ${text}`)
}

describe('xlsx · arithmetic', () => {
  it('sum — the canonical 474,000, from a workbook this time', async () => {
    const e = await ask('What is the total Revenue in this file?', 'matrix_sales.xlsx')
    assert.ok(e, 'no evidence')
    assert.equal(e!.operation, 'sum')
    assert.equal(e!.sheet, 'Sales')
    assert.ok(e!.text.includes('474,000'), e!.text)
    assertProvenance(e!.text, 'matrix_sales.xlsx', 'Sales')
    assert.ok(e!.text.includes('"Revenue"'), 'the column is not named')
  })

  it('average — over a percent column, skipping the blank', async () => {
    // 3 values: 12.75, -3.25, 8.10 -> mean 5.8667%. The blank is EXCLUDED, not
    // counted as zero, which would give 4.4%.
    const e = await ask('What is the average Margin?', 'matrix_sales.xlsx')
    assert.ok(e, 'no evidence')
    assert.ok(e!.text.includes('5.8667%'), e!.text)
    assert.ok(e!.text.includes('1 blank'), 'the blank is not reported')
  })

  it('max — with the row it belongs to', async () => {
    const e = await ask('What is the highest Revenue?', 'matrix_sales.xlsx')
    assert.ok(e!.text.includes('156,500'), e!.text)
    assert.ok(e!.text.includes('South'), 'the label is missing')
  })

  it('min', async () => {
    const e = await ask('What is the lowest Revenue?', 'matrix_sales.xlsx')
    assert.ok(e!.text.includes('61,250'), e!.text)
  })

  it('count', async () => {
    const e = await ask('How many rows are in this file?', 'matrix_sales.xlsx')
    assert.equal(e!.operation, 'count')
    assert.ok(e!.text.includes('count of rows: 4'), e!.text)
  })

  it('group-by — and never "1 rows"', async () => {
    const e = await ask('Total Revenue by Region', 'matrix_sales.xlsx')
    assert.equal(e!.operation, 'group')
    for (const [region, total] of [['North', '100,000'], ['South', '156,500'],
                                   ['East', '156,250'], ['West', '61,250']]) {
      assert.ok(e!.text.includes(`${region}: ${total}`), `${region} missing from: ${e!.text}`)
    }
    assert.ok(e!.text.includes('(1 row)'), 'singular row count regressed')
    assert.ok(!e!.text.includes('1 rows'), 'says "1 rows"')
  })
})

describe('xlsx · data shapes', () => {
  it('currency is a quantity, and negatives are kept', async () => {
    const revenue = await ask('What is the total Revenue in this file?', 'matrix_sales.xlsx')
    assert.ok(revenue!.text.includes('474,000'))
    // -3.25% is genuinely negative; an absolute-value bug would give a higher mean.
    const margin = await ask('What is the average Margin?', 'matrix_sales.xlsx')
    assert.ok(margin!.text.includes('5.8667%'), margin!.text)
  })

  it('a missing value stays absent rather than becoming zero', async () => {
    const e = await ask('What is the total Margin?', 'matrix_sales.xlsx')
    assert.ok(e, 'no evidence')
    assert.ok(e!.text.includes('1 blank'), e!.text)
    assert.ok(e!.text.includes('3 rows used'), e!.text)
  })

  it('🚨 refuses to total an identifier column — ZipCode', async () => {
    const e = await ask('What is the total ZipCode in this file?', 'matrix_sales.xlsx')
    assert.ok(e, 'went silent instead of refusing')
    assert.equal(e!.operation, 'refused:sum')
    assert.ok(/identifies rows rather than measuring them/.test(e!.text), e!.text)
    assert.ok(/Do NOT add the numbers up yourself/.test(e!.text), 'the refusal is not model-visible')
    // The figure a summed ZipCode column would have produced must never appear.
    assert.ok(!e!.text.includes('132737'), 'leaked a summed identifier')
    assert.ok(!e!.text.includes('132,737'), 'leaked a summed identifier')
  })

  it('🚨 refuses to total an identifier column — ORDERID', async () => {
    const e = await ask('What is the total ORDERID?', 'matrix_sales.xlsx')
    assert.equal(e!.operation, 'refused:sum')
    assert.ok(!e!.text.includes('19,290') && !e!.text.includes('19290'), 'leaked a summed identifier')
  })

  it('🚨 refuses to total a DATE column, which a workbook stores as numbers', async () => {
    // The hazard unique to .xlsx. Serials 46264-46267 would sum to 185,062.
    const e = await ask('What is the total Booked?', 'matrix_sales.xlsx')
    assert.ok(e, 'went silent instead of refusing')
    assert.equal(e!.operation, 'refused:sum')
    assert.ok(!e!.text.includes('185,062') && !e!.text.includes('185062'), 'summed a date column')
  })

  it('asks which column when the question is ambiguous', async () => {
    const e = await ask('What is the total?', 'matrix_ambiguous.xlsx')
    assert.equal(e!.operation, 'clarify:sum')
    assert.ok(e!.text.includes('"Revenue"') && e!.text.includes('"Cost"'), e!.text)
    assert.ok(/Do NOT .*pick a column on the user's behalf/.test(e!.text), 'not model-visible')
  })

  it('handles a large workbook without truncating it', async () => {
    // 5,000 data rows; the total was computed when the fixture was written.
    const e = await ask('What is the total Amount?', 'matrix_large.xlsx')
    assert.ok(e, 'no evidence for a large workbook')
    assert.ok(e!.text.includes('2,497,500'), e!.text)
    assert.ok(e!.text.includes('5000 rows used'), 'row count is wrong — was it truncated?')
  })
})

describe('xlsx · sheets', () => {
  it('🚨 refuses rather than picking a sheet the question did not name', async () => {
    const e = await ask('What is the total Amount?', 'matrix_multisheet.xlsx')
    assert.ok(e, 'went silent instead of refusing')
    assert.equal(e!.operation, 'refused:sum')
    assert.ok(e!.text.includes('"Q1"') && e!.text.includes('"Q2"'), e!.text)
    // Neither sheet's total may appear: Q1 sums to 30, Q2 to 700.
    assert.ok(!e!.text.includes('700') && !e!.text.includes('30'), 'leaked a sheet total')
  })

  it('uses the named sheet, and not the other one', async () => {
    const e = await ask('What is the total Amount in Q2?', 'matrix_multisheet.xlsx')
    assert.equal(e!.sheet, 'Q2')
    assert.ok(e!.text.includes('700'), e!.text)
    assert.ok(!e!.text.includes(': 30'), 'used the wrong sheet')
    assertProvenance(e!.text, 'matrix_multisheet.xlsx', 'Q2')
  })

  it('names the sheet in the provenance of every computed answer', async () => {
    for (const [q, f, sheet] of [
      ['What is the total Revenue in this file?', 'matrix_sales.xlsx', 'Sales'],
      ['What is the total Amount in Q1?', 'matrix_multisheet.xlsx', 'Q1'],
    ] as const) {
      const e = await ask(q, f)
      assert.equal(e!.sheet, sheet)
      assertProvenance(e!.text, f, sheet)
    }
  })
})

describe('xlsx · formulas', () => {
  it('🚨 uses the stored result and says it was not recalculated', async () => {
    const e = await ask('What is the total Amount?', 'matrix_formula.xlsx')
    assert.ok(e, 'no evidence')
    assert.ok(
      /stored formula results, read as saved, not recalculated by MigraPilot/.test(e!.text),
      `formula provenance missing: ${e!.text}`,
    )
  })

  it('flags formula provenance as DATA, so the disclosure cannot be optional', async () => {
    // The model dropped the prose provenance and answered "The total Amount is
    // 30" with nothing to say the figure was a saved result. The route forces the
    // disclosure from this flag, so it must be set.
    const e = await ask('What is the total Amount?', 'matrix_formula.xlsx')
    assert.equal(e!.formulaDerived, true, 'formula provenance is not machine-readable')
  })

  it('does NOT flag an ordinary numeric column', async () => {
    // The negative half: a disclosure that appears on every answer means nothing.
    for (const [q, f] of [
      ['What is the total Revenue?', 'matrix_sales.xlsx'],
      ['What is the total Amount in Q2?', 'matrix_multisheet.xlsx'],
      ['What is the total Amount?', 'matrix_large.xlsx'],
    ] as const) {
      const e = await ask(q, f)
      assert.ok(e, `${f} produced no evidence`)
      assert.notEqual(e!.formulaDerived, true, `${f} wrongly flagged as formula-derived`)
    }
  })

  it('does not claim to have evaluated anything', async () => {
    const e = await ask('What is the total Amount?', 'matrix_formula.xlsx')
    assert.ok(!/evaluat|recomputed|calculated the formula/i.test(e!.text), e!.text)
  })
})

describe('xlsx · refusals', () => {
  it('states that a zip which is not a workbook cannot be read', async () => {
    const e = await ask('What is the total?', 'matrix_notaworkbook.xlsx')
    assert.ok(e, 'went silent on an unreadable workbook')
    assert.equal(e!.operation, 'refused:sum')
    assert.ok(/not a workbook/.test(e!.text), e!.text)
  })

  it('refuses a macro-enabled package', async () => {
    const e = await ask('What is the total?', 'matrix_macro.xlsx')
    assert.ok(e, 'went silent on a macro-enabled workbook')
    assert.ok(/macro-enabled workbooks are not supported/.test(e!.text), e!.text)
  })

  it('every refusal tells the model not to invent the number', async () => {
    for (const [q, f] of [
      ['What is the total ZipCode in this file?', 'matrix_sales.xlsx'],
      ['What is the total Amount?', 'matrix_multisheet.xlsx'],
      ['What is the total?', 'matrix_notaworkbook.xlsx'],
      ['What is the total?', 'matrix_macro.xlsx'],
    ] as const) {
      const e = await ask(q, f)
      assert.ok(e, `${f} went silent`)
      assert.ok(
        /Do NOT add the numbers up yourself/.test(e!.text),
        `refusal is not model-visible for ${f}: ${e!.text}`,
      )
    }
  })
})

describe('xlsx · persistence', () => {
  it('reads the same workbook the same way on a second turn', async () => {
    // Reload behaviour: nothing is cached across turns, and a second identical
    // question must produce identical evidence rather than drifting.
    const first = await ask('What is the total Revenue in this file?', 'matrix_sales.xlsx')
    const second = await ask('What is the total Revenue in this file?', 'matrix_sales.xlsx')
    assert.deepEqual(second, first)
  })

  it('still refuses the identifier on a repeat question', async () => {
    const a = await ask('What is the total ZipCode in this file?', 'matrix_sales.xlsx')
    const b = await ask('What is the total ZipCode in this file?', 'matrix_sales.xlsx')
    assert.deepEqual(b, a)
    assert.equal(b!.operation, 'refused:sum')
  })
})

describe('xlsx · summarise', () => {
  /*
   * 🚨 REFUSING SOMETHING WE CAN DO IS A DEFECT. "Summarize the document for me."
   * used to produce no evidence, so the turn was refused with "general document
   * search inside spreadsheets is not available yet" — truthful about prose, and
   * useless, while the sheet, its columns, its row count and its totals sat
   * right there.
   */
  it('summarises a sheet from computed structure, not impressions', async () => {
    const e = await ask('Summarize the document for me.', 'matrix_sales.xlsx')
    assert.ok(e, 'no evidence for a summary request')
    assert.equal(e!.operation, 'describe')
    assert.ok(e!.text.includes('4 rows'), e!.text)
    assert.ok(e!.text.includes('474,000'), 'the real total is missing')
    for (const column of ['Region', 'Revenue', 'Margin', 'Units', 'ZipCode', 'ORDERID', 'Booked']) {
      assert.ok(e!.text.includes(`"${column}"`), `${column} missing from the summary`)
    }
  })

  it('names identifiers and dates as such instead of totalling them', async () => {
    const e = await ask('Summarize the document for me.', 'matrix_sales.xlsx')
    assert.match(e!.text, /"ZipCode": identifies rows/, e!.text)
    assert.match(e!.text, /"Booked": dates or codes/, e!.text)
    // Their sums must never appear.
    assert.ok(!e!.text.includes('132,737'))
    assert.ok(!e!.text.includes('185,062'))
  })

  it('describes EVERY sheet of a multi-sheet workbook', async () => {
    // Ambiguity matters for a total, not for a summary.
    const e = await ask('Summarize the document for me.', 'matrix_multisheet.xlsx')
    assert.equal(e!.operation, 'describe')
    assert.ok(e!.text.includes('sheet "Q1"') && e!.text.includes('sheet "Q2"'), e!.text)
    assert.ok(e!.text.includes('30') && e!.text.includes('700'), 'per-sheet totals missing')
  })

  it('a multi-sheet TOTAL still refuses, because that is genuinely ambiguous', async () => {
    const e = await ask('What is the total Amount?', 'matrix_multisheet.xlsx')
    assert.equal(e!.operation, 'refused:sum')
  })

  it('flags the workbook boundary as DATA, so the disclosure cannot be optional', async () => {
    // The evidence asked the model to state it and the model complied on one
    // prompt and not another. The route forces it from this flag.
    for (const f of ['matrix_sales.xlsx', 'matrix_multisheet.xlsx', 'matrix_formula.xlsx']) {
      const e = await ask('Summarize the document for me.', f)
      assert.ok(e, `${f} produced no evidence`)
      assert.equal(e!.workbookBoundary, true, `${f} is not flagged`)
    }
  })

  it('never tells the model that cell text is inaccessible', async () => {
    /*
     * 🚨 THE SECOND PRODUCTION DEFECT, AT ITS SOURCE. The evidence used to carry
     * "MigraPilot cannot search the text inside a spreadsheet", and the model
     * restated it as "no text content within cells is accessible … it cannot
     * process or interpret text within spreadsheet cells" — false, in a reply
     * that had just listed the column headers this same evidence read out of
     * cells.
     *
     * The prompt is where that started, so the prompt is where it is asserted.
     */
    for (const f of ['matrix_sales.xlsx', 'matrix_multisheet.xlsx', 'matrix_formula.xlsx']) {
      const e = await ask('Summarize the document for me.', f)
      assert.equal(deniesCellText(e!.text), false, `${f} evidence denies cell text:\n${e!.text}`)
      assert.ok(
        !/cannot search the text inside/i.test(e!.text),
        `${f} still carries the retired wording:\n${e!.text}`,
      )
      // And it must actively forbid the denial, not merely avoid making it.
      assert.match(e!.text, /never say MigraPilot cannot read, process or interpret/i, e!.text)
    }
  })

  it('🚨 a mixed column is described as a MIXTURE, never as a shortage', async () => {
    /*
     * THE NEGATIVE HALF of the refusal-cause fix. A date column stopped saying
     * "too few to total" because that was never why it was refused. This column
     * must keep saying it, because that is exactly why.
     *
     * 🚨 THE SHAPE HAD TO BE CORRECTED. My first fixture was one number plus four
     * BLANKS, and it came back as `sum` — blanks are excluded from the ratio, so
     * of the values present 100% were quantities and the column was legitimately
     * summable. The scarcity branch is reachable only for a MIXED column: one
     * number among four text entries, where the values present are not
     * overwhelmingly quantities. The first version asserted on a state the
     * product cannot produce.
     */
    const e = await ask('What is the total Readings?', 'matrix_mixed.xlsx')
    assert.ok(e, 'no evidence for the mixed workbook')
    assert.match(e!.operation, /refused/, e!.operation)
    assert.match(e!.text, /mixes text with numbers/i, e!.text)
    /*
     * 🚨 AND NEVER AS A SHORTAGE. "too few to total" produced, in production:
     * "the data lacks the necessary quantity of numeric entries … the remaining
     * 4 cells contain non-numeric or invalid data". The cells hold "pending",
     * "not taken", "sensor offline" — valid entries, none of them invalid.
     */
    // Scoped to the REASON line: the directive below it necessarily contains
    // "invalid" in order to forbid it, and matching the whole blob would fail on
    // the very sentence that prevents the defect.
    const reasonLine = e!.text.split('\n')[0]!
    for (const accusation of [/too few/i, /insufficient/i, /lacks/i, /invalid/i, /\bbad\b/i]) {
      assert.ok(!accusation.test(reasonLine), `accusatory framing survived: ${reasonLine}`)
    }
  })

  it('a date column is refused for being dates, never for being sparse', async () => {
    const e = await ask('What is the total Booked?', 'matrix_sales.xlsx')
    assert.match(e!.operation, /refused/)
    assert.match(e!.text, /dates or codes/i, e!.text)
    // The sentence the model turned into "there is not enough data".
    assert.ok(!/too few to total/i.test(e!.text), e!.text)
    assert.ok(!/out of \d+ that are not empty/i.test(e!.text), e!.text)
  })

  it('every refusal tells the model not to blame the user\'s file', async () => {
    for (const [q, f] of [['What is the total Booked?', 'matrix_sales.xlsx'],
                          ['What is the total Amount?', 'matrix_multisheet.xlsx']] as const) {
      const e = await ask(q, f)
      assert.match(e!.text, /do not substitute a different one/i, `${f}: ${e!.text}`)
      assert.match(e!.text, /never a fault in their file/i, `${f}: ${e!.text}`)
      // The directive must forbid calling the user's values invalid, which is
      // what the model reached for once scarcity framing licensed it.
      assert.match(e!.text, /invalid, bad or wrong/i, `${f}: ${e!.text}`)
    }
  })

  it('proves cell text WAS read, which is why the denial is false', async () => {
    // The labels below are text, taken out of cells by this layer. Any claim
    // that cell text is unreadable is contradicted by the evidence carrying it.
    const e = await ask('Summarize the document for me.', 'matrix_sales.xlsx')
    for (const label of ['Region', 'Revenue', 'Booked']) {
      assert.ok(e!.text.includes(`"${label}"`), `${label} — a cell string — is missing`)
    }
  })

  it('flags formula provenance in a summary too', async () => {
    const e = await ask('Summarize this file', 'matrix_formula.xlsx')
    assert.equal(e!.formulaDerived, true)
    assert.match(e!.text, /did not recalculate/i, e!.text)
  })
})
