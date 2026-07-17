// Operational Readiness Slice 1 — execution correlation. A single correlation id
// threads through request → route → loop-step → tool/proposal → apply, and each
// stage emits ONE metadata-only line.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  newCorrelationId,
  makeStageLogger,
  jsonLineSink,
  type StageEvent,
} from '../src/engine/correlation.js';
import { runEngineerTask, type EngineerToolInfo } from '../src/engine/engineerRuntime.js';
import { proposeChangeset, applyChangeset, ChangesetProposalStore } from '../src/tools/changeset.js';
import { nodeChangesetFs } from '../src/tools/changesetFs.js';
import { CapabilityRegistry } from '../src/engine/capabilityRegistry.js';
import { ToolApprovalStore } from '../src/engine/toolApprovalStore.js';
import { ToolAudit } from '../src/engine/toolAudit.js';
import { executeToolCore } from '../src/engine/toolExecutor.js';

test('newCorrelationId is deterministic under injected time/rand and prefixed', () => {
  const id = newCorrelationId(() => 100, () => 0.5);
  assert.match(id, /^corr_/);
  assert.equal(id, newCorrelationId(() => 100, () => 0.5));
});

test('jsonLineSink emits one metadata-only line per stage with the correlation id', () => {
  const lines: string[] = [];
  const log = makeStageLogger('corr_x', jsonLineSink((l) => lines.push(l)), () => 7);
  log.log('request', { rootPath: '/w' });
  const parsed = JSON.parse(lines[0]!);
  assert.equal(parsed.evt, 'exec.stage');
  assert.equal(parsed.correlationId, 'corr_x');
  assert.equal(parsed.stage, 'request');
  assert.equal(parsed.at, 7);
  assert.equal(parsed.rootPath, '/w');
});

test('the SAME correlation id threads through every loop stage in order', async () => {
  const events: StageEvent[] = [];
  const stage = makeStageLogger('corr_thread', (e) => events.push(e), () => 1);
  const TOOLS: EngineerToolInfo[] = [
    { id: 'workspace.search', description: 'search', readOnly: true, inputHint: '{}' },
    { id: 'fs.proposeChangeset', description: 'propose', readOnly: true, inputHint: '{}' },
  ];
  const deps = {
    complete: async (p: string) =>
      p.includes('Result of')
        ? '{"final":"Inspected the workspace and proposed a file; nothing applied."}'
        : p.includes('proposeChangeset') || p.includes('Continue')
          ? '{"action":{"tool":"fs.proposeChangeset","input":{"ops":[{"op":"create","path":"a.js","content":"x"}]}}}'
          : '{"action":{"tool":"workspace.search","input":{"query":"x"}}}',
    executeTool: async (tool: string) => (tool === 'fs.proposeChangeset' ? { ops: [{ path: 'a.js', kind: 'add' }] } : { matches: [] }),
    tools: TOOLS,
    stage,
  };
  for await (const _ of runEngineerTask(deps, { rootPath: '/w', task: 'build' })) {
    /* drain */
  }
  // Every stage carries the same id.
  assert.ok(events.length > 0);
  assert.ok(events.every((e) => e.correlationId === 'corr_thread'));
  const stages = events.map((e) => e.stage);
  assert.ok(stages.includes('loop-step'), 'loop-step logged');
  assert.ok(stages.includes('proposal'), 'proposal logged');
  assert.ok(stages.includes('final'), 'final logged');
  // request/route are emitted by the ROUTE (not the pure loop); loop-step precedes final.
  assert.ok(stages.indexOf('loop-step') < stages.indexOf('final'));
});

test('the executor emits approval + apply stages under the same correlation id', async () => {
  const events: StageEvent[] = [];
  const stage = makeStageLogger('corr_apply', (e) => events.push(e), () => 1);
  const deps = { registry: new CapabilityRegistry(), approvals: new ToolApprovalStore(), audit: new ToolAudit() };
  const fs = nodeChangesetFs();
  const store = new ChangesetProposalStore();
  const root = mkdtempSync(path.join(tmpdir(), 'corr-'));
  writeFileSync(path.join(root, 'README.md'), '#\n');

  // Register the proposal in the registry-backed store via the engine.
  const prop = await executeToolCore(deps, { tool: 'fs.proposeChangeset', input: { rootPath: root, ops: [{ op: 'create', path: 'x.js', content: '1\n' }] }, requestId: 'p', stage });
  const hash = prop.ok ? (prop.result as { proposalHash: string }).proposalHash : '';

  const parked = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: { rootPath: root, proposalHash: hash }, requestId: 'r1', stage });
  const approvalId = parked.ok ? parked.approvalId! : '';
  await executeToolCore(deps, { tool: 'fs.applyChangeset', input: { rootPath: root, proposalHash: hash }, approvalId, requestId: 'r2', stage });

  const stages = events.map((e) => e.stage);
  assert.ok(stages.includes('approval'), 'approval (mint) logged');
  assert.ok(stages.includes('apply'), 'apply (approved execute) logged');
  assert.ok(events.every((e) => e.correlationId === 'corr_apply'));
  // Redaction: no field carries file content, the proposal hash, or the approval token.
  const flat = JSON.stringify(events);
  assert.doesNotMatch(flat, /content|1\\n/);
  assert.ok(!flat.includes(hash), 'proposal hash is not in stage fields');
  assert.ok(!flat.includes(approvalId), 'approval token is not in stage fields');
});

test('replayed approval logs a refused approval stage (still correlated)', async () => {
  const events: StageEvent[] = [];
  const stage = makeStageLogger('corr_replay', (e) => events.push(e), () => 1);
  const deps = { registry: new CapabilityRegistry(), approvals: new ToolApprovalStore(), audit: new ToolAudit() };
  const fs = nodeChangesetFs();
  const root = mkdtempSync(path.join(tmpdir(), 'corr2-'));
  const prop = await executeToolCore(deps, { tool: 'fs.proposeChangeset', input: { rootPath: root, ops: [{ op: 'create', path: 'y.js', content: '1\n' }] }, requestId: 'p', stage });
  const hash = prop.ok ? (prop.result as { proposalHash: string }).proposalHash : '';
  const parked = await executeToolCore(deps, { tool: 'fs.applyChangeset', input: { rootPath: root, proposalHash: hash }, requestId: 'r1', stage });
  const approvalId = parked.ok ? parked.approvalId! : '';
  await executeToolCore(deps, { tool: 'fs.applyChangeset', input: { rootPath: root, proposalHash: hash }, approvalId, requestId: 'r2', stage });
  await executeToolCore(deps, { tool: 'fs.applyChangeset', input: { rootPath: root, proposalHash: hash }, approvalId, requestId: 'r3', stage });
  const refused = events.find((e) => e.stage === 'approval' && e.fields.status === 'refused');
  assert.ok(refused, 'a refused approval stage is emitted on replay');
});
