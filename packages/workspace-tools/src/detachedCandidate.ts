import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function candidateGit(rootPath: string, args: string[]): string {
  return execFileSync('git', ['--no-pager', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], {
    cwd: rootPath,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function assertCandidateBase(rootPath: string, baseCommit?: string): string {
  const top = realpathSync(candidateGit(rootPath, ['rev-parse', '--show-toplevel']));
  if (top !== realpathSync(rootPath)) throw new Error('Candidate requires the exact repository root');
  const head = candidateGit(rootPath, ['rev-parse', 'HEAD']);
  if (baseCommit !== undefined && head !== baseCommit) throw new Error('Original repository HEAD changed during candidate validation');
  if (candidateGit(rootPath, ['status', '--porcelain=v1', '--untracked-files=all'])) {
    throw new Error('Candidate requires an unchanged, clean committed base');
  }
  return head;
}

export interface DetachedCandidateResult<T> {
  baseCommit: string;
  value: T;
}

/** Filesystem isolation for trusted acceptance fixtures, not a code sandbox. */
export async function withDetachedCandidate<T>(
  rootPath: string,
  run: (candidateRoot: string, baseCommit: string) => Promise<T>,
): Promise<DetachedCandidateResult<T>> {
  const baseCommit = assertCandidateBase(rootPath);
  const candidateRoot = mkdtempSync(join(tmpdir(), 'migrapilot-website-candidate-'));
  let attached = false;
  let result: DetachedCandidateResult<T> | undefined;
  let failure: unknown;
  try {
    candidateGit(rootPath, ['worktree', 'add', '--detach', candidateRoot, baseCommit]);
    attached = true;
    assertCandidateBase(rootPath, baseCommit);
    const value = await run(candidateRoot, baseCommit);
    assertCandidateBase(rootPath, baseCommit);
    result = { baseCommit, value };
  } catch (error) {
    failure = error;
  }
  try {
    if (attached) candidateGit(rootPath, ['worktree', 'remove', '--force', candidateRoot]);
    else rmdirSync(candidateRoot);
  } catch (cleanupError) {
    throw new AggregateError(
      failure === undefined ? [cleanupError] : [failure, cleanupError],
      `Candidate cleanup failed; inspect the owned worktree at ${candidateRoot}`,
    );
  }
  if (failure !== undefined) throw failure;
  if (!result) throw new Error('Candidate completed without a result');
  return result;
}
