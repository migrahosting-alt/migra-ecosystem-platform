import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const repo = path.resolve(__dirname, '../../../../..');
const extensionRoot = path.join(repo, 'apps/vscode-extension');

test('review source bundle and VSIX ignore generated TypeScript build state', () => {
  const fakeRoot = path.join(extensionRoot, 'fake-root.tsbuildinfo');
  const fakeNested = path.join(extensionRoot, 'src/test/unit/fake-nested.tsbuildinfo');
  writeFileSync(fakeRoot, 'compiler-state');
  writeFileSync(fakeNested, 'compiler-state');
  try {
    const listed = spawnSync(process.execPath, ['apps/brain-service/scripts/review-source-bundle.mjs'], { cwd: repo, encoding: 'utf8' });
    assert.equal(listed.status, 0, listed.stderr);
    assert.doesNotMatch(listed.stdout, /fake-root\.tsbuildinfo|fake-nested\.tsbuildinfo/);

    const ignored = spawnSync('npx', ['--no-install', 'vsce', 'ls', '--no-dependencies'], { cwd: extensionRoot, encoding: 'utf8' });
    assert.equal(ignored.status, 0, ignored.stderr);
    assert.doesNotMatch(ignored.stdout, /\.tsbuildinfo/);
  } finally {
    rmSync(fakeRoot, { force: true });
    rmSync(fakeNested, { force: true });
  }
  assert.equal(existsSync(fakeRoot), false);
  assert.equal(existsSync(fakeNested), false);
});
