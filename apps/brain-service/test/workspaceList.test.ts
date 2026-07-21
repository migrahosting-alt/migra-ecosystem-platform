// The agent's only instrument for "what files exist?".
//
// Without it, asked what a repository contained, the agent reported "the root
// directory is empty, and there is no package.json file" about a repo holding
// package.json, README.md and .gitignore. It had no tool that could observe a
// listing, so it guessed. These tests pin the instrument's contract.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workspaceList } from '../src/tools/workspaceList.js';

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wslist-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"x"}');
  fs.writeFileSync(path.join(root, 'README.md'), '# x');
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export {};');
  fs.mkdirSync(path.join(root, 'node_modules', 'junk'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'junk', 'a.js'), 'x');
  return root;
}

test('lists what is really there, including dotfiles', async () => {
  const root = fixture();
  const res = await workspaceList({ rootPath: root });
  const names = res.entries.map((e) => e.path);

  assert.ok(names.includes('package.json'), `package.json missing: ${JSON.stringify(names)}`);
  assert.ok(names.includes('README.md'));
  assert.ok(names.includes('.gitignore'), 'dotfiles are real files and must be listed');
  assert.ok(names.includes('src'));
  assert.equal(res.entries.find((e) => e.path === 'src')?.type, 'dir');
  assert.equal(res.truncated, false);
});

test('reports file sizes, so "empty" is distinguishable from "missing"', async () => {
  const root = fixture();
  const res = await workspaceList({ rootPath: root });
  const pkg = res.entries.find((e) => e.path === 'package.json');
  assert.equal(pkg?.type, 'file');
  assert.ok((pkg?.size ?? 0) > 0);
});

test('depth 0 does not descend; depth 1 does', async () => {
  const root = fixture();
  const flat = await workspaceList({ rootPath: root });
  assert.ok(!flat.entries.some((e) => e.path === 'src/index.ts'), 'depth 0 lists src/ but not inside it');

  const deep = await workspaceList({ rootPath: root, depth: 1 });
  assert.ok(deep.entries.some((e) => e.path === 'src/index.ts'), 'depth 1 descends');
});

test('dependency and build trees are never walked into', async () => {
  const root = fixture();
  const res = await workspaceList({ rootPath: root, depth: 3 });
  assert.ok(res.entries.some((e) => e.path === 'node_modules'), 'the directory itself is still reported');
  assert.ok(!res.entries.some((e) => e.path.startsWith('node_modules/')), 'but its contents are not enumerated');
});

test('a sub-path can be listed, and escaping the root is refused', async () => {
  const root = fixture();
  const sub = await workspaceList({ rootPath: root, path: 'src' });
  assert.deepEqual(sub.entries.map((e) => e.path), ['src/index.ts']);
  assert.equal(sub.dir, 'src');

  await assert.rejects(() => workspaceList({ rootPath: root, path: '../..' }), /escapes the workspace root/);
});

test('a truncated listing says so rather than implying completeness', async () => {
  const root = fixture();
  const res = await workspaceList({ rootPath: root, limit: 2 });
  assert.equal(res.entries.length, 2);
  assert.equal(res.truncated, true, 'the caller must be able to tell the listing is partial');
});

test('an unreadable directory yields no entries instead of throwing', async () => {
  const res = await workspaceList({ rootPath: os.tmpdir(), path: 'definitely-not-here-xyz' });
  assert.deepEqual(res.entries, []);
});

test('ordering is stable, so the same tree lists identically twice', async () => {
  const root = fixture();
  const a = await workspaceList({ rootPath: root });
  const b = await workspaceList({ rootPath: root });
  assert.deepEqual(a.entries, b.entries);
});
