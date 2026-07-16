import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  GitDiffRequestSchema,
  type GitDiffRequest,
  type GitDiffResponse,
} from '@migrapilot/protocol';

const execFileAsync = promisify(execFile);

// git diff on a large dirty tree can far exceed Node's 1 MB default stdout
// buffer; raise the ceiling so real repos don't crash with maxBuffer errors.
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

export async function gitDiff(input: GitDiffRequest): Promise<GitDiffResponse> {
  const req = GitDiffRequestSchema.parse(input);
  const args = ['diff'];

  if (req.staged) {
    args.push('--staged');
  }
  if (req.path) {
    args.push('--', req.path);
  }

  const result = await execFileAsync('git', args, {
    cwd: req.rootPath,
    maxBuffer: GIT_MAX_BUFFER,
  });

  return {
    tool: 'git.diff',
    path: req.path ?? null,
    staged: req.staged,
    diff: result.stdout,
  };
}