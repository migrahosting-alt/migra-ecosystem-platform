// The acceptance fixture must itself be trustworthy before it can measure anything:
// it has to fail for the RIGHT reason, and a correct multi-file fix has to make it
// pass. A fixture that passes at baseline, or that one file can satisfy, would
// certify an agent that did nothing. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createFixtureRepo, runFixtureTests, ISSUE, REQUIRED_FILES, TRAP_FILE } from './fixtures/multifileCodingFixture.js';

test('the fixture fails at baseline, and fails for the stated defect', () => {
  const root = createFixtureRepo();
  const run = runFixtureTests(root);
  assert.notEqual(run.exitCode, 0, 'baseline must fail');
  assert.ok(run.failed >= 3, `at least three assertions fail, got ${run.failed}`);
  // The failure is the cancelled-line defect, not a broken fixture.
  assert.match(run.output, /1750|excludedLineCount/, 'failures name the real defect');
});

test('the issue text describes behaviour, never an implementation', () => {
  assert.match(ISSUE, /cancelled/i);
  assert.match(ISSUE, /excluded/i);
  // It must not hand the agent the answer.
  for (const leak of ['filter(', 'REQUIRED_FILES', 'orderTotalsService', '.js']) {
    assert.ok(!ISSUE.includes(leak), `the issue must not name ${leak}`);
  }
});

test('a correct three-file fix makes the suite pass', () => {
  const root = createFixtureRepo();

  fs.writeFileSync(path.join(root, 'src/contracts/orderTotals.js'), [
    'export const ORDER_TOTAL_FIELDS = ["subtotalCents", "totalCents", "excludedLineCount"];',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'src/services/orderTotalsService.js'), [
    'export function computeOrderTotal(lines) {',
    '  const active = lines.filter((l) => l.status !== "cancelled");',
    '  const subtotalCents = active.reduce((s, l) => s + l.amountCents, 0);',
    '  return { subtotalCents, totalCents: subtotalCents, excludedLineCount: lines.length - active.length };',
    '}',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'src/routes/orderTotalsRoute.js'), [
    'import { computeOrderTotal } from "../services/orderTotalsService.js";',
    'export function orderTotalsRoute(body) {',
    '  const t = computeOrderTotal(body.lines);',
    '  return { subtotalCents: t.subtotalCents, totalCents: t.totalCents, excludedLineCount: t.excludedLineCount };',
    '}',
    '',
  ].join('\n'));

  const run = runFixtureTests(root);
  assert.equal(run.exitCode, 0, `a correct fix passes, got:\n${run.output.slice(0, 600)}`);
  assert.equal(run.failed, 0);
  assert.ok(run.passed >= 4);
});

test('no single-file edit can satisfy the suite', () => {
  // Fixing only the service still leaves the contract without `excludedLineCount`,
  // so a one-file answer cannot be a passing answer.
  const root = createFixtureRepo();
  fs.writeFileSync(path.join(root, 'src/services/orderTotalsService.js'), [
    'export function computeOrderTotal(lines) {',
    '  const active = lines.filter((l) => l.status !== "cancelled");',
    '  const subtotalCents = active.reduce((s, l) => s + l.amountCents, 0);',
    '  return { subtotalCents, totalCents: subtotalCents };',
    '}',
    '',
  ].join('\n'));
  const run = runFixtureTests(root);
  assert.notEqual(run.exitCode, 0, 'a service-only edit must still fail');
  assert.match(run.output, /excludedLineCount/);
});

test('the trap file is genuinely irrelevant to the defect', () => {
  const root = createFixtureRepo();
  const trap = fs.readFileSync(path.join(root, TRAP_FILE), 'utf8');
  // It shares the prefix and mentions cancellation, so name-similarity selection
  // will reach for it…
  assert.ok(TRAP_FILE.includes('orderTotals'));
  assert.match(trap, /cancelled/);
  // …but it performs no arithmetic on line items, so editing it cannot fix anything.
  assert.ok(!trap.includes('reduce('), 'the trap does no summing');
  assert.ok(!trap.includes('status'), 'the trap never inspects line status');
  assert.ok(!REQUIRED_FILES.includes(TRAP_FILE as never));
});
