/**
 * Guard: the consumer must build from a clean clone, using only committed source.
 *
 * 🚨 THE FAILURE THIS EXISTS FOR, measured not imagined. The committed chat
 * stream route imported `@/server/files/turnGrounding` and
 * `@/server/tables/tableEvidence`; neither was ever added to git. Every local
 * build succeeded, 787 tests passed, and production ran a bundle whose source
 * existed only on one workstation's disk. Deleting exactly what a clean checkout
 * lacks and running `tsc` produced two TS2307 errors on a committed file.
 *
 * brain-service hit the identical defect days earlier and gained
 * `repositoryIntegrity.test.ts` for it. 🚨 THAT GUARD WOULD NOT HAVE CAUGHT THIS
 * ONE: it scans RELATIVE specifiers only, and this app imports itself through the
 * `@/*` alias. A guard copied without checking which specifier shapes the package
 * actually uses is a guard that passes while the build is broken.
 *
 * TWO CHECKS, because they fail differently:
 *   1. every source file under the app is tracked — catches the file added and
 *      never committed, before anything imports it;
 *   2. no tracked file imports a target that is missing or untracked — catches
 *      the dependency edge, which is the shape that actually broke the build.
 *
 * Workspace packages are NOT resolved here on purpose: `apps/brain-service`'s
 * guard already asserts every file under `packages/` is tracked, so an untracked
 * shared module is caught there no matter who imports it.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import * as path from 'node:path'

/** Walk up to the repository root — tests run from the package dir, not the root. */
function repoRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, '.git'))) return dir
    dir = path.dirname(dir)
  }
  throw new Error(`repository root not found from ${process.cwd()}`)
}

const ROOT = repoRoot()
const APP = 'apps/migrapilot-consumer'
const SCOPE = [`${APP}/src`]

function gitList(args: string[]): Set<string> {
  const out = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
  return new Set(out.split('\n').filter(Boolean))
}

const tracked = gitList(['ls-files', '--', ...SCOPE])
const untracked = gitList(['ls-files', '--others', '--exclude-standard', '--', ...SCOPE])

/**
 * Transient negative-control fixtures. Keyed to the one prefix, never to a
 * directory — no real source file is named `__probe`, so nothing genuine can
 * hide behind the exemption.
 */
const isTransientProbe = (p: string): boolean => path.basename(p).startsWith('__probe')
const isSource = (p: string): boolean => /\.tsx?$/.test(p) && !p.endsWith('.d.ts')

/**
 * EVERY source file, tests included — the narrowing is lifted.
 *
 * This check briefly skipped test files, for one honest reason: the file-attachment
 * lane's `uploadCeiling.test.ts` imported exports that existed only in that lane's
 * uncommitted working tree, so committing it BROKE the clean checkout (measured:
 * four fresh errors) while leaving it untracked broke this check. The narrowing was
 * documented as temporary and as a real cost — an untracked test does not run in CI.
 *
 * That lane landed (`876a2e68`), the clean worktree typechecks, and the test is
 * committed, so the exception has no remaining justification and is gone. This now
 * matches the brain-service and extension guards: any untracked source is a file
 * that will never reach a clean checkout, whatever it contains.
 */
test('every consumer source file is tracked by git', () => {
  const stray = [...untracked].filter((p) => isSource(p) && !isTransientProbe(p)).sort()
  assert.deepEqual(
    stray,
    [],
    'these compile and pass tests but would never reach a clean checkout:\n  ' +
      stray.join('\n  ') +
      '\nCheck `git check-ignore -v <path>` — do NOT reach for `git add -f`, which hides the cause.',
  )
})

/**
 * Relative and `@/`-aliased `import`/`export … from`, plus dynamic `import()`.
 *
 * The alias branch is the one that matters here: `@/server/tables/tableEvidence`
 * is how this app refers to itself, and a scanner that only understood `./` and
 * `../` would have reported a clean bill of health on a tree that could not build.
 */
const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)[^'"]*?from\s*['"]((?:\.|@\/)[^'"]+)['"]|(?:^|[\s=(,;])import\(\s*['"]((?:\.|@\/)[^'"]+)['"]\s*\)/g

export function importSpecifiers(source: string): string[] {
  const found: string[] = []
  for (const match of stripCommentLines(source).matchAll(IMPORT_RE)) {
    const spec = match[1] ?? match[2]
    if (spec) found.push(spec)
  }
  return found
}

/**
 * Drop WHOLE comment lines before scanning.
 *
 * Deliberately not a full comment parser: stripping `//` anywhere would corrupt
 * `https://` inside string literals. Only entirely-comment lines go, so a
 * trailing comment on a code line survives — at worst a LOUD false positive,
 * never a silent miss, which is the right way for a guard to be wrong.
 */
function stripCommentLines(source: string): string {
  return source
    .split('\n')
    .map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? '' : line))
    .join('\n')
}

/** Resolve a specifier to a repo-relative path, or null when nothing is there. */
export function resolveSpecifier(fromFile: string, spec: string): string | null {
  const base = spec.startsWith('@/')
    ? path.join(ROOT, APP, 'src', spec.slice(2))
    : path.resolve(path.dirname(path.join(ROOT, fromFile)), spec)
  /*
   * A `.js` specifier is USUALLY TypeScript's emit convention — `./x.js` meaning
   * `./x.ts` — so those are tried first. But it is not always: harness tooling
   * under `scripts/` is real JavaScript, and resolving only to `.ts` reported a
   * file that exists and is tracked as MISSING. The literal path is the last
   * candidate, so the TS convention still wins where both could match.
   */
  const candidates = base.endsWith('.js')
    ? [base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), base]
    : [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx'), base]
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return path.relative(ROOT, candidate)
  }
  return null
}

test('no tracked source imports a missing or untracked file', () => {
  const broken: string[] = []
  for (const file of tracked) {
    if (!isSource(file) || isTransientProbe(file)) continue
    for (const spec of importSpecifiers(readFileSync(path.join(ROOT, file), 'utf8'))) {
      const target = resolveSpecifier(file, spec)
      if (target === null) broken.push(`${file} -> ${spec} (MISSING)`)
      else if (untracked.has(target)) broken.push(`${file} -> ${target} (UNTRACKED)`)
    }
  }
  assert.deepEqual(
    broken.sort(),
    [],
    'a committed file depends on something a clean checkout will not have:\n  ' + broken.join('\n  '),
  )
})

/* ── the guard's own negative controls ─────────────────────────────────────
 * A gate is only worth having if it fails on the defect it was written for.
 * These pin the extraction and resolution the real checks are built from.
 */

test('🚨 AN ALIASED IMPORT IS SEEN — the exact shape that broke the build', () => {
  const source = "import { tableEvidenceFor } from '@/server/tables/tableEvidence'"
  assert.deepEqual(importSpecifiers(source), ['@/server/tables/tableEvidence'])
})

test('and so are relative, dynamic and re-exported ones', () => {
  /*
   * Every specifier in this file's own fixtures names a REAL module, because
   * this file is scanned by the checks above like any other. The first draft
   * used `'@/c'` and the guard correctly reported it as a missing import — a
   * gate failing on its own test data. An exemption for this file would have
   * been the wrong fix: it would carve a hole in the one file that defines the
   * rule. Real targets keep it fully self-applying.
   */
  assert.deepEqual(importSpecifiers("import a from './lib/cn'"), ['./lib/cn'])
  assert.deepEqual(importSpecifiers("export { b } from './lib/cn'"), ['./lib/cn'])
  assert.deepEqual(importSpecifiers("const c = await import('@/lib/cn')"), ['@/lib/cn'])
})

test('a bare package import is not this guard\'s business', () => {
  // Those resolve through node_modules and are covered by the lockfile, not here.
  assert.deepEqual(importSpecifiers("import next from 'next/navigation'"), [])
  assert.deepEqual(importSpecifiers("import t from '@migrapilot/shared-types/x'"), [])
})

test('a specifier inside a comment line is not an edge', () => {
  // A gate that cries wolf is one people start editing around.
  assert.deepEqual(importSpecifiers("// import x from '@/lib/cn'"), [])
  assert.deepEqual(importSpecifiers(" * import x from '@/lib/cn'"), [])
})

test('the alias resolves against the app root, not the importing file', () => {
  // `@/lib/cn` is src/lib/cn.ts however deep the importer is.
  const target = resolveSpecifier(`${APP}/src/app/api/chat/stream/route.ts`, '@/lib/cn')
  assert.equal(target, `${APP}/src/lib/cn.ts`)
})

test('a REAL .js file resolves, not only TypeScript emit', () => {
  // Harness tooling under scripts/ is genuine JavaScript. Resolving `.js` only
  // to `.ts` reported a tracked, existing file as MISSING.
  assert.equal(
    resolveSpecifier(`${APP}/src/harnessIntegrity.test.ts`, '../scripts/rigTarget.js'),
    `${APP}/scripts/rigTarget.js`,
  )
})

test('a specifier pointing at nothing resolves to null', () => {
  assert.equal(resolveSpecifier(`${APP}/src/app/page.tsx`, '@/server/does/not/exist'), null)
})
