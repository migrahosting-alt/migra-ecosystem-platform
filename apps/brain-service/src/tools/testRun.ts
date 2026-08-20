// Structured test runs — "run the tests and tell me what failed".
//
// WHAT MAKES THIS SAFE
// --------------------
// A request names a SCRIPT, never a command line. The script must already be a key in the
// project's own package.json, so the set of runnable things is exactly what the project
// declared for itself. There is no field here that becomes a shell string, and no way to
// reach a program the project did not define.
//
// Execution is delegated to `commandRun` — the SAME executor as the ad-hoc lane, with its
// allowlist untouched. `npm` is already on that allowlist, so `npm run <script>` needs no
// widening; if it were not, the right answer would be to refuse, not to widen.
//
//   ad-hoc lane   `node --version`            argv from a person
//   test run      `npm run test:unit`         script from the project, argv built HERE
//
// A REFUSAL IS NOT A FAILING TEST. `refused` means the suite never ran — no discoverable
// script, an unknown script, a policy refusal. Collapsing that into `failed` would tell
// someone their code is broken when the truth is that nothing was executed, which is the
// single most misleading thing this workflow could do.

import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  TestRunRequestSchema,
  type TestRunRequest,
  type TestRunResponse,
} from '@migrapilot/protocol';
import { containedPath, nodeWorkspaceFs } from '@migrapilot/workspace-tools';
import { CommandPolicyError, commandRun } from './commandRun.js';

/** Script names that are a test run rather than a build or a watcher. */
const TEST_SCRIPT = /^(test|tests)(:|$)/;
/** Preference order when no script was named. First match wins. */
const PREFERRED = ['test:unit', 'test'];
const DEFAULT_TEST_TIMEOUT_MS = 300_000;

export class TestRunRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestRunRefusal';
  }
}

async function readScripts(rootPath: string, cwd?: string): Promise<Record<string, string>> {
  // CONTAIN BEFORE READING. commandRun would refuse to execute outside the root, but this
  // read happens first: an uncontained `cwd` could disclose a package.json from outside the
  // workspace, and its script names, without ever running anything. Discovery is subject to
  // the same boundary as execution.
  if (cwd !== undefined) {
    try {
      containedPath(rootPath, path.join(cwd, 'package.json'), nodeWorkspaceFs());
    } catch {
      throw new TestRunRefusal('the requested directory escapes the workspace root');
    }
  }
  const manifest = path.resolve(rootPath, cwd ?? '.', 'package.json');
  let raw: string;
  try {
    raw = await readFile(manifest, 'utf8');
  } catch {
    throw new TestRunRefusal('no package.json here, so no test command can be determined safely');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TestRunRefusal('package.json is not valid JSON, so no test command can be determined');
  }
  const scripts = (parsed as { scripts?: unknown }).scripts;
  if (typeof scripts !== 'object' || scripts === null) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(scripts)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

export function testScriptsIn(scripts: Record<string, string>): string[] {
  return Object.keys(scripts).filter((name) => TEST_SCRIPT.test(name)).sort();
}

/** Resolve which script to run. Fails closed rather than guessing a command. */
export function resolveScript(scripts: Record<string, string>, requested?: string): string {
  const available = testScriptsIn(scripts);
  if (requested !== undefined) {
    // An explicit choice must EXIST. Falling back to a different script would run something
    // the caller did not ask for and report it under their name.
    if (!(requested in scripts)) {
      throw new TestRunRefusal(
        `"${requested}" is not a script in this project${
          available.length ? ` (test scripts here: ${available.join(', ')})` : ''
        }`,
      );
    }
    return requested;
  }
  for (const candidate of PREFERRED) {
    if (candidate in scripts) return candidate;
  }
  if (available.length === 1) return available[0] as string;
  if (available.length > 1) {
    throw new TestRunRefusal(
      `several test scripts exist (${available.join(', ')}) and none is the standard one — name the script to run`,
    );
  }
  throw new TestRunRefusal('this project declares no test script, so there is nothing safe to run');
}

/**
 * Extract failing test names from runner output.
 *
 * Deliberately conservative: it recognises node:test/TAP and the common `FAIL <file>` line,
 * and returns nothing when it does not recognise the format. An empty `failures` list with a
 * non-zero exit means "it failed, and the output is there" — inventing plausible test names
 * from unparsed output would be worse than admitting the format is unknown.
 */
export function parseFailures(output: string): Array<{ name: string; file: string | null }> {
  const failures: Array<{ name: string; file: string | null }> = [];
  const seen = new Set<string>();
  const push = (name: string, file: string | null): void => {
    const key = `${file ?? ''}::${name}`;
    if (name.length === 0 || seen.has(key)) return;
    seen.add(key);
    failures.push({ name, file });
  };
  for (const line of output.split(/\r?\n/)) {
    // node:test / TAP — "not ok 12 - the thing that broke"
    const tap = /^\s*not ok\s+\d+\s*-\s*(.+?)\s*$/.exec(line);
    if (tap) {
      const name = (tap[1] ?? '').trim();
      // TAP emits a `not ok` for the enclosing FILE as well as each test; the file line is
      // a path and is recorded as a file rather than as a test name.
      if (/\.(test|spec)\.[cm]?[jt]s$/.test(name)) push(name, name);
      else push(name, null);
      continue;
    }
    // jest / vitest — "FAIL src/thing.test.ts"
    const fail = /^\s*(?:✕|×|FAIL)\s+(.+?)\s*$/.exec(line);
    if (fail) {
      const target = (fail[1] ?? '').trim();
      if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(target)) push(target, target);
      else push(target, null);
    }
  }
  return failures;
}

/** node:test summary lines: "# pass 12" / "# fail 1". */
export function parseTotals(output: string): { passed: number; failed: number } | null {
  const pass = /^#\s*pass\s+(\d+)\s*$/m.exec(output);
  const fail = /^#\s*fail\s+(\d+)\s*$/m.exec(output);
  if (pass === null || fail === null) return null;
  return { passed: Number.parseInt(pass[1] as string, 10), failed: Number.parseInt(fail[1] as string, 10) };
}

function refusal(reason: string, availableScripts: string[]): TestRunResponse {
  return {
    tool: 'test.run',
    status: 'refused',
    script: null,
    command: null,
    exitCode: null,
    durationMs: 0,
    totals: null,
    failures: [],
    stdout: '',
    stderr: '',
    truncated: false,
    refusalReason: reason,
    availableScripts,
  };
}

export async function testRun(input: TestRunRequest): Promise<TestRunResponse> {
  const req = TestRunRequestSchema.parse(input);

  let scripts: Record<string, string> = {};
  let script: string;
  try {
    scripts = await readScripts(req.rootPath, req.cwd);
    script = resolveScript(scripts, req.script);
  } catch (error) {
    if (error instanceof TestRunRefusal) return refusal(error.message, testScriptsIn(scripts));
    throw error;
  }

  // argv built HERE. `npm` is already allowlisted; `--` keeps a script name from being read
  // as an npm option even if the project declared an oddly-named script.
  const command = ['npm', 'run', '--', script];
  const available = testScriptsIn(scripts);

  let result;
  try {
    result = await commandRun({
      rootPath: req.rootPath,
      command,
      ...(req.cwd !== undefined ? { cwd: req.cwd } : {}),
      timeoutMs: req.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS,
    });
  } catch (error) {
    // A policy refusal from the executor is a REFUSAL, not a failing suite.
    if (error instanceof CommandPolicyError) return refusal(error.message, available);
    throw error;
  }

  const combined = `${result.stdout}\n${result.stderr}`;
  const status: TestRunResponse['status'] = result.timedOut
    ? 'timeout'
    : result.exitCode === 0
      ? 'passed'
      : 'failed';

  return {
    tool: 'test.run',
    status,
    script,
    command,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    totals: parseTotals(combined),
    failures: status === 'passed' ? [] : parseFailures(combined),
    stdout: result.stdout,
    stderr: result.stderr,
    truncated: result.truncated,
    refusalReason: null,
    availableScripts: available,
  };
}
