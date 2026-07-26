import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Exclusions, DEFAULT_MIGRAAI_EXCLUSIONS } from '../src/engine/rag/exclusions.js';
import { FsFileSource } from '../src/engine/rag/fsFileSource.js';

/**
 * `.gitignore` negation support.
 *
 * The exclusion parser used to DROP every `!` line ("bias to exclude"). For an
 * allowlist-style repository — `*` followed by `!` re-inclusions, which is how
 * the MigraTeck platform repo is written — that excluded all 351 top-level
 * entries. `FsFileSource.files()` returned `[]` in 5 ms, and every sync durably
 * committed an EMPTY index while still incrementing the version, so the workspace
 * sat at `files: 0, chunks: 0, pendingSync: true` forever.
 *
 * These tests pin the corrected contract: negation, last-match-wins, traversal
 * into directories whose descendants are re-included, and — critically — that
 * hard exclusions (secrets, `.git`, build output, databases) remain ABSOLUTE and
 * cannot be resurrected by a broad negation.
 */

// ── 1. Allowlist repository ──────────────────────────────────────────────────

test('allowlist .gitignore: `*` plus negations re-includes the listed paths', () => {
  const excl = new Exclusions({
    gitignore: ['*', '!.gitignore', '!package.json', '!apps/', '!apps/**'].join('\n'),
  });

  assert.equal(excl.isExcluded('.gitignore'), false, '.gitignore is re-included');
  assert.equal(excl.isExcluded('package.json'), false, 'package.json is re-included');
  assert.equal(excl.isExcluded('apps', true), false, 'the apps directory is re-included');
  assert.equal(excl.isExcluded('apps/brain-service/src/server.ts'), false, 'apps/** is re-included');

  // Anything not on the allowlist stays excluded.
  for (const unlisted of ['README.md', 'tsconfig.json', 'scripts/deploy.sh', 'docs/notes.md']) {
    assert.equal(excl.isExcluded(unlisted), true, `unlisted root must stay excluded: ${unlisted}`);
  }
});

test('the real MigraTeck allowlist shape no longer excludes everything', () => {
  // The exact shape of this repository's root .gitignore.
  const excl = new Exclusions({
    gitignore: [
      '# Ignore everything by default',
      '*',
      '!.gitignore',
      '!/package-lock.json',
      '!.github/',
      '!.github/**',
      '!infra/',
      '!infra/nginx/',
      '!infra/nginx/**',
    ].join('\n'),
    extra: DEFAULT_MIGRAAI_EXCLUSIONS,
  });

  assert.equal(excl.isExcluded('.github/workflows/ci.yml'), false, 'allowlisted workflow is indexable');
  assert.equal(excl.isExcluded('infra/nginx/nginx.conf'), false, 'allowlisted nginx config is indexable');
  assert.equal(excl.shouldDescend('.github'), true, 'the walk must enter .github');
  assert.equal(excl.shouldDescend('infra'), true, 'the walk must enter infra to reach infra/nginx');
  assert.equal(excl.isExcluded('apps/web/src/main.ts'), true, 'untracked source stays excluded — gitignore is honoured');
});

// ── 2. Last match wins ───────────────────────────────────────────────────────

test('last matching rule wins', () => {
  const excl = new Exclusions({ gitignore: '*.log\n!important.log' });
  assert.equal(excl.isExcluded('debug.log'), true, 'the broad rule still excludes');
  assert.equal(excl.isExcluded('important.log'), false, 'the later negation wins');
  assert.equal(excl.isExcluded('logs/important.log'), false, 'unanchored negation matches at any depth');

  // Order matters: reversing them means the negation is overridden again.
  const reversed = new Exclusions({ gitignore: '!important.log\n*.log' });
  assert.equal(reversed.isExcluded('important.log'), true, 'a later broad rule re-excludes');
});

// ── 3. Directory re-inclusion drives traversal ───────────────────────────────

test('traversal enters a directory whose contents are re-included', () => {
  // Anchored negations (`/src/`, `src/**`) let traversal be pruned precisely.
  const excl = new Exclusions({ gitignore: '*\n!/src/\n!src/**' });
  assert.equal(excl.shouldDescend('src'), true, 'the walk MUST enter src');
  assert.equal(excl.isExcluded('src/index.ts'), false, 'src contents are indexable');
  assert.equal(excl.shouldDescend('unrelated'), false, 'no anchored negation can reach here — prune');
});

test('an unanchored negation does NOT reach a nested copy under an excluded parent', () => {
  // `!src/` is unanchored and matches a directory named src at any depth — but
  // `unrelated` is excluded, so git never descends and sub/src stays ignored.
  // Verified with git: `sub/src/app.ts` is IGNORED under `*` + `!src/` + `!src/**`.
  const excl = new Exclusions({ gitignore: '*\n!src/\n!src/**' });
  assert.equal(excl.isExcluded('src/index.ts'), false, 'the ROOT src is re-included');
  assert.equal(excl.isExcluded('unrelated/src/app.ts'), true, 'a nested src under an excluded parent is not');
  assert.equal(excl.shouldDescend('unrelated'), false, 'and the walk prunes there');
});

test('a negation CANNOT reach through an excluded parent directory', () => {
  // Verified against `git check-ignore`: with `infra` excluded and only
  // `!infra/nginx/**` negated, git ignores infra/nginx/nginx.conf. Git stops at
  // the excluded directory, so the deeper negation never applies.
  const excl = new Exclusions({ gitignore: '*\n!infra/nginx/**' });
  assert.equal(excl.isExcluded('infra', true), true, 'infra is excluded');
  assert.equal(excl.isExcluded('infra/nginx/nginx.conf'), true, 'and nothing inside it can be re-included');
  assert.equal(excl.shouldDescend('infra'), false, 'so the walk must not enter it');
  assert.equal(excl.reason('infra/nginx/nginx.conf'), 'excluded-parent', 'the reason names the real cause');

  // Re-including each ancestor is what actually works.
  const fixed = new Exclusions({ gitignore: '*\n!infra/\n!infra/nginx/\n!infra/nginx/**' });
  assert.equal(fixed.isExcluded('infra/nginx/nginx.conf'), false, 'ancestors re-included → tracked');
  assert.equal(fixed.shouldDescend('infra'), true);
});

// ── 4. Re-exclusion after inclusion ──────────────────────────────────────────

test('a later rule can re-exclude a subtree that was re-included', () => {
  // `!src/` is required: without re-including the DIRECTORY, git ignores the whole
  // subtree and the re-exclusion below would be moot (verified with git).
  const excl = new Exclusions({ gitignore: '*\n!src/\n!src/**\nsrc/generated/**' });
  assert.equal(excl.isExcluded('src/app.ts'), false, 're-included source');
  assert.equal(excl.isExcluded('src/generated/api.ts'), true, 're-excluded subtree wins (declared last)');
  assert.equal(excl.isExcluded('src/nested/deep/file.ts'), false, 'siblings remain re-included');
});

// ── 5. Ordinary .gitignore behaviour is unchanged ────────────────────────────

test('a conventional .gitignore still behaves exactly as before', () => {
  const excl = new Exclusions({ gitignore: 'private/\n*.local\nbuild/\n/only-root.txt', extra: DEFAULT_MIGRAAI_EXCLUSIONS });
  assert.equal(excl.isExcluded('private/secret.txt'), true, 'directory pattern excludes contents');
  assert.equal(excl.isExcluded('notes.local'), true, 'glob pattern');
  assert.equal(excl.isExcluded('build/main.js'), true, 'build directory');
  assert.equal(excl.isExcluded('only-root.txt'), true, 'anchored pattern at root');
  assert.equal(excl.isExcluded('nested/only-root.txt'), false, 'anchored pattern does NOT match deeper');
  assert.equal(excl.isExcluded('src/index.ts'), false, 'normal source is indexable');
  assert.equal(excl.isExcluded('model-qualification.json'), true, 'MigraAI list still applies');
});

test('directory patterns do not match a same-named FILE', () => {
  // `private` is deliberately NOT one of the hard-excluded generated directory
  // names (build/dist/out/...), so this isolates the dirOnly rule itself.
  const excl = new Exclusions({ gitignore: 'private/' });
  assert.equal(excl.isExcluded('private', true), true, 'the directory is excluded');
  assert.equal(excl.isExcluded('private/secret.txt'), true, 'its contents are excluded');
  assert.equal(excl.isExcluded('private'), false, 'a FILE named private is not a directory match');
  // A non-directory pattern still matches either kind.
  const loose = new Exclusions({ gitignore: 'private' });
  assert.equal(loose.isExcluded('private'), true);
  assert.equal(loose.isExcluded('private', true), true);
});

test('hard-excluded directory names are excluded whether or not gitignore says so', () => {
  // `build` matches GENERATED_DIR, so it is excluded as a file OR a directory
  // even with an empty .gitignore — tier 1 does not consult tier 2.
  const excl = new Exclusions({});
  assert.equal(excl.isExcluded('build', true), true);
  assert.equal(excl.isExcluded('build'), true, 'hard exclusions are not directory-sensitive');
  assert.equal(excl.reason('build'), 'generated');
});

test('patterns containing a literal space are not corrupted', () => {
  // The old parser used a space as its `**` placeholder, so any pattern with a
  // real space became `.*` and over-matched.
  const excl = new Exclusions({ gitignore: 'my notes.txt' });
  assert.equal(excl.isExcluded('my notes.txt'), true, 'the literal-space pattern matches itself');
  assert.equal(excl.isExcluded('myXnotes.txt'), false, 'and does not become a wildcard');
});

test('paths normalize consistently regardless of separators or prefixes', () => {
  // `!src/` is required alongside `!src/**` — see the excluded-parent rule.
  const excl = new Exclusions({ gitignore: '*\n!src/\n!src/**' });
  for (const variant of ['src/a.ts', 'src\\a.ts', './src/a.ts', '/src/a.ts']) {
    assert.equal(excl.isExcluded(variant), false, `normalized form must be re-included: ${variant}`);
  }
});

// ── Hard exclusions remain ABSOLUTE ──────────────────────────────────────────

test('a broad negation can NEVER resurrect secrets, .git, build output or databases', () => {
  // The most hostile input: re-include literally everything.
  const excl = new Exclusions({ gitignore: '*\n!**\n!.git/**\n!node_modules/**\n!.env', extra: DEFAULT_MIGRAAI_EXCLUSIONS });

  for (const forbidden of [
    '.env',
    '.env.production',
    'config/secrets.yaml',
    'server.key',
    'certs/site.pem',
    'data/app.sqlite',
    'backup/dump.sql',
    '.git/config',
    '.git/HEAD',
    'node_modules/react/index.js',
    'dist/bundle.js',
    'build/out.js',
    'coverage/lcov.info',
    'package-lock.json',
    'types/index.d.ts',
    'assets/logo.png',
    'model.gguf',
    'model-qualification.json',
    '.migra/state.json',
  ]) {
    assert.equal(excl.isExcluded(forbidden), true, `hard exclusion must survive negation: ${forbidden}`);
  }

  // And the walk must never enter them.
  for (const dir of ['.git', 'node_modules', 'dist', 'build', 'coverage', '.migra']) {
    assert.equal(excl.shouldDescend(dir), false, `must never descend into ${dir}`);
  }
});

test('reason() reports the tier that excluded a path', () => {
  const excl = new Exclusions({ gitignore: '*\n!src/\n!src/**', extra: DEFAULT_MIGRAAI_EXCLUSIONS });
  assert.equal(excl.reason('.env'), 'secret');
  assert.equal(excl.reason('logo.png'), 'binary');
  assert.equal(excl.reason('dist/app.js'), 'generated');
  assert.equal(excl.reason('model-qualification.json'), 'exclusion-list');
  assert.equal(excl.reason('README.md'), 'gitignore');
  assert.equal(excl.reason('src/index.ts'), null, 're-included source has no exclusion reason');
});

// ── End-to-end through the real file source ──────────────────────────────────

test('FsFileSource discovers files in an allowlist repository (the original fault)', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'migraai-allowlist-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // An allowlist repo, shaped like the real one.
  writeFileSync(
    path.join(root, '.gitignore'),
    ['# Ignore everything by default', '*', '!.gitignore', '!src/', '!src/**', '!docs/', '!docs/**'].join('\n'),
  );
  mkdirSync(path.join(root, 'src/deep'), { recursive: true });
  mkdirSync(path.join(root, 'docs'), { recursive: true });
  mkdirSync(path.join(root, 'node_modules/pkg'), { recursive: true });
  mkdirSync(path.join(root, '.git'), { recursive: true });
  writeFileSync(path.join(root, 'src/index.ts'), 'export const a = 1;\n');
  writeFileSync(path.join(root, 'src/deep/nested.ts'), 'export const b = 2;\n');
  writeFileSync(path.join(root, 'docs/guide.md'), '# Guide\n');
  writeFileSync(path.join(root, 'untracked.txt'), 'not on the allowlist\n');
  writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
  writeFileSync(path.join(root, 'node_modules/pkg/index.js'), 'module.exports = 1;\n');
  writeFileSync(path.join(root, '.git/config'), '[core]\n');

  const files = await new FsFileSource(root).files();
  const found = files.map((f) => f.relPath).sort();

  // THE REGRESSION: this used to be [].
  assert.ok(found.length > 0, 'an allowlist repository must yield files');
  assert.deepEqual(found, ['.gitignore', 'docs/guide.md', 'src/deep/nested.ts', 'src/index.ts']);

  for (const forbidden of ['untracked.txt', '.env', 'node_modules/pkg/index.js', '.git/config']) {
    assert.ok(!found.includes(forbidden), `must not be indexed: ${forbidden}`);
  }
});

test('FsFileSource still honours a conventional .gitignore', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'migraai-conventional-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(path.join(root, '.gitignore'), ['private/', '*.local', 'build/'].join('\n'));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  mkdirSync(path.join(root, 'private'), { recursive: true });
  mkdirSync(path.join(root, 'build'), { recursive: true });
  writeFileSync(path.join(root, 'src/app.ts'), 'export const x = 1;\n');
  writeFileSync(path.join(root, 'notes.local'), 'local\n');
  writeFileSync(path.join(root, 'private/secret.txt'), 'shh\n');
  writeFileSync(path.join(root, 'build/out.js'), 'built\n');
  writeFileSync(path.join(root, 'README.md'), '# Readme\n');

  const found = (await new FsFileSource(root).files()).map((f) => f.relPath).sort();
  assert.deepEqual(found, ['.gitignore', 'README.md', 'src/app.ts']);
});

// ── nested .gitignore layers ────────────────────────────────────────────────

test('a nested .gitignore excludes inside its own directory only', () => {
  const excl = new Exclusions({ gitignore: '*\n!apps/\n!apps/**' });
  excl.addNested('apps/pkg', 'out.retired-hold/\n');

  assert.equal(excl.isExcluded('apps/pkg/out.retired-hold/commands.js'), true, 'nested rule excludes its subtree');
  assert.equal(excl.shouldDescend('apps/pkg/out.retired-hold'), false, 'and prunes the walk');
  // The SAME relative path outside that package is untouched by the layer.
  assert.equal(excl.isExcluded('apps/other/out.retired-hold/commands.js'), false, 'layer does not leak to a sibling');
});

test('nested patterns are relative to the file that declares them', () => {
  const excl = new Exclusions({ gitignore: '' });
  // `/generated/` in apps/pkg means apps/pkg/generated, not <root>/generated.
  excl.addNested('apps/pkg', '/generated/\n');

  assert.equal(excl.isExcluded('apps/pkg/generated/schema.ts'), true, 'anchored nested rule resolves against its own dir');
  assert.equal(excl.isExcluded('generated/schema.ts'), false, 'not against the repository root');
});

test('a deeper .gitignore overrides a shallower one', () => {
  const excl = new Exclusions({ gitignore: 'logs/\n' });
  excl.addNested('apps/pkg', '!logs/\n');

  assert.equal(excl.isExcluded('logs/a.txt'), true, 'root rule still applies at the root');
  assert.equal(excl.isExcluded('apps/pkg/logs/a.txt'), false, 'deeper negation wins inside its package');
});

test('a nested .gitignore cannot re-include a hard exclusion', () => {
  const excl = new Exclusions({ gitignore: '', extra: DEFAULT_MIGRAAI_EXCLUSIONS });
  excl.addNested('apps/pkg', '!*\n!**\n!.env\n!node_modules/\n');

  assert.equal(excl.isExcluded('apps/pkg/.env'), true, 'secrets stay excluded');
  assert.equal(excl.isExcluded('apps/pkg/node_modules/x/index.js'), true, 'vendored code stays excluded');
});

test('FsFileSource honours a nested .gitignore end to end', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'migraai-nested-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // Shaped like this repository: a root allowlist opens `apps/`, and the package's
  // OWN .gitignore is the only thing hiding its retired build output.
  writeFileSync(path.join(root, '.gitignore'), ['*', '!apps/', '!apps/**'].join('\n'));
  mkdirSync(path.join(root, 'apps/pkg/src'), { recursive: true });
  mkdirSync(path.join(root, 'apps/pkg/out.retired-hold'), { recursive: true });
  writeFileSync(path.join(root, 'apps/pkg/.gitignore'), 'out.retired-hold/\n');
  writeFileSync(path.join(root, 'apps/pkg/src/real.ts'), 'export const kept = 1;\n');
  writeFileSync(path.join(root, 'apps/pkg/out.retired-hold/old.js'), 'module.exports = {};\n');

  const found = (await new FsFileSource(root).files()).map((f) => f.relPath).sort();

  assert.ok(found.includes('apps/pkg/src/real.ts'), 'real source indexed');
  assert.ok(!found.some((f) => f.includes('out.retired-hold')), 'nested-ignored build output never indexed');
});
