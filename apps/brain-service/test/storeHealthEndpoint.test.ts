// Operational Readiness Slice 2 — health endpoint + concurrency + sink isolation.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { registerToolExecutionRoutes } from '../src/engine/toolRoutes.js';
import { registerEngineerRoutes } from '../src/engine/engineerRoutes.js';
import { ModelRegistry } from '../src/engine/modelRegistry.js';
import { ChangesetProposalStore, proposeChangeset, applyChangeset } from '../src/tools/changeset.js';
import { nodeChangesetFs } from '../src/tools/changesetFs.js';
import { ToolApprovalStore, hashInput } from '../src/engine/toolApprovalStore.js';
import { CapabilityRegistry } from '../src/engine/capabilityRegistry.js';
import { ToolAudit } from '../src/engine/toolAudit.js';
import { executeToolCore } from '../src/engine/toolExecutor.js';

const fs = nodeChangesetFs();
function ws(seed: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sh-'));
  for (const [rel, c] of Object.entries(seed)) writeFileSync(path.join(root, rel), c);
  return root;
}

test('GET /api/ai/engineer/stores/health returns aggregate health + counters, no sensitive data', async () => {
  const app = Fastify({ logger: false });
  const env = { localProvider: 'stub', providerBaseUrl: '', openAiApiKey: undefined } as never;
  const toolDeps = registerToolExecutionRoutes(app);
  registerEngineerRoutes(app, env, new ModelRegistry({ sources: [], staticModels: [] }), toolDeps);
  await app.ready();

  // Drive a proposal through the SHARED registry store so the endpoint reflects it.
  const root = ws({ 'README.md': '#\n' });
  const stage = { correlationId: 'corr_ep', log() {}, async timed(_s: unknown, _f: unknown, fn: () => Promise<unknown>) { return fn(); } };
  await executeToolCore({ registry: toolDeps.registry, approvals: toolDeps.approvals, audit: toolDeps.audit }, {
    tool: 'fs.proposeChangeset',
    input: { rootPath: root, ops: [{ op: 'create', path: 'x.js', content: 'SECRET\n' }] },
    requestId: 'p',
    stage: stage as never,
  });

  const res = await app.inject({ method: 'GET', url: '/api/ai/engineer/stores/health' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(['healthy', 'degraded', 'unhealthy'].includes(body.status));
  assert.equal(body.stores.proposal.name, 'proposal');
  assert.equal(body.stores.approval.name, 'approval');
  assert.ok(typeof body.stores.proposal.created_total === 'number');
  assert.ok(Array.isArray(body.recent));
  // Redaction: no file content, no raw workspace path anywhere in the response.
  const flat = JSON.stringify(body);
  assert.doesNotMatch(flat, /SECRET/);
  assert.ok(!flat.includes(root), 'no raw workspace path in health response');
  await app.close();
});

test('concurrent apply of one proposal records exactly one consume (invariant #14/#15)', async () => {
  const deps = { registry: new CapabilityRegistry(), approvals: new ToolApprovalStore(), audit: new ToolAudit() };
  const root = ws();
  const prop = await executeToolCore(deps, { tool: 'fs.proposeChangeset', input: { rootPath: root, ops: [{ op: 'create', path: 'once.js', content: '1\n' }] }, requestId: 'p' });
  const hash = prop.ok ? (prop.result as { proposalHash: string }).proposalHash : '';
  const parked = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: { rootPath: root, proposalHash: hash }, requestId: 'r1' });
  const approvalId = parked.ok ? parked.approvalId! : '';
  const [a, b] = await Promise.all([
    executeToolCore(deps, { tool: 'fs.applyChangeset', input: { rootPath: root, proposalHash: hash }, approvalId, requestId: 'c1' }),
    executeToolCore(deps, { tool: 'fs.applyChangeset', input: { rootPath: root, proposalHash: hash }, approvalId, requestId: 'c2' }),
  ]);
  assert.equal([a, b].filter((r) => r.ok && r.status === 'executed').length, 1);
  assert.equal([a, b].filter((r) => !r.ok).length, 1);
});

test('telemetry sink failure neither blocks nor permits an application incorrectly (invariant #8)', async () => {
  const throwingStore = new ChangesetProposalStore(() => Date.now(), () => {
    throw new Error('telemetry down');
  });
  const root = ws({ 'a.txt': 'v1\n' });
  // Propose + apply must both succeed despite the sink throwing on every event.
  const p = proposeChangeset({ rootPath: root, ops: [{ op: 'replace', path: 'a.txt', content: 'v2\n' }] }, fs, throwingStore);
  const res = applyChangeset({ rootPath: root, proposalHash: p.proposalHash }, fs, throwingStore);
  assert.deepEqual(res.modified, ['a.txt']);
  // And a STALE apply must still be refused (enforcement intact) with a throwing sink.
  const p2 = proposeChangeset({ rootPath: root, ops: [{ op: 'replace', path: 'a.txt', content: 'v3\n' }] }, fs, throwingStore);
  writeFileSync(path.join(root, 'a.txt'), 'DRIFT\n');
  assert.throws(() => applyChangeset({ rootPath: root, proposalHash: p2.proposalHash }, fs, throwingStore), /STALE|source changed/i);
});

test('metrics counters stay internally consistent across consume + expiry (invariant #16)', () => {
  let now = 1000;
  const store = new ChangesetProposalStore(() => now);
  const root = ws();
  const p1 = proposeChangeset({ rootPath: root, ops: [{ op: 'create', path: 'a.js', content: '1' }] }, fs, store);
  const p2 = proposeChangeset({ rootPath: root, ops: [{ op: 'create', path: 'b.js', content: '1' }] }, fs, store);
  store.take(p1.proposalHash); // consume 1
  now += 31 * 60_000;
  store.health(); // sweep expires p2
  const h = store.health();
  assert.equal(h.created_total, 2);
  assert.equal(h.consumed_total, 1);
  assert.ok(h.expired_total >= 1);
  assert.equal(h.current_entries, 0);
});

test('hashInput unchanged: approval binding still SHA-256 (telemetry did not alter semantics, invariant #10)', () => {
  assert.equal(hashInput({ a: 1, b: 2 }), hashInput({ b: 2, a: 1 }));
  assert.equal(hashInput({ a: 1 }).length, 64);
});

test('correlation threads through the executor into store telemetry (proposal + approval, invariant #9)', async () => {
  const events: Array<{ event: string; correlationId?: string }> = [];
  const deps = { registry: new CapabilityRegistry(), approvals: new ToolApprovalStore(() => Date.now(), undefined, 5 * 60_000, (e) => events.push(e)), audit: new ToolAudit() };
  const stage = { correlationId: 'corr_exec', log() {}, async timed(_s: unknown, _f: unknown, fn: () => Promise<unknown>) { return fn(); } };
  const root = ws({ 'README.md': '#\n' });
  const prop = await executeToolCore(deps, { tool: 'fs.proposeChangeset', input: { rootPath: root, ops: [{ op: 'create', path: 'x.js', content: '1\n' }] }, requestId: 'p', stage: stage as never });
  const hash = prop.ok ? (prop.result as { proposalHash: string }).proposalHash : '';
  const parked = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: { rootPath: root, proposalHash: hash }, requestId: 'r1', stage: stage as never });
  const approvalId = parked.ok ? parked.approvalId! : '';
  await executeToolCore(deps, { tool: 'fs.applyChangeset', input: { rootPath: root, proposalHash: hash }, approvalId, requestId: 'r2', stage: stage as never });
  const approvalEvents = events.filter((e) => e.event.startsWith('approval.'));
  assert.ok(approvalEvents.length >= 2);
  assert.ok(approvalEvents.every((e) => e.correlationId === 'corr_exec'));
});
