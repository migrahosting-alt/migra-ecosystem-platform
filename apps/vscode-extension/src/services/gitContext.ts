// Read-ONLY git inspection for the shell's workspace context (§10).
//
// Every command goes through the existing read-only allow-list in
// `commitGen/git.ts` (`status`, `log`, `rev-parse`, `diff`, `ls-files`), so this
// module structurally cannot mutate the repository. It is vscode-free with an
// injected {@link GitRunner} so the porcelain parser is unit-testable.
//
// Absolute paths never leave this module: the repository is reported by folder
// name only, matching the sanitation rule for the rest of the shell.

import { type GitRunner, stagedFiles, unstagedFiles } from '../commitGen/git.js';
import type { GitContextSnapshot } from '../panel/shell/contextPanelModel.js';
import type { WorkingChange } from '../panel/shell/shellState.js';

/**
 * Parse `git status --porcelain=v2 --branch`.
 *
 * One command yields branch, upstream, ahead/behind and the dirty-file count,
 * which keeps the context refresh to a single cheap read.
 */
export function parsePorcelainV2(stdout: string): Omit<GitContextSnapshot, 'repository' | 'latestCommitShort' | 'latestCommitSubject'> {
  const out: Omit<GitContextSnapshot, 'repository' | 'latestCommitShort' | 'latestCommitSubject'> = {};
  let changed = 0;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim();
      // A detached HEAD reports the literal `(detached)`.
      if (head && head !== '(detached)') out.branch = head;
      else out.branch = 'HEAD (detached)';
      continue;
    }
    if (line.startsWith('# branch.upstream ')) {
      out.upstream = line.slice('# branch.upstream '.length).trim();
      continue;
    }
    if (line.startsWith('# branch.ab ')) {
      const match = /\+(\d+)\s+-(\d+)/.exec(line);
      if (match) {
        out.ahead = Number(match[1]);
        out.behind = Number(match[2]);
      }
      continue;
    }
    // Entry lines: 1 = ordinary, 2 = renamed/copied, u = unmerged, ? = untracked.
    if (/^[12u?] /.test(line)) changed += 1;
  }
  out.changedFileCount = changed;
  out.clean = changed === 0;
  return out;
}

/** `<short-sha>\t<subject>` from `git log -1`. */
export function parseLatestCommit(stdout: string): { latestCommitShort?: string; latestCommitSubject?: string } {
  const line = stdout.split(/\r?\n/).find(Boolean);
  if (!line) return {};
  const tab = line.indexOf('\t');
  if (tab < 0) return { latestCommitShort: line.trim() };
  return { latestCommitShort: line.slice(0, tab).trim(), latestCommitSubject: line.slice(tab + 1).trim() };
}

/** Folder name of a path — never the absolute path. */
export function repositoryLabel(root: string): string {
  const normalized = root.replace(/[\\/]+$/, '');
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments.length ? segments[segments.length - 1]! : root;
}

/**
 * Read the workspace's git context. A non-repository or a missing git binary is
 * reported as an explicit `unavailableReason` rather than as a clean tree.
 */
export async function readGitContext(git: GitRunner, root: string, signal?: AbortSignal): Promise<GitContextSnapshot> {
  const repository = repositoryLabel(root);
  try {
    const inside = await git.run(['rev-parse', '--is-inside-work-tree'], signal);
    if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
      return { repository, unavailableReason: 'This folder is not a Git repository.' };
    }
    const [status, log] = await Promise.all([
      git.run(['status', '--porcelain=v2', '--branch'], signal),
      git.run(['log', '-1', '--format=%h%x09%s'], signal),
    ]);
    if (status.code !== 0) {
      return { repository, unavailableReason: 'Git status could not be read for this workspace.' };
    }
    return {
      repository,
      ...parsePorcelainV2(status.stdout),
      // An empty repository has no commits; that is not an error.
      ...(log.code === 0 ? parseLatestCommit(log.stdout) : {}),
    };
  } catch {
    return { repository, unavailableReason: 'Git is unavailable on this machine.' };
  }
}

/** Working-tree changes for the Run Diff tab (staged + unstaged, read-only). */
export async function readWorkingChanges(git: GitRunner, signal?: AbortSignal): Promise<WorkingChange[]> {
  const [staged, unstaged] = await Promise.all([stagedFiles(git, signal), unstagedFiles(git, signal)]);
  const byPath = new Map<string, WorkingChange>();
  for (const file of staged) {
    byPath.set(file.path, { path: file.path, status: file.status, added: file.added, removed: file.removed, binary: file.binary, staged: true });
  }
  for (const file of unstaged) {
    const existing = byPath.get(file.path);
    if (existing) {
      // A file staged AND further modified: sum the deltas, keep it marked staged.
      existing.added += file.added;
      existing.removed += file.removed;
      existing.binary = existing.binary || file.binary;
      continue;
    }
    byPath.set(file.path, { path: file.path, status: file.status, added: file.added, removed: file.removed, binary: file.binary, staged: false });
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}
