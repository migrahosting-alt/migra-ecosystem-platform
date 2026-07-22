import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  GitStatusRequestSchema,
  type GitStatusRequest,
  type GitStatusResponse,
} from '@migrapilot/protocol';

const execFileAsync = promisify(execFile);

// A large dirty tree can push `git status --short` past Node's 1 MB default
// stdout buffer; raise the ceiling so real repos don't crash.
const GIT_MAX_BUFFER = 64 * 1024 * 1024;


/** Git refuses to touch a repository whose directory owner differs from the
 * caller — routine on Windows drives mounted into WSL, where uid mapping does
 * not match. The raw message is long and the FIX is a single command, so the
 * error names it. Without this the agent saw an opaque failure and flailed. */
export function explainGitError(err: unknown, rootPath: string): Error {
  const raw = err instanceof Error ? err.message : String(err);
  if (/dubious ownership/i.test(raw)) {
    return new Error(
      `git refuses this repository as unsafe (dubious ownership) — common for a repo on a Windows drive under WSL. ` +
        `Fix it once with: git config --global --add safe.directory ${rootPath}`,
    );
  }
  if (/not a git repository/i.test(raw)) {
    return new Error(`"${rootPath}" is not a git repository`);
  }
  return err instanceof Error ? err : new Error(raw);
}

export async function gitStatus(input: GitStatusRequest): Promise<GitStatusResponse> {
  const req = GitStatusRequestSchema.parse(input);

  // Run status FIRST: it is the call that surfaces a real repository problem.
  // Branch used to be wrapped in .catch(() => '') — so a repo git refused
  // reported branch: null, a SILENT WRONG ANSWER rather than an error. On a
  // Windows drive under WSL that happens to every repo until safe.directory is
  // set, and "no branch" is exactly the kind of confident-but-false fact this
  // agent must never produce.
  let statusResult: { stdout: string };
  try {
    statusResult = await execFileAsync('git', ['status', '--short'], { cwd: req.rootPath, maxBuffer: GIT_MAX_BUFFER });
  } catch (err) {
    throw explainGitError(err, req.rootPath);
  }

  let branchResult: { stdout: string };
  try {
    branchResult = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: req.rootPath, maxBuffer: GIT_MAX_BUFFER });
  } catch {
    // Status succeeded, so the repo is fine — this is a repo with no commits
    // yet (unborn HEAD). A null branch is the truthful answer here.
    branchResult = { stdout: '' };
  }

  const files = statusResult.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({
      path: line.slice(3).trim(),
      indexStatus: line[0] ?? ' ',
      worktreeStatus: line[1] ?? ' ',
    }));

  return {
    tool: 'git.status',
    branch: branchResult.stdout.trim() || null,
    files,
  };
}