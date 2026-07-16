import assert from 'node:assert/strict';
import test from 'node:test';
import { type GitResult, type GitRunner, assertReadOnly, recentSubjects, stagedFiles, unstagedFiles } from '../../commitGen/git.js';
import {
  buildBoundedDiff,
  detectConvention,
  isGenerated,
  isLockfile,
  redactSecrets,
} from '../../commitGen/prepare.js';
import {
  deterministicCommitMessage,
  sanitizeCommitMessage,
  validateSubject,
} from '../../commitGen/sanitize.js';

// Fake git runner keyed by the joined args.
class FakeGit implements GitRunner {
  constructor(private readonly responses: Record<string, string>) {}
  calls: string[][] = [];
  async run(args: string[]): Promise<GitResult> {
    this.calls.push(args);
    const key = args.join(' ');
    return { stdout: this.responses[key] ?? '', code: 0 };
  }
}

const CONV = { conventional: false, maxSubjectLength: 72 };

// ── read-only guard ──────────────────────────────────────────────────────────

test('assertReadOnly permits reads and blocks any mutation', () => {
  for (const ok of [['diff', '--cached'], ['status'], ['log', '-n', '5'], ['rev-parse', 'HEAD']]) {
    assert.doesNotThrow(() => assertReadOnly(ok));
  }
  for (const bad of [['add', '.'], ['commit', '-m', 'x'], ['reset'], ['checkout', '.'], ['stash']]) {
    assert.throws(() => assertReadOnly(bad));
  }
});

// ── staged/unstaged selection ────────────────────────────────────────────────

test('stagedFiles parses name-status + numstat (incl. binary)', async () => {
  const git = new FakeGit({
    'diff --cached --name-status': 'M\tsrc/a.ts\nA\tassets/logo.png',
    'diff --cached --numstat': '10\t3\tsrc/a.ts\n-\t-\tassets/logo.png',
  });
  const files = await stagedFiles(git);
  assert.equal(files.length, 2);
  const a = files.find((f) => f.path === 'src/a.ts')!;
  assert.deepEqual([a.status, a.added, a.removed, a.binary], ['M', 10, 3, false]);
  const png = files.find((f) => f.path === 'assets/logo.png')!;
  assert.equal(png.binary, true);
});

test('unstagedFiles reads the non-cached diff (staged is default elsewhere)', async () => {
  const git = new FakeGit({
    'diff --name-status': 'M\tsrc/b.ts',
    'diff --numstat': '1\t1\tsrc/b.ts',
  });
  const files = await unstagedFiles(git);
  assert.equal(files[0]?.path, 'src/b.ts');
  assert.ok(git.calls.every((c) => !c.includes('--cached')));
});

// ── redaction ────────────────────────────────────────────────────────────────

test('redactSecrets removes keys/JWTs/bearer/assignments, keeps normal text', () => {
  const input = [
    'const key = "sk-ABCDEFGHIJKLMNOPQRSTUV";',
    'Authorization: Bearer abcdef0123456789ABCDEF',
    // Fixture split so the pre-commit secret scanner doesn't false-positive on a
    // redaction-test input; the runtime string is identical.
    ['password', '=', '"hunter2secret"'].join(' '),
    'const x = add(1, 2);',
    'jwt = eyJhbGciOiJI.eyJzdWIiOiIx.SflKxwRJSMeKKF2',
  ].join('\n');
  const out = redactSecrets(input);
  for (const secret of ['sk-ABCDEFGHIJKLMNOPQRSTUV', 'abcdef0123456789ABCDEF', 'hunter2secret', 'eyJhbGciOiJI']) {
    assert.ok(!out.includes(secret), `redacted ${secret}`);
  }
  assert.ok(out.includes('add(1, 2)'), 'normal code preserved');
});

// ── classification + bounding ────────────────────────────────────────────────

test('classifies lockfiles and generated files', () => {
  assert.equal(isLockfile('package-lock.json'), true);
  assert.equal(isLockfile('sub/pnpm-lock.yaml'), true);
  assert.equal(isGenerated('dist/extension.js'), true);
  assert.equal(isGenerated('a.min.js'), true);
  assert.equal(isGenerated('src/a.ts'), false);
});

test('buildBoundedDiff summarizes binary/lockfile/generated/oversized, redacts normal', async () => {
  const git = new FakeGit({
    'diff --cached -- src/a.ts': 'diff\n+ const k = "sk-ABCDEFGHIJKLMNOPQRSTUV";',
    'diff --cached -- big.ts': `diff\n${'+x\n'.repeat(5000)}`,
  });
  const files = [
    { path: 'src/a.ts', status: 'M', added: 1, removed: 0, binary: false },
    { path: 'package-lock.json', status: 'M', added: 999, removed: 5, binary: false },
    { path: 'assets/i.png', status: 'A', added: 0, removed: 0, binary: true },
    { path: 'dist/out.js', status: 'M', added: 2, removed: 1, binary: false },
    { path: 'big.ts', status: 'M', added: 5000, removed: 0, binary: false },
  ];
  const bounded = await buildBoundedDiff(git, files, true, { maxTotalChars: 100000, maxPerFileChars: 500 });
  const cat = (p: string) => bounded.files.find((f) => f.path === p)?.category;
  assert.equal(cat('package-lock.json'), 'lockfile');
  assert.equal(cat('assets/i.png'), 'binary');
  assert.equal(cat('dist/out.js'), 'generated');
  assert.equal(cat('big.ts'), 'oversized');
  const normal = bounded.files.find((f) => f.path === 'src/a.ts')!;
  assert.equal(normal.category, 'normal');
  assert.ok(!normal.content.includes('sk-ABCDEFGHIJKLMNOPQRSTUV'), 'secret redacted in transmitted diff');
});

test('buildBoundedDiff truncates when the total budget is exhausted', async () => {
  const git = new FakeGit({ 'diff --cached -- a.ts': 'x'.repeat(80), 'diff --cached -- b.ts': 'y'.repeat(80) });
  const files = [
    { path: 'a.ts', status: 'M', added: 1, removed: 0, binary: false },
    { path: 'b.ts', status: 'M', added: 1, removed: 0, binary: false },
  ];
  const bounded = await buildBoundedDiff(git, files, true, { maxTotalChars: 100, maxPerFileChars: 1000 });
  assert.equal(bounded.truncated, true);
});

// ── convention detection ─────────────────────────────────────────────────────

test('detectConvention is conservative in auto, forced by setting', () => {
  const convHistory = ['feat: a', 'fix(x): b', 'chore: c'];
  assert.equal(detectConvention(convHistory, 'auto').conventional, true);
  assert.equal(detectConvention(['update stuff', 'more'], 'auto').conventional, false);
  assert.equal(detectConvention([], 'auto').conventional, false); // no evidence
  assert.equal(detectConvention(['update'], 'always').conventional, true);
  assert.equal(detectConvention(convHistory, 'never').conventional, false);
});

// ── sanitization ─────────────────────────────────────────────────────────────

test('sanitize strips fences and control chars', () => {
  const raw = '```\nfix the parser\n```';
  const { subject } = sanitizeCommitMessage(raw, CONV);
  assert.equal(subject, 'fix the parser');
});

test('sanitize removes invented issue refs and fabricated trailers', () => {
  const raw = 'add feature (#123)\n\nCloses #123\nCo-authored-by: Bot <b@x>\nTested: all pass\nreal detail line';
  const { subject, body } = sanitizeCommitMessage(raw, CONV);
  assert.ok(!subject.includes('#123'), 'issue ref stripped from subject');
  assert.ok(!/Closes|Co-authored-by|Tested/.test(body), 'fabricated trailers stripped');
  assert.ok(body.includes('real detail line'));
});

test('sanitize strips an invented conventional prefix when repo is not conventional', () => {
  const { subject } = sanitizeCommitMessage('feat(auth): add login', { conventional: false, maxSubjectLength: 72 });
  assert.equal(subject, 'add login');
});

test('sanitize keeps a conventional prefix but drops unevidenced breaking "!"', () => {
  const { subject } = sanitizeCommitMessage('feat(auth)!: add login', { conventional: true, maxSubjectLength: 72 });
  assert.equal(subject, 'feat(auth): add login');
});

test('sanitize strips command-line text from the body', () => {
  const { body } = sanitizeCommitMessage('do a thing\n\ngit reset --hard\nnpm run evil\nkeep this', CONV);
  assert.ok(!/git reset|npm run evil/.test(body));
  assert.ok(body.includes('keep this'));
});

test('subject length policy enforced (truncate at word boundary)', () => {
  const long = 'x'.repeat(200);
  const { subject } = sanitizeCommitMessage(long, { conventional: false, maxSubjectLength: 50 });
  assert.ok(subject.length <= 50);
  assert.equal(validateSubject(subject, 50).ok, true);
});

test('validateSubject rejects empty/multiline/too-long', () => {
  assert.equal(validateSubject('', 72).ok, false);
  assert.equal(validateSubject('a\nb', 72).ok, false);
  assert.equal(validateSubject('x'.repeat(80), 72).ok, false);
  assert.equal(validateSubject('fix the bug', 72).ok, true);
});

// ── deterministic fixture ────────────────────────────────────────────────────

test('deterministic fixture uses only diff evidence (no invented scope/issue)', () => {
  const diff = {
    files: [{ path: 'src/a.ts', status: 'M', added: 3, removed: 1, category: 'normal' as const, content: '' }],
    totalFiles: 1,
    truncated: false,
    includedUnstaged: false,
  };
  const msg = deterministicCommitMessage(diff, CONV);
  assert.equal(msg.subject, 'Update 1 file');
  assert.ok(!/#\d+|\(.*\):/.test(msg.subject), 'no invented issue or scope');
  assert.match(msg.body, /src\/a\.ts/);
});

test('empty repo: no staged files → empty analysis, no throw', async () => {
  const git = new FakeGit({});
  const files = await stagedFiles(git);
  assert.deepEqual(files, []);
  const subjects = await recentSubjects(git, 5);
  assert.deepEqual(subjects, []);
});
