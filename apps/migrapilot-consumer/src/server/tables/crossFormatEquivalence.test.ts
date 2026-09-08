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

/* ------------------------------------------------------------------ *
 * 🚨 ENUMERATION — the operation that did not exist
 *
 * MEASURED in production. "List the four Revenue values from the spreadsheet,
 * exactly as they appear." matched no operation, produced no evidence, and was
 * refused with "general document-style text search inside spreadsheets is not
 * available yet … Ask about a total, a column or a sheet instead." The user had
 * asked about a column; the refusal advised asking about a column.
 *
 * Enumeration is a STRUCTURED operation over a known column. These prove it is
 * one, and that it stays identical across the three representations.
 * ------------------------------------------------------------------ */

describe('listing a column enumerates it, and does so identically in every format', () => {
  it('the exact production question is answered, not refused', async () => {
    const answers = await askAll('eq_revenue', 'List the Revenue values from the spreadsheet, exactly as they appear.')
    assertEquivalent(answers, 'enumeration of Revenue')

    for (const answer of answers) {
      assert.equal(answer.operation, 'list', `${answer.format} did not enumerate`)
      // The refusal that used to happen must not be anywhere in the evidence.
      assert.doesNotMatch(
        answer.raw,
        /document-style text search/,
        `${answer.format} still routes a column question into the document-search refusal`,
      )
      for (const value of ['120000', '95000', '156250', '-3750']) {
        assert.ok(answer.raw.includes(value), `${answer.format} omitted the value ${value}`)
      }
    }
  })

  it('an identifier column LISTS — refusing to enumerate ids would be pedantry', async () => {
    /*
     * Identifier semantics are about ARITHMETIC. Summing postcodes is
     * meaningless and stays refused; reading them back is an ordinary question
     * with an exact answer. Collapsing the two would remove a real capability
     * in the name of a rule that was never about it.
     */
    const answers = await askAll('eq_identifiers', 'List the ZipCode values.')
    assertEquivalent(answers, 'enumeration of an identifier column')
    for (const answer of answers) {
      assert.equal(answer.operation, 'list')
      assert.doesNotMatch(answer.raw, /could not calculate/i, `${answer.format} refused to enumerate identifiers`)
    }
  })

  it('leading zeros survive — "exactly as they appear" is the whole request', async () => {
    /*
     * The sharpest cross-format hazard in the suite. `02108` is a ZIP code; a
     * workbook that stored it as a number would hand back 2108, and the answer
     * would be confidently, invisibly wrong in exactly one of the three formats.
     */
    const answers = await askAll('eq_revenue', 'List the ZipCode values exactly as they appear.')
    for (const answer of answers) {
      assert.ok(
        answer.raw.includes('02108'),
        `${answer.format} lost the leading zero on 02108 — it reported: ${answer.raw.slice(0, 400)}`,
      )
    }
    assertEquivalent(answers, 'enumeration preserving leading zeros')
  })

  it('a 5,000-row column is bounded, and says so rather than implying completeness', async () => {
    const answers = await askAll('eq_large', 'List the Value column.')
    for (const answer of answers) {
      assert.equal(answer.operation, 'list')
      assert.match(answer.raw, /5000/, `${answer.format} did not state the true row count`)
      /*
       * The FACT line specifically, not "somewhere in the evidence".
       *
       * A first version matched /not listed|first 50/ against the whole text
       * and passed with the disclosure deleted, because the DIRECTIVE also
       * contains "first 50". Removing the fact left the model told to say
       * something the evidence no longer supported, and the test approved it.
       */
      assert.match(
        answer.raw,
        /further row\(s\) not listed/,
        `${answer.format} truncated silently — the first 50 would read as all of them`,
      )
      assert.ok(
        answer.raw.includes('4950 further row(s) not listed'),
        `${answer.format} did not state how many rows it withheld`,
      )
    }
    assertEquivalent(answers, 'bounded enumeration')
  })

  it('naming no column asks which one, rather than picking', async () => {
    // Same rule the computation path obeys. A guess here is a wrong answer
    // delivered with the authority of "read directly from the file".
    const answers = await askAll('eq_revenue', 'List the values.')
    for (const answer of answers) {
      assert.equal(answer.operation, 'clarify:list')
      assert.match(answer.raw, /could mean more than one/)
    }
    assertEquivalent(answers, 'ambiguous enumeration')
  })

  it('an explicit aggregation still wins over the listing phrasing', async () => {
    // "List the total Revenue" wants a total. Enumeration is checked last for
    // exactly this reason, and that ordering needs a test or it will be moved.
    const answers = await askAll('eq_revenue', 'List the total Revenue.')
    for (const answer of answers) {
      assert.equal(answer.operation, 'sum', `${answer.format} enumerated instead of totalling`)
    }
  })

  it('the STORED text is listed, never the parsed number', async () => {
    /*
     * 🚨 THIS TEST EXISTS BECAUSE A MUTATION ESCAPED.
     *
     * Swapping `cell.raw` for `cell.value` survived the whole suite. The
     * leading-zero test that was supposed to catch it could not: ZipCode parses
     * as an IDENTIFIER, so `value` is undefined and the mutant fell back to
     * `raw` and produced identical output. The test was vacuous and looked
     * like coverage.
     *
     * Currency is the case where the two genuinely differ. "$1,250.50" parses
     * to 1250.5, and a user who asked for the values "exactly as they appear"
     * is entitled to the symbol, the separator and the parentheses that mean
     * negative. Those are provenance, not formatting noise.
     */
    const answers = await askAll('eq_currency', 'List the Amount values exactly as they appear.')
    for (const answer of answers) {
      assert.equal(answer.operation, 'list')
      for (const literal of ['$1,250.50', '(3,750)', '-$125.25']) {
        assert.ok(
          answer.raw.includes(literal),
          `${answer.format} reformatted ${literal} instead of reproducing it — it reported:\n${answer.raw.slice(0, 500)}`,
        )
      }
      // 1250.5 is what the parsed value would print as. Its presence means the
      // number was substituted for the text the file actually holds.
      assert.ok(
        !answer.raw.includes('1250.5'),
        `${answer.format} listed the parsed number rather than the stored text`,
      )
      /*
       * MISSING VALUES KEEP THEIR MEANING, and keep their POSITION.
       *
       * Added after a mutation escaped: rendering a blank as '' left "4. " on
       * the line and every assertion still passed. An empty slot in a numbered
       * list is unreadable, and worse, a blank dropped entirely would shift
       * every row after it — so the nth value listed would no longer be the nth
       * row of the file, silently.
       *
       * A blank and an "n/a" are also different facts: one is an empty cell,
       * the other is something the author wrote. Neither is a zero.
       */
      assert.ok(
        answer.raw.includes('(blank)'),
        `${answer.format} did not name the empty cell — an unlabelled gap shifts every row after it`,
      )
      assert.ok(
        answer.raw.includes('n/a'),
        `${answer.format} dropped the literal "n/a", which the file's author actually wrote`,
      )
      // Five rows in, five rows out. Positions are the contract.
      assert.match(answer.raw, /5\. /, `${answer.format} did not list all five rows`)
    }
    assertEquivalent(answers, 'enumeration reproduces stored text')
  })

  it('genuine free-form text search is STILL not offered', async () => {
    /*
     * The refusal was wrong for column enumeration; it is right for this. A
     * question that asks the file to be searched as prose has no structured
     * operation behind it, so no evidence is produced and the turn falls
     * through to the honest "not available yet" — which is what that sentence
     * was always for.
     *
     * Widening enumeration until it swallowed this would replace a false
     * refusal with a false capability, which is the worse trade.
     */
    for (const format of FORMATS) {
      const { root, file } = await stage('eq_revenue', format)
      for (const prompt of [
        'Find every mention of the word urgent in this spreadsheet.',
        'Search the file for notes about shipping delays.',
        'Which cells talk about customer complaints?',
      ]) {
        const evidence = await tableEvidenceFor(prompt, [file], root)
        assert.equal(
          evidence,
          null,
          `${format}: "${prompt}" produced structured evidence — enumeration has widened into document search`,
        )
      }
    }
  })

  it('a formula-derived column discloses cached values when listed', async () => {
    const answers = await askAll('eq_formula', 'List the Amount values.')
    const byFormat = new Map(answers.map((a) => [a.format, a]))
    assert.equal(byFormat.get('xlsx')!.formulaDerived, true, 'the workbook must disclose cached results')
    assert.equal(byFormat.get('csv')!.formulaDerived, false, 'a CSV holds literals — nothing to disclose')
    assertEquivalent(answers, 'enumeration of a formula column')
  })
})
