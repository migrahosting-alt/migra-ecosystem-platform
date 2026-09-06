/**
 * LANE C — a refusal must state its actual cause.
 *
 * 🚨 THE PRODUCTION SENTENCE THIS PINS. Asked "What is the total Booked?" over a
 * date column holding four perfectly good dates, the product replied:
 *
 *   "The 'Booked' column in the 'Sales' sheet of matrix_sales.xlsx contains 4
 *    non-empty values, but none of them can be used to calculate a total.
 *    There is not enough data to provide an accurate answer."
 *
 * Every clause traceable to our own reason string, and the conclusion false. The
 * file is not short of data. `chooseValueColumn` had exactly two refusal reasons
 * for a named column — "identifies rows" when the HEADER said so, and otherwise
 * a numeric-scarcity sentence — and a date column is neither, so it fell to
 * scarcity. The model then restated "too few to total" as "not enough data",
 * which blames the user's file for a limit that is ours.
 *
 * The property under test is therefore NOT the wording. It is that the reason
 * names the cause, and that scarcity is claimed only when scarcity is truly the
 * cause — because a reason that is true-but-generic gets restated as one that is
 * specific and wrong.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { classifyNonQuantitative, refusalReasonFor } from './tableEvidence'
import { parseTable } from './parseTable'

const table = (csv: string) => parseTable(csv)
const col = (t: ReturnType<typeof parseTable>, name: string) => {
  const c = t.columns.find((x) => x.name === name)
  assert.ok(c, `no column ${name}`)
  return c!
}

/** The production fixture's shape: a date column, an id column, text, numbers. */
const SALES = table(
  [
    'Region,Revenue,ZipCode,Booked,Notes',
    'North,100000,94105,2026-08-01,steady quarter',
    'South,156500,94107,2026-08-02,new account',
    'East,156250,94110,2026-08-03,renewal',
    'West,61250,94112,2026-08-04,churn risk',
  ].join('\n'),
)

describe('the cause is classified, not guessed', () => {
  it('a date column is dates — not scarcity', () => {
    assert.equal(classifyNonQuantitative(SALES, col(SALES, 'Booked')), 'dates-or-codes')
  })

  it('an identifier column is named from its header', () => {
    assert.equal(classifyNonQuantitative(SALES, col(SALES, 'ZipCode')), 'identifier-name')
  })

  it('a text column is text', () => {
    assert.equal(classifyNonQuantitative(SALES, col(SALES, 'Notes')), 'text')
  })
})

describe('🚨 the date refusal cannot be restated as "not enough data"', () => {
  const reason = () => refusalReasonFor(SALES, col(SALES, 'Booked'))

  it('says what the column actually holds', () => {
    assert.match(reason(), /dates or codes/i, reason())
    assert.match(reason(), /Booked/, reason())
  })

  it('never claims the file is short of values', () => {
    const r = reason()
    for (const wrong of [/too few/i, /not enough/i, /insufficient/i, /lacks/i, /\bmissing\b/i]) {
      assert.ok(!wrong.test(r), `scarcity language survived: ${r}`)
    }
  })

  it('never reports a count that invites the scarcity reading', () => {
    // "holds 0 values that can be calculated with, out of 4" is what the model
    // turned into "there is not enough data". No count, no invitation.
    assert.ok(!/\b0 value/.test(reason()), reason())
    assert.ok(!/out of \d/.test(reason()), reason())
  })
})

describe('scarcity is still said when scarcity IS the cause', () => {
  /*
   * The negative half: widening the date branch must not silence a real one.
   *
   * 🚨 THE FIXTURE HAD TO BE CORRECTED. It was one number plus three BLANKS,
   * which passes this function but is a state the product never reaches: blanks
   * are excluded from the quantitative ratio, so of the values present 100% were
   * numbers and the column is legitimately summable — the real path computes a
   * sum and never refuses. Scarcity is reachable only for a MIXED column, where
   * the values present are not overwhelmingly quantities.
   */
  const MIXED = table(
    ['Item,Score', 'a,7', 'b,pending', 'c,not taken', 'd,sensor offline'].join('\n'),
  )

  it('the mixed column is genuinely not quantitative', () => {
    // If this ever becomes quantitative, the test below stops testing anything.
    assert.equal(col(MIXED, 'Score').quantitative, false)
  })

  it('a mixed text/number column reports too few', () => {
    const c = col(MIXED, 'Score')
    assert.equal(classifyNonQuantitative(MIXED, c), 'mixed-with-text')
    assert.match(refusalReasonFor(MIXED, c), /mixes text with numbers/i)
    assert.ok(!/too few|insufficient|lacks/i.test(refusalReasonFor(MIXED, c)))
  })
})

describe('every refusal reason names its column and its cause', () => {
  it('and none of them blames the file for our limit', () => {
    for (const name of ['Booked', 'ZipCode', 'Notes']) {
      const r = refusalReasonFor(SALES, col(SALES, name))
      assert.match(r, new RegExp(name), r)
      assert.ok(r.length > 20, `too terse to be a reason: ${r}`)
      assert.ok(!/not enough|insufficient/i.test(r), `blames the file: ${r}`)
    }
  })
})
