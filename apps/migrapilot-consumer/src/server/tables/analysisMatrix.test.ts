/**
 * THE STRUCTURED-DATA ACCEPTANCE MATRIX.
 *
 * "CSV works" is not a status. Each operation, each data shape and each way a
 * question can be ambiguous is its own acceptance case, and this file is the
 * machine-checked half of that matrix — the live half is run through the real
 * product and recorded in MIGRAPILOT_STATUS.
 *
 * THE RULE THE WHOLE MATRIX SERVES: the deterministic layer produces the number
 * and its provenance; the model explains the evidence and never improvises
 * arithmetic. Every case below is therefore asserted on the EVIDENCE — what the
 * model is handed — not on what a model happened to say about it.
 *
 * Three defects were found by building this matrix rather than by reading code:
 * `count` produced no evidence at all, percentages reached the model as bare
 * fractions (`0.1275` for a file that says 12.75%), and group rows read
 * "1 rows".
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseCell } from './cellValue'
import { identifies } from './parseTable'
import { tableEvidenceFor } from './tableEvidence'

const dir = mkdtempSync(join(tmpdir(), 'migrapilot-matrix-'))

/** Mixed on purpose: ints, currency, percentages, a negative in accounting
 *  notation, a blank, a missing marker, and two identifier columns. */
writeFileSync(join(dir, 'sales.csv'), [
  'Region,OrderID,ZipCode,Units,UnitPrice,Margin,Revenue',
  'North,004821,94105,12,"$1,250.50",18%,"$120,000"',
  'South,004822,73301,8,"$980.00",22.5%,"$98,500"',
  'East,004823,10018,15,"$2,100.75",31%,"$156,250"',
  'West,004824,60601,3,"$410.00",-5%,"(3,750)"',
  'North,004825,94107,7,"$640.25",12%,"$45,000"',
  'South,004826,73344,9,"$755.10",15.5%,"$58,000"',
  'East,004827,10036,,"$300.00",8%,',
  'West,004828,60614,4,"$150.00",n/a,n/a',
  'North,004829,94110,0,$0.00,0%,$0',
].join('\n'))

/** Two equally plausible measures: "the total" is genuinely ambiguous. */
writeFileSync(join(dir, 'ambiguous.csv'), [
  'Product,Revenue,Cost',
  'Alpha,"$10,000","$4,000"',
  'Beta,"$20,000","$7,500"',
  'Gamma,"$30,000","$12,000"',
].join('\n'))

/** Tab-separated, same content as the CSV whose total is known. */
writeFileSync(join(dir, 'regional.tsv'), [
  'Region\tOrderID\tRevenue',
  'North\t004821\t$120,000',
  'South\t004822\t$98,500',
  'East\t004823\t$156,250',
  'West\t004824\t(3,750)',
  'North\t004825\t$45,000',
  'South\t004826\t$58,000',
  'North\t004829\t$0',
].join('\n'))

const ask = (question: string, file = 'sales.csv') => tableEvidenceFor(question, [file], dir)
const evidenceOf = async (question: string, file?: string): Promise<string> => {
  const e = await ask(question, file)
  assert.ok(e, `expected computed evidence for: ${question}`)
  return e.text
}

// ── the operations ─────────────────────────────────────────────────────────

test('SUM — currency, thousands separators and an accounting negative', async () => {
  // 120,000 + 98,500 + 156,250 - 3,750 + 45,000 + 58,000 + 0
  assert.match(await evidenceOf('What is the total Revenue?'), /sum of "Revenue": 474,000/)
})

test('AVERAGE — divided by the rows that HAD a value, not by every row', async () => {
  // 474,000 / 7, not / 9. Counting the blanks would drag it toward zero.
  assert.match(await evidenceOf('What is the average Revenue?'), /average of "Revenue": 67,714\.285714/)
})

test('MINIMUM — finds the negative, and says which row it came from', async () => {
  const text = await evidenceOf('What is the lowest Revenue?')
  assert.match(text, /min of "Revenue": -3,750 \(West\)/)
})

test('MAXIMUM — with its label', async () => {
  assert.match(await evidenceOf('What is the highest Revenue?'), /max of "Revenue": 156,250 \(East\)/)
})

test('🚨 COUNT — needs no value column, and used to produce nothing at all', async () => {
  /*
   * It resolved to `count`, fell through column selection because several
   * columns were quantitative and none was named, and emitted NO evidence — so
   * the one operation impossible to get wrong was answered from raw text.
   */
  assert.match(await evidenceOf('How many rows are in this file?'), /count of rows: 9/)
})

test('COUNT of a named column counts what is filled in, and says out of how many', async () => {
  assert.match(await evidenceOf('How many Units values are there?'), /count of values in "Units": 8 \(of 9 rows\)/)
})

test('and an IDENTIFIER column may be counted — counting is not arithmetic on values', async () => {
  // "How many order ids are there" is a real question; refusing it is pedantry.
  assert.match(await evidenceOf('How many OrderID entries are there?'), /count of values in "OrderID": 9/)
})

test('GROUP-BY — every group totalled, with its row count', async () => {
  const text = await evidenceOf('What is the total Revenue by Region?')
  assert.match(text, /North: 165,000 \(3 rows\)/)
  assert.match(text, /South: 156,500 \(2 rows\)/)
  assert.match(text, /East: 156,250 \(1 row\)/)
  assert.match(text, /West: -3,750 \(1 row\)/)
})

test('and a single-row group reads "1 row" — this text reaches the model verbatim', async () => {
  assert.doesNotMatch(await evidenceOf('What is the total Revenue by Region?'), /\(1 rows\)/)
})

// ── data shapes ────────────────────────────────────────────────────────────

test('🚨 PERCENTAGES come back in the units the FILE used', async () => {
  /*
   * Stored as a fraction so that averaging is correct, and the fraction was
   * reaching the model bare: `0.1275` as the answer about a file that says
   * 12.75%. Computation and presentation want different forms.
   */
  const text = await evidenceOf('What is the average Margin?')
  assert.match(text, /average of "Margin": 12\.75%/)
  assert.doesNotMatch(text, /0\.1275/)
})

test('INTEGERS — a plain count column totals exactly', async () => {
  assert.match(await evidenceOf('What is the total Units?'), /sum of "Units": 58/)
})

test('MISSING VALUES are reported as absent, never as zero', async () => {
  const text = await evidenceOf('What is the total Revenue?')
  assert.match(text, /7 rows used, 2 blank/, 'the blank and the "n/a" both count as absent')
})

test('TSV is the same product as CSV', async () => {
  assert.match(await evidenceOf('What is the total Revenue?', 'regional.tsv'), /sum of "Revenue": 474,000/)
})

// ── ambiguity, which must never be resolved by guessing ────────────────────

test('🚨 TWO CANDIDATE MEASURES AND NO NAME — never picks one', async () => {
  /*
   * This case used to assert `null`, and `null` was not good enough: the layer
   * declined correctly and the MODEL then did the arithmetic instead. Declining
   * to compute is still the rule — what changed is that it now says so, which is
   * asserted below in "AMBIGUITY IS ASKED ABOUT".
   */
  const e = await ask('What is the total?', 'ambiguous.csv')
  assert.notEqual(e?.operation, 'sum', 'guessing which number the user meant is how this module got its worst bug')
  assert.doesNotMatch(e?.text ?? '', /60,000/, 'and no figure is offered for a question it did not resolve')
})

test('but naming one of them resolves it', async () => {
  assert.match(await evidenceOf('What is the total Revenue?', 'ambiguous.csv'), /sum of "Revenue": 60,000/)
})

test('A QUESTION ASKING TWO THINGS refuses, and says why', async () => {
  const e = await ask('What is the total Revenue and the total Cost?', 'ambiguous.csv')
  assert.match(e!.operation, /^refused:/)
  assert.match(e!.text, /names more than one column/)
})

test('a non-quantitative question produces no evidence and no interference', async () => {
  assert.equal(await ask('What is this file about?'), null)
})

// ── the property the whole matrix exists to protect ────────────────────────

test('🚨 EVERY COMPUTED FIGURE CARRIES ITS PROVENANCE', async () => {
  /*
   * A total with no account of what went into it is indistinguishable from a
   * guess, which is the thing being replaced.
   */
  for (const question of [
    'What is the total Revenue?',
    'What is the average Revenue?',
    'What is the lowest Revenue?',
    'What is the total Units?',
  ]) {
    assert.match(await evidenceOf(question), /\(\d+ rows? used/, question)
  }
})

test('and every computed figure is announced as exact, not as an estimate', async () => {
  const text = await evidenceOf('What is the total Revenue?')
  assert.match(text, /exact\s+arithmetic over the parsed file, not estimates/)
  assert.match(text, /do not\s+recalculate them/)
})

// ── ambiguity asks; it does not go quiet ───────────────────────────────────

test('🚨 AMBIGUITY IS ASKED ABOUT — silence let the model foot the table itself', async () => {
  /*
   * MEASURED live: "What is the total?" over Revenue AND Cost produced no
   * evidence, correctly — and the model then answered "$10,000 + $20,000 +
   * $30,000 = $60,000" on its own. Right, on three rows. On the five-thousand-row
   * file it is the original defect, and nothing was stopping it.
   */
  const e = await ask('What is the total?', 'ambiguous.csv')
  assert.ok(e, 'a quantitative question over a table must never leave the model unattended')
  assert.match(e.operation, /^clarify:/)
  assert.match(e.text, /"Revenue", "Cost"/, 'the candidates are named, so the question can be asked back')
  assert.match(e.text, /Do NOT add the numbers up yourself/)
  assert.match(e.text, /do NOT pick a column on the user's behalf/)
})

test('and it names every candidate, not just the first two', async () => {
  const e = await ask('What is the average?')
  assert.match(e!.text, /"Units", "UnitPrice", "Margin", "Revenue"/)
})

test('naming the column still resolves it without a clarification', async () => {
  const e = await ask('What is the total Revenue?', 'ambiguous.csv')
  assert.equal(e!.operation, 'sum')
})

// ── the leading-zero rule, which was eating money ──────────────────────────

test('🚨 AN AMOUNT UNDER ONE IS MONEY, NOT A CODE', async () => {
  /*
   * MEASURED on a real price column. The identifier test stripped `.` and `,`
   * before checking for a leading zero, so `0.00` became `000` and matched: every
   * amount under a pound, and zero itself, was read as a code. Eight of nine
   * UnitPrice cells parsed and the ninth ($0.00) did not, which put the column at
   * 88.9% — under the bar — and disqualified it silently.
   */
  for (const [raw, kind] of [['$0.00', 'currency'], ['0.50', 'number'], ['$0.75', 'currency'], ['0.99', 'number'], ['0', 'number']] as const) {
    assert.equal(parseCell(raw).kind, kind, raw)
  }
})

test('while a leading-zero INTEGER is still a code', () => {
  for (const raw of ['007', '00123', '01730']) {
    assert.equal(parseCell(raw).kind, 'identifier', raw)
  }
})

test('so a price column with a zero in it is computable again', async () => {
  const e = await ask('What is the total UnitPrice?')
  assert.match(e!.text, /sum of "UnitPrice": 6,586\.6/)
})

// ── THE REAL-SYSTEM FAILURE, 2026-09-04 ────────────────────────────────────

test('🚨 REGRESSION: a named identifier column is never summed — the reported case', async () => {
  /*
   * REPORTED BY THE OWNER against the real product: "What is the total ZipCode
   * in this file?" returned "The total ZipCode in this file is 132,737 …
   * derived by summing the ZipCode column … exact arithmetic."
   *
   * The cause was NOT model behaviour and NOT this rule: production was running
   * a build from 2026-08-31 that predates the identifier rule entirely. The
   * deployed logic was reproduced outside the UI and returns exactly
   * `sum of "ZipCode": 132,737`. This case pins the fixed behaviour so the
   * deployed and the tested paths can never diverge on it again.
   */
  const dir2 = mkdtempSync(join(tmpdir(), 'migrapilot-reported-'))
  writeFileSync(join(dir2, 'reported.csv'), [
    'region,ZipCode,revenue',
    'North,10018,120500',
    'South,60601,98500',
    'East,33101,143250',
    'West,29017,111750',
  ].join('\n'))
  for (const q of [
    'What is the total ZipCode in this file?',
    'Add up all the ZipCode values and give me the number.',
    'What is the total OrderID in this file?',
  ]) {
    const e = await tableEvidenceFor(q, ['reported.csv'], dir2)
    assert.doesNotMatch(e?.text ?? '', /132,737/, `the identifier total must never appear: ${q}`)
    assert.doesNotMatch(e?.text ?? '', /\bsum of "ZipCode"/, q)
  }
  // And the measure in the same file is untouched.
  const revenue = await tableEvidenceFor('What is the total revenue in this file?', ['reported.csv'], dir2)
  assert.match(revenue!.text, /sum of "revenue": 474,000/, 'the Revenue behaviour must survive the fix')
})

test('🚨 HEADER SPELLINGS: the rule was written for one fixture and missed two ordinary ones', () => {
  /*
   * `PostCode` split to "post" + "code" and `ORDERID` stayed a single token, so
   * both were treated as measures — found by probing the rule against real
   * spellings rather than against the file it was written for.
   */
  for (const header of [
    'ZipCode', 'zipcode', 'ZIP', 'Zip Code', 'zip_code', 'ZIPCODE',
    'PostCode', 'postcode', 'Postal Code', 'AreaCode', 'ProductCode',
    'OrderID', 'order_id', 'Order Id', 'orderId', 'ORDERID', 'CUSTOMERID',
    'SKU', 'Phone', 'phone_number', 'Fax', 'UUID', 'ISBN', 'Barcode', 'Serial',
  ]) {
    assert.equal(identifies(header), true, `${header} identifies rows`)
  }
})

test('and the words it must NOT eat, which is where a substring rule would fail', () => {
  for (const header of [
    'Revenue', 'Paid', 'PAID', 'Grid Size', 'Bid', 'Rapid Spend', 'Amount', 'Cost',
    'Units', 'UnitPrice', 'Margin', 'Total', 'Price', 'Salary', 'Quantity',
    'Valid Rows', 'Solid Units', 'Video Minutes',
  ]) {
    assert.equal(identifies(header), false, `${header} measures something`)
  }
})

// ── row lookup: the most ordinary spreadsheet question there is ────────────

/*
 * 🚨 THE DEFECT THIS CLOSES. "What revenue is listed for East?" named no
 * aggregation, so `detectOperation` returned null, no evidence was produced,
 * and the model answered "$54,212" about a cell reading 25443.75 — a financial
 * figure invented out of nothing. A truthful refusal replaced the fabrication,
 * which was correct and still a "no" to a question any spreadsheet tool
 * answers. This makes it a yes.
 *
 * ONE ROW PER LABEL, which `sales.csv` deliberately is NOT — it is transactional
 * and carries four orders per region, so a lookup by region there is genuinely
 * ambiguous and is asserted as such below.
 */
writeFileSync(join(dir, 'inventory.csv'), [
  'Item,SKU,OnHand,UnitCost,Value',
  'Widget,SKU-100,120,"$4.50","$540.00"',
  'Gasket,SKU-101,48,"$12.25","$588.00"',
  'Flange,SKU-102,7,"$88.00","$616.00"',
  'Total,,175,,"$1,744.00"',
].join('\n'))

const lookup = (q: string, file = 'inventory.csv') => tableEvidenceFor(q, [file], dir)

test('🚨 a row lookup answers from the row, not from the model', async () => {
  const ev = await lookup('What value is listed for Gasket?')
  assert.equal(ev?.operation, 'lookup')
  assert.match(ev!.text, /row "Gasket"/)
  // Every cell of that row, exactly as the file stores it.
  assert.match(ev!.text, /Value: \$588\.00/)
  assert.match(ev!.text, /OnHand: 48/)
  // and nothing from a neighbouring row
  assert.doesNotMatch(ev!.text, /616\.00/)
})

test('the phrasing may vary because the FILE identifies the row', async () => {
  for (const q of ['What is the unit cost for Flange?', 'Flange on hand?', 'how much does Widget cost']) {
    const ev = await lookup(q)
    assert.equal(ev?.operation, 'lookup', q)
  }
})

test('naming one row beats a bare row count', async () => {
  // "how many" alone counts rows; naming a row contradicts that.
  const named = await lookup('How many on hand for Flange?')
  assert.equal(named?.operation, 'lookup')
  assert.match(named!.text, /row "Flange"/)

  assert.equal((await lookup('How many rows are there?'))?.operation, 'count')
})

test('a totals row is never a lookup target', async () => {
  /*
   * It is a summary, not an observation — the same rule the arithmetic follows.
   * Naming it does not have to produce NOTHING (saying "total" reasonably reads
   * as an aggregate, and that is what comes back); what it must never produce is
   * the totals ROW served up as if it were a data row.
   */
  for (const q of ['What value is listed for Total?', 'What is on hand for Total?']) {
    const ev = await lookup(q)
    assert.notEqual(ev?.operation, 'lookup', q)
    if (ev) assert.doesNotMatch(ev.text, /row "Total"/, q)
  }
})

test('an explicit aggregate is never demoted to a lookup', async () => {
  assert.equal((await lookup('What is the total Value?'))?.operation, 'sum')
  assert.equal((await lookup('Which item has the highest Value?'))?.operation, 'max')
})

test('a question that names no row produces NOTHING, not a note about the file', async () => {
  /*
   * The lookup gate is weak on purpose — any "what…" question trips it — so a
   * turn that was never about the spreadsheet must come back empty rather than
   * with "MigraPilot could not calculate this from inventory.csv" attached.
   */
  assert.equal(await lookup('What is the capital of France?'), null)
})

test('a label on more than one row is ambiguity, and is reported', async () => {
  // sales.csv is transactional: four orders per region, so "for East" names two rows.
  const ev = await lookup('What revenue is listed for East?', 'sales.csv')
  assert.equal(ev?.operation, 'clarify:lookup')
  assert.match(ev!.text, /more than one/)
  assert.match(ev!.text, /do NOT pick a row/i)
})
