import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deterministicTestProposal,
  detectTestFramework,
  selectTestCommand,
  testPathFor,
} from '../../generateTests/framework.js';
import {
  type TestProposal,
  type WorkspaceFs,
  applyTestProposal,
  containsLeakedInternals,
  fingerprintProposal,
  isTestFile,
  parseProposal,
  resolveInsideWorkspace,
  validateProposal,
} from '../../generateTests/proposal.js';
import { PilotError } from '@migrapilot/pilot-client';

const ROOT = '/ws';

class MemFs implements WorkspaceFs {
  files = new Map<string, string>();
  failWriteOn?: string;
  corrupt = false;
  seed(p: string, c = '// existing'): this {
    this.files.set(p, c);
    return this;
  }
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async read(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) throw new Error('ENOENT');
    return v;
  }
  async write(p: string, c: string): Promise<void> {
    if (this.failWriteOn === p) throw new Error('EACCES');
    this.files.set(p, this.corrupt ? `${c}CORRUPT` : c);
  }
}

// ── framework detection + constrained command selection ──────────────────────

test('detects vitest/jest/mocha/node-test/unknown from trusted config', () => {
  assert.equal(detectTestFramework({ devDependencies: { vitest: '^1' } }).framework, 'vitest');
  assert.equal(detectTestFramework({ devDependencies: { jest: '^29' } }).framework, 'jest');
  assert.equal(detectTestFramework({ dependencies: { mocha: '^10' } }).framework, 'mocha');
  assert.equal(detectTestFramework({ scripts: { test: 'node --test dist' } }).framework, 'node-test');
  assert.equal(detectTestFramework({}).framework, 'unknown');
});

test('command selection is constrained per framework; unknown → null', () => {
  assert.deepEqual(selectTestCommand('vitest', 'a.test.ts'), ['npx', 'vitest', 'run', 'a.test.ts']);
  assert.deepEqual(selectTestCommand('jest', 'a.test.ts'), ['npx', 'jest', 'a.test.ts']);
  assert.deepEqual(selectTestCommand('mocha', 'a.test.ts'), ['npx', 'mocha', 'a.test.ts']);
  assert.deepEqual(selectTestCommand('node-test', 'a.test.js'), ['node', '--test', 'a.test.js']);
  assert.equal(selectTestCommand('unknown', 'a.test.ts'), null);
});

test('testPathFor makes a sibling .test file', () => {
  assert.equal(testPathFor('src/foo.ts'), 'src/foo.test.ts');
  assert.equal(testPathFor('bar.js'), 'bar.test.js');
});

test('deterministic fixture is a valid create proposal', () => {
  const p = deterministicTestProposal('src/foo.ts', 'vitest');
  assert.equal(p.files[0]?.mode, 'create');
  assert.equal(p.files[0]?.path, 'src/foo.test.ts');
  assert.match(p.files[0]!.contents, /describe\(/);
});

// ── path validation ──────────────────────────────────────────────────────────

test('resolveInsideWorkspace allows inside, rejects escape', () => {
  assert.equal(resolveInsideWorkspace(ROOT, 'src/a.test.ts'), 'src/a.test.ts');
  assert.throws(() => resolveInsideWorkspace(ROOT, '../evil.ts'), (e: unknown) => e instanceof PilotError);
  assert.throws(() => resolveInsideWorkspace(ROOT, '/etc/passwd'), (e: unknown) => e instanceof PilotError);
});

test('isTestFile recognizes test/spec files and test dirs', () => {
  assert.equal(isTestFile('src/a.test.ts'), true);
  assert.equal(isTestFile('src/a.spec.tsx'), true);
  assert.equal(isTestFile('test/a.js'), true);
  assert.equal(isTestFile('src/a.ts'), false);
});

test('containsLeakedInternals flags auth/approval/correlation material', () => {
  assert.equal(containsLeakedInternals('const h = "Bearer eyJhbGciOiJIUzI1NiJ9.abc.def";'), true);
  assert.equal(containsLeakedInternals('approvalToken: "tok-x"'), true);
  assert.equal(containsLeakedInternals('expect(add(1,2)).toBe(3)'), false);
});

// ── proposal parsing ─────────────────────────────────────────────────────────

test('parseProposal accepts bare JSON and ```json fences', () => {
  const bare = parseProposal('{"files":[{"path":"a.test.ts","contents":"x","mode":"create"}]}');
  assert.equal(bare.files.length, 1);
  const fenced = parseProposal('sure!\n```json\n{"files":[{"path":"a.test.ts","contents":"x","mode":"create"}]}\n```\n');
  assert.equal(fenced.files[0]?.path, 'a.test.ts');
});

test('parseProposal rejects malformed output', () => {
  for (const bad of ['not json', '{"files": []}', '{"files":[{"path":"a"}]}', '{"nope":1}', '{"files":[{"path":"a","contents":"x","mode":"delete"}]}']) {
    assert.throws(() => parseProposal(bad), (e: unknown) => (e as Error).name === 'ProposalParseError', bad);
  }
});

// ── proposal validation ──────────────────────────────────────────────────────

async function validate(proposal: TestProposal, fs: MemFs) {
  return validateProposal(proposal, ROOT, fs);
}

test('validate: create to a new path is ok', async () => {
  const r = await validate({ files: [{ path: 'src/a.test.ts', contents: 'x', mode: 'create' }] }, new MemFs());
  assert.equal(r.ok, true);
});

test('validate: create over an existing file is refused (no silent overwrite)', async () => {
  const fs = new MemFs().seed('src/a.test.ts');
  const r = await validate({ files: [{ path: 'src/a.test.ts', contents: 'x', mode: 'create' }] }, fs);
  assert.equal(r.ok, false);
});

test('validate: update requires an existing TEST file', async () => {
  const missing = await validate({ files: [{ path: 'src/a.test.ts', contents: 'x', mode: 'update' }] }, new MemFs());
  assert.equal(missing.ok, false);
  const nonTest = await validate(
    { files: [{ path: 'src/a.ts', contents: 'x', mode: 'update' }] },
    new MemFs().seed('src/a.ts'),
  );
  assert.equal(nonTest.ok, false); // refuse to update a source file
  const ok = await validate(
    { files: [{ path: 'src/a.test.ts', contents: 'x', mode: 'update' }] },
    new MemFs().seed('src/a.test.ts'),
  );
  assert.equal(ok.ok, true);
});

test('validate: unsafe path and leaked internals are refused', async () => {
  const escape = await validate({ files: [{ path: '../evil.ts', contents: 'x', mode: 'create' }] }, new MemFs());
  assert.equal(escape.ok, false);
  const leak = await validate(
    { files: [{ path: 'a.test.ts', contents: 'const h="Bearer eyJhbGciOiJIUzI1NiJ9.aaaaaaaaaaaaaaaaaaaa"', mode: 'create' }] },
    new MemFs(),
  );
  assert.equal(leak.ok, false);
});

// ── fingerprint / confirmation binding ───────────────────────────────────────

test('fingerprint is stable and content-sensitive', () => {
  const a: TestProposal = { files: [{ path: 'a.test.ts', contents: 'x', mode: 'create' }] };
  const b: TestProposal = { files: [{ path: 'a.test.ts', contents: 'y', mode: 'create' }] };
  assert.equal(fingerprintProposal(a), fingerprintProposal({ files: [...a.files] }));
  assert.notEqual(fingerprintProposal(a), fingerprintProposal(b));
});

// ── apply + read-back ────────────────────────────────────────────────────────

test('apply writes and verifies via read-back', async () => {
  const proposal: TestProposal = { files: [{ path: 'src/a.test.ts', contents: 'PASS', mode: 'create' }] };
  const fs = new MemFs();
  const res = await applyTestProposal(proposal, fingerprintProposal(proposal), ROOT, fs);
  assert.equal(res.status, 'applied');
  if (res.status === 'applied') {
    assert.deepEqual(res.written, ['src/a.test.ts']);
    assert.equal(res.verified, true);
  }
  assert.equal(fs.files.get('src/a.test.ts'), 'PASS');
});

test('apply refuses a proposal changed since review (fingerprint mismatch)', async () => {
  const proposal: TestProposal = { files: [{ path: 'a.test.ts', contents: 'x', mode: 'create' }] };
  const res = await applyTestProposal(proposal, 'stale-fingerprint', ROOT, new MemFs());
  assert.equal(res.status, 'refused');
});

test('apply fails closed on a partial write and reports precisely', async () => {
  const proposal: TestProposal = {
    files: [
      { path: 'a.test.ts', contents: 'A', mode: 'create' },
      { path: 'b.test.ts', contents: 'B', mode: 'create' },
    ],
  };
  const fs = new MemFs();
  fs.failWriteOn = 'b.test.ts';
  const res = await applyTestProposal(proposal, fingerprintProposal(proposal), ROOT, fs);
  assert.equal(res.status, 'partial');
  if (res.status === 'partial') {
    assert.deepEqual(res.written, ['a.test.ts']);
    assert.equal(res.failed, 'b.test.ts');
  }
});

test('apply reports verified=false when read-back does not match', async () => {
  const proposal: TestProposal = { files: [{ path: 'a.test.ts', contents: 'WANT', mode: 'create' }] };
  const fs = new MemFs();
  fs.corrupt = true; // stored content differs from written
  const res = await applyTestProposal(proposal, fingerprintProposal(proposal), ROOT, fs);
  assert.equal(res.status, 'applied');
  if (res.status === 'applied') {
    assert.equal(res.verified, false, 'read-back mismatch is not reported as success');
  }
});
