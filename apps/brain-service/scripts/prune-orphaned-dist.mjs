#!/usr/bin/env node
/**
 * DELETE COMPILED OUTPUT WHOSE SOURCE IS GONE.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY THIS EXISTS
 *
 * `npm test` is `tsc -b && node --test dist/test/**‍/*.test.js`. It runs the
 * COMPILED tree, and `tsc` never removes an output whose input disappeared. So
 * deleting a test file does not stop it running: the stale `.js` keeps being
 * globbed, keeps executing, and keeps failing.
 *
 * Measured: a test was removed from the source tree and the full gate still
 * reported the identical 3241 tests with the identical 3 failures, because
 * `dist/test/engineerPromptGuardrails.test.js` from an earlier build was still
 * there. The release gate was enforcing a file that no longer existed in the
 * repository, and no amount of reading the source could explain it.
 *
 * `npm run clean` fixes it by deleting everything, which costs a full rebuild
 * on every test run. This deletes only what is genuinely orphaned.
 *
 * Deliberately narrow: it removes a `dist/**‍/*.js` (and its `.d.ts`/maps) ONLY
 * when the corresponding `.ts` under the source root is absent. It never
 * touches output that still has a source, so it cannot mask a compile failure.
 */
import { readdir, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const app = path.resolve(here, '..');
const dist = path.join(app, 'dist');

if (!existsSync(dist)) process.exit(0);

/** Every file under a directory, recursively. */
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

/**
 * The source file a compiled artifact came from.
 *
 * `dist/` mirrors the app root, so `dist/test/x.test.js` came from
 * `test/x.test.ts` and `dist/src/a/b.js` from `src/a/b.ts`.
 */
function sourceFor(distFile) {
  const rel = path.relative(dist, distFile);
  const withoutExt = rel.replace(/\.(js|d\.ts)(\.map)?$/, '');
  return path.join(app, `${withoutExt}.ts`);
}

const files = await walk(dist);
let removed = 0;
for (const file of files) {
  if (!/\.(js|d\.ts)(\.map)?$/.test(file)) continue;
  const src = sourceFor(file);
  if (existsSync(src)) continue;
  // A `.tsx` source is possible in principle; check before deleting.
  if (existsSync(src.replace(/\.ts$/, '.tsx'))) continue;
  await unlink(file);
  removed += 1;
  console.log(`  pruned orphan: ${path.relative(app, file)}`);
}
if (removed > 0) console.log(`prune-orphaned-dist: removed ${removed} file(s) with no source`);

// A non-zero count is normal and not an error; the gate continues.
await stat(dist);
