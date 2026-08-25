/**
 * The acceptance gate must actually run every test it claims to.
 *
 * WHY THIS EXISTS. A test written for this service was placed in `src/engine/`
 * and reported green for an entire change: `npm test` globs
 * `dist/test/**''/*.test.js`, that file compiled somewhere else, and the suite
 * counted 1831 both before and after four new tests were added. A test that does
 * not run is worse than no test — it is a claim of coverage that nothing checks,
 * and it fails silently and permanently.
 *
 * This is the guard for the gate itself. It compares what exists in source with
 * what the runner will actually load, so a misplaced file fails loudly on the
 * first run instead of hiding.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Every `*.test.ts` under a directory, recursively. */
function testFilesUnder(root: string, relative = ''): string[] {
  const here = join(root, relative);
  if (!existsSync(here)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(here, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const next = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...testFilesUnder(root, next));
    else if (entry.name.endsWith('.test.ts')) found.push(next);
  }
  return found;
}

test('no test file lives outside the directory the runner globs', () => {
  // `npm test` runs `dist/test/**/*.test.js`. A `.test.ts` under `src/` compiles
  // to `dist/engine/...` and is never loaded, so it passes by never existing.
  const stranded = testFilesUnder(join(process.cwd(), 'src'));
  assert.deepEqual(
    stranded,
    [],
    `these would never run — move them into test/: ${stranded.join(', ')}`,
  );
});

test('every source test file has a compiled counterpart the runner will load', () => {
  /*
   * Catches the other half: a file in the right place that did not compile, or
   * one deleted from source while its stale build output keeps "passing".
   */
  const sources = testFilesUnder(join(process.cwd(), 'test')).map((f) => f.replace(/\.ts$/, '.js'));
  const compiled = new Set(
    (function walk(dir: string, rel = ''): string[] {
      const here = join(dir, rel);
      if (!existsSync(here)) return [];
      const out: string[] = [];
      for (const entry of readdirSync(here, { withFileTypes: true })) {
        const next = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) out.push(...walk(dir, next));
        else if (entry.name.endsWith('.test.js')) out.push(next);
      }
      return out;
    })(join(process.cwd(), 'dist', 'test')),
  );

  const missing = sources.filter((f) => !compiled.has(f));
  assert.deepEqual(missing, [], `written but not built, so never run: ${missing.join(', ')}`);
  // Non-vacuous: if this ever finds nothing at all, the check itself is broken.
  assert.ok(sources.length > 50, `expected the real suite, found ${sources.length} files`);
});
