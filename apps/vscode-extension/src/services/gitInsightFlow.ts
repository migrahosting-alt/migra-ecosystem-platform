/**
 * Read-only Git visibility, extension side.
 *
 * The extension asks the Brain a QUESTION and renders the structured answer. It does not
 * shell out, does not read `.git`, and cannot request arbitrary Git execution — the request
 * types carry no subcommand and no flags, so there is nothing to smuggle.
 *
 * This is deliberately NOT the ad-hoc command lane. `git` is not on that lane's allowlist and
 * this does not put it there:
 *
 *   command.run          "run this program and show me its output"    — argv from a person
 *   git.overview/history "answer this question about the repository"  — argv built server-side
 *
 * Adding `git` to the command allowlist would have been the shortcut, and it would have
 * bought arbitrary `git` execution — including mutations — to answer a read-only question.
 *
 * No `vscode` import, so the fail-closed and formatting paths are testable under bare
 * `node --test`.
 */

export interface GitOverview {
  branch: string | null;
  head: string | null;
  headShort: string | null;
  detached: boolean;
  ahead: number | null;
  behind: number | null;
  counts: { staged: number; unstaged: number; untracked: number; conflicted: number };
  diffSummary: {
    stagedFiles: number;
    stagedInsertions: number;
    stagedDeletions: number;
    unstagedFiles: number;
    unstagedInsertions: number;
    unstagedDeletions: number;
  };
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  author: string;
  authoredAt: string;
  subject: string;
}

export interface GitHistory {
  head: string | null;
  branch: string | null;
  commits: GitCommit[];
  truncated: boolean;
}

export interface GitInsightSource {
  overview(rootPath: string): Promise<GitOverview>;
  history(rootPath: string, limit: number): Promise<GitHistory>;
}

export type GitInsightOutcome =
  | { status: 'ok'; report: string }
  | { status: 'unavailable'; reason: string };

function pluralFiles(n: number): string {
  return n === 1 ? '1 file' : `${n} files`;
}

/** A worktree line that states zero as zero rather than omitting it. */
function worktreeLine(counts: GitOverview['counts']): string {
  const total = counts.staged + counts.unstaged + counts.untracked + counts.conflicted;
  if (total === 0) return 'Worktree: clean';
  const parts = [
    `${counts.staged} staged`,
    `${counts.unstaged} unstaged`,
    `${counts.untracked} untracked`,
  ];
  if (counts.conflicted > 0) parts.push(`${counts.conflicted} CONFLICTED`);
  return `Worktree: ${parts.join(', ')}`;
}

function upstreamLine(overview: GitOverview): string {
  // null is not zero. "0 ahead, 0 behind" claims we compared against an upstream; when
  // there is none, saying so is the honest answer.
  if (overview.ahead === null || overview.behind === null) return 'Upstream: none configured';
  return `Upstream: ${overview.ahead} ahead, ${overview.behind} behind`;
}

export function formatGitReport(overview: GitOverview, history: GitHistory): string {
  const lines: string[] = [];
  const branch = overview.detached
    ? `HEAD detached at ${overview.headShort ?? 'unknown'}`
    : (overview.branch ?? '(no branch)');
  lines.push(`Branch: ${branch}`);
  lines.push(`HEAD:   ${overview.head === null ? '(no commits yet)' : `${overview.headShort}  ${overview.head}`}`);
  lines.push(upstreamLine(overview));
  lines.push(worktreeLine(overview.counts));
  const d = overview.diffSummary;
  lines.push(
    `Changes: staged ${pluralFiles(d.stagedFiles)} +${d.stagedInsertions}/-${d.stagedDeletions} · ` +
      `unstaged ${pluralFiles(d.unstagedFiles)} +${d.unstagedInsertions}/-${d.unstagedDeletions}`,
  );
  lines.push('');
  if (history.commits.length === 0) {
    lines.push('No commits yet.');
  } else {
    lines.push(`Recent commits (${history.commits.length}${history.truncated ? ', more not shown' : ''}):`);
    for (const commit of history.commits) {
      const date = commit.authoredAt.slice(0, 10);
      lines.push(`  ${commit.shortSha}  ${date}  ${commit.author}  ${commit.subject}`);
    }
  }
  return lines.join('\n');
}

export async function runGitInsightFlow(input: {
  rootPath: string | undefined;
  limit: number;
  source: GitInsightSource;
}): Promise<GitInsightOutcome> {
  if (input.rootPath === undefined || input.rootPath.length === 0) {
    return { status: 'unavailable', reason: 'Open a workspace folder first — Git status needs a resolved root.' };
  }
  try {
    // Sequential on purpose: overview is the call that surfaces a real repository problem
    // (not a repo, dubious ownership), so its error is the one worth reporting.
    const overview = await input.source.overview(input.rootPath);
    const history = await input.source.history(input.rootPath, input.limit);
    return { status: 'ok', report: formatGitReport(overview, history) };
  } catch (error) {
    // FAIL CLOSED. No local git fallback exists here; an unreachable Brain means the
    // question is unanswered, and reporting a stale or invented status would be worse
    // than reporting nothing.
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'unavailable', reason: `Git information is unavailable (${message}).` };
  }
}
