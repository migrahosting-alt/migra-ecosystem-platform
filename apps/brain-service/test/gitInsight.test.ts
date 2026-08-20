// Acceptance for read-only Git visibility.
//
// Driven against a REAL temporary repository rather than stubbed git output: the claim under
// test is "these numbers match the actual worktree", which a fixture cannot establish.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gitBlame, gitHistory, gitOverview } from '../src/tools/gitInsight.js';

function run(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8' });
}

/** A repository with a known, deliberately mixed state. */
function repo(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'migrapilot-git-'));
  run(root, ['init', '--initial-branch=main']);
  run(root, ['config', 'user.email', 'test@example.test']);
  run(root, ['config', 'user.name', 'Test Person']);
  writeFileSync(path.join(root, 'a.txt'), 'one\ntwo\nthree\n');
  run(root, ['add', 'a.txt']);
  run(root, ['commit', '-m', 'first commit']);
  writeFileSync(path.join(root, 'b.txt'), 'beta\n');
  run(root, ['add', 'b.txt']);
  run(root, ['commit', '-m', 'second commit']);
  return root;
}

test('overview reports the real branch and HEAD', async () => {
  const root = repo();
  const overview = await gitOverview({ rootPath: root });
  assert.equal(overview.tool, 'git.overview');
  assert.equal(overview.branch, 'main');
  assert.equal(overview.detached, false);
  const realHead = run(root, ['rev-parse', 'HEAD']).trim();
  assert.equal(overview.head, realHead, 'HEAD must match the actual repository');
  assert.equal(overview.headShort, realHead.slice(0, 7));
});

test('a clean worktree reports zero of everything', async () => {
  const overview = await gitOverview({ rootPath: repo() });
  assert.deepEqual(overview.counts, { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 });
  assert.equal(overview.diffSummary.stagedFiles, 0);
  assert.equal(overview.diffSummary.unstagedFiles, 0);
});

test('STAGED, UNSTAGED and UNTRACKED are distinguished correctly', async () => {
  const root = repo();
  // staged: a new tracked file added to the index
  writeFileSync(path.join(root, 'staged.txt'), 'x\n');
  run(root, ['add', 'staged.txt']);
  // unstaged: a tracked file modified in the worktree only
  writeFileSync(path.join(root, 'a.txt'), 'one\ntwo\nthree\nfour\n');
  // untracked: never added
  writeFileSync(path.join(root, 'untracked.txt'), 'y\n');

  const overview = await gitOverview({ rootPath: root });
  assert.equal(overview.counts.staged, 1, 'exactly one staged change');
  assert.equal(overview.counts.unstaged, 1, 'exactly one unstaged change');
  assert.equal(overview.counts.untracked, 1, 'exactly one untracked file');
  assert.equal(overview.counts.conflicted, 0);
});

test('the diff summary counts real line churn on each side', async () => {
  const root = repo();
  writeFileSync(path.join(root, 'staged.txt'), 'p\nq\n');
  run(root, ['add', 'staged.txt']);
  writeFileSync(path.join(root, 'a.txt'), 'one\ntwo\nthree\nfour\nfive\n');

  const overview = await gitOverview({ rootPath: root });
  assert.equal(overview.diffSummary.stagedFiles, 1);
  assert.equal(overview.diffSummary.stagedInsertions, 2);
  assert.equal(overview.diffSummary.unstagedFiles, 1);
  assert.equal(overview.diffSummary.unstagedInsertions, 2, 'two lines appended to a.txt');
  assert.equal(overview.diffSummary.unstagedDeletions, 0);
});

test('no upstream means ahead/behind are null, not zero', async () => {
  const overview = await gitOverview({ rootPath: repo() });
  assert.equal(overview.ahead, null, 'null means unknown; 0 would claim we are in sync');
  assert.equal(overview.behind, null);
});

test('history returns the correct HEAD and commits newest first', async () => {
  const root = repo();
  const history = await gitHistory({ rootPath: root, limit: 20 });
  assert.equal(history.head, run(root, ['rev-parse', 'HEAD']).trim());
  assert.equal(history.branch, 'main');
  assert.equal(history.commits.length, 2);
  assert.equal(history.commits[0]!.subject, 'second commit');
  assert.equal(history.commits[1]!.subject, 'first commit');
  assert.equal(history.commits[0]!.author, 'Test Person');
  assert.match(history.commits[0]!.authoredAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(history.commits[0]!.sha, history.head);
  assert.equal(history.truncated, false);
});

test('history is BOUNDED and reports truncation observably', async () => {
  const root = repo();
  for (let i = 0; i < 5; i += 1) {
    writeFileSync(path.join(root, `f${i}.txt`), `${i}\n`);
    run(root, ['add', '.']);
    run(root, ['commit', '-m', `commit ${i}`]);
  }
  const limited = await gitHistory({ rootPath: root, limit: 3 });
  assert.equal(limited.commits.length, 3, 'the limit is honoured');
  assert.equal(limited.truncated, true, 'truncation is observed, not guessed');

  const all = await gitHistory({ rootPath: root, limit: 100 });
  assert.equal(all.commits.length, 7);
  assert.equal(all.truncated, false);
});

test('history can be filtered to a contained path', async () => {
  const root = repo();
  const only = await gitHistory({ rootPath: root, limit: 20, path: 'b.txt' });
  assert.equal(only.commits.length, 1);
  assert.equal(only.commits[0]!.subject, 'second commit');
});

test('PATH SCOPING: history refuses a path outside the workspace', async () => {
  const root = repo();
  for (const bad of ['../outside.txt', '/etc/passwd']) {
    await assert.rejects(
      () => gitHistory({ rootPath: root, limit: 5, path: bad }),
      (err: Error) => /PATH_ESCAPE|ABSOLUTE_PATH|escape|Absolute/i.test(`${err.message}${(err as { code?: string }).code ?? ''}`),
      `${bad} must be refused`,
    );
  }
});

test('PATH SCOPING: blame refuses a path outside the workspace', async () => {
  const root = repo();
  for (const bad of ['../outside.txt', '/etc/passwd']) {
    await assert.rejects(() => gitBlame({ rootPath: root, path: bad }));
  }
});

test('blame attributes real lines to the real commit', async () => {
  const root = repo();
  const head = run(root, ['rev-parse', 'HEAD']).trim();
  const blame = await gitBlame({ rootPath: root, path: 'b.txt' });
  assert.equal(blame.tool, 'git.blame');
  assert.equal(blame.path, 'b.txt');
  assert.equal(blame.lines.length, 1);
  assert.equal(blame.lines[0]!.line, 1);
  assert.equal(blame.lines[0]!.sha, head);
  assert.equal(blame.lines[0]!.shortSha, head.slice(0, 7));
  assert.equal(blame.lines[0]!.author, 'Test Person');
});

test('blame honours a line range', async () => {
  const root = repo();
  const blame = await gitBlame({ rootPath: root, path: 'a.txt', startLine: 2, endLine: 3 });
  assert.equal(blame.lines.length, 2);
  assert.deepEqual(blame.lines.map((l) => l.line), [2, 3]);
});

test('blame never returns file CONTENT, only attribution', async () => {
  const root = repo();
  const blame = await gitBlame({ rootPath: root, path: 'a.txt' });
  const blob = JSON.stringify(blame);
  for (const content of ['one', 'two', 'three']) {
    assert.ok(!blob.includes(`"${content}"`), 'the caller already has the file; do not echo it back');
  }
});

test('NO MUTATION is reachable — a path that looks like a flag is treated as a path', async () => {
  const root = repo();
  // If `--` were missing, git would read this as an option. It must be a path, and there is
  // no such file, so the call fails as a path lookup rather than executing anything.
  await assert.rejects(() => gitBlame({ rootPath: root, path: '--output=/tmp/pwned' }));
  const overview = await gitOverview({ rootPath: root });
  assert.equal(overview.counts.staged, 0, 'nothing was staged by the attempt');
});

test('a repository with no commits reports null HEAD rather than failing', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'migrapilot-git-empty-'));
  run(root, ['init', '--initial-branch=main']);
  const overview = await gitOverview({ rootPath: root });
  assert.equal(overview.head, null, 'unborn HEAD is null, not a fabricated sha');
  assert.equal(overview.branch, 'main');
  const history = await gitHistory({ rootPath: root, limit: 5 });
  assert.deepEqual(history.commits, []);
});

test('a non-repository is refused with a named reason', async () => {
  const notARepo = mkdtempSync(path.join(tmpdir(), 'migrapilot-not-git-'));
  await assert.rejects(
    () => gitOverview({ rootPath: notARepo }),
    (err: Error) => /not a git repository/i.test(err.message),
  );
});

test('untracked counts FILES, not collapsed directories', async () => {
  const root = repo();
  // `--untracked-files=normal` would report this whole tree as ONE entry. A field named
  // `untracked` reporting 1 when three files are untracked is a confident wrong number.
  execFileSync('mkdir', ['-p', path.join(root, 'newdir', 'nested')]);
  writeFileSync(path.join(root, 'newdir', 'one.txt'), '1\n');
  writeFileSync(path.join(root, 'newdir', 'two.txt'), '2\n');
  writeFileSync(path.join(root, 'newdir', 'nested', 'three.txt'), '3\n');

  const overview = await gitOverview({ rootPath: root });
  assert.equal(overview.counts.untracked, 3, 'three untracked FILES, not one directory');
  const real = run(root, ['ls-files', '--others', '--exclude-standard']).trim().split('\n').length;
  assert.equal(overview.counts.untracked, real, 'must agree with git itself');
});
