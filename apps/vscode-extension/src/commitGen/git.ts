// Read-ONLY git analysis for commit-message generation. Every command here is a
// read command (status/diff/log/numstat); this module never stages, commits,
// amends, or otherwise mutates the repository. vscode-free with an injected
// GitRunner so it is fully unit-testable.

export interface GitResult {
  stdout: string;
  code: number;
}

export interface GitRunner {
  run(args: string[], signal?: AbortSignal): Promise<GitResult>;
}

// Read-only allow-list. The runner refuses anything not on it, as defense in
// depth against a mutating command ever being constructed.
const READ_ONLY_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'rev-parse', 'ls-files']);

export function assertReadOnly(args: string[]): void {
  const sub = args[0];
  if (!sub || !READ_ONLY_SUBCOMMANDS.has(sub)) {
    throw new Error(`git subcommand not allowed in read-only analysis: ${sub ?? '(none)'}`);
  }
}

export interface ChangedFile {
  path: string;
  status: string; // A, M, D, R, etc.
  added: number;
  removed: number;
  binary: boolean;
}

async function nameStatus(git: GitRunner, staged: boolean, signal?: AbortSignal): Promise<Array<{ path: string; status: string }>> {
  const args = ['diff', ...(staged ? ['--cached'] : []), '--name-status'];
  const res = await git.run(args, signal);
  return res.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      const status = parts[0] ?? '';
      const path = parts[parts.length - 1] ?? '';
      return { path, status: status[0] ?? status };
    });
}

async function numstat(git: GitRunner, staged: boolean, signal?: AbortSignal): Promise<Map<string, { added: number; removed: number; binary: boolean }>> {
  const args = ['diff', ...(staged ? ['--cached'] : []), '--numstat'];
  const res = await git.run(args, signal);
  const map = new Map<string, { added: number; removed: number; binary: boolean }>();
  for (const line of res.stdout.split(/\r?\n/).filter(Boolean)) {
    const parts = line.split('\t');
    const a = parts[0];
    const r = parts[1];
    const path = parts[parts.length - 1] ?? '';
    const binary = a === '-' || r === '-';
    map.set(path, { added: binary ? 0 : Number(a) || 0, removed: binary ? 0 : Number(r) || 0, binary });
  }
  return map;
}

async function changedFiles(git: GitRunner, staged: boolean, signal?: AbortSignal): Promise<ChangedFile[]> {
  const [names, stats] = await Promise.all([nameStatus(git, staged, signal), numstat(git, staged, signal)]);
  return names.map((n) => {
    const s = stats.get(n.path) ?? { added: 0, removed: 0, binary: false };
    return { path: n.path, status: n.status, added: s.added, removed: s.removed, binary: s.binary };
  });
}

export function stagedFiles(git: GitRunner, signal?: AbortSignal): Promise<ChangedFile[]> {
  return changedFiles(git, true, signal);
}

export function unstagedFiles(git: GitRunner, signal?: AbortSignal): Promise<ChangedFile[]> {
  return changedFiles(git, false, signal);
}

/** Diff text for a single file (read-only). */
export async function fileDiff(git: GitRunner, staged: boolean, path: string, signal?: AbortSignal): Promise<string> {
  const args = ['diff', ...(staged ? ['--cached'] : []), '--', path];
  const res = await git.run(args, signal);
  return res.stdout;
}

/** Recent commit subjects, for conservative convention detection. */
export async function recentSubjects(git: GitRunner, n = 20, signal?: AbortSignal): Promise<string[]> {
  const res = await git.run(['log', `-n`, String(n), '--format=%s'], signal);
  return res.stdout.split(/\r?\n/).filter(Boolean);
}
