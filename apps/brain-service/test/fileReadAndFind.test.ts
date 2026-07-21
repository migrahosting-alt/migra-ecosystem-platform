// The two remaining "observe the filesystem" instruments.
//
// file.readRange REQUIRED line numbers, so reading package.json meant guessing
// a range and then reasoning about a truncated file as if it were whole. And
// there was no way to ask "where is tsconfig.json?" — only content search,
// which matches every file that merely mentions the word.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileRead } from '../src/tools/fileRead.js';
import { workspaceFind } from '../src/tools/workspaceFind.js';

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readfind-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{\n  "name": "x",\n  "private": true\n}\n');
  fs.mkdirSync(path.join(root, 'apps', 'web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'web', 'tsconfig.json'), '{}');
  fs.writeFileSync(path.join(root, 'docker-compose.yml'), 'services: {}');
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'tsconfig.json'), '{}');
  return root;
}

test('file.read returns the whole file without being told its length', async () => {
  const root = fixture();
  const res = await fileRead({ rootPath: root, path: 'package.json' });
  assert.match(res.content, /"private": true/);
  assert.equal(res.truncated, false);
  assert.equal(res.lines, 5);
  assert.ok(res.totalBytes > 0);
});

test('a file larger than the cap is truncated HONESTLY, never silently', async () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'big.txt'), 'x'.repeat(5_000));
  const res = await fileRead({ rootPath: root, path: 'big.txt', maxBytes: 100 });
  assert.equal(res.content.length, 100);
  assert.equal(res.truncated, true, 'a partial read must never look complete');
  assert.equal(res.totalBytes, 5_000, 'and the real size is still reported');
});

test('reading a directory names the right tool instead of failing opaquely', async () => {
  const root = fixture();
  await assert.rejects(() => fileRead({ rootPath: root, path: 'apps' }), /use workspace\.list/);
});

test('file.read refuses to escape the workspace root', async () => {
  const root = fixture();
  await assert.rejects(() => fileRead({ rootPath: root, path: '../../etc/passwd' }), /escapes the workspace root/);
});

test('workspace.find locates a file by name, anywhere in the tree', async () => {
  const root = fixture();
  const res = await workspaceFind({ rootPath: root, query: 'tsconfig.json' });
  assert.deepEqual(res.matches.map((m) => m.path), ['apps/web/tsconfig.json']);
});

test('find never returns dependency trees', async () => {
  const root = fixture();
  const res = await workspaceFind({ rootPath: root, query: 'tsconfig' });
  assert.ok(!res.matches.some((m) => m.path.includes('node_modules')), 'node_modules must never surface');
});

test('globs work, and so does a plain substring', async () => {
  const root = fixture();
  const glob = await workspaceFind({ rootPath: root, query: 'docker-compose*' });
  assert.deepEqual(glob.matches.map((m) => m.path), ['docker-compose.yml']);

  const substr = await workspaceFind({ rootPath: root, query: 'compose' });
  assert.deepEqual(substr.matches.map((m) => m.path), ['docker-compose.yml']);
});

test('kind filters directories from files', async () => {
  const root = fixture();
  const dirs = await workspaceFind({ rootPath: root, query: 'apps', kind: 'dir' });
  assert.deepEqual(dirs.matches.map((m) => m.path), ['apps']);

  const files = await workspaceFind({ rootPath: root, query: 'apps', kind: 'file' });
  assert.deepEqual(files.matches, []);
});

test('a truncated find says so', async () => {
  const root = fixture();
  const res = await workspaceFind({ rootPath: root, query: 'o', limit: 1 });
  assert.equal(res.matches.length, 1);
  assert.equal(res.truncated, true);
});
