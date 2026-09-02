// Workspace tools executed where the workspace actually is.
//
// The rule every case below defends: ABSENCE IS AN ERROR, never an empty
// success. A missing root that lists as empty is what told the agent its
// project had no files and invited it to invent some.

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { executeWorkspaceTool, WorkspaceToolError } from '../../services/workspaceTools.js';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'wt-'));
  writeFileSync(join(root, 'index.html'), '<h1>MigraPilot</h1>');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'app.ts'), 'export const x = 1;\n');
  return root;
}

test('a missing root is an ERROR, not an empty listing', async () => {
  await assert.rejects(
    () => executeWorkspaceTool('workspace.list', { rootPath: '/no/such/place/here' }),
    /does not exist on this machine/,
  );
});

test('workspace.list reports what is really there', async () => {
  const root = fixture();
  const res = (await executeWorkspaceTool('workspace.list', { rootPath: root })) as { entries: Array<{ path: string }> };
  assert.deepEqual(res.entries.map((e) => e.path).sort(), ['index.html', 'src']);
});

test('file.read returns content; a missing file is an error, not empty text', async () => {
  const root = fixture();
  const ok = (await executeWorkspaceTool('file.read', { rootPath: root, path: 'index.html' })) as { text: string };
  assert.match(ok.text, /MigraPilot/);
  await assert.rejects(
    () => executeWorkspaceTool('file.read', { rootPath: root, path: 'nope.txt' }),
    /does not exist in this workspace/,
  );
});

test('a directory read is refused with a usable hint', async () => {
  const root = fixture();
  await assert.rejects(
    () => executeWorkspaceTool('file.read', { rootPath: root, path: 'src' }),
    /is a directory — use workspace\.list/,
  );
});

test('path traversal out of the workspace is refused', async () => {
  const root = fixture();
  for (const bad of ['../../../etc/passwd', '/etc/passwd']) {
    await assert.rejects(
      () => executeWorkspaceTool('file.read', { rootPath: root, path: bad }),
      (err: Error) => err instanceof WorkspaceToolError || /escapes the workspace root|does not exist/.test(err.message),
      bad,
    );
  }
});

test('proposeChangeset classifies create vs overwrite against the real disk', async () => {
  const root = fixture();
  const res = (await executeWorkspaceTool('fs.proposeChangeset', {
    rootPath: root,
    ops: [
      { op: 'create', path: 'src/new.ts', content: 'export const y = 2;' },
      { op: 'create', path: 'index.html', content: '<h1>replaced</h1>' },
    ],
  })) as { ops: Array<{ path: string; effect: string }>; applied: boolean; fileCount: number };
  const byPath = Object.fromEntries(res.ops.map((o) => [o.path, o.effect]));
  assert.equal(byPath['src/new.ts'], 'create');
  assert.equal(byPath['index.html'], 'overwrite', 'an existing file must be flagged as an overwrite');
  assert.equal(res.fileCount, 2);
  assert.equal(res.applied, false, 'proposing must never write');
});

test('proposeChangeset writes nothing', async () => {
  const root = fixture();
  await executeWorkspaceTool('fs.proposeChangeset', {
    rootPath: root,
    ops: [{ op: 'create', path: 'should-not-exist.txt', content: 'x' }],
  });
  await assert.rejects(
    () => executeWorkspaceTool('file.read', { rootPath: root, path: 'should-not-exist.txt' }),
    /does not exist/,
  );
});

test('an empty ops list is refused rather than proposing nothing', async () => {
  const root = fixture();
  await assert.rejects(
    () => executeWorkspaceTool('fs.proposeChangeset', { rootPath: root, ops: [] }),
    /at least one operation/,
  );
});

test('an unsupported tool is refused BY NAME, so the gap is diagnosable', async () => {
  const root = fixture();
  await assert.rejects(
    () => executeWorkspaceTool('git.blame', { rootPath: root }),
    /git\.blame is not implemented by this client yet/,
  );
});

test('git.status answers for a real repo root', async () => {
  // The extension's own repo is a git checkout; if git is unavailable the tool
  // must still FAIL rather than claim a clean tree.
  const res = await executeWorkspaceTool('git.status', { rootPath: process.cwd() }).catch((e: Error) => e);
  if (res instanceof Error) {
    assert.match(res.message, /git status failed/);
  } else {
    assert.ok(typeof (res as { clean: boolean }).clean === 'boolean');
  }
});
