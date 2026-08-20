/**
 * Structured test runs, extension side.
 *
 * The extension asks the Brain to run a NAMED SCRIPT the project already declares. It never
 * spawns a process, never assembles a command line, and cannot reach a program the project
 * did not define for itself.
 *
 * A REFUSAL IS NOT A FAILING SUITE. `refused` means nothing ran — no discoverable script, an
 * unknown script, a containment or policy refusal. Rendering that as "tests failed" would
 * tell someone their code is broken when in fact nothing executed, which is the most
 * misleading thing this workflow could do, so the two render differently and are never
 * collapsed.
 *
 * No `vscode` import, so every branch is testable under bare `node --test`.
 */

export interface TestFailure {
  name: string;
  file: string | null;
}

export interface TestRunResult {
  status: 'passed' | 'failed' | 'timeout' | 'refused';
  script: string | null;
  command: string[] | null;
  exitCode: number | null;
  durationMs: number;
  totals: { passed: number; failed: number } | null;
  failures: TestFailure[];
  stdout: string;
  stderr: string;
  truncated: boolean;
  refusalReason: string | null;
  availableScripts: string[];
}

export interface TestRunner {
  run(input: { rootPath: string; script?: string }): Promise<TestRunResult>;
}

export type TestRunOutcome =
  | { kind: 'ran'; result: TestRunResult; report: string }
  | { kind: 'refused'; reason: string; availableScripts: string[] }
  | { kind: 'unavailable'; reason: string };

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatTestReport(result: TestRunResult): string {
  const lines: string[] = [];
  lines.push(`> ${(result.command ?? []).join(' ')}`);
  lines.push('');
  if (result.status === 'timeout') {
    lines.push(`TIMED OUT after ${seconds(result.durationMs)} — the suite was stopped, so its result is unknown.`);
  } else if (result.status === 'passed') {
    const totals = result.totals === null ? '' : `  (${result.totals.passed} passed)`;
    lines.push(`PASSED in ${seconds(result.durationMs)}${totals}`);
  } else {
    const totals = result.totals === null ? '' : `  (${result.totals.passed} passed, ${result.totals.failed} failed)`;
    lines.push(`FAILED — exit ${result.exitCode ?? 'unknown'} in ${seconds(result.durationMs)}${totals}`);
  }

  if (result.failures.length > 0) {
    lines.push('', 'Failed:');
    for (const failure of result.failures) {
      lines.push(failure.file === null ? `  ${failure.name}` : `  ${failure.name}  (${failure.file})`);
    }
  } else if (result.status === 'failed') {
    // Say so rather than implying there were no failures.
    lines.push('', 'Individual test names were not parsable from this runner — see the output below.');
  }

  if (result.truncated) lines.push('', 'Output was truncated at the server cap.');
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (output.length > 0) lines.push('', 'Output:', output);
  return lines.join('\n');
}

export async function runTestFlow(input: {
  rootPath: string | undefined;
  script?: string;
  runner: TestRunner;
}): Promise<TestRunOutcome> {
  if (input.rootPath === undefined || input.rootPath.length === 0) {
    return { kind: 'unavailable', reason: 'Open a workspace folder first — a test run needs a resolved root.' };
  }
  let result: TestRunResult;
  try {
    result = await input.runner.run({
      rootPath: input.rootPath,
      ...(input.script !== undefined ? { script: input.script } : {}),
    });
  } catch (error) {
    // FAIL CLOSED. The Brain is the only executor; unreachable means the suite did not run,
    // and there is deliberately no local fallback that could pretend otherwise.
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'unavailable', reason: `the Brain Service is unavailable, so no tests were run (${message}).` };
  }
  if (result.status === 'refused') {
    return {
      kind: 'refused',
      reason: result.refusalReason ?? 'no test command could be determined safely',
      availableScripts: result.availableScripts,
    };
  }
  return { kind: 'ran', result, report: formatTestReport(result) };
}

/**
 * A one-line verification summary for the product's result area.
 *
 * Keeps the same distinction the report makes: a refusal is not a failing suite,
 * and a timeout is not a failure — it is an unknown.
 */
export function testRunActivity(outcome: TestRunOutcome): { text: string; tone: 'ok' | 'warn' | 'error' | 'info' } {
  if (outcome.kind === 'unavailable') return { text: 'Tests not run — MigraPilot is unavailable', tone: 'error' };
  if (outcome.kind === 'refused') return { text: `Tests not run — ${outcome.reason}`, tone: 'warn' };
  const { status, totals, script } = outcome.result;
  const name = script ?? 'tests';
  if (status === 'timeout') return { text: `${name}: timed out — result unknown`, tone: 'warn' };
  if (status === 'passed') {
    return { text: totals ? `${name}: passed (${totals.passed})` : `${name}: passed`, tone: 'ok' };
  }
  return { text: totals ? `${name}: FAILED (${totals.failed} of ${totals.passed + totals.failed})` : `${name}: FAILED`, tone: 'error' };
}

