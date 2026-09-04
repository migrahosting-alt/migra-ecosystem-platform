// engine/ is modules, not a dump.
//
// It held 52 loose files beside 19 directories — the codebase already knew how to
// organise itself and half of it had opted out. That is not cosmetic: `aiRoutes.ts`
// and `engineerRoutes.ts` sitting side by side as peers is part of why one of them
// gated on GPU capacity for weeks while the other, the product's coding agent, did
// not. Nothing about the layout said they were the same kind of thing.
//
// A flat directory has no natural stopping point, so this is enforced rather than
// agreed: the 53rd loose file is always easier to add than the first one was.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

function repoRoot(): string {
  let dir = process.cwd(); // never __dirname: this package is ESM
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('repository root not found from ' + process.cwd());
}

const ROOT = repoRoot();
const ENGINE = 'apps/brain-service/src/engine';

function engineSources(): string[] {
  return execFileSync('git', ['ls-files', '--', ENGINE], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\n')
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
}

test('every engine source file belongs to a module', () => {
  const files = engineSources();
  // A rule that matches nothing passes forever.
  assert.ok(files.length > 100, `expected the engine tree, found ${files.length} files`);

  const loose = files
    .filter((f) => path.dirname(f) === ENGINE)
    .sort();

  assert.deepEqual(
    loose,
    [],
    'these sit loose at engine/ top level instead of in a module that says what they are:\n  '
      + loose.join('\n  ')
      + '\nPut each in the directory of its domain — or add a new one if none fits.',
  );
});

test('no module is a second dumping ground', () => {
  // A "misc", "common", "shared" or "utils" bucket is a flat directory with a
  // nicer name: it accepts anything, so it explains nothing.
  const banned = new Set(['misc', 'common', 'shared', 'utils', 'helpers', 'lib']);
  const modules = new Set(
    engineSources()
      .map((f) => path.relative(ENGINE, f).split('/')[0] ?? '')
      .filter((d) => d !== '' && !d.endsWith('.ts')),
  );
  const offenders = [...modules].filter((m) => banned.has(m.toLowerCase())).sort();
  assert.deepEqual(offenders, [], `these name no domain:\n  ${offenders.join('\n  ')}`);
});
