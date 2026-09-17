import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canonicalEngineerDirtyState,
  engineerWorkspaceSnapshotFromGit,
} from '../src/engine/engineer/engineerWorkspaceSnapshot.js';

function overview(
  overrides: Partial<{
    branch: string | null;
    head: string | null;
    detached: boolean;
  }> = {},
) {
  return {
    tool: 'git.overview' as const,
    branch:
      overrides.branch !== undefined
        ? overrides.branch
        : 'main',
    head:
      overrides.head !== undefined
        ? overrides.head
        : '0123456789abcdef0123456789abcdef01234567',
    headShort:
      overrides.head === null
        ? null
        : '0123456',
    detached: overrides.detached ?? false,
    ahead: 0,
    behind: 0,
    counts: {
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
    },
    diffSummary: {
      stagedFiles: 0,
      stagedInsertions: 0,
      stagedDeletions: 0,
      unstagedFiles: 0,
      unstagedInsertions: 0,
      unstagedDeletions: 0,
    },
  };
}

function status(files: Array<{
  path: string;
  indexStatus: string;
  worktreeStatus: string;
}>) {
  return {
    tool: 'git.status' as const,
    branch: 'main',
    files,
  };
}

test('R2 workspace snapshot uses overview as HEAD and branch authority', () => {
  const snapshot = engineerWorkspaceSnapshotFromGit(
    status([]),
    overview({
      branch: 'feature/restart',
      head: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }),
  );

  assert.equal(
    snapshot.gitHead,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  );
  assert.equal(snapshot.gitBranch, 'feature/restart');
  assert.equal(typeof snapshot.dirtyFingerprint, 'string');
  assert.ok(snapshot.dirtyFingerprint !== null);
  assert.ok(snapshot.dirtyFingerprint.length > 0);
});

test('R2 dirty fingerprint is independent of git.status file ordering', () => {
  const first = engineerWorkspaceSnapshotFromGit(
    status([
      {
        path: 'src/z.ts',
        indexStatus: ' ',
        worktreeStatus: 'M',
      },
      {
        path: 'src/a.ts',
        indexStatus: 'A',
        worktreeStatus: ' ',
      },
    ]),
    overview(),
  );

  const second = engineerWorkspaceSnapshotFromGit(
    status([
      {
        path: 'src/a.ts',
        indexStatus: 'A',
        worktreeStatus: ' ',
      },
      {
        path: 'src/z.ts',
        indexStatus: ' ',
        worktreeStatus: 'M',
      },
    ]),
    overview(),
  );

  assert.equal(first.dirtyFingerprint, second.dirtyFingerprint);
});

test('R2 dirty fingerprint normalizes path separators', () => {
  const windows = engineerWorkspaceSnapshotFromGit(
    status([
      {
        path: 'src\\engine\\runtime.ts',
        indexStatus: ' ',
        worktreeStatus: 'M',
      },
    ]),
    overview(),
  );

  const posix = engineerWorkspaceSnapshotFromGit(
    status([
      {
        path: 'src/engine/runtime.ts',
        indexStatus: ' ',
        worktreeStatus: 'M',
      },
    ]),
    overview(),
  );

  assert.equal(windows.dirtyFingerprint, posix.dirtyFingerprint);
});

test('R2 dirty fingerprint changes when working-tree state changes', () => {
  const before = engineerWorkspaceSnapshotFromGit(
    status([
      {
        path: 'src/runtime.ts',
        indexStatus: ' ',
        worktreeStatus: 'M',
      },
    ]),
    overview(),
  );

  const after = engineerWorkspaceSnapshotFromGit(
    status([
      {
        path: 'src/runtime.ts',
        indexStatus: 'M',
        worktreeStatus: ' ',
      },
    ]),
    overview(),
  );

  assert.notEqual(before.dirtyFingerprint, after.dirtyFingerprint);
});

test('R2 canonical dirty state sorts and normalizes exact Git facts', () => {
  assert.deepEqual(
    canonicalEngineerDirtyState(
      status([
        {
          path: 'z\\two.ts',
          indexStatus: '?',
          worktreeStatus: '?',
        },
        {
          path: 'a/one.ts',
          indexStatus: 'M',
          worktreeStatus: ' ',
        },
      ]),
    ),
    [
      ['a/one.ts', 'M', ' '],
      ['z/two.ts', '?', '?'],
    ],
  );
});

test('R2 snapshot preserves detached HEAD truthfully', () => {
  const snapshot = engineerWorkspaceSnapshotFromGit(
    status([]),
    overview({
      branch: null,
      head: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      detached: true,
    }),
  );

  assert.equal(
    snapshot.gitHead,
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  );
  assert.equal(snapshot.gitBranch, null);
});

test('R2 snapshot preserves an unborn repository truthfully', () => {
  const snapshot = engineerWorkspaceSnapshotFromGit(
    {
      tool: 'git.status',
      branch: null,
      files: [],
    },
    {
      ...overview(),
      branch: 'main',
      head: null,
      headShort: null,
      detached: false,
    },
  );

  assert.equal(snapshot.gitHead, null);
  assert.equal(snapshot.gitBranch, 'main');
});

test('R2 canonical snapshot rejects malformed Git observations', () => {
  assert.throws(
    () =>
      engineerWorkspaceSnapshotFromGit(
        {
          tool: 'git.status',
          branch: 'main',
          files: [{ path: 'x.ts' }],
        },
        overview(),
      ),
  );

  assert.throws(
    () =>
      engineerWorkspaceSnapshotFromGit(
        status([]),
        {
          tool: 'git.overview',
          branch: 'main',
          head: 123,
        },
      ),
  );
});
