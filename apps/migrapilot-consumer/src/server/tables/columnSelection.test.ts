/**
 * Which column a total is computed FROM.
 *
 * 🚨 THE PRODUCTION FAILURE THIS EXISTS FOR, measured through the real UI on
 * 2026-09-04. A signed-in user attached a nine-row CSV — Region, OrderID,
 * ZipCode, Revenue — and asked "What is the total Revenue in this file?". The
 * layer computed the sum of the ZIPCODE column, 570,236, and handed it to the
 * model as "exact arithmetic … Use them verbatim and do not recalculate them".
 * The model, holding evidence that answered a different question, footed the
 * table itself and replied "$367,500". The true total is 474,000.
 *
 * Two rules had met. A column counts as quantitative only at ≥90% of its
 * non-blank cells, and ONE `n/a` put Revenue at 7/8 = 87.5% — disqualifying the
 * money column. Selection then fell back from "the named column" to "the only
 * quantitative column", which was ZipCode, because a plain five-digit postcode
 * is indistinguishable from a quantity by shape.
 *
 * Everything below pins one of the three fixes: a missing marker is an absence,
 * a named column is never swapped, and a column NAMED as an identifier is not a
 * measure however numeric it looks.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseCell } from './cellValue'
import { parseTable, identifies } from './parseTable'
import { tableEvidenceFor } from './tableEvidence'

/** The exact file from the failing run, byte for byte. */
const FIXTURE = [
  'Region,OrderID,ZipCode,Revenue',
  'North,004821,94105,"$120,000"',
  'South,004822,73301,"$98,500"',
  'East,004823,10018,"$156,250"',
  'West,004824,60601,"(3,750)"',
  'North,004825,94107,"$45,000"',
  'South,004826,73344,"$58,000"',
  'East,004827,10036,',
  'West,004828,60614,n/a',
  'North,004829,94110,$0',
].join('\n')

const dir = mkdtempSync(join(tmpdir(), 'migrapilot-tables-'))
writeFileSync(join(dir, 'q3.csv'), FIXTURE)
const evidence = (prompt: string) => tableEvidenceFor(prompt, ['q3.csv'], dir)

// ── a missing marker is an absence, not a word ──────────────────────────────

test('🚨 "n/a" is a BLANK, not text — it must not argue against the column being numeric', () => {
  const cell = parseCell('n/a')
  assert.equal(cell.kind, 'blank')
  assert.equal(cell.value, undefined, 'a missing value is never a zero')
  assert.equal(cell.raw, 'n/a', 'and the file\'s own text is preserved')
})

test('the other markers real exports use are treated the same way', () => {
  for (const marker of ['N/A', 'na', 'NULL', 'none', 'nil', 'NaN', '-', '--', '—', '?']) {
    assert.equal(parseCell(marker).kind, 'blank', `${marker} should mean "no value"`)
  }
})

test('but a word that merely CONTAINS one of them is still text', () => {
  // "Nairobi" starts with "na"; a loose rule here would start eating real values.
  for (const word of ['Nairobi', 'nan-tucket', 'idle', 'none-of-the-above']) {
    assert.equal(parseCell(word).kind, 'text', word)
  }
})

test('THE DISQUALIFICATION IS GONE: one missing value no longer sinks a money column', () => {
  const table = parseTable(FIXTURE)
  const revenue = table.columns.find((c) => c.name === 'Revenue')!
  assert.equal(revenue.quantitative, true, 'seven amounts and two absences is a money column')
  assert.equal(revenue.numericCells, 7)
})

// ── a name that identifies is not a name that measures ──────────────────────

test('🚨 A ZIP CODE IS NOT A QUANTITY, however numeric it looks', () => {
  const table = parseTable(FIXTURE)
  const zip = table.columns.find((c) => c.name === 'ZipCode')!
  assert.equal(zip.numericCells, 9, 'every cell parses as a number — shape cannot save us here')
  assert.equal(zip.identifierName, true)
  assert.equal(zip.quantitative, false, 'and it is still not computable')
})

test('the header is read in tokens, so `paid` and `grid` are not identifiers', () => {
  /*
   * A substring rule would match "id" inside both and silently disqualify a
   * money column — a worse failure than the one being fixed.
   */
  for (const header of ['Paid', 'Grid Size', 'Bid', 'Video Minutes', 'Rapid Spend']) {
    assert.equal(identifies(header), false, header)
  }
  for (const header of ['OrderID', 'order_id', 'Order Id', 'ZipCode', 'zip code', 'Postal Code', 'SKU', 'Phone']) {
    assert.equal(identifies(header), true, header)
  }
})

// ── the defect itself, end to end through the evidence layer ────────────────

test('🚨 THE REGRESSION: "total Revenue" computes REVENUE, and the figure is 474,000', async () => {
  const e = await evidence('What is the total Revenue in this file?')
  assert.ok(e, 'the turn must carry computed evidence')
  assert.match(e.text, /sum of "Revenue": 474,000/)
  assert.doesNotMatch(e.text, /ZipCode/, 'never a column the question did not name')
  assert.doesNotMatch(e.text, /570,236/, 'the postcode sum must not appear anywhere')
})

test('and it reports what it counted, so the figure can be checked', async () => {
  const e = await evidence('What is the total Revenue in this file?')
  assert.match(e!.text, /7 rows used, 2 blank/)
})

test('a question naming an identifier column REFUSES instead of computing it', async () => {
  const e = await evidence('What is the sum of the ZipCode column?')
  assert.ok(e)
  assert.match(e.operation, /^refused:/)
  assert.match(e.text, /identifies rows rather than measuring them/)
  assert.doesNotMatch(e.text, /570,236/, 'the number is not offered even as an aside')
})

test('the refusal forbids the model from footing the table itself', async () => {
  /*
   * Silence is not enough. Going quiet leaves the model holding a table and a
   * question about a total — which is how 473,250 and 367,500 happened.
   */
  const e = await evidence('What is the total of the OrderID column?')
  assert.match(e!.text, /Do NOT add the numbers up yourself/)
  assert.match(e!.text, /do NOT estimate/)
})

test('a question that names NOTHING may still use the only measurable column', async () => {
  const e = await evidence('What is the total?')
  assert.match(e!.text, /sum of "Revenue": 474,000/)
})

test('no evidence at all when the question is not quantitative', async () => {
  assert.equal(await evidence('What is this file about?'), null)
})

// ── the substitution can never come back ────────────────────────────────────

test('🚨 A NAMED COLUMN IS NEVER ANSWERED WITH A DIFFERENT ONE', async () => {
  /*
   * The guard against the exact shape of the defect: whatever the reason a named
   * column cannot be computed, the answer is a refusal naming THAT column — never
   * a figure from another one.
   */
  for (const [prompt, named] of [
    ['What is the sum of the ZipCode column?', 'ZipCode'],
    ['What is the total of the OrderID column?', 'OrderID'],
  ] as const) {
    const e = await evidence(prompt)
    assert.ok(e, prompt)
    assert.match(e.operation, /^refused:/, prompt)
    assert.match(e.text, new RegExp(`"${named}"`), 'the refusal names the column that was asked about')
    assert.doesNotMatch(e.text, /Revenue/, 'and never substitutes the one that happens to be computable')
  }
})
