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

export async function gitStatus(input: GitStatusRequest): Promise<GitStatusResponse> {
  const req = GitStatusRequestSchema.parse(input);

  const branchResult = await execFileAsync(
    'git',
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    { cwd: req.rootPath, maxBuffer: GIT_MAX_BUFFER },
  ).catch(() => ({ stdout: '' }));

  const statusResult = await execFileAsync(
    'git',
    ['status', '--short'],
    { cwd: req.rootPath, maxBuffer: GIT_MAX_BUFFER },
  );

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