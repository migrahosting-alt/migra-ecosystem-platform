// Guard: no source file may exist only in the working tree.
//
// The repository root .gitignore is an ALLOWLIST — `*` ignores everything, and each
// tracked tree is re-admitted by an explicit negation. That design is deliberate, but
// it has one dangerous failure mode: add a directory nobody negated, and its files are
// silently ignored. They compile, they pass tests, and they never enter the PR.
//
// `git add -f` masks exactly this. It is the habit this guard exists to make unnecessary
// — a forced add succeeds whether or not the path was ignored, so it can never tell you
// that something was wrong.

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const EXT_ROOT = join(__dirname, '..', '..', '..');
const SRC = join(EXT_ROOT, 'src');

/** Generated or installed trees, legitimately untracked. */
const EXCLUDED = new Set(['node_modules', 'dist', 'out', '.vscode-test']);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (EXCLUDED.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (name.endsWith('.ts') || name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

function trackedSet(): Set<string> {
  const out = execFileSync('git', ['ls-files', '--', 'src', 'scripts'], {
    cwd: EXT_ROOT,
    encoding: 'utf8',
  });
  return new Set(out.split('\n').filter(Boolean).map((p) => p.split('/').join(sep)));
}

test('every extension source file is tracked by git', () => {
  const tracked = trackedSet();
  const untracked = [...sources(SRC), ...sources(join(EXT_ROOT, 'scripts'))]
    .map((p) => relative(EXT_ROOT, p))
    .filter((p) => !tracked.has(p))
    .sort();

  assert.deepEqual(
    untracked,
    [],
    'these compile and pass tests but would never reach the PR:\n' +
      untracked.map((p) => `  ${p}`).join('\n') +
      '\nCheck `git check-ignore -v <path>` — do NOT reach for `git add -f`, which hides the cause.',
  );
});

test('the guard is not vacuous — it does see the real source tree', () => {
  const found = sources(SRC);
  assert.ok(found.length > 100, `expected the full source tree, found ${found.length} files`);
  assert.ok(trackedSet().size > 100, 'git ls-files returned an implausibly small set');
});

test('no ignored file was force-added into the tree', () => {
  const forced = execFileSync('git', ['ls-files', '-i', '-c', '--exclude-standard', '--', '.'], {
    cwd: EXT_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  assert.deepEqual(forced, [], `tracked despite being ignored (a forced add):\n${forced.join('\n')}`);
});
