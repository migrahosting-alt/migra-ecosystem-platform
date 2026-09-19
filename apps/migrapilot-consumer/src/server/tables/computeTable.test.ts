import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseCell } from './cellValue'
import { parseTable } from './parseTable'
import { computeColumn, groupBy, ComputationRefused } from './computeTable'

/**
 * Deterministic arithmetic over structured data.
 *
 * 🚨 THE PRODUCTION FAILURE. CSV and TSV were parsed and cited correctly and the
 * arithmetic was still wrong: totals of 473,250 and 473,000 for a column that
 * sums to 474,000, reproducible in brand-new chats with only the file attached.
 * A language model was footing a table out of retrieved text. It reads tables
 * well and adds them unreliably, and a confidently wrong total is worse than an
 * honest refusal.
 */

const FIXTURE_CSV = [
  'region,revenue',
  'North,120500',
  'South,98500',
  'East,143250',
  'West,111750',
].join('\n')

const FIXTURE_TSV = FIXTURE_CSV.replace(/,/g, '\t')

const cols = (t: ReturnType<typeof parseTable>, name: string) =>
  t.columns.find((c) => c.name === name)!

// ── the mandatory fixture ──────────────────────────────────────────────────

for (const [label, text] of [['CSV', FIXTURE_CSV], ['TSV', FIXTURE_TSV]] as const) {
  test(`🚨 ${label}: East · 143,250 · 474,000`, () => {
    const table = parseTable(text)
    assert.equal(table.delimiter, label === 'TSV' ? '\t' : ',')

    const revenue = cols(table, 'revenue')
    const region = cols(table, 'region')

    const total = computeColumn(table, revenue, 'sum')
    assert.equal(total.value, 474000, 'the exact total the model kept getting wrong')
    assert.equal(total.provenance.rowsUsed, 4)

    const max = computeColumn(table, revenue, 'max', { labelColumn: region })
    assert.equal(max.value, 143250)
    assert.deepEqual(max.labels, ['East'])
    assert.notEqual(max.tied, true)
  })
}

test('the region column is NOT treated as quantitative', () => {
  const table = parseTable(FIXTURE_CSV)
  assert.equal(cols(table, 'region').quantitative, false)
  assert.equal(cols(table, 'revenue').quantitative, true)
})

// ── the nasty cases ────────────────────────────────────────────────────────

test('thousands separators, currency and decimals are exact', () => {
  const table = parseTable([
    'item,amount',
    'a,"1,234.56"',
    'b,$1234.56',
    'c,"$1,000.00"',
  ].join('\n'))
  const total = computeColumn(table, cols(table, 'amount'), 'sum')
  // 1234.56 + 1234.56 + 1000 — exact, not 3469.1199999999
  assert.equal(total.value, 3469.12)
})

test('negatives in both notations reduce the total', () => {
  const table = parseTable(['k,v', 'a,100', 'b,-40', 'c,(10)'].join('\n'))
  assert.equal(computeColumn(table, cols(table, 'v'), 'sum').value, 50)
})

test('zero counts; blank does not', () => {
  /*
   * The difference that breaks averages. Treating a blank as 0 drags the mean
   * down and looks entirely reasonable in the output.
   */
  const table = parseTable(['k,v', 'a,0', 'b,', 'c,10'].join('\n'))
  const avg = computeColumn(table, cols(table, 'v'), 'average')
  assert.equal(avg.value, 5, 'mean of 0 and 10, not of 0, 0 and 10')
  assert.equal(avg.provenance.rowsUsed, 2)
  assert.equal(avg.provenance.rowsBlank, 1)
})

test('percentages compute as fractions, not as their face value', () => {
  const table = parseTable(['k,v', 'a,50%', 'b,25%'].join('\n'))
  assert.equal(computeColumn(table, cols(table, 'v'), 'average').value, 0.375)
})

test('🚨 duplicate maxima are reported as a tie, never resolved silently', () => {
  const table = parseTable(['region,revenue', 'North,100', 'South,100', 'East,50'].join('\n'))
  const max = computeColumn(table, cols(table, 'revenue'), 'max', { labelColumn: cols(table, 'region') })
  assert.equal(max.tied, true)
  assert.deepEqual(max.labels!.sort(), ['North', 'South'])
})

test('🚨 identifiers are never arithmetic inputs', () => {
  // Leading zeros, versions and dates are numeric-SHAPED and are not quantities.
  for (const raw of ['00123', '01730', '1.2.3', '2026-08-29', '08/29/2026']) {
    assert.equal(parseCell(raw).kind, 'identifier', raw)
    assert.equal(parseCell(raw).value, undefined, raw)
  }
  const table = parseTable(['zip,people', '01730,4', '02138,6'].join('\n'))
  assert.equal(cols(table, 'zip').quantitative, false, 'a ZIP column must not be summable')
  assert.throws(() => computeColumn(table, cols(table, 'zip'), 'sum'), ComputationRefused)
})

test('🚨 a comma that cannot be thousands-grouping is refused, not guessed', () => {
  /*
   * 🚨 MY FIRST VERSION OF THIS TEST WAS WRONG, and pinning it would have made
   * the product worse. It asserted that `1,234` is ambiguous. It is not, in any
   * way worth acting on: `1,234` is valid thousands grouping, that reading is
   * overwhelmingly the common one, and the production fixture itself depends on
   * it. Refusing it would reject a large share of ordinary CSVs to guard against
   * a rarer convention.
   *
   * The genuinely undecidable case is a comma followed by something that CANNOT
   * be a thousands group — `1,23` is 1.23 under a decimal comma and nothing at
   * all under grouping. That one is refused, because a wrong reading there is
   * off by a factor of a hundred and looks entirely reasonable in a total.
   */
  assert.equal(parseCell('1,234').kind, 'number')
  assert.equal(parseCell('1,234').value, 1234)

  for (const raw of ['1,23', '12,5', '1,23456']) {
    const cell = parseCell(raw)
    assert.equal(cell.kind, 'text', raw)
    assert.match(cell.note!, /ambiguous/, raw)
  }
})

test('a mixed numeric/text column is not summable', () => {
  const table = parseTable(['k,v', 'a,10', 'b,pending', 'c,unknown', 'd,20'].join('\n'))
  assert.equal(cols(table, 'v').quantitative, false, 'half text is not a quantity column')
  assert.throws(() => computeColumn(table, cols(table, 'v'), 'sum'), ComputationRefused)
})

test('one stray non-numeric cell does not disqualify a real column', () => {
  const rows = ['k,v', ...Array.from({ length: 20 }, (_, i) => `r${i},${i * 10}`), 'bad,pending']
  const table = parseTable(rows.join('\n'))
  const v = cols(table, 'v')
  assert.equal(v.quantitative, true)
  const sum = computeColumn(table, v, 'sum')
  assert.equal(sum.provenance.rowsNonNumeric, 1, 'and the skipped row is reported, not hidden')
})

test('and a MISSING value is counted as absent rather than as non-numeric', () => {
  /*
   * This case used `n/a` as its stray "non-numeric" value, which was the
   * classification that produced the production defect: one `n/a` in nine rows
   * dropped a real currency column below the 90% bar and the turn answered about
   * a different column entirely. A missing marker is an ABSENCE — the same fact
   * as an empty cell — so it is reported as blank and no longer argues against
   * the column being numeric. See columnSelection.test.ts.
   */
  const rows = ['k,v', ...Array.from({ length: 20 }, (_, i) => `r${i},${i * 10}`), 'bad,n/a']
  const table = parseTable(rows.join('\n'))
  const v = cols(table, 'v')
  assert.equal(v.quantitative, true)
  const sum = computeColumn(table, v, 'sum')
  assert.equal(sum.provenance.rowsNonNumeric, 0, 'nothing here was unreadable')
  assert.equal(sum.provenance.rowsBlank, 1, 'it was simply not filled in')
})

test('malformed rows are recorded and travel with the result', () => {
  const table = parseTable(['a,b,c', '1,2,3', '4,5', '6,7,8'].join('\n'))
  assert.deepEqual(table.malformedRows, [3])
  const sum = computeColumn(table, cols(table, 'a'), 'sum')
  assert.deepEqual(sum.provenance.malformedRows, [3], 'a total over a damaged file must say so')
})

test('filters and aggregates combine, with the exclusion counted', () => {
  const table = parseTable([
    'name,status,amount',
    'a,active,100',
    'b,inactive,999',
    'c,active,50',
  ].join('\n'))
  const sum = computeColumn(table, cols(table, 'amount'), 'sum', {
    filter: { column: cols(table, 'status'), equals: 'active' },
  })
  assert.equal(sum.value, 150)
  assert.equal(sum.provenance.rowsFiltered, 1)
  assert.deepEqual(sum.provenance.filter, { column: 'status', equals: 'active' })
})

test('grouped totals come back ordered, with row counts', () => {
  const table = parseTable([
    'region,revenue',
    'North,100', 'South,300', 'North,50', 'South,10',
  ].join('\n'))
  assert.deepEqual(groupBy(table, cols(table, 'region'), cols(table, 'revenue')), [
    { group: 'South', value: 310, rows: 2 },
    { group: 'North', value: 150, rows: 2 },
  ])
})

test('quoted fields containing the delimiter stay one field', () => {
  const table = parseTable(['name,amount', '"Smith, John",42'].join('\n'))
  assert.equal(table.rows[0]![0]!.raw, 'Smith, John')
  assert.equal(computeColumn(table, cols(table, 'amount'), 'sum').value, 42)
})

test('a column of nothing usable refuses instead of returning zero', () => {
  /*
   * `0` would be a plausible, wrong, unfalsifiable answer. The refusal names
   * which column and why.
   */
  const table = parseTable(['k,v', 'a,', 'b,'].join('\n'))
  assert.throws(
    () => computeColumn(table, { ...cols(table, 'v'), quantitative: true }, 'sum'),
    (e: unknown) => e instanceof ComputationRefused && /No rows in "v"/.test((e as Error).message),
  )
})

test('a one-column file is refused with a reason', () => {
  assert.throws(() => parseTable('total\n5\n6'), /only one column/)
})

/*
 * 🚨 THE WIRING. A perfect calculator the turn never calls is not a fix.
 * These pin that the computed figures actually reach the model, and that the
 * user's stored message is not rewritten to carry them.
 */
test('computed evidence reaches the model, and only the model', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const route = readFileSync(join(process.cwd(), 'src/app/api/chat/stream/route.ts'), 'utf8')

  // Whitespace-tolerant: the invariant is WHICH files are computed over, not how
  // the call happens to be wrapped. Pinning the formatting failed a correct
  // refactor once already.
  assert.match(route, /tableEvidenceFor\(\s*prompt,\s*turnGrounding\.active/,
    'computed over the ACTIVE grounding, not the whole thread')
  assert.match(route, /chatTurnStream\(\s*\n?\s*modelPrompt/,
    'the model receives the prompt carrying computed evidence')
  assert.match(route, /appendMessage\(\s*\n?\s*conversationId, 'user', prompt/,
    "the transcript stores the user's own words, never the evidence-prefixed prompt")
})

test('the evidence block tells the model not to recalculate', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const src = readFileSync(join(process.cwd(), 'src/server/tables/tableEvidence.ts'), 'utf8')
  assert.match(src, /Use them verbatim and do not/)
  assert.match(src, /not estimates/)
})

test('two attached tables produce no computed evidence', async () => {
  /*
   * "The total" across two files is a different question, and picking one is how
   * a confident wrong number gets produced. Refuses by returning null.
   */
  const { tableEvidenceFor } = await import('./tableEvidence')
  assert.equal(await tableEvidenceFor('what is the total?', ['a.csv', 'b.csv'], '/tmp'), null)
})

test('a question with no recognisable operation produces no evidence', async () => {
  const { tableEvidenceFor } = await import('./tableEvidence')
  assert.equal(await tableEvidenceFor('what is this file about?', ['a.csv'], '/tmp'), null)
})

// ── a sheet that carries its own total ─────────────────────────────────────

/*
 * 🚨 THE DEFECT: THE AUTHOR'S TOTAL WAS SUMMED AS IF IT WERE DATA.
 *
 * Measured in the real product on a Q1 sheet ending in a Total row: "the total
 * revenue across the four regions" came back $151,427.50 — the four regions,
 * plus the sheet's own total added again. Produced by this deterministic layer,
 * not by the model, and disclosed nowhere. Most real business sheets end in a
 * totals row, so this was close to the default case rather than an exotic one.
 */
const WITH_TOTAL = [
  'Region,Revenue',
  'North,22200',
  'South,15910',
  'East,25443.75',
  'West,12160',
  'Total,75713.75',
].join('\n')

test('🚨 a row the author labelled Total is not summed as data', () => {
  const table = parseTable(WITH_TOTAL)
  const r = computeColumn(table, cols(table, 'Revenue'), 'sum')
  assert.equal(r.value, 75713.75, 'the four data rows, not the data plus the total')
  assert.equal(r.provenance.rowsUsed, 4)
  assert.equal(r.provenance.rowsSummary, 1, 'and the exclusion is reported, not silent')
})

test('the totals row is excluded from every operation, not just sum', () => {
  const table = parseTable(WITH_TOTAL)
  const revenue = cols(table, 'Revenue')
  // Otherwise the maximum of a column containing its own total is always the total.
  const max = computeColumn(table, revenue, 'max', { labelColumn: cols(table, 'Region') })
  assert.equal(max.value, 25443.75)
  assert.deepEqual(max.labels, ['East'])
  assert.equal(computeColumn(table, revenue, 'average').value, round4(75713.75 / 4))
  assert.equal(computeColumn(table, revenue, 'count').value, 4)
})

function round4(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

test('a label that merely CONTAINS a totals word is real data', () => {
  // "Total Systems Ltd" is a supplier, and its revenue counts.
  const table = parseTable(
    ['Supplier,Revenue', 'Total Systems Ltd,500', 'Acme,300', 'Total,800'].join('\n'),
  )
  const r = computeColumn(table, cols(table, 'Revenue'), 'sum')
  assert.equal(r.value, 800, 'the supplier stays in; only the summary row leaves')
  assert.equal(r.provenance.rowsSummary, 1)
})

test('a sheet with no totals row reports no exclusion', () => {
  const table = parseTable(['Region,Revenue', 'North,10', 'South,20'].join('\n'))
  const r = computeColumn(table, cols(table, 'Revenue'), 'sum')
  assert.equal(r.value, 30)
  assert.equal(r.provenance.rowsSummary, undefined)
})
