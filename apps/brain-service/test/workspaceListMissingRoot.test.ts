// A missing workspace root must FAIL, never look like an empty project.
//
// Observed for real: after the Brain moved to another host, every workstation
// path stopped existing on it, and workspace.list answered `ok` with zero
// entries. A model told its workspace is empty does not stop — it invents
// plausible files and reports work it never did.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { workspaceList } from '../src/tools/workspaceList.js';

test('a root that does not exist is an ERROR, not an empty listing', async () => {
  await assert.rejects(
    () => workspaceList({ rootPath: '/definitely/not/here/on/this/machine' }),
    /does not exist on the machine running this tool/,
  );
});

test('the error explains WHY, so a cross-machine path is diagnosable', async () => {
  await assert.rejects(
    () => workspaceList({ rootPath: '/home/someone/project-from-another-laptop' }),
    /filesystem of the Brain host/,
  );
});

test('a root that is a FILE is refused too', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wl-'));
  const file = join(dir, 'not-a-dir.txt');
  writeFileSync(file, 'x');
  await assert.rejects(() => workspaceList({ rootPath: file }), /is not a directory/);
});

test('a real root still lists normally — the guard did not break the tool', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wl-'));
  writeFileSync(join(dir, 'a.txt'), 'hello');
  mkdirSync(join(dir, 'sub'));
  const res = await workspaceList({ rootPath: dir });
  const names = res.entries.map((e) => e.path).sort();
  assert.deepEqual(names, ['a.txt', 'sub']);
});

test('a missing SUBPATH under a valid root still lists empty — a different question', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wl-'));
  const res = await workspaceList({ rootPath: dir, path: 'not-here-xyz' });
  assert.deepEqual(res.entries, [], 'the workspace exists; the named subdirectory does not');
});

test('an unreadable SUBdirectory is still tolerated, not fatal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wl-'));
  writeFileSync(join(dir, 'visible.txt'), 'x');
  const locked = join(dir, 'locked');
  mkdirSync(locked);
  chmodSync(locked, 0o000);
  const res = await workspaceList({ rootPath: dir, depth: 2 });
  assert.ok(res.entries.some((e) => e.path === 'visible.txt'), 'the readable part must still list');
  chmodSync(locked, 0o755);
});
