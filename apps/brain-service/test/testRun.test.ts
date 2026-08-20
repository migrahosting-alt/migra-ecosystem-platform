// Acceptance for structured test runs.
//
// Driven against REAL temporary projects that really pass, really fail and really hang. The
// claim under test is "the reported outcome is the actual outcome", which a stubbed runner
// cannot establish.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseFailures, parseTotals, resolveScript, testRun, testScriptsIn } from '../src/tools/testRun.js';

/** A project whose `test` script runs the given node source. */
function project(testSource: string | null, scripts?: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'migrapilot-testrun-'));
  const declared = scripts ?? (testSource === null ? {} : { test: 'node --test suite.test.js' });
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'probe', version: '1.0.0', scripts: declared }));
  if (testSource !== null) writeFileSync(path.join(root, 'suite.test.js'), testSource);
  return root;
}

const PASSING = `
const test = require('node:test');
const assert = require('node:assert/strict');
test('adds', () => { assert.equal(1 + 1, 2); });
test('concatenates', () => { assert.equal('a' + 'b', 'ab'); });
`;

const FAILING = `
const test = require('node:test');
const assert = require('node:assert/strict');
test('adds', () => { assert.equal(1 + 1, 2); });
test('the broken expectation', () => { assert.equal(1 + 1, 3); });
`;

test('a PASSING suite reports passed with real totals', async () => {
  const result = await testRun({ rootPath: project(PASSING) });
  assert.equal(result.status, 'passed');
  assert.equal(result.exitCode, 0);
  assert.equal(result.script, 'test');
  assert.deepEqual(result.command, ['npm', 'run', '--', 'test']);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.totals, { passed: 2, failed: 0 });
  assert.ok(result.durationMs >= 0);
  assert.equal(result.refusalReason, null);
});

test('a FAILING suite reports failed and names the failing test', async () => {
  const result = await testRun({ rootPath: project(FAILING) });
  assert.equal(result.status, 'failed');
  assert.notEqual(result.exitCode, 0);
  assert.deepEqual(result.totals, { passed: 1, failed: 1 });
  assert.ok(
    result.failures.some((f) => f.name.includes('the broken expectation')),
    `expected the failing test to be named, saw ${JSON.stringify(result.failures)}`,
  );
  assert.ok(result.stdout.length > 0, 'raw output is preserved for inspection');
});

test('a TIMEOUT is reported as timeout, not as a failing suite', async () => {
  const root = project(`setTimeout(() => {}, 60000);`);
  const result = await testRun({ rootPath: root, timeoutMs: 1500 });
  assert.equal(result.status, 'timeout');
  assert.notEqual(result.status, 'failed', 'a hang is not a test failure');
});

test('REFUSAL: a project with no test script refuses rather than guessing', async () => {
  const result = await testRun({ rootPath: project(null) });
  assert.equal(result.status, 'refused');
  assert.equal(result.command, null, 'nothing was executed');
  assert.match(result.refusalReason ?? '', /no test script/);
});

test('REFUSAL: no package.json at all', async () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'migrapilot-notest-'));
  const result = await testRun({ rootPath: empty });
  assert.equal(result.status, 'refused');
  assert.match(result.refusalReason ?? '', /no package\.json/);
});

test('REFUSAL: an unknown script is refused, never silently swapped', async () => {
  const root = project(PASSING);
  const result = await testRun({ rootPath: root, script: 'test:does-not-exist' });
  assert.equal(result.status, 'refused');
  assert.equal(result.command, null);
  assert.match(result.refusalReason ?? '', /is not a script in this project/);
});

test('a REFUSAL is never reported as a failing suite', async () => {
  const result = await testRun({ rootPath: project(null) });
  assert.notEqual(result.status, 'failed', 'nothing ran, so nothing failed');
  assert.deepEqual(result.failures, [], 'a refusal invents no failures');
  assert.equal(result.totals, null);
});

test('an explicitly selected known script runs', async () => {
  const root = project(PASSING, { test: 'node --test suite.test.js', 'test:unit': 'node --test suite.test.js' });
  const result = await testRun({ rootPath: root, script: 'test:unit' });
  assert.equal(result.status, 'passed');
  assert.equal(result.script, 'test:unit');
});

test('EDIT then RERUN reflects the new state', async () => {
  const root = project(FAILING);
  const first = await testRun({ rootPath: root });
  assert.equal(first.status, 'failed');

  // fix the test, exactly as an edit would
  writeFileSync(path.join(root, 'suite.test.js'), PASSING);

  const second = await testRun({ rootPath: root });
  assert.equal(second.status, 'passed', 'the rerun must observe the edit, not a cached result');
  assert.deepEqual(second.failures, []);
  assert.deepEqual(second.command, first.command, 'the same command is rerun');
});

test('a contained cwd selects the right sub-project', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'migrapilot-mono-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'root', scripts: {} }));
  const pkg = path.join(root, 'packages', 'inner');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'inner', scripts: { test: 'node --test suite.test.js' } }));
  writeFileSync(path.join(pkg, 'suite.test.js'), PASSING);

  const result = await testRun({ rootPath: root, cwd: 'packages/inner' });
  assert.equal(result.status, 'passed');
  assert.equal(result.script, 'test');
});

test('a cwd escaping the workspace is refused BEFORE anything is read or run', async () => {
  const root = project(PASSING);
  const result = await testRun({ rootPath: root, cwd: '../..' });
  assert.equal(result.status, 'refused');
  assert.equal(result.command, null, 'nothing executed');
  assert.match(result.refusalReason ?? '', /escapes the workspace root/);
});

test('an ABSOLUTE cwd cannot be used to read a manifest outside the workspace', async () => {
  const root = project(PASSING);
  // A real package.json exists at the repo root; containment must refuse to reach it.
  const result = await testRun({ rootPath: root, cwd: '/home' });
  assert.equal(result.status, 'refused');
  assert.equal(result.command, null);
  assert.match(result.refusalReason ?? '', /escapes the workspace root/);
});

test('availableScripts lists what the project actually declares', async () => {
  const root = project(PASSING, {
    build: 'tsc',
    test: 'node --test suite.test.js',
    'test:unit': 'node --test suite.test.js',
  });
  const result = await testRun({ rootPath: root, script: 'test' });
  assert.deepEqual(result.availableScripts, ['test', 'test:unit'], 'build is not a test script');
});

// ── pure helpers ────────────────────────────────────────────────────────────

test('resolveScript prefers the standard script and refuses when ambiguous', () => {
  assert.equal(resolveScript({ test: 'x' }), 'test');
  assert.equal(resolveScript({ 'test:unit': 'x', test: 'y' }), 'test:unit');
  assert.equal(resolveScript({ 'test:only': 'x' }), 'test:only', 'a single test script is unambiguous');
  assert.throws(() => resolveScript({ 'test:a': 'x', 'test:b': 'y' }), /name the script to run/);
  assert.throws(() => resolveScript({ build: 'x' }), /no test script/);
});

test('testScriptsIn recognises test scripts and excludes builds', () => {
  assert.deepEqual(
    testScriptsIn({ build: 'x', test: 'x', 'test:unit': 'x', typecheck: 'x', latest: 'x' }),
    ['test', 'test:unit'],
    '"latest" contains "test" but is not a test script',
  );
});

test('parseFailures reads TAP and jest-style output, and invents nothing', () => {
  const tap = parseFailures('ok 1 - fine\nnot ok 2 - the broken one\n');
  assert.deepEqual(tap, [{ name: 'the broken one', file: null }]);

  const jest = parseFailures('FAIL src/thing.test.ts\n');
  assert.deepEqual(jest, [{ name: 'src/thing.test.ts', file: 'src/thing.test.ts' }]);

  assert.deepEqual(parseFailures('some unrecognised runner output\n'), [], 'unknown format yields nothing');
});

test('parseTotals returns null rather than guessing', () => {
  assert.deepEqual(parseTotals('# pass 3\n# fail 1\n'), { passed: 3, failed: 1 });
  assert.equal(parseTotals('no summary here'), null);
});

test('a TIMEOUT actually STOPS the work, it does not wait for it', async () => {
  // The suite would take 60s. `npm run` spawns a grandchild, so killing only the direct
  // child would leave it holding the stdout pipe and the call would return after the full
  // 60s while still reporting "timeout" — a truthful label on a useless wait, and an
  // outright hang for a suite that never ends.
  const root = project('setTimeout(() => {}, 60000);');
  const started = Date.now();
  const result = await testRun({ rootPath: root, timeoutMs: 2000 });
  const elapsed = Date.now() - started;
  assert.equal(result.status, 'timeout');
  assert.ok(elapsed < 20_000, `the timeout must stop the work; waited ${elapsed}ms`);
  assert.ok(result.durationMs < 20_000, `reported duration must reflect the stop, saw ${result.durationMs}ms`);
});
