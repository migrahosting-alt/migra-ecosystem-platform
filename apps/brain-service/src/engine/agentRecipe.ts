import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, chmod, cp, lstat, mkdir, readFile, readdir, readlink, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentModeCommandResult, AgentModeRecipeId } from '@migrapilot/protocol';
import { redactCommandOutput } from './redaction.js';
import { hashInput } from './toolApprovalStore.js';

export const AGENT_RECIPE_POLICY_VERSION = 'agent-recipes-v2';
export const AGENT_RECIPE_OUTPUT_CAP_BYTES = 24 * 1024;
const SNAPSHOT_MAX_FILES = 50_000;
const SNAPSHOT_MAX_BYTES = 1024 * 1024 * 1024;
const ANSI_ESCAPE = /\x1B(?:[@-_][0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

export interface AgentRecipeIdentity {
  recipe: AgentModeRecipeId;
  policyVersion: typeof AGENT_RECIPE_POLICY_VERSION;
  runId: string;
  activationId: string;
  sourceWorkspace: string;
  sourceWorkspaceIdentity: string;
  snapshotId: string;
  snapshotRoot: string;
  canonicalCwd: string;
  executablePath: string;
  executableDigest: string;
  executableIdentity: string;
  arguments: string[];
  environmentPolicy: 'minimal-git-v2';
  environmentIdentity: string;
  workspaceMaterialIdentity: string;
  containmentPolicy: 'systemd-user-service-v2';
  timeoutMs: number;
  outputLimitBytes: number;
  shell: false;
  mutationClassification: 'read-only';
  canModifyFiles: false;
  networkPolicy: 'not-required';
  expectedEffects: string[];
}

export interface AgentRecipePlan {
  identity: AgentRecipeIdentity;
  environment: NodeJS.ProcessEnv;
  privateRunRoot: string;
}

export interface AgentRecipePrepareContext {
  runId: string;
  activationId: string;
  workspaceIdentity: string;
}

export interface AgentRecipeResolverLike {
  prepare(recipe: AgentModeRecipeId, rootPath: string, context: AgentRecipePrepareContext): Promise<AgentRecipePlan>;
  verify(plan: AgentRecipePlan): Promise<boolean>;
  release(plan: AgentRecipePlan): Promise<void>;
  binding(plan: AgentRecipePlan): string;
}

export interface AgentRecipeProcessManagerLike {
  availability(): Promise<{ ok: true; policy: string } | { ok: false; code: 'UNSUPPORTED_PLATFORM' | 'CONTAINMENT_UNAVAILABLE'; message: string }>;
  activeCount(): number;
  execute(runId: string, plan: AgentRecipePlan, hooks: { onSpawned(): void }, signal?: AbortSignal): Promise<AgentRecipeExecutionOutcome>;
  shutdown(): Promise<void>;
}

export class AgentRecipePolicyError extends Error {
  constructor(readonly code: 'INVALID_WORKSPACE' | 'RECIPE_UNAVAILABLE' | 'STALE' | 'OVERLOADED' | 'START_FAILED' | 'TERMINATION_FAILED' | 'SNAPSHOT_FAILED' | 'UNSUPPORTED_PLATFORM' | 'CONTAINMENT_UNAVAILABLE', message: string) {
    super(message);
    this.name = 'AgentRecipePolicyError';
  }
}

const COMMON_GIT_ARGUMENTS = Object.freeze([
  '-c', 'core.fsmonitor=false',
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'core.attributesFile=/dev/null',
  '-c', 'diff.external=',
  '-c', 'diff.ignoreSubmodules=all',
  '-c', 'status.submoduleSummary=false',
  '-c', 'pager.status=false',
  '-c', 'pager.diff=false',
  '--no-pager',
  '--no-optional-locks',
]);

const RECIPE_ARGUMENTS: Readonly<Record<AgentModeRecipeId, readonly string[]>> = Object.freeze({
  'git.status': Object.freeze([...COMMON_GIT_ARGUMENTS, 'status', '--short', '--branch', '--ignore-submodules=all']),
  'git.diff': Object.freeze([...COMMON_GIT_ARGUMENTS, 'diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', '--']),
});

export class AgentRecipeResolver implements AgentRecipeResolverLike {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly platform = process.platform) {}

  async prepare(recipe: AgentModeRecipeId, rootPath: string, context: AgentRecipePrepareContext): Promise<AgentRecipePlan> {
    if (this.platform !== 'linux') throw new AgentRecipePolicyError('UNSUPPORTED_PLATFORM', 'Stage 2B Agent recipes require Linux systemd containment.');
    const sourceWorkspace = await realpath(rootPath).catch(() => { throw new AgentRecipePolicyError('INVALID_WORKSPACE', 'The workspace root does not exist.'); });
    const sourceStat = await stat(sourceWorkspace);
    if (!sourceStat.isDirectory()) throw new AgentRecipePolicyError('INVALID_WORKSPACE', 'The workspace root is not a directory.');
    const sourceWorkspaceIdentity = directoryIdentity(sourceStat);
    if (sourceWorkspaceIdentity !== context.workspaceIdentity) throw new AgentRecipePolicyError('STALE', 'The activated workspace identity changed.');
    const dotGit = await lstat(path.join(sourceWorkspace, '.git')).catch(() => undefined);
    if (!dotGit?.isDirectory()) throw new AgentRecipePolicyError('INVALID_WORKSPACE', 'Stage 2B requires a standard Git repository with a local .git directory.');

    const runRoot = await import('node:fs/promises').then(({ mkdtemp }) => mkdtemp(path.join(tmpdir(), 'migrapilot-agent-snapshot-')));
    await chmod(runRoot, 0o700);
    const snapshotRoot = path.join(runRoot, 'workspace');
    const binRoot = path.join(runRoot, 'bin');
    const homeRoot = path.join(runRoot, 'home');
    try {
      await mkdir(binRoot, { recursive: true, mode: 0o700 });
      await mkdir(homeRoot, { recursive: true, mode: 0o700 });
      await cp(sourceWorkspace, snapshotRoot, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true, preserveTimestamps: true });
      await hardenGitMetadata(snapshotRoot);
      await assertGitMetadataContained(path.join(snapshotRoot, '.git'));
      const sourceGit = await resolveExecutable('git', this.env, this.platform);
      const executablePath = path.join(binRoot, 'git');
      await cp(sourceGit, executablePath, { force: false, errorOnExist: true });
      await chmod(executablePath, 0o500);
      await makeReadOnly(snapshotRoot);
      const executableStat = await stat(executablePath);
      const executableDigest = await fileDigest(executablePath);
      const workspaceMaterialIdentity = await snapshotManifest(snapshotRoot);
      const snapshotId = hashInput({ workspaceMaterialIdentity, executableDigest, sourceWorkspaceIdentity, runId: context.runId });
      const environment = minimalGitEnvironment(binRoot, homeRoot, this.env);
      const identity: AgentRecipeIdentity = {
        recipe,
        policyVersion: AGENT_RECIPE_POLICY_VERSION,
        runId: context.runId,
        activationId: context.activationId,
        sourceWorkspace,
        sourceWorkspaceIdentity,
        snapshotId,
        snapshotRoot,
        canonicalCwd: snapshotRoot,
        executablePath,
        executableDigest,
        executableIdentity: fileIdentity(executableStat),
        arguments: [...RECIPE_ARGUMENTS[recipe]],
        environmentPolicy: 'minimal-git-v2',
        environmentIdentity: hashInput(environment),
        workspaceMaterialIdentity,
        containmentPolicy: 'systemd-user-service-v2',
        timeoutMs: 30_000,
        outputLimitBytes: AGENT_RECIPE_OUTPUT_CAP_BYTES,
        shell: false,
        mutationClassification: 'read-only',
        canModifyFiles: false,
        networkPolicy: 'not-required',
        expectedEffects: [
          'Reads a private snapshot of the selected Git workspace; the live workspace is not used as the execution cwd.',
          'Repository and user Git helpers, hooks, pagers, external diff, text conversion, and filesystem monitors are disabled.',
          'Execution requires an OS-owned systemd cgroup and fails closed when containment is unavailable.',
        ],
      };
      return { identity, environment, privateRunRoot: runRoot };
    } catch (error) {
      await rm(runRoot, { recursive: true, force: true }).catch(() => {});
      if (error instanceof AgentRecipePolicyError) throw error;
      throw new AgentRecipePolicyError('SNAPSHOT_FAILED', 'The immutable Agent execution snapshot could not be created.');
    }
  }

  async verify(plan: AgentRecipePlan): Promise<boolean> {
    try {
      const sourceStat = await stat(plan.identity.sourceWorkspace);
      if (directoryIdentity(sourceStat) !== plan.identity.sourceWorkspaceIdentity) return false;
      const executableStat = await stat(plan.identity.executablePath);
      if (fileIdentity(executableStat) !== plan.identity.executableIdentity) return false;
      if (await fileDigest(plan.identity.executablePath) !== plan.identity.executableDigest) return false;
      if (await snapshotManifest(plan.identity.snapshotRoot) !== plan.identity.workspaceMaterialIdentity) return false;
      return hashInput(plan.environment) === plan.identity.environmentIdentity;
    } catch {
      return false;
    }
  }

  async release(plan: AgentRecipePlan): Promise<void> {
    await makeWritable(plan.privateRunRoot).catch(() => {});
    await rm(plan.privateRunRoot, { recursive: true, force: true });
  }

  binding(plan: AgentRecipePlan): string { return hashInput(plan.identity); }
}

interface ActiveContainment {
  unit: string;
  launcher: ChildProcess;
  termination?: Promise<boolean>;
  requestTermination?: (cause: 'cancel' | 'timeout' | 'shutdown') => Promise<void>;
}

export interface AgentRecipeExecutionOutcome {
  result: AgentModeCommandResult;
  disposition: 'completed' | 'cancelled' | 'timed_out' | 'shutdown';
}

interface CaptureResult { code: number | null; stdout: string; stderr: string }
export interface SystemdControlAdapter {
  capture(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<CaptureResult>;
  readCgroup(pathname: string): Promise<string>;
  delay(ms: number): Promise<void>;
}

const DEFAULT_SYSTEMD_CONTROL: SystemdControlAdapter = {
  capture,
  readCgroup: (pathname) => readFile(pathname, 'utf8'),
  delay,
};

/** Controls the OS-owned containment unit. Completion is based on the cgroup's
 * membership, never on the recipe leader PID, so setsid/detach does not escape
 * cancellation accounting. */
export class SystemdContainmentController {
  constructor(private readonly adapter: SystemdControlAdapter = DEFAULT_SYSTEMD_CONTROL) {}

  async waitForAcquisition(unit: string): Promise<boolean> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const shown = await this.adapter.capture('/usr/bin/systemctl', ['--user', 'show', '--property=LoadState,ExecMainStartTimestampMonotonic', unit], systemdClientEnvironment(process.env), 2_000).catch(() => undefined);
      if (shown?.code === 0) {
        const values = parseSystemdProperties(shown.stdout);
        if (values.LoadState === 'loaded' && Number(values.ExecMainStartTimestampMonotonic) > 0) return true;
      }
      await this.adapter.delay(10);
    }
    return false;
  }

  async terminateUnit(unit: string): Promise<boolean> {
    await this.adapter.capture('/usr/bin/systemctl', ['--user', 'kill', '--kill-who=all', '--signal=SIGTERM', unit], systemdClientEnvironment(process.env), 2_000).catch(() => undefined);
    await this.adapter.delay(250);
    if (await this.unitEmpty(unit)) return true;
    await this.adapter.capture('/usr/bin/systemctl', ['--user', 'kill', '--kill-who=all', '--signal=SIGKILL', unit], systemdClientEnvironment(process.env), 2_000).catch(() => undefined);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await this.unitEmpty(unit)) return true;
      await this.adapter.delay(50);
    }
    return false;
  }

  async unitEmpty(unit: string): Promise<boolean> {
    const shown = await this.adapter.capture('/usr/bin/systemctl', ['--user', 'show', '--property=LoadState,ActiveState,ControlGroup', unit], systemdClientEnvironment(process.env), 2_000).catch(() => undefined);
    if (!shown || shown.code !== 0) return false;
    const values = parseSystemdProperties(shown.stdout);
    if (values.LoadState === 'not-found') return true;
    const cgroup = values.ControlGroup;
    if (!cgroup) return true;
    try {
      return (await this.adapter.readCgroup(path.join('/sys/fs/cgroup', cgroup, 'cgroup.procs'))).trim().length === 0;
    } catch (error) {
      const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
      return missing && (values.ActiveState === 'inactive' || values.ActiveState === 'failed');
    }
  }
}

/** Linux Stage 2B containment. No PID/process-group fallback exists. Other
 * platforms and Linux hosts without an active user systemd manager fail closed. */
export class AgentRecipeProcessManager implements AgentRecipeProcessManagerLike {
  private readonly active = new Map<string, ActiveContainment>();
  constructor(private readonly platform = process.platform, private readonly maxConcurrent = 1, private readonly containment = new SystemdContainmentController()) {}

  activeCount(): number { return this.active.size; }

  async availability(): Promise<{ ok: true; policy: string } | { ok: false; code: 'UNSUPPORTED_PLATFORM' | 'CONTAINMENT_UNAVAILABLE'; message: string }> {
    if (this.platform !== 'linux') return { ok: false, code: 'UNSUPPORTED_PLATFORM', message: 'Strong Agent containment is not implemented on this platform.' };
    try {
      await access('/usr/bin/systemd-run', constants.X_OK);
      await access('/usr/bin/systemctl', constants.X_OK);
      const probe = await capture('/usr/bin/systemctl', ['--user', 'is-system-running'], process.env, 2_000);
      const state = `${probe.stdout}${probe.stderr}`.trim();
      if (probe.code === 0 || state === 'running' || state === 'degraded') return { ok: true, policy: 'systemd-user-service-v2' };
    } catch { /* fail closed below */ }
    return { ok: false, code: 'CONTAINMENT_UNAVAILABLE', message: 'A delegated user systemd/cgroup containment manager is unavailable.' };
  }

  async execute(runId: string, plan: AgentRecipePlan, hooks: { onSpawned(): void }, signal?: AbortSignal): Promise<AgentRecipeExecutionOutcome> {
    if (this.active.size >= this.maxConcurrent) throw new AgentRecipePolicyError('OVERLOADED', 'The Agent execution containment limit is reached.');
    const available = await this.availability();
    if (!available.ok) throw new AgentRecipePolicyError(available.code, available.message);
    const unit = `migrapilot-agent-${runId.replace(/[^a-zA-Z0-9_-]/g, '').slice(-48)}.service`;
    const properties = [
      'Type=exec',
      'KillMode=control-group',
      'TimeoutStopSec=1s',
      'NoNewPrivileges=yes',
      'PrivateDevices=yes',
      'PrivateNetwork=yes',
      'ProtectSystem=strict',
      'ProtectHome=yes',
      'RestrictSUIDSGID=yes',
      'LockPersonality=yes',
      `ReadOnlyPaths=${plan.privateRunRoot}`,
      `WorkingDirectory=${plan.identity.canonicalCwd}`,
    ];
    const serviceEnvironment = Object.entries(plan.environment).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
    const args = [
      '--user', '--quiet', '--wait', '--pipe', `--unit=${unit}`,
      ...properties.map((property) => `--property=${property}`),
      ...serviceEnvironment.map(([key, value]) => `--setenv=${key}=${value}`),
      '--', plan.identity.executablePath, ...plan.identity.arguments,
    ];
    const started = Date.now();
    const launcher = spawn('/usr/bin/systemd-run', args, { cwd: '/', shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: systemdClientEnvironment(process.env) });
    const active: ActiveContainment = { unit, launcher };
    this.active.set(runId, active);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    launcher.stdout?.on('data', (chunk: Buffer) => collectBounded(stdout, chunk, plan.identity.outputLimitBytes));
    launcher.stderr?.on('data', (chunk: Buffer) => collectBounded(stderr, chunk, plan.identity.outputLimitBytes));
    let timedOut = false;
    let cancelled = false;
    let shutdown = false;
    let terminationFailed = false;
    let rejectTermination!: (error: Error) => void;
    const terminationFailure = new Promise<never>((_resolve, reject) => { rejectTermination = reject; });
    const terminate = async (cause: 'cancel' | 'timeout' | 'shutdown'): Promise<void> => {
      if (cause === 'cancel') cancelled = true;
      if (cause === 'timeout') timedOut = true;
      if (cause === 'shutdown') shutdown = true;
      active.termination ??= this.containment.terminateUnit(unit);
      if (!(await active.termination)) {
        terminationFailed = true;
        rejectTermination(new AgentRecipePolicyError('TERMINATION_FAILED', 'The systemd containment unit could not be confirmed empty.'));
      }
    };
    active.requestTermination = terminate;
    const timer = setTimeout(() => { void terminate('timeout'); }, plan.identity.timeoutMs);
    timer.unref();
    const onAbort = (): void => { void terminate('cancel'); };
    if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        launcher.once('spawn', () => {
          void this.containment.waitForAcquisition(unit).then((acquired) => {
            if (!acquired) throw new AgentRecipePolicyError('START_FAILED', 'The systemd service did not acquire the recipe process.');
            hooks.onSpawned();
            resolve();
          }).catch((error) => { void terminate('cancel'); reject(error); });
        });
        launcher.once('error', (error) => reject(new AgentRecipePolicyError('START_FAILED', `The systemd containment launcher could not start: ${error.message}`)));
      });
      const exitCode = await Promise.race([
        new Promise<number | null>((resolve, reject) => {
          launcher.once('error', (error) => reject(new AgentRecipePolicyError('START_FAILED', `The contained recipe could not start: ${error.message}`)));
          launcher.once('close', (code) => resolve(code));
        }),
        terminationFailure,
      ]);
      if (active.termination) await active.termination;
      if (terminationFailed) throw new AgentRecipePolicyError('TERMINATION_FAILED', 'The systemd containment unit could not be confirmed empty.');
      if (!(await this.containment.unitEmpty(unit))) throw new AgentRecipePolicyError('TERMINATION_FAILED', 'The systemd containment unit retained descendant processes.');
      const out = sanitizeAgentRecipeOutput(Buffer.concat(stdout).toString('utf8'), plan.identity.outputLimitBytes);
      const err = sanitizeAgentRecipeOutput(Buffer.concat(stderr).toString('utf8'), plan.identity.outputLimitBytes);
      return {
        disposition: timedOut ? 'timed_out' : shutdown ? 'shutdown' : cancelled ? 'cancelled' : 'completed',
        result: { recipe: plan.identity.recipe, exitCode, timedOut, stdout: out.value, stderr: err.value, truncated: out.truncated || err.truncated, redacted: out.redacted || err.redacted, durationMs: Date.now() - started },
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      this.active.delete(runId);
      void capture('/usr/bin/systemctl', ['--user', 'reset-failed', unit], systemdClientEnvironment(process.env), 2_000).catch(() => undefined);
    }
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([...this.active.values()].map(async (entry) => {
      if (entry.requestTermination) return entry.requestTermination('shutdown');
      entry.termination ??= this.containment.terminateUnit(entry.unit);
      await entry.termination;
    }));
  }

}

async function resolveExecutable(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<string> {
  const pathValue = env.PATH ?? env.Path ?? '';
  const extensions = platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean) : [''];
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) for (const extension of extensions) {
    const candidate = path.join(directory, platform === 'win32' ? `${name}${extension}` : name);
    try { await access(candidate, constants.X_OK); return await realpath(candidate); } catch { /* continue */ }
  }
  throw new AgentRecipePolicyError('RECIPE_UNAVAILABLE', `The trusted ${name} executable is unavailable.`);
}

function minimalGitEnvironment(binRoot: string, homeRoot: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    PATH: binRoot,
    HOME: homeRoot,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    NO_COLOR: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    PAGER: 'cat',
    ...(env.XDG_RUNTIME_DIR ? { XDG_RUNTIME_DIR: env.XDG_RUNTIME_DIR } : {}),
    ...(env.DBUS_SESSION_BUS_ADDRESS ? { DBUS_SESSION_BUS_ADDRESS: env.DBUS_SESSION_BUS_ADDRESS } : {}),
  };
}

function systemdClientEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    PATH: '/usr/bin:/bin',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    ...(env.XDG_RUNTIME_DIR ? { XDG_RUNTIME_DIR: env.XDG_RUNTIME_DIR } : {}),
    ...(env.DBUS_SESSION_BUS_ADDRESS ? { DBUS_SESSION_BUS_ADDRESS: env.DBUS_SESSION_BUS_ADDRESS } : {}),
  };
}

function parseSystemdProperties(output: string): Record<string, string> {
  return Object.fromEntries(output.trim().split('\n').filter(Boolean).map((line) => {
    const separator = line.indexOf('=');
    return separator < 0 ? [line, ''] : [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

async function hardenGitMetadata(snapshotRoot: string): Promise<void> {
  const gitDir = path.join(snapshotRoot, '.git');
  await rm(path.join(gitDir, 'hooks'), { recursive: true, force: true });
  await rm(path.join(gitDir, 'config.worktree'), { force: true });
  await rm(path.join(gitDir, 'objects', 'info', 'alternates'), { force: true });
  await rm(path.join(gitDir, 'objects', 'info', 'http-alternates'), { force: true });
  await writeFile(path.join(gitDir, 'config'), '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n\tfsmonitor = false\n\thooksPath = /dev/null\n', { encoding: 'utf8', mode: 0o400 });
}

async function assertGitMetadataContained(gitDir: string): Promise<void> {
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      const info = await lstat(target);
      if (info.isSymbolicLink()) throw new AgentRecipePolicyError('SNAPSHOT_FAILED', 'Git metadata contains a symlink outside the immutable snapshot boundary.');
      if (info.isDirectory()) await walk(target);
      else if (!info.isFile()) throw new AgentRecipePolicyError('SNAPSHOT_FAILED', 'Git metadata contains an unsupported special file.');
    }
  }
  await walk(gitDir);
}

async function snapshotManifest(root: string): Promise<string> {
  const entries: string[] = [];
  let files = 0;
  let bytes = 0;
  async function walk(directory: string): Promise<void> {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const relative = path.relative(root, absolute);
      const info = await lstat(absolute);
      files += 1;
      bytes += info.size;
      if (files > SNAPSHOT_MAX_FILES || bytes > SNAPSHOT_MAX_BYTES) throw new AgentRecipePolicyError('SNAPSHOT_FAILED', 'The repository exceeds the bounded Stage 2B snapshot limit.');
      if (info.isDirectory()) { entries.push(`d\0${relative}\0${info.mode & 0o777}`); await walk(absolute); }
      else if (info.isSymbolicLink()) entries.push(`l\0${relative}\0${await readlink(absolute)}`);
      else if (info.isFile()) entries.push(`f\0${relative}\0${info.mode & 0o777}\0${info.size}\0${await fileDigest(absolute)}`);
      else throw new AgentRecipePolicyError('SNAPSHOT_FAILED', 'The repository contains an unsupported special file.');
    }
  }
  await walk(root);
  return createHash('sha256').update(entries.join('\n')).digest('hex');
}

async function makeReadOnly(root: string): Promise<void> {
  const info = await lstat(root);
  if (info.isDirectory()) {
    for (const entry of await readdir(root)) await makeReadOnly(path.join(root, entry));
    await chmod(root, 0o500);
  } else if (info.isFile()) await chmod(root, 0o400);
}

async function makeWritable(root: string): Promise<void> {
  const info = await lstat(root).catch(() => undefined);
  if (!info) return;
  if (info.isDirectory()) {
    await chmod(root, 0o700).catch(() => {});
    for (const entry of await readdir(root).catch(() => [])) await makeWritable(path.join(root, entry));
  } else if (info.isFile()) await chmod(root, 0o600).catch(() => {});
}

function collectBounded(target: Buffer[], chunk: Buffer, cap: number): void {
  const held = target.reduce((sum, item) => sum + item.length, 0);
  const remaining = Math.max(0, cap + 8192 - held);
  if (remaining > 0) target.push(chunk.subarray(0, remaining));
}

export function sanitizeAgentRecipeOutput(raw: string, cap: number): { value: string; redacted: boolean; truncated: boolean } {
  const withoutAnsi = raw.replace(ANSI_ESCAPE, '');
  const scrubbed = redactCommandOutput(withoutAnsi);
  const bytes = Buffer.from(scrubbed.value, 'utf8');
  if (bytes.length <= cap) return { value: scrubbed.value, redacted: scrubbed.redacted || withoutAnsi !== raw, truncated: false };
  return { value: bytes.subarray(0, cap).toString('utf8'), redacted: scrubbed.redacted || withoutAnsi !== raw, truncated: true };
}

async function fileDigest(file: string): Promise<string> { return createHash('sha256').update(await readFile(file)).digest('hex'); }
function fileIdentity(value: { dev: number | bigint; ino: number | bigint; size: number; mtimeMs: number; ctimeMs: number }): string { return `${value.dev}:${value.ino}:${value.size}:${value.mtimeMs}:${value.ctimeMs}`; }
function directoryIdentity(value: { dev: number | bigint; ino: number | bigint; birthtimeMs: number; ctimeMs: number }): string { return `${value.dev}:${value.ino}:${value.birthtimeMs}:${value.ctimeMs}`; }
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function capture(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], env });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
    timer.unref();
    child.once('error', reject);
    child.once('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
