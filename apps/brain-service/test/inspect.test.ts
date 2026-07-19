// Read-only workspace inspection (model-free local runner). Proves the inspect
// path returns REAL evidence and TRUTHFUL typed errors — the fix for the chat
// falsely refusing local workspace inspection. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runInspection, type InspectErrorCode } from '../src/engine/inspectRoutes.js';

function tmpRepo(withGit: boolean): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'migra-inspect-')));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x' }));
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const NEEDLE_TOKEN = 1;\n');
  if (withGit) {
    const g = (args: string[]): void => { execFileSync('git', args, { cwd: dir, stdio: 'ignore' }); };
    g(['init', '-q']);
    g(['config', 'user.email', 't@t.co']);
    g(['config', 'user.name', 'T']);
    g(['remote', 'add', 'origin', 'git@github.com:acme/x.git']);
    g(['add', '.']);
    g(['commit', '-q', '-m', 'init']);
  }
  return dir;
}

async function expectError(p: Promise<unknown>, code: InspectErrorCode): Promise<void> {
  await assert.rejects(p, (e: unknown) => (e as { code?: string }).code === code, `expected ${code}`);
}

test('workspace_root returns the real workspace root', async () => {
  const dir = tmpRepo(false);
  const { data } = await runInspection({ rootPath: dir, op: 'workspace_root' });
  assert.equal((data as { root: string }).root, dir);
});

test('list returns bounded directory entries, contained to the root', async () => {
  const dir = tmpRepo(false);
  const { data } = await runInspection({ rootPath: dir, op: 'list' });
  const names = (data as { entries: Array<{ name: string; type: string }> }).entries.map((e) => e.name);
  assert.ok(names.includes('package.json') && names.includes('src'));
});

test('content search finds a token INSIDE files (grep-like), distinct from find', async () => {
  const dir = tmpRepo(false);
  const { data } = await runInspection({ rootPath: dir, op: 'search', query: 'NEEDLE_TOKEN' });
  const matches = (data as { matches: Array<{ path: string }> }).matches;
  assert.ok(matches.length >= 1 && /a\.ts$/.test(matches[0]!.path));
});

test('find (kind=dir) returns DIRECTORIES by name, not file-content matches', async () => {
  const dir = tmpRepo(false);
  fs.mkdirSync(path.join(dir, 'engine'));
  fs.writeFileSync(path.join(dir, 'notes.md'), 'the engine subsystem is described here\n'); // content decoy
  const { data } = await runInspection({ rootPath: dir, op: 'find', query: 'engine', kind: 'dir' });
  const matches = (data as { matches: Array<{ path: string; type: string }> }).matches;
  assert.ok(matches.some((m) => m.path === 'engine' && m.type === 'dir'), 'directory "engine" is returned');
  assert.ok(matches.every((m) => m.type === 'dir'), 'kind=dir returns only directories');
  assert.ok(!matches.some((m) => /notes\.md/.test(m.path)), 'a file whose CONTENT mentions the query is NOT a find match');
});

test('find (kind=file) returns FILES by name', async () => {
  const dir = tmpRepo(false);
  const { data } = await runInspection({ rootPath: dir, op: 'find', query: 'a.ts', kind: 'file' });
  const matches = (data as { matches: Array<{ path: string; type: string }> }).matches;
  assert.ok(matches.some((m) => /(^|\/)a\.ts$/.test(m.path) && m.type === 'file'));
  assert.ok(matches.every((m) => m.type === 'file'));
});

test('find is workspace-contained: a symlinked directory escaping the root is not traversed', async () => {
  const dir = tmpRepo(false);
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'migra-outside-')));
  fs.writeFileSync(path.join(outside, 'SECRET_engine_file.txt'), 'x');
  try { fs.symlinkSync(outside, path.join(dir, 'link')); } catch { return; /* symlinks unsupported here */ }
  const { data } = await runInspection({ rootPath: dir, op: 'find', query: 'SECRET_engine_file' });
  const matches = (data as { matches: Array<{ path: string }> }).matches;
  assert.equal(matches.length, 0, 'a symlinked dir is never followed out of the workspace');
});

test('read returns file contents for an in-scope path', async () => {
  const dir = tmpRepo(false);
  const { data } = await runInspection({ rootPath: dir, op: 'read', path: 'src/a.ts' });
  assert.match((data as { content: string }).content, /NEEDLE_TOKEN/);
});

test('git status/branch/head/remotes return real repo state', async () => {
  const dir = tmpRepo(true);
  const status = await runInspection({ rootPath: dir, op: 'git_status' });
  assert.equal((status.data as { clean: boolean }).clean, true);
  const branch = await runInspection({ rootPath: dir, op: 'git_branch' });
  assert.ok(typeof (branch.data as { branch: string }).branch === 'string');
  const head = await runInspection({ rootPath: dir, op: 'git_head' });
  assert.match((head.data as { head: string }).head, /^[0-9a-f]{40}$/);
  const remotes = await runInspection({ rootPath: dir, op: 'git_remotes' });
  const r = (remotes.data as { remotes: Array<{ name: string; url: string }> }).remotes;
  assert.ok(r.some((x) => x.name === 'origin' && /acme\/x\.git/.test(x.url)));
});

test('pkg_manager detects the lockfile-based package manager', async () => {
  const dir = tmpRepo(false);
  const { data } = await runInspection({ rootPath: dir, op: 'pkg_manager' });
  assert.equal((data as { manager: string }).manager, 'pnpm');
});

test('a blank workspace root → workspace_not_open (never a generic refusal)', async () => {
  await expectError(runInspection({ rootPath: '   ', op: 'git_status' }), 'workspace_not_open');
});

test('a path escaping the workspace root → scope_not_authorized', async () => {
  const dir = tmpRepo(false);
  await expectError(runInspection({ rootPath: dir, op: 'read', path: '../../../../etc/passwd' }), 'scope_not_authorized');
  await expectError(runInspection({ rootPath: dir, op: 'list', path: '/etc' }), 'scope_not_authorized');
});

test('a git op in a non-git directory → tool_execution_failed (truthful, not a refusal)', async () => {
  const dir = tmpRepo(false); // no git init
  await expectError(runInspection({ rootPath: dir, op: 'git_head' }), 'tool_execution_failed');
});
