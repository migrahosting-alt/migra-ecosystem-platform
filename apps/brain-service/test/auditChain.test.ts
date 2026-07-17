// Operational Readiness Slice 3 — end-to-end audit chain + INCONSISTENT_STATE
// incident via deterministic fault injection (no real workspace is damaged).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { CapabilityRegistry } from '../src/engine/capabilityRegistry.js';
import { ToolApprovalStore } from '../src/engine/toolApprovalStore.js';
import { ToolAudit } from '../src/engine/toolAudit.js';
import { executeToolCore } from '../src/engine/toolExecutor.js';
import { auditStore, auditHash } from '../src/engine/auditLog.js';
import { proposeChangeset, applyChangeset, ChangesetProposalStore, ChangesetError, type ChangesetFs } from '../src/tools/changeset.js';
import { nodeChangesetFs } from '../src/tools/changesetFs.js';
import { IncidentManager, LocalAlertSink } from '../src/engine/incidents.js';
import { telemetryHub } from '../src/engine/telemetryHub.js';
import { registerToolExecutionRoutes } from '../src/engine/toolRoutes.js';
import { registerEngineerRoutes } from '../src/engine/engineerRoutes.js';
import { ModelRegistry } from '../src/engine/modelRegistry.js';

const fs = nodeChangesetFs();
function ws(seed: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'auditchain-'));
  for (const [rel, c] of Object.entries(seed)) writeFileSync(path.join(root, rel), c);
  return root;
}
function stageFor(cid: string) {
  return { correlationId: cid, log() {}, async timed(_s: unknown, _f: unknown, fn: () => Promise<unknown>) { return fn(); } } as never;
}

test('Run A — happy application: full audit chain shares one correlation + causation', async () => {
  const deps = { registry: new CapabilityRegistry(), approvals: new ToolApprovalStore(undefined, undefined, undefined, telemetryHub.sink), audit: new ToolAudit() };
  const root = ws({ 'README.md': '#\n' });
  const cid = 'corr_runA';
  const prop = await executeToolCore(deps, { tool: 'fs.proposeChangeset', input: { rootPath: root, ops: [{ op: 'create', path: 'x.js', content: '1\n' }] }, requestId: 'p', stage: stageFor(cid) });
  const hash = prop.ok ? (prop.result as { proposalHash: string }).proposalHash : '';
  const parked = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: { rootPath: root, proposalHash: hash }, requestId: 'r1', stage: stageFor(cid) });
  const approvalId = parked.ok ? parked.approvalId! : '';
  const applied = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: { rootPath: root, proposalHash: hash }, approvalId, requestId: 'r2', stage: stageFor(cid) });
  assert.ok(applied.ok && applied.status === 'executed');

  const chain = auditStore.byCorrelation(cid);
  const types = chain.map((r) => r.type);
  assert.ok(types.includes('proposal.created'), 'proposal.created audited');
  assert.ok(types.includes('approval.minted'), 'approval.minted audited');
  assert.ok(types.includes('approval.consumed'), 'approval.consumed audited');
  assert.ok(types.includes('application.started'), 'application.started audited');
  assert.ok(types.includes('application.completed'), 'application.completed audited');
  // causation chain is linear + ordered by seq.
  assert.ok(chain.every((r) => r.correlationId === cid));
  for (let i = 1; i < chain.length; i++) assert.ok(chain[i]!.seq > chain[i - 1]!.seq);
  // No sensitive values in the chain.
  const flat = JSON.stringify(chain);
  assert.ok(!flat.includes(root) && !flat.includes(approvalId) && !flat.includes(hash));
});

test('Run B — replay: rejection is audited; no critical incident', async () => {
  const deps = { registry: new CapabilityRegistry(), approvals: new ToolApprovalStore(undefined, undefined, undefined, telemetryHub.sink), audit: new ToolAudit() };
  const root = ws();
  const cid = 'corr_runB';
  const prop = await executeToolCore(deps, { tool: 'fs.proposeChangeset', input: { rootPath: root, ops: [{ op: 'create', path: 'y.js', content: '1\n' }] }, requestId: 'p', stage: stageFor(cid) });
  const hash = prop.ok ? (prop.result as { proposalHash: string }).proposalHash : '';
  const parked = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: { rootPath: root, proposalHash: hash }, requestId: 'r1', stage: stageFor(cid) });
  const approvalId = parked.ok ? parked.approvalId! : '';
  await executeToolCore(deps, { tool: 'fs.applyChangeset', input: { rootPath: root, proposalHash: hash }, approvalId, requestId: 'r2', stage: stageFor(cid) });
  const replay = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: { rootPath: root, proposalHash: hash }, approvalId, requestId: 'r3', stage: stageFor(cid) });
  assert.ok(!replay.ok && replay.code === 'INVALID_STATE');
  const chain = auditStore.byCorrelation(cid);
  assert.ok(chain.some((r) => r.type === 'approval.replayed'), 'replay audited');
  assert.ok(!chain.some((r) => r.type === 'application.rollback_failed'), 'no INCONSISTENT_STATE for a replay');
});

test('Run C — rollback failure (fault-injected) → INCONSISTENT_STATE → critical incident, deduped', () => {
  // Deterministic fault: writeFile fails on the 2nd write (apply) AND on the
  // restore (rollback) → INCONSISTENT_STATE. No real workspace is damaged.
  const root = ws({ 'keep.txt': 'ORIG\n' });
  const store = new ChangesetProposalStore(() => Date.now());
  const proposal = proposeChangeset({ rootPath: root, ops: [{ op: 'replace', path: 'keep.txt', content: 'NEW\n' }, { op: 'create', path: 'second.js', content: 'x\n' }] }, fs, store);
  let writes = 0;
  const faultFs: ChangesetFs = { ...fs, writeFile: (p, c) => { writes++; if (writes >= 2) throw new Error('injected fault'); fs.writeFile(p, c); } };

  const sink = new LocalAlertSink();
  const incidents = new IncidentManager(sink.sink, () => 1);
  const raiseFrom = (err: ChangesetError, cid: string) => {
    const d = err.details!;
    return incidents.raiseInconsistentState({ correlationId: cid, workspaceIdentityHash: auditHash(root), proposalHashPrefix: auditHash(proposal.proposalHash), appliedFileCount: d.appliedFileCount, affectedPathCount: d.affectedPathCount, rollbackFailureCount: d.rollbackFailureCount, failureStage: d.failureStage });
  };

  let caught: ChangesetError | null = null;
  try {
    applyChangeset({ rootPath: root, proposalHash: proposal.proposalHash }, faultFs, store, 'corr_runC');
  } catch (e) {
    caught = e as ChangesetError;
  }
  assert.ok(caught && caught.code === 'INCONSISTENT_STATE', 'rollback failure raises INCONSISTENT_STATE');
  assert.ok(caught.details && caught.details.rollbackFailureCount === 1);

  const first = raiseFrom(caught, 'corr_runC');
  assert.equal(first.notified, true);
  assert.equal(first.incident.severity, 'critical');
  // A repeat of the SAME incident dedups the notification but counts occurrences.
  const second = raiseFrom(caught, 'corr_runC');
  assert.equal(second.notified, false);
  assert.equal(second.incident.occurrenceCount, 2);
  assert.equal(sink.delivered.length, 1);
});

test('endpoints: audit?correlationId, incidents, incidents/:id expose no sensitive data', async () => {
  const app = Fastify({ logger: false });
  const env = { localProvider: 'stub', providerBaseUrl: '', openAiApiKey: undefined } as never;
  const toolDeps = registerToolExecutionRoutes(app);
  registerEngineerRoutes(app, env, new ModelRegistry({ sources: [], staticModels: [] }), toolDeps);
  await app.ready();
  const cid = 'corr_endpoints';
  const root = ws({ 'README.md': '#\n' });
  await executeToolCore(toolDeps, { tool: 'fs.proposeChangeset', input: { rootPath: root, ops: [{ op: 'create', path: 'x.js', content: 'SECRET\n' }] }, requestId: 'p', stage: stageFor(cid) });

  const audit = await app.inject({ method: 'GET', url: `/api/ai/engineer/audit?correlationId=${cid}` });
  assert.equal(audit.statusCode, 200);
  const auditBody = audit.json();
  assert.ok(auditBody.records.length >= 1);
  assert.ok(auditBody.records.every((r: { correlationId: string }) => r.correlationId === cid));
  assert.doesNotMatch(JSON.stringify(auditBody), /SECRET/);
  assert.ok(!JSON.stringify(auditBody).includes(root));

  const missing = await app.inject({ method: 'GET', url: '/api/ai/engineer/audit' });
  assert.equal(missing.statusCode, 400);

  const incidents = await app.inject({ method: 'GET', url: '/api/ai/engineer/incidents' });
  assert.equal(incidents.statusCode, 200);
  assert.ok(Array.isArray(incidents.json().incidents));

  const unknown = await app.inject({ method: 'GET', url: '/api/ai/engineer/incidents/nope' });
  assert.equal(unknown.statusCode, 404);
  await app.close();
});
