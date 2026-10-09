import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { candidateGit, withDetachedCandidate } from './support/detachedCandidate.js';
import { createWebsiteRepo } from './fixtures/websiteCodingFixture.js';

test('detached candidate uses the exact clean HEAD and cleans only its owned worktree', async (t) => {
  const root = createWebsiteRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let candidate = '';
  const result = await withDetachedCandidate(root, async (path, head) => {
    candidate = path;
    assert.equal(candidateGit(path, ['rev-parse', 'HEAD']), head);
    assert.equal(candidateGit(path, ['rev-parse', '--abbrev-ref', 'HEAD']), 'HEAD');
    writeFileSync(join(path, 'public/summary.js'), 'candidate change\n');
    assert.equal(candidateGit(root, ['status', '--porcelain']), '');
    return 42;
  });
  assert.equal(result.value, 42);
  assert.equal(existsSync(candidate), false);
  assert.equal(candidateGit(root, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)?.length, 1);
});

for (const path of ['public/summary.js', 'untracked.txt']) {
  test(`candidate refuses dirty ${path} before executing a callback`, async (t) => {
    const root = createWebsiteRepo();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(join(root, path), 'uncommitted\n');
    let executed = false;
    await assert.rejects(withDetachedCandidate(root, async () => { executed = true; }), /clean committed base/);
    assert.equal(executed, false);
    assert.equal(readFileSync(join(root, path), 'utf8'), 'uncommitted\n');
  });
}

test('candidate failure is explicit and still removes its owned worktree', async (t) => {
  const root = createWebsiteRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let candidate = '';
  await assert.rejects(withDetachedCandidate(root, async (path) => {
    candidate = path;
    throw new Error('controlled validation failure');
  }), /controlled validation failure/);
  assert.equal(existsSync(candidate), false);
  assert.equal(candidateGit(root, ['status', '--porcelain']), '');
});

test('candidate detects original-file drift before returning validated material', async (t) => {
  const root = createWebsiteRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  await assert.rejects(withDetachedCandidate(root, async () => {
    writeFileSync(join(root, 'public/summary.js'), 'external change\n');
    return 'must not be accepted';
  }), /unchanged, clean committed base/);
  assert.equal(readFileSync(join(root, 'public/summary.js'), 'utf8'), 'external change\n');
  assert.equal(candidateGit(root, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)?.length, 1);
});

test('candidate refuses a repository subdirectory rather than silently choosing its parent', async (t) => {
  const root = createWebsiteRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  await assert.rejects(withDetachedCandidate(join(root, 'src'), async () => 'must not run'), /exact repository root/);
});

test('candidate detects a changed clean HEAD, not only dirty files', async (t) => {
  const root = createWebsiteRepo();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  await assert.rejects(withDetachedCandidate(root, async () => {
    candidateGit(root, [
      '-c', 'user.name=MigraPilot Acceptance', '-c', 'user.email=acceptance@migrateck.invalid',
      'commit', '--allow-empty', '-qm', 'Controlled HEAD drift\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>',
    ]);
    assert.equal(candidateGit(root, ['status', '--porcelain']), '');
    return 'must not be accepted';
  }), /HEAD changed/);
  assert.equal(candidateGit(root, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)?.length, 1);
});
