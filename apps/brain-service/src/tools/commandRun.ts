// command.run — policy-allowlisted local command execution (build/test/debug).
//
// Safety model (matrix: "Run local builds/tests: Enabled" — under policy):
//  - argv ARRAY spawned directly (never a shell) → no injection surface;
//  - argv[0] must be a BARE name (no path separators) on the allowlist
//    (MIGRAPILOT_COMMAND_ALLOWLIST, default node/npm/npx/tsc/tsx) — anything
//    else is refused outright, not parked for approval (fail-closed policy);
//  - cwd is contained inside rootPath (realpath check — symlink escapes refused);
//  - MIGRAPILOT_COMMAND_RUN=off is the kill-switch (capability stays registered
//    but every dispatch is refused);
//  - bounded: default 120s timeout (max 600s), stdout/stderr capped at 24 KiB
//    each so a chatty build cannot flood the engine or the model loop.

import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import * as path from 'node:path';
import { MARKERS, redactCommandOutput } from '../engine/redaction.js';
import {
  CommandRunRequestSchema,
  type CommandRunRequest,
  type CommandRunResponse,
} from '@migrapilot/protocol';

const OUTPUT_CAP = 24 * 1024;
export const COMMAND_OUTPUT_CAP_BYTES = OUTPUT_CAP;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_ALLOWLIST = ['node', 'npm', 'npx', 'tsc', 'tsx'];

// External-effect subcommands refused regardless of allowlist — these publish,
// deploy, release, or push off-machine (Slice 3A command-write policy).
const DENIED_SUBCOMMANDS = new Set(['publish', 'deploy', 'release', 'push']);
// These variables can substitute the resolved executable or inject native code
// before argv[0] starts, making the displayed executable materially untruthful.
const DENIED_ENVIRONMENT_KEYS = new Set([
  'PATH', 'PATHEXT', 'COMSPEC', 'LD_PRELOAD', 'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH',
]);

// Inherited variables that change how a child TEST RUNNER behaves without changing which
// executable runs. `NODE_TEST_CONTEXT` is the dangerous one: a nested `node --test` sees it,
// logs "run() is being called recursively ... skipping running files", runs NOTHING, and
// still exits 0 — which reads as a passing suite. A test workflow that can report "passed"
// for a suite that never executed is worse than one that fails, so these are stripped from
// the child environment. This removes inherited state; it grants nothing.
const STRIPPED_INHERITED_KEYS = ['NODE_TEST_CONTEXT'] as const;

function assertSafeEnvironment(environment: Record<string, string> | undefined): void {
  const denied = Object.keys(environment ?? {}).find((key) => DENIED_ENVIRONMENT_KEYS.has(key.toUpperCase()));
  if (denied) throw new CommandPolicyError(`environment variable "${denied}" can alter executable resolution and is refused`);
}

/** The child's environment: inherited, minus runner state that would corrupt the result. */
function childEnvironment(
  base: NodeJS.ProcessEnv,
  explicit: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env, ...base, ...(explicit ?? {}) };
  for (const key of STRIPPED_INHERITED_KEYS) delete merged[key];
  return merged;
}

function redactKnownEnvironmentValues(
  text: string,
  environment: Record<string, string> | undefined,
): { value: string; redacted: boolean } {
  let value = text;
  let redacted = false;
  for (const secret of Object.values(environment ?? {})) {
    if (secret.length === 0) continue;
    const variants = new Set([
      secret,
      encodeURIComponent(secret),
      JSON.stringify(secret).slice(1, -1),
      ...(secret.length >= 4 ? [Buffer.from(secret, 'utf8').toString('base64')] : []),
    ]);
    for (const variant of variants) {
      if (!variant || !value.includes(variant)) continue;
      value = value.split(variant).join(MARKERS.secret);
      redacted = true;
    }
  }
  const patternResult = redactCommandOutput(value);
  return { value: patternResult.value, redacted: redacted || patternResult.redacted };
}

export function commandAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.MIGRAPILOT_COMMAND_ALLOWLIST;
  if (!raw) return DEFAULT_ALLOWLIST;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function commandRunEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MIGRAPILOT_COMMAND_RUN !== 'off';
}

export interface CommandRunPreview {
  tool: 'command.run';
  command: string[];
  cwd: string;
  timeoutMs: number;
  shell: false;
  environment: Array<{ key: string; value: string; redacted: boolean }>;
}

/**
 * A refusal by POLICY, not a failure to execute. Exported so a caller can report
 * "refused, and here is why" truthfully instead of collapsing it into a generic
 * internal error — the refusal reason is the useful part.
 */
export class CommandPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandPolicyError';
  }
}

async function containedCwd(rootPath: string, cwd?: string): Promise<string> {
  const realRoot = await realpath(rootPath).catch(() => {
    throw new CommandPolicyError(`rootPath does not exist: ${rootPath}`);
  });
  if (!cwd) return realRoot;
  if (path.isAbsolute(cwd)) throw new CommandPolicyError('cwd must be relative to rootPath');
  const resolved = path.resolve(realRoot, cwd);
  const real = await realpath(resolved).catch(() => {
    throw new CommandPolicyError(`cwd does not exist: ${cwd}`);
  });
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    throw new CommandPolicyError('cwd escapes the workspace root');
  }
  return real;
}

export async function commandRun(
  input: CommandRunRequest,
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
): Promise<CommandRunResponse> {
  const req = CommandRunRequestSchema.parse(input);
  assertSafeEnvironment(req.environment);

  if (!commandRunEnabled(env)) {
    throw new CommandPolicyError('command.run is disabled (MIGRAPILOT_COMMAND_RUN=off)');
  }
  const argv0 = req.command[0]!;
  if (argv0.includes('/') || argv0.includes('\\')) {
    throw new CommandPolicyError('argv[0] must be a bare program name (no paths)');
  }
  const allow = commandAllowlist(env);
  if (!allow.includes(argv0)) {
    throw new CommandPolicyError(`command "${argv0}" is not on the allowlist (${allow.join(', ')})`);
  }
  const denied = req.command.slice(1).find((a) => DENIED_SUBCOMMANDS.has(a.toLowerCase()));
  if (denied) {
    throw new CommandPolicyError(`subcommand "${denied}" is an external-effect action (publish/deploy/release/push) and is refused`);
  }
  const cwd = await containedCwd(req.rootPath, req.cwd);
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const started = Date.now();
  return await new Promise<CommandRunResponse>((resolve, reject) => {
    const child = spawn(argv0, req.command.slice(1), {
      cwd,
      shell: false,
      // Own process GROUP on POSIX. `npm run x` spawns a grandchild; killing only `npm`
      // leaves the grandchild holding the stdout pipe, so `close` never fires and a timeout
      // waits for work it was supposed to stop — a hanging suite would hang forever. The
      // group lets the timeout kill the whole tree. Windows has no process groups, so the
      // kill path falls back to killing the child directly.
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnvironment(env, req.environment),
    });
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const cap = (current: string, chunk: Buffer): string => {
      if (current.length >= OUTPUT_CAP) {
        truncated = true;
        return current;
      }
      const next = current + chunk.toString('utf8');
      if (next.length > OUTPUT_CAP) {
        truncated = true;
        return next.slice(0, OUTPUT_CAP);
      }
      return next;
    };
    child.stdout.on('data', (c: Buffer) => { stdout = cap(stdout, c); });
    child.stderr.on('data', (c: Buffer) => { stderr = cap(stderr, c); });

    /** Kill the whole tree, not just the direct child. */
    const killTree = (): void => {
      if (child.pid !== undefined && process.platform !== 'win32') {
        try {
          process.kill(-child.pid, 'SIGKILL');
          return;
        } catch {
          // The group may already be gone; fall through to the direct kill.
        }
      }
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, timeoutMs);
    const onAbort = (): void => {
      cancelled = true;
      killTree();
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (err) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (settled) return;
      settled = true;
      reject(new CommandPolicyError(`failed to start "${argv0}": ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (settled) return;
      settled = true;
      if (cancelled) {
        const error = new Error('Command execution cancelled.');
        error.name = 'AbortError';
        reject(error);
        return;
      }
      // Secret-aware handling: redact BEFORE the output leaves the tool, so no
      // caller (operator display OR any log/audit) ever sees raw credentials.
      const so = redactKnownEnvironmentValues(stdout, req.environment);
      const se = redactKnownEnvironmentValues(stderr, req.environment);
      resolve({
        tool: 'command.run',
        exitCode: code,
        timedOut,
        stdout: so.value,
        stderr: se.value,
        truncated,
        redacted: so.redacted || se.redacted,
        durationMs: Date.now() - started,
      });
    });
  });
}

/** Validate the exact command policy and return bounded operator-facing consent
 * material without spawning a process. The approval token is bound to the full
 * input hash by the shared executor, so the command cannot change after review. */
export async function previewCommandRun(
  input: CommandRunRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CommandRunPreview> {
  const req = CommandRunRequestSchema.parse(input);
  assertSafeEnvironment(req.environment);
  if (!commandRunEnabled(env)) {
    throw new CommandPolicyError('command.run is disabled (MIGRAPILOT_COMMAND_RUN=off)');
  }
  const argv0 = req.command[0]!;
  if (argv0.includes('/') || argv0.includes('\\')) {
    throw new CommandPolicyError('argv[0] must be a bare program name (no paths)');
  }
  const allow = commandAllowlist(env);
  if (!allow.includes(argv0)) {
    throw new CommandPolicyError(`command "${argv0}" is not on the allowlist (${allow.join(', ')})`);
  }
  const denied = req.command.slice(1).find((arg) => DENIED_SUBCOMMANDS.has(arg.toLowerCase()));
  if (denied) {
    throw new CommandPolicyError(`subcommand "${denied}" is an external-effect action (publish/deploy/release/push) and is refused`);
  }
  await containedCwd(req.rootPath, req.cwd);
  return {
    tool: 'command.run',
    command: req.command.map((arg) => redactCommandOutput(arg).value),
    cwd: req.cwd ?? '.',
    timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    shell: false,
    environment: Object.keys(req.environment ?? {}).map((key) => ({ key, value: '[REDACTED]', redacted: true })),
  };
}
