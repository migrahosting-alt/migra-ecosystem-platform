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
import {
  CommandRunRequestSchema,
  type CommandRunRequest,
  type CommandRunResponse,
} from '@migrapilot/protocol';

const OUTPUT_CAP = 24 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_ALLOWLIST = ['node', 'npm', 'npx', 'tsc', 'tsx'];

export function commandAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.MIGRAPILOT_COMMAND_ALLOWLIST;
  if (!raw) return DEFAULT_ALLOWLIST;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function commandRunEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MIGRAPILOT_COMMAND_RUN !== 'off';
}

class CommandPolicyError extends Error {
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
): Promise<CommandRunResponse> {
  const req = CommandRunRequestSchema.parse(input);

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
  const cwd = await containedCwd(req.rootPath, req.cwd);
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const started = Date.now();
  return await new Promise<CommandRunResponse>((resolve, reject) => {
    const child = spawn(argv0, req.command.slice(1), { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;

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

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new CommandPolicyError(`failed to start "${argv0}": ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        tool: 'command.run',
        exitCode: code,
        timedOut,
        stdout,
        stderr,
        truncated,
        durationMs: Date.now() - started,
      });
    });
  });
}
