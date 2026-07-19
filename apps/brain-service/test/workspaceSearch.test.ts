// Content search (`op: search`) hardening. Proves the search is CORRECT and
// BOUNDED: it finds real text, skips binary/oversized/excluded files, honors the
// result limit, and returns promptly on a junk-heavy tree instead of hanging the
// runner (the root cause of `local_runner_unavailable` timeouts). © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { workspaceSearch } from '../src/tools/workspaceSearch.js';

const NEEDLE = 'FINDME_UNIQUE_TOKEN_9x';

function tmpTree(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'migra-search-')));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), `line1\nline2\nconst x = '${NEEDLE}';\n`);

  // Binary file that CONTAINS the needle text but has a NUL byte → must be skipped.
  fs.writeFileSync(path.join(dir, 'src', 'blob.bin'), Buffer.concat([Buffer.from(NEEDLE), Buffer.from([0x00, 0x01, 0x02])]));

  // Excluded-by-default dependency dir with a match → must be skipped.
  fs.mkdirSync(path.join(dir, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'dep', 'index.js'), `${NEEDLE}\n`);

  // Caller-excluded dir with a match → must be skipped when excludeGlobs cover it.
  fs.mkdirSync(path.join(dir, 'generated'));
  fs.writeFileSync(path.join(dir, 'generated', 'g.ts'), `${NEEDLE}\n`);

  return dir;
}

test('search finds real text with correct path + line, and skips binary/excluded files', async () => {
  const dir = tmpTree();
  const res = await workspaceSearch({
    rootPath: dir,
    query: NEEDLE,
    limit: 20,
    includeGlobs: [],
    excludeGlobs: ['**/node_modules/**', '**/generated/**'],
  });

  const paths = res.matches.map((m) => m.path);
  assert.ok(paths.includes('src/a.ts'), 'must find the source match');
  assert.ok(!paths.some((p) => p.includes('blob.bin')), 'must NOT match binary content');
  assert.ok(!paths.some((p) => p.includes('node_modules')), 'must NOT match excluded deps');
  assert.ok(!paths.some((p) => p.startsWith('generated/')), 'must honor caller excludeGlobs');

  const hit = res.matches.find((m) => m.path === 'src/a.ts')!;
  assert.equal(hit.line, 3, 'reports the correct 1-based line number');
  assert.match(hit.preview, new RegExp(NEEDLE));
});

test('search honors the result limit', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'migra-search-lim-')));
  for (let i = 0; i < 5; i += 1) fs.writeFileSync(path.join(dir, `f${i}.txt`), `${NEEDLE}\n`);
  const res = await workspaceSearch({ rootPath: dir, query: NEEDLE, limit: 2, includeGlobs: [], excludeGlobs: [] });
  assert.equal(res.matches.length, 2, 'never returns more than the requested limit');
});

test('search returns promptly on a junk-heavy tree (never hangs the runner)', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'migra-search-junk-')));
  const junk = path.join(dir, 'cache');
  fs.mkdirSync(junk);
  // Many small binary files (a stand-in for a checked-in browser cache).
  const bin = Buffer.from([0x00, 0xff, 0x00, 0xff, 0x00]);
  for (let i = 0; i < 800; i += 1) fs.writeFileSync(path.join(junk, `c${i}.bin`), bin);
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'real.ts'), `${NEEDLE}\n`);

  const started = Date.now();
  const res = await workspaceSearch({ rootPath: dir, query: NEEDLE, limit: 10, includeGlobs: [], excludeGlobs: [] });
  const elapsed = Date.now() - started;

  assert.ok(res.matches.some((m) => m.path === 'src/real.ts'), 'still finds the real match past the junk');
  assert.ok(elapsed < 15_000, `returned in ${elapsed}ms — must be well-bounded`);
});
