// MigraPilot — the governed coding acceptance fixture, extension side.
//
// A byte-for-byte copy of the Brain's `multifileCodingFixture`, kept here because
// the installed-path harness cannot import from brain-service's test tree. The
// duplication is deliberate and narrow: the fixture IS the contract under test, so
// the acceptance must materialise exactly the repository the Brain suite proved
// against, not an approximation of it.
//
// Its load-bearing property: `ORDER_TOTAL_FIELDS` is runtime-enforced by the tests,
// so no single-file edit can satisfy them, and `orderTotalsFormatter.js` shares the
// service's prefix while performing no arithmetic — a trap for filename-based
// selection.

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const ISSUE = [
  'Cancelled line items are still counted in the order total.',
  '',
  'An order total must exclude every line whose status is `cancelled`, and the',
  'response must report how many lines were excluded so the UI can explain the',
  'difference to the customer.',
].join('\n');

/** Files that a correct fix MUST change. */
export const REQUIRED_FILES = [
  'src/contracts/orderTotals.js',
  'src/services/orderTotalsService.js',
  'src/routes/orderTotalsRoute.js',
] as const;

/** The near-namesake an evidence-driven agent must leave alone. */
export const TRAP_FILE = 'src/services/orderTotalsFormatter.js';

export const FIXTURE_FILES: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'orders-fixture', private: true, type: 'module' }, null, 2) + '\n',

  // ── the shared contract ─────────────────────────────────────────────────────
  // Executable, not merely declarative: the tests assert the response keys against
  // this list, so the contract must change for a fix to pass. A type annotation a
  // runtime never checks would let the fixture certify a two-file edit.
  'src/contracts/orderTotals.js': [
    '/**',
    ' * The shape returned by the order-totals route. Shared by the service, the',
    ' * route and the tests.',
    ' *',
    ' * @typedef {"active"|"cancelled"} LineStatus',
    ' * @typedef {{ sku: string, amountCents: number, status: LineStatus }} OrderLine',
    ' */',
    '',
    '/** Fields every order-total response must carry, in order. */',
    'export const ORDER_TOTAL_FIELDS = ["subtotalCents", "totalCents"];',
    '',
  ].join('\n'),

  // ── the implementation with the defect ──────────────────────────────────────
  'src/services/orderTotalsService.js': [
    '/** Sum the order. */',
    'export function computeOrderTotal(lines) {',
    '  // DEFECT: every line is counted, including cancelled ones.',
    '  const subtotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);',
    '  return { subtotalCents, totalCents: subtotalCents };',
    '}',
    '',
  ].join('\n'),

  // ── the route: projects an explicit shape, so a new field needs a change here ─
  'src/routes/orderTotalsRoute.js': [
    'import { computeOrderTotal } from "../services/orderTotalsService.js";',
    '',
    'export function orderTotalsRoute(body) {',
    '  const total = computeOrderTotal(body.lines);',
    '  // The route projects an explicit shape rather than spreading, so a new',
    '  // contract field does not reach the client until this is updated too.',
    '  return { subtotalCents: total.subtotalCents, totalCents: total.totalCents };',
    '}',
    '',
  ].join('\n'),

  // ── the trap: same prefix, adjacent directory, irrelevant to the defect ──────
  [TRAP_FILE]: [
    '// Presentation only. Formats an already-computed order total for display,',
    '// including a note about cancelled lines. It performs NO arithmetic and is',
    '// not part of the totalling defect.',
    '',
    'export function formatOrderTotal(total) {',
    '  return `$${(total.totalCents / 100).toFixed(2)}`;',
    '}',
    '',
  ].join('\n'),

  // ── failing tests ───────────────────────────────────────────────────────────
  'test/orderTotals.test.js': [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { computeOrderTotal } from "../src/services/orderTotalsService.js";',
    'import { orderTotalsRoute } from "../src/routes/orderTotalsRoute.js";',
    'import { ORDER_TOTAL_FIELDS } from "../src/contracts/orderTotals.js";',
    '',
    'const LINES = [',
    '  { sku: "a", amountCents: 1000, status: "active" },',
    '  { sku: "b", amountCents: 500, status: "cancelled" },',
    '  { sku: "c", amountCents: 250, status: "active" },',
    '];',
    '',
    'test("cancelled lines are excluded from the total", () => {',
    '  const result = computeOrderTotal(LINES);',
    '  assert.equal(result.subtotalCents, 1250);',
    '  assert.equal(result.totalCents, 1250);',
    '});',
    '',
    'test("the excluded line count is reported", () => {',
    '  assert.equal(computeOrderTotal(LINES).excludedLineCount, 1);',
    '});',
    '',
    'test("the contract declares the excluded-count field", () => {',
    '  assert.deepEqual(ORDER_TOTAL_FIELDS, ["subtotalCents", "totalCents", "excludedLineCount"]);',
    '});',
    '',
    'test("the route returns exactly the contract fields", () => {',
    '  const body = orderTotalsRoute({ lines: LINES });',
    '  assert.deepEqual(Object.keys(body).sort(), [...ORDER_TOTAL_FIELDS].sort());',
    '  assert.equal(body.excludedLineCount, 1);',
    '});',
    '',
    'test("an order with no cancelled lines reports zero excluded", () => {',
    '  const active = LINES.filter((l) => l.status === "active");',
    '  const result = computeOrderTotal(active);',
    '  assert.equal(result.totalCents, 1250);',
    '  assert.equal(result.excludedLineCount, 0);',
    '});',
    '',
  ].join('\n'),
};

/** Materialise the fixture as a real git repository under a temp directory. */

/** Write the fixture into an existing directory. */
export function writeCodingFixture(root: string): void {
  for (const [rel, body] of Object.entries(FIXTURE_FILES)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
}

export interface FixtureRun {
  exitCode: number | null;
  output: string;
  passed: number;
  failed: number;
}

/**
 * Run the fixture's own tests with a CLEAN environment.
 *
 * `NODE_TEST_CONTEXT` and `NODE_OPTIONS` are stripped: a child that inherits the
 * first believes it is a subtest, skips the suite and exits 0 — reporting a failing
 * fixture as green. Measured, not theorised.
 */
export function runFixtureTests(root: string): FixtureRun {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  const res = spawnSync('node', ['--test', '--test-reporter=tap', 'test/orderTotals.test.js'], {
    cwd: root, encoding: 'utf8', env, maxBuffer: 8 * 1024 * 1024,
  });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const count = (re: RegExp): number => Number(output.match(re)?.[1] ?? 0);
  return { exitCode: res.status, output, passed: count(/# pass (\d+)/), failed: count(/# fail (\d+)/) };
}
