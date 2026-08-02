/**
 * Controlled fixture for evidence-governed multi-file coding.
 *
 * A real, small repository with a genuine bug that CANNOT be fixed in one file:
 * the contract, the implementation and the route must all change together, and
 * the tests fail until they agree. That is the property being measured — a
 * single-file edit is not a passing answer here, it is a wrong one.
 *
 * It also carries one deliberate trap. `orderTotalsFormatter.js` sits beside
 * `orderTotalsService.js`, shares its prefix, mentions totals and cancellation in
 * its comments, and has nothing to do with the defect. An agent that edits it has
 * selected on name similarity rather than evidence — the same failure the ranking
 * slice measured, now with write access. © MigraTeck LLC.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** The issue text an agent is given. Deliberately behavioural, not prescriptive. */
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
export function createFixtureRepo(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'migra-coding-fixture-')));
  for (const [rel, body] of Object.entries(FIXTURE_FILES)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  const g = (args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  };
  g(['init', '-q']);
  g(['config', 'user.email', 'fixture@migrateck.test']);
  g(['config', 'user.name', 'Fixture']);
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'orders fixture with cancelled-line defect']);
  return dir;
}

export interface FixtureTestRun {
  exitCode: number;
  passed: number;
  failed: number;
  output: string;
}

/** Run the fixture's own suite. The baseline must FAIL; a fix must make it pass. */
export function runFixtureTests(root: string): FixtureTestRun {
  let output = '';
  let exitCode = 0;
  const files = fs
    .readdirSync(path.join(root, 'test'))
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => path.join('test', f));
  // The child must not inherit the PARENT test runner's context. Node switches
  // reporter and exit-code behaviour when `NODE_TEST_CONTEXT` is set, so a fixture
  // invoked from inside a test reported success for a suite that was failing —
  // the harness would have certified an agent that changed nothing.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  try {
    output = execFileSync('node', ['--test', '--test-reporter=tap', ...files], {
      cwd: root,
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    exitCode = e.status ?? 1;
    output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  const num = (label: string): number => Number(new RegExp(`^# ${label} (\\d+)$`, 'm').exec(output)?.[1] ?? 0);
  return { exitCode, passed: num('pass'), failed: num('fail'), output };
}
