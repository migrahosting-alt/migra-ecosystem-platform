// Acceptance for the structured test-run lane, extension side.
//
// The engine's correctness against real passing/failing/hanging suites is proven in
// brain-service. What is asserted here is what the extension must not lose: a refusal is
// never rendered as a failing suite, an unreachable Brain never looks like a result, and no
// process is spawned anywhere in the extension.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { formatTestReport, runTestFlow, type TestRunResult } from '../../services/testRunFlow.js';

const result = (patch: Partial<TestRunResult> = {}): TestRunResult => ({
  status: 'passed',
  script: 'test',
  command: ['npm', 'run', '--', 'test'],
  exitCode: 0,
  durationMs: 1234,
  totals: { passed: 12, failed: 0 },
  failures: [],
  stdout: 'TAP version 13\n# pass 12\n',
  stderr: '',
  truncated: false,
  refusalReason: null,
  availableScripts: ['test'],
  ...patch,
});

test('a passing suite renders PASSED with real totals', async () => {
  const outcome = await runTestFlow({ rootPath: '/w', runner: { run: async () => result() } });
  assert.equal(outcome.kind, 'ran');
  if (outcome.kind !== 'ran') return;
  assert.match(outcome.report, /> npm run -- test/);
  assert.match(outcome.report, /PASSED in 1\.2s\s+\(12 passed\)/);
});

test('a failing suite names the failed tests', async () => {
  const outcome = await runTestFlow({
    rootPath: '/w',
    runner: {
      async run() {
        return result({
          status: 'failed',
          exitCode: 1,
          totals: { passed: 11, failed: 1 },
          failures: [{ name: 'the broken expectation', file: 'suite.test.js' }],
        });
      },
    },
  });
  if (outcome.kind !== 'ran') throw new Error('expected a run');
  assert.match(outcome.report, /FAILED — exit 1/);
  assert.match(outcome.report, /11 passed, 1 failed/);
  assert.match(outcome.report, /the broken expectation\s+\(suite\.test\.js\)/);
});

test('an unparsable runner says so instead of implying there were no failures', async () => {
  const outcome = await runTestFlow({
    rootPath: '/w',
    runner: { run: async () => result({ status: 'failed', exitCode: 1, totals: null, failures: [] }) },
  });
  if (outcome.kind !== 'ran') throw new Error('expected a run');
  assert.match(outcome.report, /not parsable from this runner/);
});

test('a TIMEOUT says the result is unknown, not that tests failed', async () => {
  const outcome = await runTestFlow({
    rootPath: '/w',
    runner: { run: async () => result({ status: 'timeout', exitCode: null, totals: null, durationMs: 300000 }) },
  });
  if (outcome.kind !== 'ran') throw new Error('expected a run');
  assert.match(outcome.report, /TIMED OUT after 300\.0s/);
  assert.match(outcome.report, /result is unknown/);
  assert.ok(!/FAILED/.test(outcome.report), 'a hang must not be reported as a failure');
});

test('A REFUSAL IS NOT A FAILING SUITE', async () => {
  const outcome = await runTestFlow({
    rootPath: '/w',
    runner: {
      async run() {
        return result({
          status: 'refused',
          script: null,
          command: null,
          exitCode: null,
          totals: null,
          stdout: '',
          refusalReason: 'this project declares no test script, so there is nothing safe to run',
          availableScripts: [],
        });
      },
    },
  });
  assert.equal(outcome.kind, 'refused');
  if (outcome.kind !== 'refused') return;
  assert.match(outcome.reason, /no test script/);
  // the crucial negative: nothing that reads as a test outcome
  assert.ok(!/FAILED|PASSED/.test(outcome.reason));
});

test('a refusal offers the project\'s own scripts, never an invented command', async () => {
  const outcome = await runTestFlow({
    rootPath: '/w',
    runner: {
      async run() {
        return result({
          status: 'refused',
          command: null,
          refusalReason: 'several test scripts exist and none is the standard one',
          availableScripts: ['test:unit', 'test:integration'],
        });
      },
    },
  });
  if (outcome.kind !== 'refused') throw new Error('expected a refusal');
  assert.deepEqual(outcome.availableScripts, ['test:unit', 'test:integration']);
});

test('FAIL CLOSED: an unreachable Brain reports that no tests were run', async () => {
  const outcome = await runTestFlow({
    rootPath: '/w',
    runner: {
      async run(): Promise<TestRunResult> {
        throw new Error('local_runner_unavailable');
      },
    },
  });
  assert.equal(outcome.kind, 'unavailable');
  if (outcome.kind !== 'unavailable') return;
  assert.match(outcome.reason, /no tests were run/);
});

test('no workspace folder is refused before any request', async () => {
  let called = false;
  const outcome = await runTestFlow({
    rootPath: undefined,
    runner: {
      async run() {
        called = true;
        return result();
      },
    },
  });
  assert.equal(outcome.kind, 'unavailable');
  assert.equal(called, false);
});

test('an explicitly selected script is passed through unchanged', async () => {
  let seen: string | undefined;
  await runTestFlow({
    rootPath: '/w',
    script: 'test:unit',
    runner: {
      async run(input) {
        seen = input.script;
        return result({ script: 'test:unit' });
      },
    },
  });
  assert.equal(seen, 'test:unit');
});

test('RERUN after an edit reports the new outcome, not the old one', async () => {
  const outcomes: TestRunResult[] = [
    result({ status: 'failed', exitCode: 1, totals: { passed: 1, failed: 1 }, failures: [{ name: 'broken', file: null }] }),
    result({ status: 'passed', exitCode: 0, totals: { passed: 2, failed: 0 } }),
  ];
  let call = 0;
  const runner = { run: async () => outcomes[call++] as TestRunResult };

  const first = await runTestFlow({ rootPath: '/w', runner });
  const second = await runTestFlow({ rootPath: '/w', runner });
  if (first.kind !== 'ran' || second.kind !== 'ran') throw new Error('expected runs');
  assert.match(first.report, /FAILED/);
  assert.match(second.report, /PASSED/);
  assert.deepEqual(second.result.failures, []);
});

test('raw bounded output is preserved and truncation disclosed', () => {
  const report = formatTestReport(result({ truncated: true, stdout: 'raw runner output here' }));
  assert.match(report, /Output was truncated at the server cap/);
  assert.match(report, /raw runner output here/);
});

test('THE EXTENSION NEVER SPAWNS A PROCESS FOR TESTS', () => {
  for (const relative of ['services/testRunFlow.ts', 'commands/runTests.ts']) {
    const source = readFileSync(path.resolve(__dirname, '../../../src', relative), 'utf8');
    for (const forbidden of ['child_process', 'execFile', 'execSync', 'spawn(', 'node:fs', 'createTerminal']) {
      assert.ok(!source.includes(forbidden), `${relative} must not reference "${forbidden}"`);
    }
  }
});

test('the lane never assembles a command line', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/commands/runTests.ts'), 'utf8');
  for (const forbidden of ['npm run', "'npm'", 'command:', '&&', 'shell']) {
    assert.ok(!source.includes(forbidden), `must not reference "${forbidden}"`);
  }
});

test('`git` is still absent from the ad-hoc command allowlist', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/services/commandInput.ts'), 'utf8');
  assert.ok(!source.includes("'git'"));
});

test('REGISTRATION: migrapilot.runTests is contributed AND wired to its handler', () => {
  // The quickEdit defect typechecked and silently never registered, so registration is
  // asserted structurally rather than assumed from the command existing.
  const pkg = JSON.parse(
    readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
  ) as { contributes: { commands: Array<{ command: string }> } };
  assert.ok(
    pkg.contributes.commands.some((c) => c.command === 'migrapilot.runTests'),
    'must be contributed in package.json',
  );
  const source = readFileSync(path.resolve(__dirname, '../../../src/extension.ts'), 'utf8');
  assert.match(
    source,
    // Tolerates line wrapping, but still requires the handler to BE runTests —
    // the quickEdit defect passed a compile and registered nothing at all.
    /registerCommand\(\s*'migrapilot\.runTests',\s*(?:\/\/[^\n]*\n\s*)*\(\)\s*=>\s*(?:\n\s*)?(?:\/\/[^\n]*\n\s*)*runTests\(/,
    'must be registered and wired to runTests()',
  );
});
