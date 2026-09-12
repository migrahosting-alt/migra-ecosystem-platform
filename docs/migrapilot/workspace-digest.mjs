#!/usr/bin/env node
/**
 * IDENTIFY ONE WORKSPACE PACKAGE, THE WAY NODE WILL LOAD IT.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY THIS EXISTS
 *
 * `chat-platform-rc-0907` aborted at the boot test with
 *
 *   SyntaxError: The requested module '@migrapilot/shared-types/outcome-plan'
 *   does not provide an export named 'STEP_LABEL'
 *
 * The release ships `dist` + `package.json` and then HARDLINKS node_modules
 * from the previous release. `@migrapilot/shared-types` lives inside that
 * node_modules as a copied directory, so the release inherited a build from
 * three days earlier. The repo resolves the same specifier through a workspace
 * SYMLINK to freshly built output, so every local gate passed.
 *
 * The export map is the other half: `types → ./src/*.ts`, `default →
 * ./dist/*.js`. TypeScript reads SOURCE, Node reads DIST. `tsc --noEmit` and
 * 2484 tests were satisfied by source that the artifact never carried.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT PRINTS, AND WHY THAT SHAPE
 *
 * A digest over the RUNTIME FILES — the ones Node actually loads — plus the
 * resolved export targets, so a comparison can say WHICH package differs and
 * whether the difference is a missing file or changed bytes.
 *
 * Digesting `dist` rather than the source tree is deliberate: source can differ
 * legitimately (comments stripped, tests absent from `files`), and what must
 * match is what the process will execute.
 *
 * Run with no arguments for JSON on stdout:
 *   node workspace-digest.mjs <package-dir>
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? '.');

const fail = (message) => {
  console.log(JSON.stringify({ ok: false, dir, error: message }));
  process.exit(0); // Reported as data; the CALLER decides to fail.
};

if (!existsSync(join(dir, 'package.json'))) fail('no package.json — package is missing from the artifact');

let pkg;
try {
  pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
} catch (error) {
  fail(`unreadable package.json: ${error.message}`);
}

/**
 * Every path an `exports` map can send Node to, under RUNTIME conditions.
 *
 * `types` is deliberately ignored: it points at TypeScript source that the
 * published package does not ship and the process never loads. Including it
 * would make the check fail on a correctly staged package — and, worse, could
 * be "fixed" by shipping source, which is the wrong lesson entirely.
 */
function runtimeTargets(exportsField) {
  const out = [];
  const walk = (node) => {
    if (typeof node === 'string') {
      if (node.startsWith('./')) out.push(node);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [condition, value] of Object.entries(node)) {
      if (condition === 'types') continue;
      walk(value);
    }
  };
  walk(exportsField);
  return [...new Set(out)];
}

const targets = runtimeTargets(pkg.exports ?? (pkg.main ? { '.': pkg.main } : {}));
const missing = targets.filter((t) => !existsSync(join(dir, t)));

/** Every runtime file, in a stable order, hashed by path AND content. */
function digestOf(root) {
  const files = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      // Source maps and declarations do not affect execution and churn freely.
      else if (/\.(js|cjs|mjs|json)$/.test(entry.name)) files.push(full);
    }
  };
  if (!existsSync(root)) return { digest: null, files: 0 };
  walk(root);
  const h = createHash('sha256');
  for (const file of files) {
    h.update(relative(root, file));
    h.update(readFileSync(file));
  }
  return { digest: h.digest('hex'), files: files.length };
}

const distRoot = join(dir, 'dist');
const { digest, files } = digestOf(distRoot);

console.log(
  JSON.stringify({
    ok: missing.length === 0 && digest !== null,
    name: pkg.name,
    version: pkg.version,
    // Only the SHAPE of the package is reported — never file contents, never
    // anything from the environment.
    runtimeTargets: targets.length,
    missingTargets: missing,
    distFiles: files,
    distDigest: digest,
    ...(digest === null ? { error: 'no dist/ directory — nothing for Node to load' } : {}),
    ...(missing.length ? { error: `export targets missing from the artifact: ${missing.join(', ')}` } : {}),
  }),
);
