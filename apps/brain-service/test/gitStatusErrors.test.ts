// git.status must never answer a broken repository with a confident null.
//
// Observed on the owner's machine: a repo on a Windows drive mounted into WSL is
// refused by git for "dubious ownership". `rev-parse` was wrapped in
// .catch(() => ''), so the tool reported branch: null — a SILENT WRONG ANSWER,
// the exact class this agent must never produce — while the real problem (and
// its one-line fix) never reached the caller.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitStatus, explainGitError } from '../src/tools/gitStatus.js';

const execFileAsync = promisify(execFile);

async function tempRepo(withCommit: boolean): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitstatus-'));
  await execFileAsync('git', ['init', '-q'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 't'], { cwd: dir });
  if (withCommit) {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    await execFileAsync('git', ['add', 'a.txt'], { cwd: dir });
    await execFileAsync('git', ['commit', '-qm', 'init'], { cwd: dir });
  }
  return dir;
}

test('reports the real branch and dirty files', async () => {
  const dir = await tempRepo(true);
  fs.writeFileSync(path.join(dir, 'b.txt'), 'y');
  const res = await gitStatus({ rootPath: dir });
  assert.ok(res.branch, 'a committed repo has a branch');
  assert.ok(res.files.some((f) => f.path === 'b.txt'), 'untracked file is reported');
});

test('a repo with no commits yet reports a null branch — the truthful answer', async () => {
  const dir = await tempRepo(false);
  const res = await gitStatus({ rootPath: dir });
  assert.equal(res.branch, null, 'unborn HEAD genuinely has no branch');
  assert.deepEqual(res.files, [], 'and status still works');
});

test('a directory that is not a repository FAILS instead of answering null', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notrepo-'));
  await assert.rejects(() => gitStatus({ rootPath: dir }), /not a git repository/);
});

test('a repo git refuses names the one-line fix, rather than failing opaquely', () => {
  // The owner's real failure, verbatim from git 2.43 on a WSL-mounted drive.
  const raw = new Error(
    "fatal: detected dubious ownership in repository at '/mnt/t/MigraAccess'\nTo add an exception for this directory, call:\n\n\tgit config --global --add safe.directory /mnt/t/MigraAccess",
  );
  const explained = explainGitError(raw, '/mnt/t/MigraAccess');
  assert.match(explained.message, /dubious ownership/);
  assert.match(explained.message, /Windows drive under WSL/, 'says WHY it happens');
  assert.match(
    explained.message,
    /git config --global --add safe\.directory \/mnt\/t\/MigraAccess/,
    'and gives the exact command that fixes it',
  );
});

test('an unrelated git failure is passed through unchanged', () => {
  const raw = new Error('fatal: some other git problem');
  assert.equal(explainGitError(raw, '/w').message, 'fatal: some other git problem');
});
