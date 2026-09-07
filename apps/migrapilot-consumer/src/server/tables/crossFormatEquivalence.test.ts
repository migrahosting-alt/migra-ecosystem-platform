/**
 * CROSS-FORMAT EQUIVALENCE — the regression that decides whether the
 * quantitative substrate is actually shared.
 *
 * ---------------------------------------------------------------------------
 * WHY TWO GREEN MATRICES WERE NOT ENOUGH
 *
 * `analysisMatrix.test.ts` proves the delimited path works. `xlsxMatrix.test.ts`
 * proves the workbook path works. Both pass. Neither can prove the two AGREE,
 * because neither ever compares them — and if three representations of one table
 * produce three subtly different answers, the substrate is fragmented and both
 * matrices stay green while it is.
 *
 * So every fixture here is ONE logical table emitted as CSV, TSV and XLSX by
 * `build_equivalence.py`. The same question is asked of each file, and what must
 * match is the REASONING, not the bytes:
 *
 *   · the column selected
 *   · its classification
 *   · the operation performed
 *   · the numeric result
 *   · the refusal category, where one applies
 *   · the semantics of the evidence
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ALLOWED TO DIFFER, AND WHY THAT LIST IS SHORT
 *
 * The file name, and the sheet attribution a workbook carries. And exactly one
 * substantive thing: whether the figures came from CACHED FORMULA RESULTS. That
 * is not a divergence in reasoning — it is a difference in what is TRUE about
 * the two files. A CSV export of a formula column holds literals and there is
 * nothing to disclose; the workbook holds values a spreadsheet computed and
 * saved, and saying so is the honest thing. The NUMBER may not differ.
 *
 * Anything else that differs is a defect IN THE SHARED LAYER, and belongs fixed
 * there — never in whichever adapter makes the test go green fastest.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cp, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { tableEvidenceFor } from './tableEvidence'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')
const FORMATS = ['csv', 'tsv', 'xlsx'] as const
type Format = (typeof FORMATS)[number]

/** Stage one fixture under an upload root, as an attachment would arrive. */
async function stage(base: string, format: Format): Promise<{ root: string; file: string }> {
  const root = await mkdtemp(join(tmpdir(), 'eq-'))
  const file = `${base}.${format}`
  await cp(join(FIXTURES, file), join(root, file))
  return { root, file }
}

interface Answer {
  format: Format
  /** The evidence prompt text, with file/sheet identity removed. */
  reasoning: string
  operation: string
  formulaDerived: boolean
  raw: string
}

/**
 * Ask one question of one format, and reduce the answer to its REASONING.
 *
 * File names and sheet attribution are stripped, because they are the two
 * things that legitimately differ. Everything left must match across formats or
 * the substrate is not shared.
 */
async function ask(base: string, format: Format, prompt: string): Promise<Answer> {
  const { root, file } = await stage(base, format)
  const evidence = await tableEvidenceFor(prompt, [file], root)
  assert.ok(evidence, `${file}: produced no evidence for ${JSON.stringify(prompt)}`)
  const reasoning = evidence.text
    .replaceAll(file, '<FILE>')
    // Sheet attribution is provenance a workbook has and a CSV cannot: strip it
    // in every form it takes, rather than letting it read as a divergence.
    .replace(/ \(sheet "[^"]*"\)/g, '')
    .replace(/ in sheet "[^"]*"/g, '')
    .replace(/sheet "[^"]*"/g, '<SHEET>')
    /*
     * The formula provenance line is the ONE legitimate difference in content,
     * and it is asserted separately below rather than ignored.
     */
    .split('\n')
    .filter((line) => !/formula|computed and saved|cached/i.test(line))
    .join('\n')
    .trim()
  return {
    format,
    reasoning,
    operation: evidence.operation,
    formulaDerived: evidence.formulaDerived === true,
    raw: evidence.text,
  }
}

/** Ask all three, and report what differs rather than just that something did. */
async function askAll(base: string, prompt: string): Promise<Answer[]> {
  return Promise.all(FORMATS.map((format) => ask(base, format, prompt)))
}

function assertEquivalent(answers: Answer[], what: string): void {
  const [first, ...rest] = answers
  for (const other of rest) {
    assert.equal(
      other.operation,
      first!.operation,
      `${what}: ${first!.format} performed ${first!.operation}, ${other.format} performed ${other.operation}`,
    )
    if (other.reasoning !== first!.reasoning) {
      assert.fail(
        `${what}: ${first!.format} and ${other.format} reasoned differently about the same table.\n` +
          `--- ${first!.format} ---\n${first!.reasoning}\n` +
          `--- ${other.format} ---\n${other.reasoning}\n` +
          'Fix this in the shared substrate, not in whichever adapter is quickest to make green.',
      )
    }
  }
}

describe('the same table, in three formats, reasons identically', () => {
  it('sum — and the Revenue regression still totals 474,000', async () => {
    const answers = await askAll('eq_revenue', 'What is the total Revenue in this file?')
    assertEquivalent(answers, 'sum of Revenue')
    for (const answer of answers) {
      assert.match(answer.reasoning, /474,000|474000/, `${answer.format} lost the closed regression`)
      // The ZIP column is right there and must never be what got totalled.
      assert.doesNotMatch(answer.reasoning, /ZipCode.*570,236|570236/, `${answer.format} summed ZIP codes`)
    }
  })

  it('average — over the values present, not the row count', async () => {
    const answers = await askAll('eq_revenue', 'What is the average Revenue?')
    assertEquivalent(answers, 'average of Revenue')
  })

  it('minimum and maximum', async () => {
    assertEquivalent(await askAll('eq_revenue', 'What is the minimum Revenue?'), 'min of Revenue')
    assertEquivalent(await askAll('eq_revenue', 'What is the maximum Revenue?'), 'max of Revenue')
  })

  it('count — rows, needing no value column at all', async () => {
    assertEquivalent(await askAll('eq_revenue', 'How many rows are in this file?'), 'count')
  })

  it('missing values are excluded, never read as zero', async () => {
    const answers = await askAll('eq_revenue', 'What is the average Revenue?')
    for (const answer of answers) {
      assert.doesNotMatch(answer.reasoning, /\b9 rows used\b/, `${answer.format} counted blanks as values`)
    }
  })

  it('percentages survive as percentages', async () => {
    const answers = await askAll('eq_percent', 'What is the average Margin?')
    assertEquivalent(answers, 'average of Margin')
    for (const answer of answers) {
      assert.match(answer.reasoning, /12\.75\s*%/, `${answer.format} reported a bare fraction`)
    }
  })

  it('currency, thousands separators and accounting negatives', async () => {
    const answers = await askAll('eq_currency', 'What is the total Amount?')
    assertEquivalent(answers, 'sum of Amount')
    for (const answer of answers) {
      // 1250.50 - 3750 - 125.25 + 2000 = -624.75
      assert.match(answer.reasoning, /-?624\.75/, `${answer.format} mis-parsed currency or negatives`)
    }
  })

  it('fractional numbers survive the workbook numeric path unrounded', async () => {
    /*
     * 🚨 THIS TEST EXISTS BECAUSE A MUTATION ESCAPED. Making the workbook
     * adapter round its numbers passed all fifteen other equivalence tests:
     * every numeric XLSX cell in the set happened to be an integer, and
     * currency/percentages are TEXT in a workbook so they go through the shared
     * parser rather than the numeric path. A format-local arithmetic drift was
     * invisible. It is not any more.
     */
    const answers = await askAll('eq_decimals', 'What is the total Measure?')
    assertEquivalent(answers, 'sum of Measure')
    // 1250.5 + 99.95 - 3750.25 + 0.125 = -2399.675
    for (const answer of answers) {
      assert.match(answer.reasoning, /-?2,?399\.6/, `${answer.format} rounded or mis-parsed a fraction`)
    }
  })

  it('group-by reaches the same groups and the same figures', async () => {
    assertEquivalent(await askAll('eq_groups', 'Total Revenue by Region'), 'group-by Region')
  })

  it('a large table is arithmetic, not a sample', async () => {
    const answers = await askAll('eq_large', 'What is the total Value?')
    assertEquivalent(answers, 'sum of Value')
    // sum(i*7+3) for i in 0..4999 = 7*12497500 + 15000 = 87,497,500
    for (const answer of answers) {
      assert.match(answer.reasoning, /87,497,500|87497500/, `${answer.format} did not total 5,000 rows`)
    }
  })
})

describe('the same table, in three formats, refuses identically', () => {
  it('ambiguity NAMES the candidates rather than picking one', async () => {
    const answers = await askAll('eq_ambiguous', 'What is the total?')
    assertEquivalent(answers, 'ambiguous total')
    for (const answer of answers) {
      assert.match(answer.reasoning, /Revenue/, `${answer.format} did not name Revenue`)
      assert.match(answer.reasoning, /Cost/, `${answer.format} did not name Cost`)
    }
  })

  it('identifiers are never silently summed — every family, every format', async () => {
    for (const column of ['ZipCode', 'ORDERID', 'SKU', 'Phone', 'Postcode']) {
      const answers = await askAll('eq_identifiers', `What is the total ${column}?`)
      assertEquivalent(answers, `refusal for ${column}`)
      for (const answer of answers) {
        assert.match(
          answer.operation,
          /refused/,
          `${answer.format} did not refuse ${column} — an identifier was treated as a quantity`,
        )
      }
    }
  })

  it('dates and timestamps are not quantities', async () => {
    for (const column of ['StartedOn', 'Timestamp']) {
      const answers = await askAll('eq_dates', `What is the total ${column}?`)
      assertEquivalent(answers, `refusal for ${column}`)
      for (const answer of answers) {
        assert.match(answer.operation, /refused/, `${answer.format} treated ${column} as a quantity`)
      }
    }
  })

  it('mixed text and numbers is described truthfully, not as "not enough data"', async () => {
    const answers = await askAll('eq_mixed', 'What is the total Readings?')
    assertEquivalent(answers, 'refusal for Readings')
    for (const answer of answers) {
      assert.doesNotMatch(
        answer.reasoning,
        /non-numeric or invalid data|lacks the necessary quantity/i,
        `${answer.format} misattributed the cause`,
      )
    }
  })
})

describe('what may differ between formats, and only this', () => {
  it('the NUMBER is identical though only the workbook discloses cached formulas', async () => {
    const answers = await askAll('eq_formula', 'What is the total Amount?')
    assertEquivalent(answers, 'sum of Amount over cached formula results')

    const byFormat = new Map(answers.map((a) => [a.format, a]))
    assert.equal(byFormat.get('xlsx')!.formulaDerived, true, 'the workbook must disclose cached results')
    assert.equal(
      byFormat.get('csv')!.formulaDerived,
      false,
      'a CSV holds literals — there is nothing to disclose, and claiming otherwise is a fabrication',
    )
    assert.equal(byFormat.get('tsv')!.formulaDerived, false)

    for (const answer of answers) {
      assert.match(answer.reasoning, /\b60\b/, `${answer.format} did not total 10 + 20 + 30`)
    }
  })

  it('CSV and TSV are indistinguishable — the delimiter is not reasoning', async () => {
    const [csv, tsv] = await Promise.all([
      ask('eq_revenue', 'csv', 'What is the total Revenue in this file?'),
      ask('eq_revenue', 'tsv', 'What is the total Revenue in this file?'),
    ])
    assert.equal(csv.reasoning, tsv.reasoning)
  })
})
