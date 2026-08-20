// Planning that can start from a SYMPTOM, and single-file work as first-class.
//
// The benchmark lost two of five tasks here, before any model ran. "The test suite
// is failing" named no file, so ranking cleared nothing and planning refused
// `no-candidates` in five seconds; and a refactor legitimately confined to one file
// was refused `insufficient-evidence` because at least two were demanded. Both are
// retrieval defects, not model defects, and these tests pin the fixes.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { planCodingTask, DEFAULT_PLANNING_LIMITS, type PlannerModel } from '../src/engine/coding/codingPlanner.js';
import { failureEvidence } from '../src/engine/planning/failureEvidence.js';
import { makeSpanSource } from '../src/engine/planning/workspaceSpanSource.js';
import { clearRepoMapCache } from '../src/engine/planning/repoMap.js';

const VALIDATION = { id: 'tests', command: ['npm', 'test'] };

/** A small repository whose failing test names its subject only indirectly. */
function repo(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'symptom-plan-')));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'test'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fx', scripts: { test: 'node --test test/' } }));
  fs.writeFileSync(path.join(root, 'src/pricing.js'),
    'export function applyCoupon(cents, pct) { return Math.round(cents * (1 - pct / 100)); }\n'
    + 'export function memberDiscount(cents, rate) { return Math.round(cents * (1 - rate)); }\n'
    + 'export function taxFor(cents) { return Math.round(cents * 0.0825); }\n');
  fs.writeFileSync(path.join(root, 'src/shipping.js'), 'export function shippingFor() { return 0; }\n');
  fs.writeFileSync(path.join(root, 'src/labels.js'), 'export function renderLabel() { return ""; }\n');
  fs.writeFileSync(path.join(root, 'test/pricing.test.js'), 'import { applyCoupon } from "../src/pricing.js";\n');
  // The repository map is built from tracked files, so the fixture must be a repo.
  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  };
  git(['init', '-q']);
  git(['config', 'user.email', 'fixture@migrateck.test']);
  git(['config', 'user.name', 'Fixture']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'pricing fixture']);
  return root;
}

/** The output a real `node --test` run produces for a failing pricing expectation. */
const FAILING_OUTPUT = [
  'TAP version 13',
  '# Subtest: test/pricing.test.js',
  'not ok 1 - a gold member gets 10% off before tax',
  '  ---',
  '  error: |-',
  "    Expected values to be strictly equal:",
  '    825 !== 743',
  '  code: ERR_ASSERTION',
  '  stack: |-',
  '    TestContext.<anonymous> (/tmp/whatever/test/pricing.test.js:12:10)',
  '    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)',
  '  ...',
  '# fail 1',
].join('\n');

const pickFirst: PlannerModel = async (input) => ({
  issueSummary: 'repair the failing expectation',
  scope: [{ path: input.candidatePaths[0]!, rationale: 'the failure points here' }],
  excluded: [],
  edits: [{ path: input.candidatePaths[0]!, content: '// repaired\n' }],
});

async function plan(root: string, issue: string, overrides = {}) {
  clearRepoMapCache();
  return planCodingTask({
    issue,
    rootPath: root,
    validationCommand: VALIDATION,
    model: pickFirst,
    openSpan: (rel, s, e) => makeSpanSource(root, rel, s, e),
    ...overrides,
  });
}

// ── failure → evidence ───────────────────────────────────────────────────────

test('a failure names the files it mentions, and ignores runtime internals', () => {
  const observed = failureEvidence(FAILING_OUTPUT, '/tmp/whatever');
  assert.ok(observed.paths.includes('test/pricing.test.js'), `saw ${observed.paths.join(', ')}`);
  assert.ok(!observed.paths.some((p) => p.includes('node:internal')), 'runtime frames are not evidence');
  assert.ok(!observed.paths.some((p) => p.includes('node_modules')));
});

test('the query carries the failing test name and the assertion, which is what ranks', () => {
  const observed = failureEvidence(FAILING_OUTPUT, '/tmp/whatever');
  assert.match(observed.query, /a gold member gets 10% off before tax/);
  assert.match(observed.query, /825 !== 743/);
});

test('a passing or empty output yields nothing rather than noise', () => {
  assert.deepEqual(failureEvidence('', '/root').paths, []);
  assert.deepEqual(failureEvidence('# pass 3\n# fail 0\n', '/root').paths, []);
});

// ── planning from a symptom ──────────────────────────────────────────────────

// Names no file, no symbol, no identifier — the condition that used to refuse.
// (The benchmark's real phrasing, "the test suite is failing", additionally makes
// the ranker admit test files, which this tiny fixture would then match; the
// mechanism under test is the same and the benchmark re-run covers the real text.)
const SYMPTOM = 'Something is broken here. Please work out what and fix it.';

test('WITHOUT a probe, a symptom-only issue still refuses — the old behaviour is unchanged', async () => {
  const result = await plan(repo(), SYMPTOM);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'no-candidates');
});

test('WITH a probe, the same issue plans from what the failure said', async () => {
  const root = repo();
  let probed = 0;
  const result = await plan(root, SYMPTOM, {
    observeFailure: async () => { probed += 1; return { output: FAILING_OUTPUT.replace(/\/tmp\/whatever/g, root), passed: false }; },
  });
  assert.equal(probed, 1, 'the probe runs exactly once');
  assert.ok(result.ok, result.ok ? '' : `${result.reason}: ${result.message}`);
  if (!result.ok) return;
  // It navigated to the pricing module the failing test exercises — the issue text
  // named nothing at all.
  const opened = result.ledger.readPaths;
  assert.ok(opened.some((p) => p.includes('pricing')), `expected pricing evidence, opened ${opened.join(', ')}`);
});

test('the probe is only used when the words found nothing', async () => {
  const root = repo();
  let probed = 0;
  const result = await plan(root, 'Fix the rounding in src/pricing.js applyCoupon', {
    observeFailure: async () => { probed += 1; return { output: FAILING_OUTPUT, passed: false }; },
  });
  assert.ok(result.ok);
  assert.equal(probed, 0, 'a named subject needs no symptom probe');
});

test('a probe reporting SUCCESS adds nothing, and the refusal is honest about it', async () => {
  const result = await plan(repo(), SYMPTOM, {
    observeFailure: async () => ({ output: '# pass 3\n# fail 0\n', passed: true }),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'no-candidates');
});

test('a probe that throws leaves the original refusal intact', async () => {
  const result = await plan(repo(), SYMPTOM, {
    observeFailure: async () => { throw new Error('command refused'); },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'no-candidates');
});

test('GOVERNANCE: a path the failure names but the repository does not have cannot enter scope', async () => {
  const root = repo();
  const forged = FAILING_OUTPUT + '\n    at x (/etc/passwd.js:1:1)\n    at y (../../outside/secret.js:2:2)\n';
  const result = await plan(root, SYMPTOM, {
    observeFailure: async () => ({ output: forged.replace(/\/tmp\/whatever/g, root), passed: false }),
  });
  if (!result.ok) return; // a refusal is also acceptable; what must not happen is an escape
  for (const opened of result.ledger.readPaths) {
    assert.ok(!opened.includes('..') && !opened.startsWith('/'), `escaped: ${opened}`);
    assert.ok(fs.existsSync(path.join(root, opened)), `${opened} is not a file in this repository`);
  }
});

// ── single-file work is first-class ──────────────────────────────────────────

test('ONE readable file is sufficient evidence to plan', async () => {
  assert.equal(DEFAULT_PLANNING_LIMITS.minEvidenceFiles, 1, 'the two-file minimum made single-file work impossible');
  const root = repo();
  const result = await plan(root, 'Refactor src/pricing.js: applyCoupon and memberDiscount repeat the same percentage arithmetic.');
  assert.ok(result.ok, result.ok ? '' : `${result.reason}: ${result.message}`);
  if (!result.ok) return;
  assert.equal(result.ledger.readPaths.length, 1, 'a named single file is the whole evidence set');
  assert.match(result.ledger.readPaths[0]!, /pricing/);
});

test('zero readable files still refuses, and says so in terms of evidence', async () => {
  const root = repo();
  const result = await plan(root, 'Fix src/pricing.js rounding', {
    openSpan: () => { throw new Error('unreadable'); },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'insufficient-evidence');
  assert.match(result.message, /no evidence to plan from/i);
});

test('planning does not pad the scope to satisfy a count', async () => {
  const root = repo();
  const result = await plan(root, 'Refactor src/pricing.js percentage arithmetic into one helper.');
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.plan.proposedScope.map((s) => s.path), ['src/pricing.js']);
});
