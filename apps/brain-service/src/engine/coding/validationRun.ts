/**
 * MigraAI Engine — targeted validation for a coding run.
 *
 * The command is DECLARED, not generated. A model that writes its own validation
 * command can, under pressure to finish, write one that passes — and the whole
 * point of running tests is that the run is not under the model's control. The
 * task contract names the commands; the model chooses only WHEN to run them.
 *
 * Runs through `command.run` (allowlisted, contained, output-redacted), never
 * `terminal.exec`, which is deliberately registered-but-unavailable.
 *
 * A command that did not execute successfully is never representable as a passed
 * check: `passed` is derived from a real `exitCode === 0`, and a spawn failure or
 * timeout yields `exitCode: null`, which is not zero. © MigraTeck LLC.
 */

import type { CommandRunResponse } from '@migrapilot/protocol';
import { commandRun } from '../../tools/commandRun.js';

/** Which point in the run a validation belongs to. */
export type ValidationStage = 'baseline' | 'repair' | 'final';

/** A command the task contract permits. Not model-authored. */
export interface DeclaredValidation {
  id: string;
  /** argv; argv[0] must be a bare allowlisted program name. */
  command: string[];
  /** Working directory relative to the workspace root. */
  cwd?: string;
  timeoutMs?: number;
}

export interface ValidationRecord {
  id: string;
  stage: ValidationStage;
  command: string[];
  cwd: string;
  /** Whether the command was permitted to run at all, and why not when refused. */
  admitted: boolean;
  refusedReason?: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  /** `null` when the process never produced a status — a spawn failure or timeout. */
  exitCode: number | null;
  timedOut: boolean;
  /** Bounded, redacted by `command.run`. */
  stdout: string;
  stderr: string;
  truncated: boolean;
  /** ONLY true for a real zero exit. Never inferred from output text. */
  passed: boolean;
}

/** Output kept per stream in the record. Enough to diagnose, bounded for storage. */
const MAX_STREAM_CHARS = 8_000;

function clip(s: string): string {
  return s.length <= MAX_STREAM_CHARS ? s : `${s.slice(0, MAX_STREAM_CHARS)}\n…[truncated ${s.length - MAX_STREAM_CHARS} chars]`;
}

export interface RunValidationDeps {
  rootPath: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  now?: () => number;
}

/**
 * A note on `NODE_TEST_CONTEXT`, because it is a trap worth documenting.
 *
 * When that variable is present, `node --test` believes it is a SUBTEST of a
 * parent runner and skips the run entirely — exit 0, empty output, a failing suite
 * reported as success. The obvious defence, passing `NODE_TEST_CONTEXT: ''`
 * through `command.run`, makes it WORSE: Node checks for PRESENCE, not truth, so
 * an empty value still suppresses the run. Measured, both ways.
 *
 * `command.run` builds the child env as `{ ...process.env, ...env, ...request.environment }`
 * and offers no way to UNSET a key, so this cannot be fixed from here. It is also
 * not a production concern — the Brain is a server, not a process spawned by a
 * test runner. The obligation therefore sits with any harness that invokes
 * validation from inside `node --test`: it must clean its own environment, and
 * `codingRun.test.ts` does exactly that, for exactly this reason.
 */

/**
 * Execute one declared validation.
 *
 * Never throws for a failing command — a non-zero exit is a RESULT, and the repair
 * loop needs it as evidence. It only surfaces a refusal when the command could not
 * be admitted at all (disabled, off-allowlist, escaping cwd), and that refusal is
 * recorded as `admitted: false` rather than as a failed test.
 */
export async function runValidation(
  validation: DeclaredValidation,
  stage: ValidationStage,
  deps: RunValidationDeps,
): Promise<ValidationRecord> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const base = {
    id: validation.id,
    stage,
    command: [...validation.command],
    cwd: validation.cwd ?? '.',
    startedAt,
  };

  let response: CommandRunResponse;
  try {
    response = await commandRun(
      {
        rootPath: deps.rootPath,
        command: validation.command,
        ...(validation.cwd ? { cwd: validation.cwd } : {}),
        ...(validation.timeoutMs ? { timeoutMs: validation.timeoutMs } : {}),
      },
      deps.env ?? process.env,
      deps.signal,
    );
  } catch (err) {
    // Policy refusal or spawn failure. NOT a test result, and never a pass.
    const endedAt = now();
    return {
      ...base,
      admitted: false,
      refusedReason: err instanceof Error ? err.message : String(err),
      endedAt,
      durationMs: endedAt - startedAt,
      exitCode: null,
      timedOut: false,
      stdout: '',
      stderr: '',
      truncated: false,
      passed: false,
    };
  }

  const endedAt = now();
  return {
    ...base,
    admitted: true,
    endedAt,
    durationMs: endedAt - startedAt,
    exitCode: response.exitCode,
    timedOut: response.timedOut,
    stdout: clip(response.stdout),
    stderr: clip(response.stderr),
    truncated: response.truncated,
    // The single definition of "passed" in the whole coding path.
    passed: response.exitCode === 0 && !response.timedOut,
  };
}

/**
 * The observable failure, extracted from real output.
 *
 * Deliberately mechanical: assertion lines, error lines and the TAP failure count.
 * The repair loop is only allowed to reason from what this returns, so anything it
 * cannot find here is something the model may not claim.
 */
export function observedFailure(record: ValidationRecord): { summary: string; lines: string[] } {
  if (record.passed) return { summary: 'passed', lines: [] };
  if (!record.admitted) return { summary: `command refused: ${record.refusedReason ?? 'unknown'}`, lines: [] };
  // Keep the failure HEADLINES *and* the body of each error block.
  //
  // An earlier version matched only headline patterns, which discarded the
  // assertion diff — the part that actually names the missing field. A live run
  // then showed the repair author `not ok 3 - the contract declares the
  // excluded-count field` with no mention of `excludedLineCount`, so it correctly
  // declined to invent an explanation and the run stalled. The loop behaved
  // properly; it was simply shown too little. Extraction stays mechanical: TAP
  // error blocks open at `error:` and close at the block terminator.
  const text = `${record.stdout}\n${record.stderr}`;
  const lines: string[] = [];
  let inErrorBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (lines.length >= 60) break;
    if (/^error:/.test(line)) {
      inErrorBlock = true;
      lines.push(line);
      continue;
    }
    if (inErrorBlock) {
      // `...` terminates a TAP YAML block; `code:`/`stack:` end the useful part.
      if (line === '...' || /^(code|name|stack|operator):/.test(line)) {
        inErrorBlock = false;
        continue;
      }
      if (line) lines.push(line);
      continue;
    }
    if (/^(not ok|AssertionError|# fail)/.test(line) || line.includes('!==')) lines.push(line);
  }
  const failCount = /^# fail (\d+)$/m.exec(record.stdout)?.[1];
  const summary = record.timedOut
    ? `timed out after ${record.durationMs}ms`
    : `exit ${record.exitCode ?? 'null'}${failCount ? `, ${failCount} failing test(s)` : ''}`;
  return { summary, lines };
}
