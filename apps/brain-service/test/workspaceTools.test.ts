import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  editApply,
  diagnosticsGet,
  containedPath,
  nodeWorkspaceFs,
  WORKSPACE_TOOLS,
  WorkspaceToolError,
  type WorkspaceFs,
} from '@migrapilot/workspace-tools';

// An in-memory WorkspaceFs for deterministic containment/write tests.
function memFs(files: Record<string, string>, opts: { root: string; failWriteOn?: string; corruptReadOn?: string } = { root: '/ws' }): WorkspaceFs & { files: Record<string, string> } {
  const store = { ...files };
  return {
    files: store,
    readFile: (p) => { if (!(p in store)) throw new Error(`ENOENT ${p}`); return store[p]!; },
    writeFile: (p, c) => { if (opts.failWriteOn && p.endsWith(opts.failWriteOn)) throw new Error('disk full'); store[p] = opts.corruptReadOn && p.endsWith(opts.corruptReadOn) ? c + '<corrupt>' : c; },
    exists: (p) => p in store || p === opts.root || Object.keys(store).some((k) => k.startsWith(p + '/')),
    realPath: (p) => p, // no symlinks in memfs
    dirname: (p) => p.split('/').slice(0, -1).join('/') || '/',
    resolve: (root, rel) => path.posix.resolve(root, rel),
    isAbsolute: (p) => p.startsWith('/'),
    sep: '/',
  };
}

test('metadata: canonical classification (diagnostics.get read-only; edit.apply mutating+approval+dry-run)', () => {
  assert.deepEqual(WORKSPACE_TOOLS['diagnostics.get'], { id: 'diagnostics.get', readOnly: true, mutating: false, approvalRequired: false, supportsDryRun: false });
  assert.deepEqual(WORKSPACE_TOOLS['edit.apply'], { id: 'edit.apply', readOnly: false, mutating: true, approvalRequired: true, supportsDryRun: true });
});

test('containment: absolute path + `..` traversal are refused', () => {
  const f = memFs({ '/ws/a.ts': 'x' }, { root: '/ws' });
  assert.throws(() => containedPath('/ws', '/etc/passwd', f), (e: unknown) => e instanceof WorkspaceToolError && e.code === 'ABSOLUTE_PATH');
  assert.throws(() => containedPath('/ws', '../../etc/passwd', f), (e: unknown) => e instanceof WorkspaceToolError && e.code === 'PATH_ESCAPE');
  assert.equal(containedPath('/ws', 'a.ts', f), '/ws/a.ts');
});

test('symlink escape is refused (real temp dir)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-out-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'SECRET');
  fs.symlinkSync(outside, path.join(root, 'link')); // a symlink inside root → outside
  const nfs = nodeWorkspaceFs();
  assert.throws(
    () => containedPath(root, 'link/secret.txt', nfs),
    (e: unknown) => e instanceof WorkspaceToolError && e.code === 'PATH_ESCAPE',
    'a symlink inside the root pointing outside must be refused',
  );
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

test('dry-run: exact before/after, ZERO mutation', () => {
  const f = memFs({ '/ws/a.ts': 'l1\nl2\nl3' }, { root: '/ws' });
  const before = f.files['/ws/a.ts'];
  const out = editApply({ rootPath: '/ws', changes: [{ path: 'a.ts', startLine: 2, endLine: 2, replacement: 'X' }] }, { fs: f, mode: 'dry-run' });
  assert.equal(out.mode, 'dry-run');
  assert.equal(out.files[0]!.before, 'l1\nl2\nl3');
  assert.equal(out.files[0]!.after, 'l1\nX\nl3');
  assert.equal(out.files[0]!.changed, true);
  assert.equal(f.files['/ws/a.ts'], before, 'dry-run wrote nothing');
});

test('live: applies once + read-back verified', () => {
  const f = memFs({ '/ws/a.ts': 'l1\nl2\nl3' }, { root: '/ws' });
  const out = editApply({ rootPath: '/ws', changes: [{ path: 'a.ts', startLine: 2, endLine: 2, replacement: 'X' }] }, { fs: f, mode: 'live' });
  assert.equal(out.mode, 'live');
  assert.equal(out.files[0]!.verified, true);
  assert.equal(f.files['/ws/a.ts'], 'l1\nX\nl3');
});

test('read-back mismatch → fail closed (READBACK_MISMATCH)', () => {
  const f = memFs({ '/ws/a.ts': 'l1' }, { root: '/ws', corruptReadOn: 'a.ts' });
  assert.throws(
    () => editApply({ rootPath: '/ws', changes: [{ path: 'a.ts', startLine: 1, endLine: 1, replacement: 'Y' }] }, { fs: f, mode: 'live' }),
    (e: unknown) => e instanceof WorkspaceToolError && e.code === 'READBACK_MISMATCH',
  );
});

test('invalid range → INVALID_RANGE with NO write (validate-all-first)', () => {
  const f = memFs({ '/ws/a.ts': 'l1\nl2' }, { root: '/ws' });
  const before = f.files['/ws/a.ts'];
  assert.throws(
    () => editApply({ rootPath: '/ws', changes: [{ path: 'a.ts', startLine: 5, endLine: 6, replacement: 'Z' }] }, { fs: f, mode: 'live' }),
    (e: unknown) => e instanceof WorkspaceToolError && e.code === 'INVALID_RANGE',
  );
  assert.equal(f.files['/ws/a.ts'], before, 'no write on validation failure');
});

test('partial-write: a mid-apply write failure rolls back already-written files (all-or-nothing)', () => {
  // Two files; the SECOND write fails → the first must be rolled back to its original.
  const f = memFs({ '/ws/a.ts': 'A0', '/ws/b.ts': 'B0' }, { root: '/ws', failWriteOn: 'b.ts' });
  assert.throws(
    () => editApply({ rootPath: '/ws', changes: [
      { path: 'a.ts', startLine: 1, endLine: 1, replacement: 'A1' },
      { path: 'b.ts', startLine: 1, endLine: 1, replacement: 'B1' },
    ] }, { fs: f, mode: 'live' }),
    (e: unknown) => e instanceof WorkspaceToolError && e.code === 'PARTIAL_WRITE',
  );
  assert.equal(f.files['/ws/a.ts'], 'A0', 'first file rolled back to original');
  assert.equal(f.files['/ws/b.ts'], 'B0', 'second file never changed');
});

test('diagnostics.get: read-only, returns the injected source, touches no fs', () => {
  const items = [{ path: 'a.ts', severity: 'error' as const, code: null, source: null, message: 'boom', range: { startLine: 1, startCharacter: 1, endLine: 1, endCharacter: 2 } }];
  const res = diagnosticsGet({ rootPath: '/ws', path: 'a.ts' }, { diagnostics: { get: () => items } });
  assert.equal(res.tool, 'diagnostics.get');
  assert.deepEqual(res.items, items);
});
