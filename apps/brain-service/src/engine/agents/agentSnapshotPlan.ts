import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, readlink, symlink, utimes } from 'node:fs/promises';
import path from 'node:path';

/** Bounded governed snapshot planning.
 *
 * Stage 2B recipes must execute against an immutable private snapshot, never the
 * live workspace. The snapshot input is the repository's *Git-governed* material
 * (tracked working-tree files, relevant non-ignored untracked files, and the
 * repository metadata Git needs to compare them), not the physical directory.
 *
 * The physical workspace is not a safe copy unit: a small tracked repository can
 * be surrounded by hundreds of gigabytes of ignored dependencies, caches, model
 * data, generated output and unrelated worktrees. Enumeration therefore runs
 * first and is bounded, so the file-count and byte limits reject an oversized
 * repository *before* any payload is copied. */

export const SNAPSHOT_MAX_FILES = 50_000;
export const SNAPSHOT_MAX_BYTES = 1024 * 1024 * 1024;

/** Enumeration must not outlive the client request; it is a planning step, not a
 * governed recipe execution. */
const ENUMERATION_TIMEOUT_MS = 20_000;
/** Git's own path enumeration output is bounded so a hostile or pathological
 * repository cannot exhaust memory before the file-count limit is applied. */
const ENUMERATION_OUTPUT_CAP_BYTES = 32 * 1024 * 1024;
const ABORT_CHECK_INTERVAL = 64;

/** Repository metadata required to reproduce `git status` and `git diff`.
 * Everything not listed here is excluded, which is what keeps nested repository
 * internals (`modules/`), unrelated worktrees (`worktrees/`), executable content
 * (`hooks/`), and object escapes (`objects/info/alternates`) out of the
 * snapshot. */
const GIT_METADATA_ALLOWLIST: readonly string[] = Object.freeze([
  'HEAD',
  'index',
  'packed-refs',
  'shallow',
  'refs',
  'objects',
  'info/exclude',
]);

const GIT_METADATA_DENYLIST: readonly string[] = Object.freeze([
  'objects/info/alternates',
  'objects/info/http-alternates',
]);

export type GovernedSnapshotEntryKind = 'file' | 'symlink';

export interface GovernedSnapshotEntry {
  /** Workspace-relative path, always contained inside the workspace root. */
  relative: string;
  kind: GovernedSnapshotEntryKind;
  /** Payload bytes this entry will contribute to the snapshot. */
  size: number;
  mode: number;
  mtimeMs: number;
  atimeMs: number;
  /** Symlink target, reproduced verbatim and never dereferenced. */
  linkTarget?: string;
}

export interface GovernedSnapshotPlan {
  entries: GovernedSnapshotEntry[];
  totalFiles: number;
  totalBytes: number;
  trackedFiles: number;
  untrackedFiles: number;
  metadataFiles: number;
  /** Governed material intentionally left out of the snapshot, surfaced to the
   * approver rather than silently dropped. */
  omissions: string[];
}

export class SnapshotPlanError extends Error {
  constructor(readonly reason: 'ENUMERATION_FAILED' | 'LIMIT_EXCEEDED' | 'UNSUPPORTED_ENTRY' | 'CONTAINMENT_VIOLATION' | 'ABORTED', message: string) {
    super(message);
    this.name = 'SnapshotPlanError';
  }
}

export interface SnapshotPlanLimits {
  maxFiles?: number;
  maxBytes?: number;
}

export interface SnapshotPlanOptions extends SnapshotPlanLimits {
  signal?: AbortSignal;
  /** Injection seam for tests; defaults to Git path enumeration. */
  enumerate?: GitPathEnumerator;
}

export interface GitPathEnumerator {
  (workspace: string, signal?: AbortSignal): Promise<{ tracked: string[]; untracked: string[]; nestedRepositories: string[] }>;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new SnapshotPlanError('ABORTED', 'Snapshot planning was aborted before completion.');
}

/** Resolves a Git-reported relative path against the workspace root and proves
 * containment lexically. Git does not emit escaping paths, so a `..` component
 * here means the enumeration cannot be trusted. */
function containedPath(workspace: string, relative: string): string {
  const absolute = path.resolve(workspace, relative);
  const inside = path.relative(workspace, absolute);
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new SnapshotPlanError('CONTAINMENT_VIOLATION', 'Snapshot enumeration produced a path outside the workspace boundary.');
  }
  return absolute;
}

/** Enumerates governed paths using Git's own index and ignore machinery.
 *
 * This runs against the live workspace because that is where the working tree
 * lives and because reimplementing `.gitignore` precedence would risk copying
 * ignored bulk content. It is strictly a read-only planning probe: no hooks, no
 * user or system configuration, no optional index writes, no pager, bounded
 * output and a bounded timeout. The governed recipe itself is never executed
 * here and never uses the live workspace as its cwd. */
export const enumerateGitPaths: GitPathEnumerator = async (workspace, signal) => {
  const [trackedRaw, othersRaw] = await Promise.all([
    runGitEnumeration(workspace, ['ls-files', '-z', '--cached', '--full-name'], signal),
    runGitEnumeration(workspace, ['ls-files', '-z', '--others', '--exclude-standard', '--full-name'], signal),
  ]);
  const tracked = [...new Set(splitNul(trackedRaw))];
  const untracked: string[] = [];
  const nestedRepositories: string[] = [];
  for (const entry of splitNul(othersRaw)) {
    // `--others` does not descend into a nested repository; it reports the
    // directory itself with a trailing separator.
    if (entry.endsWith('/')) nestedRepositories.push(entry);
    else untracked.push(entry);
  }
  return { tracked, untracked: [...new Set(untracked)], nestedRepositories: [...new Set(nestedRepositories)] };
};

function splitNul(raw: string): string[] {
  return raw.split('\0').filter((value) => value.length > 0);
}

function runGitEnumeration(workspace: string, args: string[], signal?: AbortSignal): Promise<string> {
  assertNotAborted(signal);
  return new Promise<string>((resolve, reject) => {
    const child = spawn('git', ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: workspace,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: '/nonexistent',
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
        NO_COLOR: '1',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        GIT_PAGER: 'cat',
        PAGER: 'cat',
      },
    });
    let stdout = '';
    let stderr = '';
    let overflowed = false;
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      action();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new SnapshotPlanError('ENUMERATION_FAILED', 'Git snapshot enumeration exceeded its planning timeout.')));
    }, ENUMERATION_TIMEOUT_MS);
    timer.unref();
    const onAbort = (): void => {
      child.kill('SIGKILL');
      finish(() => reject(new SnapshotPlanError('ABORTED', 'Snapshot planning was aborted by the client.')));
    };
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length + chunk.length > ENUMERATION_OUTPUT_CAP_BYTES) {
        overflowed = true;
        child.kill('SIGKILL');
        return;
      }
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => { if (stderr.length < 8192) stderr += chunk.toString('utf8'); });
    child.once('error', () => finish(() => reject(new SnapshotPlanError('ENUMERATION_FAILED', 'The Git enumeration probe could not start.'))));
    child.once('close', (code) => finish(() => {
      if (overflowed) return reject(new SnapshotPlanError('LIMIT_EXCEEDED', 'The repository exceeds the bounded Stage 2B snapshot limit.'));
      if (code !== 0) return reject(new SnapshotPlanError('ENUMERATION_FAILED', `Git snapshot enumeration failed: ${stderr.trim().slice(0, 200)}`));
      resolve(stdout);
    }));
  });
}

/** Builds the bounded snapshot input manifest. Limits are enforced here, before
 * any payload byte is copied. */
export async function planGovernedSnapshot(workspace: string, options: SnapshotPlanOptions = {}): Promise<GovernedSnapshotPlan> {
  const maxFiles = options.maxFiles ?? SNAPSHOT_MAX_FILES;
  const maxBytes = options.maxBytes ?? SNAPSHOT_MAX_BYTES;
  const enumerate = options.enumerate ?? enumerateGitPaths;
  const { signal } = options;
  assertNotAborted(signal);

  const { tracked, untracked, nestedRepositories } = await enumerate(workspace, signal);
  const entries: GovernedSnapshotEntry[] = [];
  const omissions: string[] = [];
  let totalBytes = 0;
  let inspected = 0;

  const admit = (entry: GovernedSnapshotEntry): void => {
    entries.push(entry);
    totalBytes += entry.size;
    if (entries.length > maxFiles || totalBytes > maxBytes) {
      throw new SnapshotPlanError('LIMIT_EXCEEDED', 'The repository exceeds the bounded Stage 2B snapshot limit.');
    }
  };

  const consider = async (relative: string): Promise<boolean> => {
    if (inspected++ % ABORT_CHECK_INTERVAL === 0) assertNotAborted(signal);
    const absolute = containedPath(workspace, relative);
    const info = await lstat(absolute).catch(() => undefined);
    // A tracked path missing from the working tree is a normal deletion; the
    // copied index still reports it, so Git semantics are preserved.
    if (!info) return false;
    if (info.isSymbolicLink()) {
      // Reproduced verbatim and never dereferenced, so a link pointing outside
      // the workspace copies no external content. Git compares the stored link
      // target itself, so this is also the semantically correct representation.
      const linkTarget = await readlink(absolute);
      admit({ relative, kind: 'symlink', size: Buffer.byteLength(linkTarget, 'utf8'), mode: info.mode & 0o777, mtimeMs: info.mtimeMs, atimeMs: info.atimeMs, linkTarget });
      return true;
    }
    if (info.isFile()) {
      admit({ relative, kind: 'file', size: info.size, mode: info.mode & 0o777, mtimeMs: info.mtimeMs, atimeMs: info.atimeMs });
      return true;
    }
    if (info.isDirectory()) return false;
    throw new SnapshotPlanError('UNSUPPORTED_ENTRY', 'The governed snapshot material contains an unsupported special file.');
  };

  let trackedFiles = 0;
  for (const relative of tracked) if (await consider(relative)) trackedFiles += 1;
  let untrackedFiles = 0;
  for (const relative of untracked) if (await consider(relative)) untrackedFiles += 1;

  const metadataBefore = entries.length;
  await planGitMetadata(workspace, consider, signal);
  const metadataFiles = entries.length - metadataBefore;

  if (nestedRepositories.length > 0) {
    omissions.push(`${nestedRepositories.length} nested repository ${nestedRepositories.length === 1 ? 'directory was' : 'directories were'} excluded from the snapshot; their internals are never copied.`);
  }

  return { entries, totalFiles: entries.length, totalBytes, trackedFiles, untrackedFiles, metadataFiles, omissions };
}

async function planGitMetadata(workspace: string, consider: (relative: string) => Promise<boolean>, signal?: AbortSignal): Promise<void> {
  const gitDir = path.join(workspace, '.git');
  const denied = new Set(GIT_METADATA_DENYLIST.map((entry) => path.join('.git', entry)));
  const walk = async (relative: string): Promise<void> => {
    assertNotAborted(signal);
    if (denied.has(relative)) return;
    const absolute = path.join(workspace, relative);
    const info = await lstat(absolute).catch(() => undefined);
    if (!info) return;
    if (info.isDirectory()) {
      const children = await readdir(absolute, { withFileTypes: true }).catch(() => []);
      children.sort((a, b) => a.name.localeCompare(b.name));
      for (const child of children) await walk(path.join(relative, child.name));
      return;
    }
    await consider(relative);
  };
  for (const allowed of GIT_METADATA_ALLOWLIST) {
    const relative = path.join('.git', allowed);
    if (!path.resolve(workspace, relative).startsWith(`${gitDir}${path.sep}`)) {
      throw new SnapshotPlanError('CONTAINMENT_VIOLATION', 'Git metadata planning escaped the repository metadata boundary.');
    }
    await walk(relative);
  }
}

/** Copies exactly the planned entries into the snapshot root. Bytes are counted
 * as they are written so the byte limit binds actual disk consumption, not only
 * the enumerated estimate. */
export async function materializeGovernedSnapshot(
  workspace: string,
  snapshotRoot: string,
  plan: GovernedSnapshotPlan,
  options: { signal?: AbortSignal; maxBytes?: number } = {},
): Promise<{ copiedFiles: number; copiedBytes: number }> {
  const maxBytes = options.maxBytes ?? SNAPSHOT_MAX_BYTES;
  const { signal } = options;
  assertNotAborted(signal);
  await mkdir(snapshotRoot, { recursive: true, mode: 0o700 });
  const created = new Set<string>();
  let copiedFiles = 0;
  let copiedBytes = 0;
  let index = 0;
  for (const entry of plan.entries) {
    if (index++ % ABORT_CHECK_INTERVAL === 0) assertNotAborted(signal);
    const source = containedPath(workspace, entry.relative);
    const destination = containedPath(snapshotRoot, entry.relative);
    const parent = path.dirname(destination);
    if (!created.has(parent)) {
      await mkdir(parent, { recursive: true, mode: 0o700 });
      created.add(parent);
    }
    if (entry.kind === 'symlink') {
      await symlink(entry.linkTarget ?? '', destination);
      copiedBytes += entry.size;
    } else {
      await copyFile(source, destination, constants.COPYFILE_EXCL);
      // Preserve mtime so the copied index keeps its stat cache meaningful.
      await utimes(destination, entry.atimeMs / 1000, entry.mtimeMs / 1000).catch(() => {});
      const written = await lstat(destination);
      copiedBytes += written.size;
    }
    copiedFiles += 1;
    if (copiedBytes > maxBytes) {
      throw new SnapshotPlanError('LIMIT_EXCEEDED', 'The repository exceeds the bounded Stage 2B snapshot limit.');
    }
  }
  assertNotAborted(signal);
  return { copiedFiles, copiedBytes };
}
