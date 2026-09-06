/**
 * The standing assertion: MigraPilot must never claim spreadsheet cell text is
 * wholly inaccessible or uninterpretable.
 *
 * 🚨 THE EXACT PRODUCTION SENTENCE IS PINNED BELOW. Everything else about that
 * retest passed — the structured summary was right, the identifier and date
 * columns were refused, the numbers were exact — and the reply still closed with
 * a falsehood about the product's own capability, one the same reply disproved
 * by quoting the column headers.
 *
 * Two failures are guarded here, and the second is the one that keeps recurring:
 *   · the FALSE claim, in every phrasing a model reaches for;
 *   · the TRUE statement tripping its own guard, which is how an over-broad
 *     detector would quietly force the correction onto every correct reply.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { refusalFor } from './capability'
import { outcomeOfIndex } from './outcome'
import {
  CELL_TEXT_CORRECTION,
  SPREADSHEET_CAPABILITY_STATEMENT,
  deniesCellText,
  workbookDisclosureFor,
} from './spreadsheetDisclosure'

/** Verbatim, from the production retest. */
const PRODUCTION_FALSEHOOD =
  'No text content within cells is accessible to MigraPilot, as it cannot ' +
  'process or interpret text within spreadsheet cells.'

describe('the production falsehood', () => {
  it('is caught verbatim', () => {
    assert.equal(deniesCellText(PRODUCTION_FALSEHOOD), true)
  })

  it('is caught inside a reply that is otherwise correct', () => {
    const reply = [
      'The workbook matrix_sales.xlsx has one sheet, Sales, with 5 rows.',
      'Region holds the labels North and South. Revenue totals 474,000.',
      PRODUCTION_FALSEHOOD,
    ].join('\n\n')
    assert.equal(deniesCellText(reply), true, 'the guard only looked at the summary')
  })

  it('is caught in the phrasings a model reaches for instead', () => {
    for (const claim of [
      'MigraPilot cannot read the text in the cells.',
      'The text within spreadsheet cells is not accessible.',
      'Cell contents are inaccessible to MigraPilot.',
      'It is unable to interpret any text inside the workbook cells.',
      'No cell text is readable by MigraPilot.',
      'MigraPilot does not process text content in Excel cells.',
      'The labels in this sheet are uninterpretable to MigraPilot.',
      // Split across two sentences, which a single-sentence guard would miss.
      'MigraPilot cannot process the contents. The cells in this spreadsheet are opaque to it.',
    ]) {
      assert.equal(deniesCellText(claim), true, `MISSED: ${claim}`)
    }
  })

  it('is caught in the PASSIVE voice, which is how a model prefers to write it', () => {
    for (const claim of [
      'The text in these cells could not be accessed.',
      'Cell contents are not processed by MigraPilot.',
      'No text within the spreadsheet cells was read.',
      'The labels in this workbook cannot be interpreted.',
      'Text inside the cells was not understood.',
    ]) {
      assert.equal(deniesCellText(claim), true, `MISSED: ${claim}`)
    }
  })

  it('is caught when made by EXCLUSION rather than by denial', () => {
    // No denial verb appears, and the reader is told the same false thing.
    for (const claim of [
      'Only numeric values in the spreadsheet can be analyzed.',
      'MigraPilot is limited to numeric data in this workbook.',
      'Analysis of these cells is restricted to numbers.',
    ]) {
      assert.equal(deniesCellText(claim), true, `MISSED: ${claim}`)
    }
  })
})

describe('the true statement does not trip its own guard', () => {
  it('the deterministic sentence is clean', () => {
    assert.equal(deniesCellText(SPREADSHEET_CAPABILITY_STATEMENT), false, SPREADSHEET_CAPABILITY_STATEMENT)
  })

  it('the correction is clean, so it is never appended to itself', () => {
    const both = `${CELL_TEXT_CORRECTION} ${SPREADSHEET_CAPABILITY_STATEMENT}`
    assert.equal(deniesCellText(both), false, both)
  })

  it('a real workbook summary carrying the sentence is clean', () => {
    const reply = [
      'matrix_sales.xlsx contains one sheet, Sales, with 5 data rows across 6 columns.',
      'Region holds text labels (North, South). Revenue totals 474,000 and Margin averages 5.87%.',
      'Booked is a date column and ZipCode is an identifier, so neither was totalled.',
      SPREADSHEET_CAPABILITY_STATEMENT,
    ].join('\n\n')
    assert.equal(deniesCellText(reply), false, 'the guard fires on a correct reply')
  })

  it('saying search is unavailable is TRUE and must stay sayable', () => {
    for (const fine of [
      'General document-style text search inside spreadsheets is not available yet.',
      'MigraPilot cannot search across the text of a spreadsheet the way it searches a PDF.',
      'Document search inside spreadsheets is not available yet, so ask about a column instead.',
      'Document-style text search inside this workbook is unavailable.',
    ]) {
      assert.equal(deniesCellText(fine), false, `FALSE POSITIVE: ${fine}`)
    }
  })

  it('FORBIDDING the claim is not making it', () => {
    /*
     * The evidence prompt has to name the false statement to rule it out, and
     * the guard fired on exactly that sentence — the one written to prevent the
     * defect. A word filter would have failed here; reading the frame does not.
     */
    for (const fine of [
      'Those labels ARE cell text, so never say MigraPilot cannot read, process or interpret the text in cells — it can.',
      'Do not claim that the text in a spreadsheet cell is inaccessible.',
      'It is false to say that cell contents cannot be read.',
    ]) {
      assert.equal(deniesCellText(fine), false, `FALSE POSITIVE: ${fine}`)
    }
  })

  it('a positive statement about reading is not a denial', () => {
    // `understood` standing alone made this fail — a true sentence flagged as a
    // lie because it contained one word from the denial vocabulary.
    for (const fine of [
      'MigraPilot understood the sheet structure and the column labels.',
      'The text in each cell was read directly from the workbook.',
      'Region holds the labels North and South, read from the spreadsheet.',
    ]) {
      assert.equal(deniesCellText(fine), false, `FALSE POSITIVE: ${fine}`)
    }
  })

  it('DESCRIBING the data is not an exclusivity claim about the reader', () => {
    /*
     * 🚨 CAUGHT BY THE LIVE MATRIX, not by this file. Run B of the acceptance
     * matrix flagged the reply below and the correction was appended to a
     * CORRECT answer — the guard producing its own wrong output. The sentence
     * says "only structured data with labels and numeric values", which names
     * the cell text as present; nothing about it denies reading.
     */
    const liveReply =
      'There are no written commentary or narrative paragraphs inside the "Sales" sheet ' +
      'of the matrix_sales.xlsx file. The sheet contains only structured data with labels ' +
      'and numeric values, as described.'
    assert.equal(deniesCellText(liveReply), false, 'the guard fires on a correct reply')

    for (const fine of [
      'The sheet contains only numbers and labels.',
      'This workbook holds only structured rows of numeric values and text headers.',
    ]) {
      assert.equal(deniesCellText(fine), false, `FALSE POSITIVE: ${fine}`)
    }
  })

  it('reporting an actually-empty cell is data, not a capability claim', () => {
    for (const fine of [
      'Row 4 of the Margin column has an empty cell, so it was excluded from the average.',
      'Two cells in the Notes column contain no text.',
    ]) {
      assert.equal(deniesCellText(fine), false, `FALSE POSITIVE: ${fine}`)
    }
  })
})

describe('what the route actually appends', () => {
  /*
   * The correction branch exists for the production defect, and no live test can
   * make a model produce that denial on demand — so without these it would be
   * the one branch nothing checked.
   */
  it('a correct reply gets the statement, and nothing else', () => {
    const reply = 'The Sales sheet has 4 rows. Revenue totals 474,000.'
    assert.equal(workbookDisclosureFor(reply), SPREADSHEET_CAPABILITY_STATEMENT)
  })

  it('a reply that denied cell text is CONTRADICTED, not merely followed', () => {
    const out = workbookDisclosureFor(PRODUCTION_FALSEHOOD)
    assert.ok(out.startsWith(CELL_TEXT_CORRECTION), out)
    assert.ok(out.includes(SPREADSHEET_CAPABILITY_STATEMENT), out)
  })

  it('what it appends never trips the guard, whichever branch ran', () => {
    for (const reply of ['Revenue totals 474,000.', PRODUCTION_FALSEHOOD]) {
      assert.equal(deniesCellText(workbookDisclosureFor(reply)), false)
    }
  })

  it('the statement is unconditional — it never defers to the model', () => {
    /*
     * The version this replaces suppressed itself whenever the reply already
     * looked boundary-shaped, which is precisely what let the false paraphrase
     * stand in place of the true statement.
     */
    for (const reply of [
      'MigraPilot cannot search the text inside a spreadsheet.',
      'No text was read from this file.',
      'Revenue totals 474,000.',
      PRODUCTION_FALSEHOOD,
    ]) {
      assert.ok(
        workbookDisclosureFor(reply).includes(SPREADSHEET_CAPABILITY_STATEMENT),
        `suppressed itself for: ${reply}`,
      )
    }
  })
})

describe('every surface states the same boundary', () => {
  /*
   * The claim leaked from three places at once, and fixing one at a time is how
   * it survived two deploys. These assert the copy directly.
   */
  const surfaces = () => {
    const chip = outcomeOfIndex(true, { searchable: true, chunkCounts: {} }, 'budget.xlsx')
    return {
      'the deterministic sentence': SPREADSHEET_CAPABILITY_STATEMENT,
      'the upload refusal copy': refusalFor('budget.xlsx'),
      'the attachment chip': 'reason' in chip ? chip.reason ?? '' : '',
    }
  }

  it('none of them denies reading cell text', () => {
    for (const [where, copy] of Object.entries(surfaces())) {
      assert.ok(copy.length > 0, `${where} is empty`)
      assert.equal(deniesCellText(copy), false, `${where}: ${copy}`)
    }
  })

  it('none of them carries the retired wording', () => {
    for (const [where, copy] of Object.entries(surfaces())) {
      assert.ok(
        !/text inside it is not searchable|cannot search the text inside/i.test(copy),
        `${where} still says the old thing: ${copy}`,
      )
    }
  })

  it('each names what CAN be analysed and what is missing', () => {
    for (const [where, copy] of Object.entries(surfaces())) {
      assert.match(copy, /sheets|columns|labels/i, `${where} does not say what works: ${copy}`)
      assert.match(copy, /not available yet/i, `${where} does not state the limit: ${copy}`)
    }
  })
})
