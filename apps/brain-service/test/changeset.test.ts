// Slice 3B — approval-backed workspace edit application. The changeset engine is
// exercised against a REAL temp filesystem via the node adapter; the approval
// lifecycle is exercised through executeToolCore + ToolApprovalStore.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { proposeChangeset, applyChangeset, ChangesetError, type ChangesetFs } from '../src/tools/changeset.js';
import { nodeChangesetFs } from '../src/tools/changesetFs.js';
import { CapabilityRegistry } from '../src/engine/capabilityRegistry.js';
import { ToolApprovalStore } from '../src/engine/toolApprovalStore.js';
import { ToolAudit } from '../src/engine/toolAudit.js';
import { executeToolCore } from '../src/engine/toolExecutor.js';

const fs: ChangesetFs = nodeChangesetFs();
function ws(seed: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'migra-cs-'));
  for (const [rel, content] of Object.entries(seed)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}
const read = (root: string, rel: string) => readFileSync(path.join(root, rel), 'utf8');

// ── proposal phase: zero writes, additions rendered ─────────────────────────────

test('propose creates an immutable proposal and performs ZERO writes', () => {
  const root = ws();
  const before = existsSync(path.join(root, 'src/index.js'));
  const p = proposeChangeset({ rootPath: root, ops: [{ op: 'create', path: 'src/index.js', content: 'export const x = 1;\n' }] }, fs);
  assert.equal(p.tool, 'fs.proposeChangeset');
  assert.equal(p.fileCount, 1);
  assert.ok(p.proposalHash.length === 64);
  assert.equal(p.ops[0]!.kind, 'add');
  assert.equal(p.ops[0]!.before, null); // new file → pure addition
  assert.equal(p.ops[0]!.after, 'export const x = 1;\n');
  assert.equal(existsSync(path.join(root, 'src/index.js')), before, 'propose must not write');
});

test('propose fills expectedSha for existing-file ops and hash changes with any op edit', () => {
  const root = ws({ 'a.txt': 'hello\n' });
  const p1 = proposeChangeset({ rootPath: root, ops: [{ op: 'replace', path: 'a.txt', content: 'bye\n' }] }, fs);
  assert.ok(p1.changeset.ops[0]!.op === 'replace' && p1.changeset.ops[0]!.expectedSha);
  const p2 = proposeChangeset({ rootPath: root, ops: [{ op: 'replace', path: 'a.txt', content: 'different\n' }] }, fs);
  assert.notEqual(p1.proposalHash, p2.proposalHash);
});

// ── apply phase: create / modify / mixed / delete / mkdir ───────────────────────

test('apply creates one new file', () => {
  const root = ws();
  applyChangeset({ rootPath: root, ops: [{ op: 'create', path: 'x.js', content: 'ok\n' }] }, fs);
  assert.equal(read(root, 'x.js'), 'ok\n');
});

test('apply creates multiple files and directories', () => {
  const root = ws();
  applyChangeset(
    {
      rootPath: root,
      ops: [
        { op: 'mkdir', path: 'src' },
        { op: 'create', path: 'src/index.js', content: 'a\n' },
        { op: 'create', path: 'test/x.test.js', content: 'b\n' },
      ],
    },
    fs,
  );
  assert.equal(read(root, 'src/index.js'), 'a\n');
  assert.equal(read(root, 'test/x.test.js'), 'b\n');
});

test('apply modifies an existing file (replace + patch)', () => {
  const root = ws({ 'a.txt': 'l1\nl2\nl3\n', 'b.txt': 'old\n' });
  const p = proposeChangeset({ rootPath: root, ops: [{ op: 'patch', path: 'a.txt', startLine: 2, endLine: 2, replacement: 'L2' }, { op: 'replace', path: 'b.txt', content: 'new\n' }] }, fs);
  applyChangeset(p.changeset, fs);
  assert.equal(read(root, 'a.txt'), 'l1\nL2\nl3\n');
  assert.equal(read(root, 'b.txt'), 'new\n');
});

test('mixed create-and-modify proposal applies coherently', () => {
  const root = ws({ 'pkg.json': '{}\n' });
  const p = proposeChangeset({ rootPath: root, ops: [{ op: 'replace', path: 'pkg.json', content: '{"name":"x"}\n' }, { op: 'create', path: 'index.js', content: 'run\n' }] }, fs);
  applyChangeset(p.changeset, fs);
  assert.equal(read(root, 'pkg.json'), '{"name":"x"}\n');
  assert.equal(read(root, 'index.js'), 'run\n');
});

// ── stale / immutability / containment refusals ─────────────────────────────────

test('stale pre-state is rejected (file changed since proposal)', () => {
  const root = ws({ 'a.txt': 'v1\n' });
  const p = proposeChangeset({ rootPath: root, ops: [{ op: 'replace', path: 'a.txt', content: 'v2\n' }] }, fs);
  writeFileSync(path.join(root, 'a.txt'), 'CHANGED\n'); // drift after proposal
  assert.throws(() => applyChangeset(p.changeset, fs), (e: unknown) => e instanceof ChangesetError && e.code === 'STALE');
  assert.equal(read(root, 'a.txt'), 'CHANGED\n', 'a stale apply must not write');
});

test('traversal and absolute paths are rejected (no writes)', () => {
  const root = ws();
  assert.throws(() => applyChangeset({ rootPath: root, ops: [{ op: 'create', path: '../escape.js', content: 'x' }] }, fs), /escape|Absolute|contain/i);
  assert.throws(() => applyChangeset({ rootPath: root, ops: [{ op: 'create', path: '/tmp/abs.js', content: 'x' }] }, fs), /Absolute/i);
  assert.equal(existsSync(path.join(path.dirname(root), 'escape.js')), false);
});

test('symlink escape is rejected', () => {
  const root = ws();
  const outside = mkdtempSync(path.join(tmpdir(), 'migra-outside-'));
  symlinkSync(outside, path.join(root, 'link'));
  assert.throws(() => applyChangeset({ rootPath: root, ops: [{ op: 'create', path: 'link/evil.js', content: 'x' }] }, fs), /symlink|escape/i);
  assert.equal(existsSync(path.join(outside, 'evil.js')), false);
});

test('delete requires allowDelete; with it, the file is removed', () => {
  const root = ws({ 'gone.txt': 'bye\n' });
  assert.throws(() => applyChangeset({ rootPath: root, ops: [{ op: 'delete', path: 'gone.txt' }] }, fs), (e: unknown) => e instanceof ChangesetError && e.code === 'DELETE_NOT_ALLOWED');
  assert.ok(existsSync(path.join(root, 'gone.txt')));
  applyChangeset({ rootPath: root, ops: [{ op: 'delete', path: 'gone.txt' }], allowDelete: true }, fs);
  assert.equal(existsSync(path.join(root, 'gone.txt')), false);
});

// ── rollback: partial failure cannot leave a mixed state ─────────────────────────

test('partial failure rolls back ALL prior ops and reports (no mixed state)', () => {
  const root = ws({ 'keep.txt': 'ORIGINAL\n' });
  // A changeset that modifies keep.txt then creates second.js; an fs whose
  // writeFile throws on the SECOND write forces a mid-apply failure.
  const proposal = proposeChangeset(
    { rootPath: root, ops: [{ op: 'replace', path: 'keep.txt', content: 'NEW\n' }, { op: 'create', path: 'second.js', content: 'x\n' }] },
    fs,
  );
  let writes = 0;
  const flaky: ChangesetFs = {
    ...fs,
    writeFile: (p, c) => {
      writes++;
      if (writes === 2) throw new Error('disk full (simulated)');
      fs.writeFile(p, c);
    },
  };
  assert.throws(
    () => applyChangeset(proposal.changeset, flaky),
    (e: unknown) => e instanceof ChangesetError && e.code === 'PARTIAL_WRITE',
  );
  assert.equal(read(root, 'keep.txt'), 'ORIGINAL\n', 'rolled back to original');
  assert.equal(existsSync(path.join(root, 'second.js')), false, 'partial create removed');
});

test('apply returns valid rollback material (reverse content per touched file)', () => {
  const root = ws({ 'a.txt': 'orig\n' });
  const p = proposeChangeset({ rootPath: root, ops: [{ op: 'replace', path: 'a.txt', content: 'new\n' }, { op: 'create', path: 'b.txt', content: 'b\n' }] }, fs);
  const res = applyChangeset(p.changeset, fs);
  assert.deepEqual(res.created, ['b.txt']);
  assert.deepEqual(res.modified, ['a.txt']);
  const aRb = res.rollback.find((r) => r.path === 'a.txt');
  const bRb = res.rollback.find((r) => r.path === 'b.txt');
  assert.equal(aRb!.previousContent, 'orig\n'); // reverse-patch material
  assert.equal(bRb!.previousContent, null); // created → undo is delete
});

// ── approval lifecycle through the engine ───────────────────────────────────────

test('apply through the engine: exact approval applies once; replay is rejected', async () => {
  const deps = { registry: new CapabilityRegistry(), approvals: new ToolApprovalStore(), audit: new ToolAudit() };
  const root = ws();
  const proposal = proposeChangeset({ rootPath: root, ops: [{ op: 'create', path: 'made.js', content: 'hi\n' }] }, fs);

  // No approvalId → parks with the proposal preview, no write.
  const parked = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: proposal.changeset, requestId: 'r1' });
  assert.ok(parked.ok && parked.status === 'approval_required');
  assert.equal(existsSync(path.join(root, 'made.js')), false, 'parked apply must not write');
  const approvalId = parked.ok ? parked.approvalId! : '';

  // Approve → single-use consume → applies exactly once.
  const applied = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: proposal.changeset, approvalId, requestId: 'r2' });
  assert.ok(applied.ok && applied.status === 'executed');
  assert.equal(read(root, 'made.js'), 'hi\n');

  // Replay the same approval → refused.
  const replay = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: proposal.changeset, approvalId, requestId: 'r3' });
  assert.ok(!replay.ok && replay.code === 'INVALID_STATE');
});

test('altered proposal is rejected: approval minted for A cannot apply B', async () => {
  const deps = { registry: new CapabilityRegistry(), approvals: new ToolApprovalStore(), audit: new ToolAudit() };
  const root = ws();
  const a = proposeChangeset({ rootPath: root, ops: [{ op: 'create', path: 'a.js', content: 'a\n' }] }, fs);
  const parked = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: a.changeset, requestId: 'r1' });
  const approvalId = parked.ok ? parked.approvalId! : '';
  // Apply a DIFFERENT changeset with A's approval → hash mismatch refusal.
  const altered = { rootPath: root, ops: [{ op: 'create' as const, path: 'b.js', content: 'b\n' }] };
  const res = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: altered, approvalId, requestId: 'r2' });
  assert.ok(!res.ok && res.code === 'INVALID_STATE');
  assert.equal(existsSync(path.join(root, 'b.js')), false);
});

test('fs.proposeChangeset is read-only + available; fs.applyChangeset is mutating + approval-required', () => {
  const reg = new CapabilityRegistry();
  const propose = reg.get('fs.proposeChangeset');
  const apply = reg.get('fs.applyChangeset');
  assert.ok(propose && propose.available && propose.readOnly);
  assert.ok(apply && apply.available && !apply.readOnly && apply.approvalRequired);
});
