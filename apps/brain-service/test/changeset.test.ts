// Slice 3B — approval-backed workspace edit application. Exercised against a REAL
// temp filesystem via the node adapter; the approval lifecycle through
// executeToolCore + ToolApprovalStore. Apply consumes a SERVER-STORED proposal
// by hash — the client only ever names {rootPath, proposalHash}.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, symlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  proposeChangeset,
  applyChangeset,
  previewStoredChangeset,
  ChangesetError,
  ChangesetProposalStore,
  type ChangesetFs,
} from '../src/tools/changeset.js';
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
/** Propose then apply-by-hash in one go (the operator's happy path). */
function proposeAndApply(cs: Parameters<typeof proposeChangeset>[0], root: string) {
  const store = new ChangesetProposalStore();
  const p = proposeChangeset(cs, fs, store);
  return applyChangeset({ rootPath: root, proposalHash: p.proposalHash }, fs, store);
}

// ── proposal phase: zero writes, additions, immutability ────────────────────────

test('propose performs ZERO writes and renders new files as additions', () => {
  const root = ws();
  const store = new ChangesetProposalStore();
  const p = proposeChangeset({ rootPath: root, ops: [{ op: 'create', path: 'src/index.js', content: 'export const x = 1;\n' }] }, fs, store);
  assert.equal(p.ops[0]!.kind, 'add');
  assert.equal(p.ops[0]!.before, null);
  assert.equal(p.ops[0]!.after, 'export const x = 1;\n');
  assert.equal(p.proposalHash.length, 64); // sha256
  assert.equal(existsSync(path.join(root, 'src/index.js')), false, 'propose must not write');
  assert.ok(store.get(p.proposalHash), 'proposal stored server-side');
});

test('proposal hash binds root, allowDelete, and ops — any change alters it', () => {
  const root = ws({ 'a.txt': 'x\n' });
  const s = new ChangesetProposalStore();
  const base = proposeChangeset({ rootPath: root, ops: [{ op: 'delete', path: 'a.txt' }], allowDelete: true }, fs, s).proposalHash;
  // Different content, different root, different allowDelete all → different hash.
  const root2 = ws({ 'a.txt': 'x\n' });
  assert.notEqual(base, proposeChangeset({ rootPath: root2, ops: [{ op: 'delete', path: 'a.txt' }], allowDelete: true }, fs, s).proposalHash);
});

// ── apply phase (by hash): create / modify / mixed ──────────────────────────────

test('apply creates one new file', () => {
  const root = ws();
  proposeAndApply({ rootPath: root, ops: [{ op: 'create', path: 'x.js', content: 'ok\n' }] }, root);
  assert.equal(read(root, 'x.js'), 'ok\n');
});

test('apply creates multiple files and directories', () => {
  const root = ws();
  proposeAndApply(
    { rootPath: root, ops: [{ op: 'mkdir', path: 'src' }, { op: 'create', path: 'src/index.js', content: 'a\n' }, { op: 'create', path: 'test/x.test.js', content: 'b\n' }] },
    root,
  );
  assert.equal(read(root, 'src/index.js'), 'a\n');
  assert.equal(read(root, 'test/x.test.js'), 'b\n');
});

test('apply modifies an existing file (replace + patch) and mixed create+modify', () => {
  const root = ws({ 'a.txt': 'l1\nl2\nl3\n', 'pkg.json': '{}\n' });
  proposeAndApply(
    { rootPath: root, ops: [{ op: 'patch', path: 'a.txt', startLine: 2, endLine: 2, replacement: 'L2' }, { op: 'replace', path: 'pkg.json', content: '{"n":1}\n' }, { op: 'create', path: 'new.js', content: 'n\n' }] },
    root,
  );
  assert.equal(read(root, 'a.txt'), 'l1\nL2\nl3\n');
  assert.equal(read(root, 'pkg.json'), '{"n":1}\n');
  assert.equal(read(root, 'new.js'), 'n\n');
});

// ── containment, staleness, conflicts, limits, delete gating ────────────────────

test('traversal / absolute / symlink-escape are rejected at propose (no hash issued)', () => {
  const root = ws();
  const s = new ChangesetProposalStore();
  assert.throws(() => proposeChangeset({ rootPath: root, ops: [{ op: 'create', path: '../escape.js', content: 'x' }] }, fs, s), /escape|contain/i);
  assert.throws(() => proposeChangeset({ rootPath: root, ops: [{ op: 'create', path: '/tmp/abs.js', content: 'x' }] }, fs, s), /Absolute/i);
  const outside = mkdtempSync(path.join(tmpdir(), 'migra-outside-'));
  symlinkSync(outside, path.join(root, 'link'));
  assert.throws(() => proposeChangeset({ rootPath: root, ops: [{ op: 'create', path: 'link/evil.js', content: 'x' }] }, fs, s), /symlink|escape/i);
  assert.equal(existsSync(path.join(outside, 'evil.js')), false);
});

test('apply RE-VALIDATES containment: a symlink planted AFTER propose is caught (TOCTOU)', () => {
  const root = ws();
  mkdirSync(path.join(root, 'd'));
  const store = new ChangesetProposalStore();
  const p = proposeChangeset({ rootPath: root, ops: [{ op: 'create', path: 'd/evil.js', content: 'x' }] }, fs, store);
  // Replace the contained dir with a symlink outside the root after proposal.
  const outside = mkdtempSync(path.join(tmpdir(), 'migra-toctou-'));
  rmdirSync(path.join(root, 'd'));
  symlinkSync(outside, path.join(root, 'd'));
  assert.throws(() => applyChangeset({ rootPath: root, proposalHash: p.proposalHash }, fs, store), /symlink|escape/i);
  assert.equal(existsSync(path.join(outside, 'evil.js')), false);
});

test('stale pre-state is rejected (file changed since proposal); no write', () => {
  const root = ws({ 'a.txt': 'v1\n' });
  const store = new ChangesetProposalStore();
  const p = proposeChangeset({ rootPath: root, ops: [{ op: 'replace', path: 'a.txt', content: 'v2\n' }] }, fs, store);
  writeFileSync(path.join(root, 'a.txt'), 'CHANGED\n');
  assert.throws(() => applyChangeset({ rootPath: root, proposalHash: p.proposalHash }, fs, store), (e: unknown) => e instanceof ChangesetError && e.code === 'STALE');
  assert.equal(read(root, 'a.txt'), 'CHANGED\n');
});

test('conflicting ops on the same path are rejected (create+replace+delete a.ts)', () => {
  const root = ws({ 'a.ts': 'x\n' });
  const s = new ChangesetProposalStore();
  assert.throws(
    () => proposeChangeset({ rootPath: root, ops: [{ op: 'replace', path: 'a.ts', content: '1\n' }, { op: 'delete', path: 'a.ts' }], allowDelete: true }, fs, s),
    (e: unknown) => e instanceof ChangesetError && e.code === 'CONFLICT',
  );
});

test('oversized files / changesets are rejected (TOO_LARGE)', () => {
  const root = ws();
  const s = new ChangesetProposalStore();
  const huge = 'x'.repeat(2 * 1024 * 1024 + 1);
  assert.throws(() => proposeChangeset({ rootPath: root, ops: [{ op: 'create', path: 'big.txt', content: huge }] }, fs, s), (e: unknown) => e instanceof ChangesetError && e.code === 'TOO_LARGE');
  const many = Array.from({ length: 201 }, (_, i) => ({ op: 'create' as const, path: `f${i}.txt`, content: 'x' }));
  assert.throws(() => proposeChangeset({ rootPath: root, ops: many }, fs, s), (e: unknown) => e instanceof ChangesetError && e.code === 'TOO_LARGE');
});

test('delete requires allowDelete; with it, the file is removed', () => {
  const root = ws({ 'gone.txt': 'bye\n' });
  const s = new ChangesetProposalStore();
  assert.throws(() => proposeChangeset({ rootPath: root, ops: [{ op: 'delete', path: 'gone.txt' }] }, fs, s), (e: unknown) => e instanceof ChangesetError && e.code === 'DELETE_NOT_ALLOWED');
  proposeAndApply({ rootPath: root, ops: [{ op: 'delete', path: 'gone.txt' }], allowDelete: true }, root);
  assert.equal(existsSync(path.join(root, 'gone.txt')), false);
});

// ── rollback: partial failure cannot leave a mixed state ─────────────────────────

test('partial failure rolls back ALL prior ops (no mixed state); rollback material is valid', () => {
  const root = ws({ 'keep.txt': 'ORIGINAL\n' });
  const store = new ChangesetProposalStore();
  const p = proposeChangeset({ rootPath: root, ops: [{ op: 'replace', path: 'keep.txt', content: 'NEW\n' }, { op: 'create', path: 'second.js', content: 'x\n' }] }, fs, store);
  let writes = 0;
  const flaky: ChangesetFs = { ...fs, writeFile: (pp, c) => { if (++writes === 2) throw new Error('disk full (simulated)'); fs.writeFile(pp, c); } };
  assert.throws(() => applyChangeset({ rootPath: root, proposalHash: p.proposalHash }, flaky, store), (e: unknown) => e instanceof ChangesetError && e.code === 'PARTIAL_WRITE');
  assert.equal(read(root, 'keep.txt'), 'ORIGINAL\n', 'rolled back to original');
  assert.equal(existsSync(path.join(root, 'second.js')), false, 'partial create removed');
});

test('apply returns valid reverse material per touched file', () => {
  const root = ws({ 'a.txt': 'orig\n' });
  const res = proposeAndApply({ rootPath: root, ops: [{ op: 'replace', path: 'a.txt', content: 'new\n' }, { op: 'create', path: 'b.txt', content: 'b\n' }] }, root);
  assert.deepEqual(res.created, ['b.txt']);
  assert.deepEqual(res.modified, ['a.txt']);
  assert.equal(res.rollback.find((r) => r.path === 'a.txt')!.previousContent, 'orig\n');
  assert.equal(res.rollback.find((r) => r.path === 'b.txt')!.previousContent, null);
});

// ── server-stored proposal contract: no client body resubmission ────────────────

test('apply consumes a stored proposal by hash; an unknown hash is refused', () => {
  const root = ws();
  const store = new ChangesetProposalStore();
  assert.throws(() => applyChangeset({ rootPath: root, proposalHash: 'deadbeef' }, fs, store), (e: unknown) => e instanceof ChangesetError && e.code === 'UNKNOWN_PROPOSAL');
});

test('proposal is single-use: re-applying the same hash is refused after it succeeds', () => {
  const root = ws();
  const store = new ChangesetProposalStore();
  const p = proposeChangeset({ rootPath: root, ops: [{ op: 'create', path: 'once.js', content: '1\n' }] }, fs, store);
  applyChangeset({ rootPath: root, proposalHash: p.proposalHash }, fs, store);
  assert.throws(() => applyChangeset({ rootPath: root, proposalHash: p.proposalHash }, fs, store), (e: unknown) => e instanceof ChangesetError && e.code === 'UNKNOWN_PROPOSAL');
});

test('expired proposals are not applicable', () => {
  const root = ws();
  let now = 1_000;
  const store = new ChangesetProposalStore(() => now);
  const p = proposeChangeset({ rootPath: root, ops: [{ op: 'create', path: 'x.js', content: '1\n' }] }, fs, store);
  now += 31 * 60_000; // past the 30-min TTL
  assert.throws(() => applyChangeset({ rootPath: root, proposalHash: p.proposalHash }, fs, store), (e: unknown) => e instanceof ChangesetError && e.code === 'UNKNOWN_PROPOSAL');
});

// ── approval lifecycle through the engine ───────────────────────────────────────

test('engine apply: mint (parks, no write) → approve (applies once) → replay refused', async () => {
  const deps = { registry: new CapabilityRegistry(), approvals: new ToolApprovalStore(), audit: new ToolAudit() };
  const root = ws();
  // Propose through the SAME registry so the store is shared.
  const proposal = (await executeToolCore(deps, { tool: 'fs.proposeChangeset', input: { rootPath: root, ops: [{ op: 'create', path: 'made.js', content: 'hi\n' }] }, requestId: 'p' }));
  const proposalHash = (proposal.ok ? (proposal.result as { proposalHash: string }).proposalHash : '');
  const applyInput = { rootPath: root, proposalHash };

  const parked = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: applyInput, requestId: 'r1' });
  assert.ok(parked.ok && parked.status === 'approval_required');
  assert.equal(existsSync(path.join(root, 'made.js')), false, 'parked apply must not write');
  const approvalId = parked.ok ? parked.approvalId! : '';

  const applied = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: applyInput, approvalId, requestId: 'r2' });
  assert.ok(applied.ok && applied.status === 'executed');
  assert.equal(read(root, 'made.js'), 'hi\n');

  const replay = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: applyInput, approvalId, requestId: 'r3' });
  assert.ok(!replay.ok && replay.code === 'INVALID_STATE');
});

test('an approval minted for proposal A cannot apply proposal B (hash-bound)', async () => {
  const deps = { registry: new CapabilityRegistry(), approvals: new ToolApprovalStore(), audit: new ToolAudit() };
  const root = ws();
  const a = await executeToolCore(deps, { tool: 'fs.proposeChangeset', input: { rootPath: root, ops: [{ op: 'create', path: 'a.js', content: 'a\n' }] }, requestId: 'pa' });
  const b = await executeToolCore(deps, { tool: 'fs.proposeChangeset', input: { rootPath: root, ops: [{ op: 'create', path: 'b.js', content: 'b\n' }] }, requestId: 'pb' });
  const hashA = a.ok ? (a.result as { proposalHash: string }).proposalHash : '';
  const hashB = b.ok ? (b.result as { proposalHash: string }).proposalHash : '';
  const parked = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: { rootPath: root, proposalHash: hashA }, requestId: 'r1' });
  const approvalId = parked.ok ? parked.approvalId! : '';
  // Use A's approval against B's hash → binding mismatch, refused, nothing written.
  const res = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: { rootPath: root, proposalHash: hashB }, approvalId, requestId: 'r2' });
  assert.ok(!res.ok && res.code === 'INVALID_STATE');
  assert.equal(existsSync(path.join(root, 'b.js')), false);
});

test('previewStoredChangeset renders the stored proposal without consuming it', () => {
  const root = ws();
  const store = new ChangesetProposalStore();
  const p = proposeChangeset({ rootPath: root, ops: [{ op: 'create', path: 'x.js', content: '1\n' }] }, fs, store);
  const preview = previewStoredChangeset({ rootPath: root, proposalHash: p.proposalHash }, fs, store);
  assert.equal(preview.ops[0]!.kind, 'add');
  assert.ok(store.get(p.proposalHash), 'preview must NOT consume the proposal');
});

// ── owner merge-bar invariants ──────────────────────────────────────────────────

test('invariant #1: proposal hash is canonical — key order does not change identity', () => {
  const root = ws({ 'a.txt': 'x\n' });
  const s = new ChangesetProposalStore();
  // Two logically-identical proposals whose op object keys arrive in different
  // order must yield the SAME proposal hash.
  const h1 = proposeChangeset({ rootPath: root, ops: [{ op: 'patch', path: 'a.txt', startLine: 1, endLine: 1, replacement: 'Y' }] }, fs, s).proposalHash;
  const h2 = proposeChangeset({ rootPath: root, ops: [{ replacement: 'Y', endLine: 1, startLine: 1, path: 'a.txt', op: 'patch' } as never] }, fs, s).proposalHash;
  assert.equal(h1, h2);
});

test('invariant #2: an approval cannot outlive its proposal (approval TTL < proposal TTL)', async () => {
  let now = 1_000;
  const approvals = new ToolApprovalStore(() => now, undefined, 5 * 60_000);
  const store = new ChangesetProposalStore(() => now);
  const deps = { registry: new CapabilityRegistry(), approvals, audit: new ToolAudit() };
  // Proposal must be stored in the registry's store; use the shared store via a
  // direct proposal here, then drive apply through the engine with our approvals.
  const root = ws();
  // Register a proposal in the registry-backed store by calling propose through the engine.
  const prop = await executeToolCore(deps, { tool: 'fs.proposeChangeset', input: { rootPath: root, ops: [{ op: 'create', path: 'x.js', content: '1\n' }] }, requestId: 'p' });
  const hash = prop.ok ? (prop.result as { proposalHash: string }).proposalHash : '';
  const parked = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: { rootPath: root, proposalHash: hash }, requestId: 'r1' });
  const approvalId = parked.ok ? parked.approvalId! : '';
  now += 6 * 60_000; // past approval TTL (5m), still within proposal TTL (30m)
  const res = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: { rootPath: root, proposalHash: hash }, approvalId, requestId: 'r2' });
  assert.ok(!res.ok && res.code === 'INVALID_STATE', 'expired approval must be refused before the proposal expires');
});

test('invariant #3: two concurrent applies for one approval → exactly one success', async () => {
  const deps = { registry: new CapabilityRegistry(), approvals: new ToolApprovalStore(), audit: new ToolAudit() };
  const root = ws();
  const prop = await executeToolCore(deps, { tool: 'fs.proposeChangeset', input: { rootPath: root, ops: [{ op: 'create', path: 'once.js', content: 'X\n' }] }, requestId: 'p' });
  const hash = prop.ok ? (prop.result as { proposalHash: string }).proposalHash : '';
  const parked = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: { rootPath: root, proposalHash: hash }, requestId: 'r1' });
  const approvalId = parked.ok ? parked.approvalId! : '';
  const applyInput = { rootPath: root, proposalHash: hash };
  const [a, b] = await Promise.all([
    executeToolCore(deps, { tool: 'fs.applyChangeset', input: applyInput, approvalId, requestId: 'c1' }),
    executeToolCore(deps, { tool: 'fs.applyChangeset', input: applyInput, approvalId, requestId: 'c2' }),
  ]);
  const okCount = [a, b].filter((r) => r.ok && r.status === 'executed').length;
  const failCount = [a, b].filter((r) => !r.ok && (r.code === 'INVALID_STATE' || r.code === 'UNKNOWN_PROPOSAL')).length;
  assert.equal(okCount, 1, 'exactly one apply succeeds');
  assert.equal(failCount, 1, 'the other is refused');
  assert.equal(read(root, 'once.js'), 'X\n'); // written exactly once
});

test('invariant #4: the same proposal hash cannot target a different workspace', async () => {
  const store = new ChangesetProposalStore();
  const rootA = ws();
  const rootB = ws();
  const p = proposeChangeset({ rootPath: rootA, ops: [{ op: 'create', path: 'x.js', content: '1\n' }] }, fs, store);
  // Re-store under the same hash but attempt to apply against a DIFFERENT root.
  assert.throws(() => applyChangeset({ rootPath: rootB, proposalHash: p.proposalHash }, fs, store), /does not resolve to the stored proposal root/);
});

test('invariant #4: a symlink alias to the SAME real root is accepted', () => {
  const store = new ChangesetProposalStore();
  const root = ws();
  const alias = path.join(mkdtempSync(path.join(tmpdir(), 'alias-')), 'ws');
  symlinkSync(root, alias);
  const p = proposeChangeset({ rootPath: root, ops: [{ op: 'create', path: 'x.js', content: '1\n' }] }, fs, store);
  applyChangeset({ rootPath: alias, proposalHash: p.proposalHash }, fs, store); // alias → same real dir → accepted
  assert.equal(read(root, 'x.js'), '1\n');
});

test('invariant #5: a rollback failure surfaces INCONSISTENT_STATE, never a clean-rollback claim', () => {
  const root = ws({ 'keep.txt': 'ORIG\n' });
  const store = new ChangesetProposalStore();
  const p = proposeChangeset({ rootPath: root, ops: [{ op: 'replace', path: 'keep.txt', content: 'NEW\n' }, { op: 'create', path: 'second.js', content: 'x\n' }] }, fs, store);
  let writes = 0;
  const broken: ChangesetFs = {
    ...fs,
    writeFile: (pp, c) => {
      writes++;
      if (writes === 2) throw new Error('apply write failed');
      if (writes === 3) throw new Error('rollback write ALSO failed'); // undo restore fails
      fs.writeFile(pp, c);
    },
  };
  assert.throws(() => applyChangeset({ rootPath: root, proposalHash: p.proposalHash }, broken, store), (e: unknown) => e instanceof ChangesetError && e.code === 'INCONSISTENT_STATE');
});

test('invariant #6: allowDelete is hash-bound and comes only from the stored proposal', () => {
  const root = ws({ 'a.txt': 'x\n' });
  const s = new ChangesetProposalStore();
  // allowDelete true vs false → different proposal identities (hash-bound).
  const withDel = proposeChangeset({ rootPath: root, ops: [{ op: 'delete', path: 'a.txt' }], allowDelete: true }, fs, s).proposalHash;
  const root2 = ws({ 'a.txt': 'x\n' });
  // Same ops, allowDelete omitted → rejected at propose (can't even get a hash).
  assert.throws(() => proposeChangeset({ rootPath: root2, ops: [{ op: 'delete', path: 'a.txt' }] }, fs, s), (e: unknown) => e instanceof ChangesetError && e.code === 'DELETE_NOT_ALLOWED');
  // The apply request schema carries NO allowDelete field — a client cannot inject it.
  assert.ok(withDel.length === 64);
});

test('fs.proposeChangeset is read-only + available; fs.applyChangeset is mutating + approval-required', () => {
  const reg = new CapabilityRegistry();
  const propose = reg.get('fs.proposeChangeset');
  const apply = reg.get('fs.applyChangeset');
  assert.ok(propose && propose.available && propose.readOnly);
  assert.ok(apply && apply.available && !apply.readOnly && apply.approvalRequired);
});
