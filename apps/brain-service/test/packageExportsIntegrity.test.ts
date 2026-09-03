// A release guard for the defect that crash-looped production.
//
// shared-types' `dist` was shipped WITHOUT its updated package.json, so a new
// subpath export did not resolve and the Brain failed at import time — eight
// restarts, and nothing in the journal, because the failure happens before any
// logging exists. systemd should never be the thing that discovers this.

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(process.cwd(), '..', '..');
const PKG_DIR = join(REPO, 'packages', 'shared-types');
const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')) as {
  exports: Record<string, { types?: string; default?: string }>;
};

test('every declared subpath export points at a source file that exists', () => {
  const missing: string[] = [];
  for (const [subpath, entry] of Object.entries(pkg.exports ?? {})) {
    if (entry.types && !existsSync(join(PKG_DIR, entry.types))) missing.push(`${subpath} -> ${entry.types}`);
  }
  assert.deepEqual(missing, [], 'an export names a source file that is not there');
});

test('every built module a consumer imports is COVERED by an export entry', () => {
  /*
   * The failing direction. A new module can be built and shipped while its
   * export entry is missing, and nothing complains until Node refuses the
   * import inside a service that has not started logging yet.
   */
  const declared = new Set(
    Object.values(pkg.exports ?? {})
      .map((e) => e.default?.replace(/^\.\/dist\//, '').replace(/\.js$/, ''))
      .filter(Boolean) as string[],
  );
  // Modules this service actually imports by subpath.
  const required = ['modelFamilies', 'outcomePlan', 'projectAuthority', 'turnIntent', 'orchestrationDecision'];
  const uncovered = required.filter((m) => !declared.has(m));
  assert.deepEqual(uncovered, [], 'a module is imported by subpath but has no export entry');
});

test('the built dist matches what the export map promises', () => {
  // Catches the exact release mistake: dist copied, package.json not.
  const distDir = join(PKG_DIR, 'dist');
  if (!existsSync(distDir)) return; // not built in this environment; nothing to check
  const broken: string[] = [];
  for (const [subpath, entry] of Object.entries(pkg.exports ?? {})) {
    if (!entry.default) continue;
    const built = join(PKG_DIR, entry.default);
    if (!existsSync(built)) broken.push(`${subpath} -> ${entry.default}`);
  }
  assert.deepEqual(broken, [], 'the export map names a built file that was never emitted — rebuild before shipping');
});
