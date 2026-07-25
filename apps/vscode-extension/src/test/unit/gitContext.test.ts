import assert from 'node:assert/strict';
import test from 'node:test';

import { type GitResult, type GitRunner, assertReadOnly } from '../../commitGen/git.js';
import { parseLatestCommit, parsePorcelainV2, readGitContext, readWorkingChanges, repositoryLabel } from '../../services/gitContext.js';

/** Records every command so the read-only guarantee can be asserted. */
class FakeGit implements GitRunner {
  readonly calls: string[][] = [];
  constructor(private readonly responses: Record<string, GitResult>) {}
  run(args: string[]): Promise<GitResult> {
    // Defense in depth is exercised on every call, exactly as production does.
    assertReadOnly(args);
    this.calls.push(args);
    const key = args.join(' ');
    return Promise.resolve(this.responses[key] ?? { stdout: '', code: 0 });
  }
}

const STATUS_CLEAN = [
  '# branch.oid b557cf4835',
  '# branch.head phase-1/canonical-vscode-extension',
  '# branch.upstream origin/phase-1/canonical-vscode-extension',
  '# branch.ab +0 -0',
  '',
].join('\n');

const STATUS_DIRTY = [
  '# branch.oid b557cf4835',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -3',
  '1 .M N... 100644 100644 100644 aaa bbb src/panel/shell/types.ts',
  '1 M. N... 100644 100644 100644 ccc ddd src/extension.ts',
  '2 R. N... 100644 100644 100644 eee fff R100 new.ts\told.ts',
  'u UU N... 100644 100644 100644 100644 ggg hhh iii conflict.ts',
  '? untracked.md',
  '',
].join('\n');

test('porcelain v2 yields branch, upstream, ahead/behind and a clean tree', () => {
  const parsed = parsePorcelainV2(STATUS_CLEAN);
  assert.equal(parsed.branch, 'phase-1/canonical-vscode-extension');
  assert.equal(parsed.upstream, 'origin/phase-1/canonical-vscode-extension');
  assert.equal(parsed.ahead, 0);
  assert.equal(parsed.behind, 0);
  assert.equal(parsed.clean, true);
  assert.equal(parsed.changedFileCount, 0);
});

test('porcelain v2 counts ordinary, renamed, unmerged and untracked entries', () => {
  const parsed = parsePorcelainV2(STATUS_DIRTY);
  assert.equal(parsed.branch, 'main');
  assert.equal(parsed.ahead, 2);
  assert.equal(parsed.behind, 3);
  assert.equal(parsed.changedFileCount, 5);
  assert.equal(parsed.clean, false);
});

test('a detached HEAD is reported honestly, not as a branch name', () => {
  const parsed = parsePorcelainV2('# branch.oid abc\n# branch.head (detached)\n');
  assert.equal(parsed.branch, 'HEAD (detached)');
  // No upstream line → no invented upstream.
  assert.equal(parsed.upstream, undefined);
  assert.equal(parsed.ahead, undefined, 'ahead/behind is unknown without an upstream');
  assert.equal(parsed.behind, undefined);
});

test('the latest commit is split into short sha and subject', () => {
  assert.deepEqual(parseLatestCommit('b557cf48\tMerge pull request #99 from migrahosting-alt/fix\n'), {
    latestCommitShort: 'b557cf48',
    latestCommitSubject: 'Merge pull request #99 from migrahosting-alt/fix',
  });
  assert.deepEqual(parseLatestCommit(''), {});
  assert.deepEqual(parseLatestCommit('b557cf48\n'), { latestCommitShort: 'b557cf48' });
});

test('the repository is labelled by folder name, never an absolute path', () => {
  assert.equal(repositoryLabel('/home/bonex/workspace/active/MigraTeck-Ecosystem/dev'), 'dev');
  assert.equal(repositoryLabel('C:\\Users\\bonex\\repo\\'), 'repo');
});

test('reading git context issues ONLY read-only commands', async () => {
  const git = new FakeGit({
    'rev-parse --is-inside-work-tree': { stdout: 'true\n', code: 0 },
    'status --porcelain=v2 --branch': { stdout: STATUS_DIRTY, code: 0 },
    'log -1 --format=%h%x09%s': { stdout: 'b557cf48\tMerge pull request #99\n', code: 0 },
  });
  const snapshot = await readGitContext(git, '/home/bonex/workspace/active/MigraTeck-Ecosystem/dev');

  assert.equal(snapshot.repository, 'dev');
  assert.equal(snapshot.branch, 'main');
  assert.equal(snapshot.changedFileCount, 5);
  assert.equal(snapshot.latestCommitShort, 'b557cf48');
  assert.equal(snapshot.unavailableReason, undefined);

  // Every command is on the read-only allow-list, and none mutates the repo.
  const subcommands = git.calls.map((call) => call[0]);
  assert.deepEqual([...new Set(subcommands)].sort(), ['log', 'rev-parse', 'status']);
  for (const call of git.calls) {
    assert.doesNotThrow(() => assertReadOnly(call));
  }
  // The snapshot itself carries no absolute path.
  assert.doesNotMatch(JSON.stringify(snapshot), /home\/bonex/);
});

test('a non-repository is reported as unavailable, never as a clean tree', async () => {
  const git = new FakeGit({ 'rev-parse --is-inside-work-tree': { stdout: 'false\n', code: 0 } });
  const snapshot = await readGitContext(git, '/tmp/not-a-repo');
  assert.equal(snapshot.unavailableReason, 'This folder is not a Git repository.');
  assert.equal(snapshot.clean, undefined, 'never claim a clean tree when git could not be read');
  assert.equal(snapshot.branch, undefined);
});

test('a failing git status is reported as unavailable', async () => {
  const git = new FakeGit({
    'rev-parse --is-inside-work-tree': { stdout: 'true\n', code: 0 },
    'status --porcelain=v2 --branch': { stdout: '', code: 128 },
  });
  const snapshot = await readGitContext(git, '/repo');
  assert.match(snapshot.unavailableReason ?? '', /could not be read/);
  assert.equal(snapshot.clean, undefined);
});

test('an empty repository (no commits) is not treated as an error', async () => {
  const git = new FakeGit({
    'rev-parse --is-inside-work-tree': { stdout: 'true\n', code: 0 },
    'status --porcelain=v2 --branch': { stdout: '# branch.head main\n', code: 0 },
    'log -1 --format=%h%x09%s': { stdout: '', code: 128 },
  });
  const snapshot = await readGitContext(git, '/repo');
  assert.equal(snapshot.unavailableReason, undefined);
  assert.equal(snapshot.branch, 'main');
  assert.equal(snapshot.latestCommitShort, undefined);
});

test('a thrown git error degrades to "git is unavailable"', async () => {
  const broken: GitRunner = { run: () => Promise.reject(new Error('ENOENT')) };
  const snapshot = await readGitContext(broken, '/repo');
  assert.equal(snapshot.unavailableReason, 'Git is unavailable on this machine.');
});

test('working changes merge staged and unstaged deltas for the same file', async () => {
  const git = new FakeGit({
    'diff --cached --name-status': { stdout: 'M\tsrc/a.ts\nA\tsrc/new.ts\n', code: 0 },
    'diff --cached --numstat': { stdout: '10\t2\tsrc/a.ts\n5\t0\tsrc/new.ts\n', code: 0 },
    'diff --name-status': { stdout: 'M\tsrc/a.ts\nM\tsrc/b.ts\n', code: 0 },
    'diff --numstat': { stdout: '3\t1\tsrc/a.ts\n-\t-\tsrc/b.ts\n', code: 0 },
  });
  const changes = await readWorkingChanges(git);

  assert.deepEqual(changes.map((change) => change.path), ['src/a.ts', 'src/b.ts', 'src/new.ts']);
  const a = changes.find((change) => change.path === 'src/a.ts');
  assert.deepEqual({ added: a?.added, removed: a?.removed, staged: a?.staged }, { added: 13, removed: 3, staged: true });
  const b = changes.find((change) => change.path === 'src/b.ts');
  assert.deepEqual({ binary: b?.binary, staged: b?.staged }, { binary: true, staged: false });
});
