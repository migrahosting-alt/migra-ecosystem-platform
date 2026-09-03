// Guard: the Brain must build from a clean clone, using only committed source.
//
// THE FAILURE THIS EXISTS FOR. `server.ts`, `documentJobs.ts` and `indexService.ts`
// were committed importing five RAG modules that were never added to git. Every
// local build succeeded, every test passed, and the deployed service ran compiled
// output whose source existed in exactly two places: one workstation's disk, and
// production's own dist. A clean worktree could not build the Brain at all, and
// nothing said so until someone tried it.
//
// The extension has had an equivalent guard for a while — it is what caught a test
// file of mine that would never have reached CI. brain-service had none, which is
// the whole reason this went unnoticed for as long as it did.
//
// TWO CHECKS, because they fail differently:
//   1. every source file under the Brain is tracked — catches the file added and
//      never committed, even before anything imports it;
//   2. no tracked file imports a target that is missing or untracked — catches the
//      dependency edge itself, including into packages/, which is the shape that
//      actually broke the build.
//
// The root .gitignore is an ALLOWLIST (`*`, then explicit negations). A directory
// nobody negated is silently ignored, so "it compiles" can never be the standard.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

/** Walk up to the repository root — tests run from the package dir, not the root. */
function repoRoot(): string {
  let dir = process.cwd(); // never __dirname: this package is ESM, where it is undefined
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('repository root not found from ' + process.cwd());
}

const ROOT = repoRoot();
const SCOPE = ['apps/brain-service/src', 'apps/brain-service/test', 'packages'];

function gitList(args: string[]): Set<string> {
  const out = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  return new Set(out.split('\n').filter(Boolean));
}

const tracked = gitList(['ls-files', '--', ...SCOPE]);
const untracked = gitList(['ls-files', '--others', '--exclude-standard', '--', ...SCOPE]);

/**
 * Transient negative-control fixtures: a few tests write a probe file into the
 * source tree, scan it, and delete it. Keyed to the one prefix, never to a
 * directory — a real source file is never named `__probe`, so nothing genuine
 * can hide behind the exemption.
 */
const isTransientProbe = (p: string) => path.basename(p).startsWith('__probe');

const isSource = (p: string) => /\.tsx?$/.test(p) && !p.endsWith('.d.ts');

test('every Brain source file is tracked by git', () => {
  const stray = [...untracked].filter((p) => isSource(p) && !isTransientProbe(p)).sort();
  assert.deepEqual(
    stray,
    [],
    'these compile and pass tests but would never reach a clean checkout:\n  ' +
      stray.join('\n  ') +
      '\nCheck `git check-ignore -v <path>` — do NOT reach for `git add -f`, which hides the cause.',
  );
});

/** Relative `import`/`export ... from` and dynamic `import()` specifiers.
 *
 * The dynamic branch requires the character before `import(` to be a code
 * position. Without that, this guard flagged a real file over the phrase
 * `` `import('../dist/...')` `` written inside a comment — a false positive, and
 * a gate that cries wolf is one people start editing around. */
const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]|(?:^|[\s=(,;])import\(\s*['"](\.[^'"]+)['"]\s*\)/g;

/**
 * Drop WHOLE comment lines before scanning.
 *
 * Deliberately not a full comment parser: stripping `//` anywhere would corrupt
 * `https://` inside string literals, and tracking string state breaks on regex
 * literals that themselves contain quotes — this very file has one. Only lines
 * that are entirely comment are removed, so a trailing comment on a code line
 * survives. That can at worst produce a LOUD false positive, never a silent miss,
 * which is the right way for a guard to be wrong.
 */
function stripCommentLines(src: string): string {
  return src
    .split('\n')
    .map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? '' : line))
    .join('\n');
}

/** Resolve a TS-style specifier — `./x.js` means `./x.ts` on disk. */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec);
  const candidates = base.endsWith('.js')
    ? [base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx')]
    : [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), base];
  for (const c of candidates) if (existsSync(c) && statSync(c).isFile()) return path.relative(ROOT, c);
  return null;
}

test('no tracked source imports a missing or untracked file', () => {
  const broken: string[] = [];
  for (const file of tracked) {
    if (!isSource(file)) continue;
    const src = stripCommentLines(readFileSync(path.join(ROOT, file), 'utf8'));
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      const target = resolveSpecifier(file, spec);
      if (target === null) broken.push(`${file} -> ${spec} (MISSING)`);
      else if (untracked.has(target)) broken.push(`${file} -> ${target} (UNTRACKED)`);
    }
  }
  assert.deepEqual(
    broken.sort(),
    [],
    'a committed file depends on something a clean checkout will not have:\n  ' + broken.join('\n  '),
  );
});
