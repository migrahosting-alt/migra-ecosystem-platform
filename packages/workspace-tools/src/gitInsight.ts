// Read-only Git visibility — overview, bounded history, blame.
//
// WHY THIS IS NOT `command.run`
// -----------------------------
// The ad-hoc command lane deliberately does NOT allowlist `git`, and this does not change
// that. Those are different questions:
//
//   command.run          "run this program and show me the output"  — argv from a person
//   git.overview/history "answer this specific question about the repo" — argv from HERE
//
// Every git invocation below is built from a fixed argv array in this file. No request field
// becomes a subcommand or a flag, so there is no shape of input that turns a read into a
// mutation, and no need to maintain a denylist of dangerous git verbs. The three subcommands
// used — `status`, `rev-parse`, `log`, `blame`, `diff --numstat`, `rev-list` — are all
// read-only, and a request cannot reach any other.
//
// `--` precedes every user-supplied path so a path can never be read as an option, and paths
// are contained inside the workspace root before they are used at all.
//
// `git.status` and `git.diff` are untouched by this module. Their behaviour is relied upon
// elsewhere and this adds capabilities beside them rather than reshaping them.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { containedPath, nodeWorkspaceFs } from '@migrapilot/workspace-tools';
import {
  GitBlameRequestSchema,
  GitHistoryRequestSchema,
  GitOverviewRequestSchema,
  type GitBlameRequest,
  type GitBlameResponse,
  type GitHistoryRequest,
  type GitHistoryResponse,
  type GitOverviewRequest,
  type GitOverviewResponse,
} from '@migrapilot/protocol';
import { explainGitError } from './gitStatus.js';

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
/** Blame on a very large file is unbounded work and unbounded output. */
const MAX_BLAME_LINES = 2000;

/** A record separator that cannot occur in a subject line. */
const REC = '\u001e';
const FIELD = '\u001f';

async function git(rootPath: string, args: readonly string[]): Promise<string> {
  try {
    const result = await execFileAsync('git', [...args], { cwd: rootPath, maxBuffer: GIT_MAX_BUFFER });
    return result.stdout;
  } catch (err) {
    throw explainGitError(err, rootPath);
  }
}

/** Same call, but an expected-empty failure (unborn HEAD, no upstream) is not an error. */
async function gitOrNull(rootPath: string, args: readonly string[]): Promise<string | null> {
  try {
    const result = await execFileAsync('git', [...args], { cwd: rootPath, maxBuffer: GIT_MAX_BUFFER });
    return result.stdout;
  } catch {
    return null;
  }
}

/** Contain a caller-supplied path inside the workspace, then return it workspace-relative. */
function containedRelative(rootPath: string, relative: string): string {
  // Throws WorkspaceToolError('PATH_ESCAPE' | 'ABSOLUTE_PATH') — the same chokepoint the
  // changeset engine uses, so containment behaves identically across every lane.
  containedPath(rootPath, relative, nodeWorkspaceFs());
  return relative;
}

function sumNumstat(raw: string | null): { files: number; insertions: number; deletions: number } {
  if (raw === null) return { files: 0, insertions: 0, deletions: 0 };
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [added, removed] = line.split('\t');
    files += 1;
    // A binary file reports "-" for both counts; it contributes a file, not lines.
    insertions += Number.parseInt(added ?? '', 10) || 0;
    deletions += Number.parseInt(removed ?? '', 10) || 0;
  }
  return { files, insertions, deletions };
}

export async function gitOverview(input: GitOverviewRequest): Promise<GitOverviewResponse> {
  const req = GitOverviewRequestSchema.parse(input);

  // Status first: it is the call that surfaces a real repository problem, so a repo git
  // refuses fails loudly instead of reporting a confident-but-empty overview.
  // `--untracked-files=all`, NOT `normal`. `normal` collapses an untracked DIRECTORY into a
  // single entry, so a field named `untracked` would report 14 on a tree with 30 untracked
  // files — a confident wrong number. Measured on a real 562-commit repo, `all` costs the
  // same (0.01s vs 0.02s), so the truthful count is also the cheap one.
  const status = await git(req.rootPath, ['status', '--porcelain=v1', '--untracked-files=all']);

  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let conflicted = 0;
  for (const line of status.split(/\r?\n/)) {
    if (!line) continue;
    const index = line[0] ?? ' ';
    const worktree = line[1] ?? ' ';
    if (index === '?' && worktree === '?') {
      untracked += 1;
      continue;
    }
    // Both sides marked, or either side U, is a conflict — not "staged and unstaged".
    if (index === 'U' || worktree === 'U' || (index === 'A' && worktree === 'A') || (index === 'D' && worktree === 'D')) {
      conflicted += 1;
      continue;
    }
    if (index !== ' ') staged += 1;
    if (worktree !== ' ') unstaged += 1;
  }

  const headSha = (await gitOrNull(req.rootPath, ['rev-parse', 'HEAD']))?.trim() || null;
  // `symbolic-ref` rather than `rev-parse --abbrev-ref`: it still names the branch in a
  // repository with NO COMMITS YET (git itself says "On branch main" there, so reporting
  // null would be less true than git), and it fails exactly when HEAD is detached — which
  // makes the detached check an observation rather than a string comparison against 'HEAD'.
  const branchRaw = (await gitOrNull(req.rootPath, ['symbolic-ref', '--short', 'HEAD']))?.trim() || null;
  const detached = branchRaw === null && headSha !== null;

  let ahead: number | null = null;
  let behind: number | null = null;
  const counts = await gitOrNull(req.rootPath, ['rev-list', '--left-right', '--count', '@{u}...HEAD']);
  if (counts !== null) {
    const [b, a] = counts.trim().split(/\s+/);
    behind = Number.parseInt(b ?? '', 10);
    ahead = Number.parseInt(a ?? '', 10);
    if (Number.isNaN(behind)) behind = null;
    if (Number.isNaN(ahead)) ahead = null;
  }

  const stagedStat = sumNumstat(await gitOrNull(req.rootPath, ['diff', '--numstat', '--cached']));
  const unstagedStat = sumNumstat(await gitOrNull(req.rootPath, ['diff', '--numstat']));

  return {
    tool: 'git.overview',
    branch: branchRaw,
    head: headSha,
    headShort: headSha === null ? null : headSha.slice(0, 7),
    detached,
    ahead,
    behind,
    counts: { staged, unstaged, untracked, conflicted },
    diffSummary: {
      stagedFiles: stagedStat.files,
      stagedInsertions: stagedStat.insertions,
      stagedDeletions: stagedStat.deletions,
      unstagedFiles: unstagedStat.files,
      unstagedInsertions: unstagedStat.insertions,
      unstagedDeletions: unstagedStat.deletions,
    },
  };
}

export async function gitHistory(input: GitHistoryRequest): Promise<GitHistoryResponse> {
  const req = GitHistoryRequestSchema.parse(input);
  const relative = req.path === undefined ? undefined : containedRelative(req.rootPath, req.path);

  const format = ['%H', '%h', '%an', '%aI', '%s'].join(FIELD) + REC;
  // limit + 1 so `truncated` is observed rather than guessed.
  const args = ['log', `--max-count=${req.limit + 1}`, `--format=${format}`];
  if (relative !== undefined) args.push('--', relative);

  const raw = await gitOrNull(req.rootPath, args);
  const head = (await gitOrNull(req.rootPath, ['rev-parse', 'HEAD']))?.trim() || null;
  const branchRaw = (await gitOrNull(req.rootPath, ['symbolic-ref', '--short', 'HEAD']))?.trim() || null;

  const records = (raw ?? '')
    .split(REC)
    .map((r) => r.replace(/^\r?\n/, ''))
    .filter((r) => r.trim().length > 0);

  const truncated = records.length > req.limit;
  const commits = records.slice(0, req.limit).map((record) => {
    const [sha, shortSha, author, authoredAt, subject] = record.split(FIELD);
    return {
      sha: sha ?? '',
      shortSha: shortSha ?? '',
      author: author ?? '',
      authoredAt: authoredAt ?? '',
      subject: subject ?? '',
    };
  });

  return {
    tool: 'git.history',
    head,
    branch: branchRaw,
    commits,
    truncated,
  };
}

export async function gitBlame(input: GitBlameRequest): Promise<GitBlameResponse> {
  const req = GitBlameRequestSchema.parse(input);
  const relative = containedRelative(req.rootPath, req.path);

  const args = ['blame', '--line-porcelain'];
  if (req.startLine !== undefined) {
    const end = req.endLine ?? req.startLine;
    if (end < req.startLine) throw new Error('endLine must not be before startLine');
    args.push('-L', `${req.startLine},${end}`);
  }
  args.push('--', relative);

  const raw = await git(req.rootPath, args);

  const lines: GitBlameResponse['lines'] = [];
  let current: { sha?: string; line?: number; author?: string; authoredAt?: string } = {};
  let truncated = false;
  for (const text of raw.split(/\r?\n/)) {
    const header = /^([0-9a-f]{40})\s+\d+\s+(\d+)/.exec(text);
    if (header) {
      current = { sha: header[1] as string, line: Number.parseInt(header[2] as string, 10) };
      continue;
    }
    if (text.startsWith('author ')) current.author = text.slice(7);
    else if (text.startsWith('author-time ')) {
      const seconds = Number.parseInt(text.slice(12), 10);
      current.authoredAt = Number.isNaN(seconds) ? '' : new Date(seconds * 1000).toISOString();
    } else if (text.startsWith('\t')) {
      // The tab-prefixed line closes a record. Content itself is NOT returned: the caller
      // already has the file, and echoing it back doubles the payload for no information.
      if (current.sha !== undefined && current.line !== undefined) {
        if (lines.length >= MAX_BLAME_LINES) {
          truncated = true;
          break;
        }
        lines.push({
          line: current.line,
          sha: current.sha,
          shortSha: current.sha.slice(0, 7),
          author: current.author ?? '',
          authoredAt: current.authoredAt ?? '',
        });
      }
      current = {};
    }
  }

  return { tool: 'git.blame', path: relative, lines, truncated };
}
