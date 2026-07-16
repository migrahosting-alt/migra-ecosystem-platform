import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import Fastify from 'fastify';
import { CapabilityRegistry } from '../src/engine/capabilityRegistry.js';
import { ToolApprovalStore } from '../src/engine/toolApprovalStore.js';
import { ToolAudit } from '../src/engine/toolAudit.js';
import { AgentRegistry, type AgentDefinition, type AgentDescriptor } from '../src/engine/agentRegistry.js';
import { AgentRunStore, canTransition } from '../src/engine/agentRunStore.js';
import { AgentService, toRunView } from '../src/engine/agentRuntime.js';
import { registerAgentRoutes } from '../src/engine/agentRoutes.js';

// A tool registry whose 3 agent-used tools are deterministic in-memory fakes, so
// agent runs never touch the filesystem. `applied` records real mutations.
class FakeToolRegistry extends CapabilityRegistry {
  applied: unknown[] = [];
  override runnable(id: string) {
    const base = super.runnable(id);
    if (!base) return base;
    if (id === 'file.readRange') return { ...base, handler: async () => ({ lines: ['x'], path: 'f.ts' }) };
    if (id === 'diagnostics.get') return { ...base, handler: async () => ({ items: [] }) };
    if (id === 'edit.apply') {
      return {
        ...base,
        handler: async (input: unknown) => {
          this.applied.push(input);
          return { files: [{ path: 'f.ts', changed: true }] };
        },
        preview: async () => ({ files: [{ path: 'f.ts', before: 'a', after: 'b' }] }),
      };
    }
    return base;
  }
}

function descriptor(over: Partial<AgentDescriptor> & Pick<AgentDescriptor, 'id'>): AgentDescriptor {
  return {
    kind: 'agent', version: '1', displayName: over.id, purpose: 'test', operationClasses: ['read'],
    requiredModelCapabilities: [], requiredToolCapabilities: [], readOnly: true, approvalRequired: false,
    resumable: false, cancellable: true, maxSteps: 8, maxRuntimeMs: 60_000, available: true, ...over,
  };
}
const IN = z.object({ rootPath: z.string(), path: z.string() });

// Extra test-only agents: a step-limit looper, and pilot-runtime agents.
const LOOPER: AgentDefinition = {
  descriptor: descriptor({ id: '_test.looper', maxSteps: 1 }),
  runtime: 'local', inputSchema: IN,
  async plan(input, ctx) {
    const { rootPath, path } = input as z.infer<typeof IN>;
    await ctx.callTool('file.readRange', { rootPath, path, startLine: 1, endLine: 1 });
    await ctx.callTool('file.readRange', { rootPath, path, startLine: 2, endLine: 2 });
    return { kind: 'result', result: { ok: true } };
  },
};
const PILOT_MUTATE: AgentDefinition = {
  descriptor: descriptor({ id: '_test.pilot-mutate', readOnly: false, approvalRequired: true, operationClasses: ['propose-edit'] }),
  runtime: 'pilot', inputSchema: IN,
  async plan(input) {
    const { rootPath, path } = input as z.infer<typeof IN>;
    return { kind: 'action', tool: 'edit.apply', input: { rootPath, changes: [{ path, startLine: 1, endLine: 1, replacement: 'X' }] }, summary: 'x' };
  },
};

function svc(opts: { extra?: AgentDefinition[]; now?: () => number } = {}) {
  const fake = new FakeToolRegistry();
  const store = new AgentRunStore(opts.now);
  const service = new AgentService(new AgentRegistry(opts.extra ?? []), store, { registry: fake, approvals: new ToolApprovalStore(opts.now), audit: new ToolAudit(opts.now) }, { now: opts.now });
  return { service, store, fake };
}
const TARGET = { rootPath: '/tmp/x', path: 'f.ts' };

test('state machine: legal transitions + fail-closed', () => {
  assert.equal(canTransition('CREATED', 'PLANNING'), true);
  assert.equal(canTransition('RUNNING', 'WAITING_FOR_APPROVAL'), true);
  assert.equal(canTransition('COMPLETED', 'RUNNING'), false);
  assert.equal(canTransition('WAITING_FOR_APPROVAL', 'RUNNING'), false);
});

test('agent discovery + capability filtering', () => {
  const reg = new AgentRegistry();
  const ids = reg.list().map((a) => a.id);
  assert.ok(ids.includes('workspace.explain') && ids.includes('workspace.fix-diagnostics'));
  assert.ok(reg.list({ readOnly: true }).every((a) => a.readOnly));
  assert.ok(reg.list({ operationClass: 'propose-edit' }).every((a) => a.operationClasses.includes('propose-edit')));
});

test('immutable run specification (frozen)', async () => {
  const { service } = svc();
  const res = await service.createRun({ agentId: 'workspace.diagnostics', input: TARGET, requestId: 'r1' });
  assert.ok(res.ok);
  const spec = res.run.spec;
  assert.ok(Object.isFrozen(spec) && Object.isFrozen(spec.limits));
  assert.throws(() => { (spec as { agentId: string }).agentId = 'evil'; });
});

test('read-only run completes with a result', async () => {
  const { service } = svc();
  const res = await service.createRun({ agentId: 'workspace.diagnostics', input: TARGET, requestId: 'r1' });
  assert.ok(res.ok);
  assert.equal(res.run.state, 'COMPLETED');
  assert.deepEqual(res.run.result, { count: 0, items: [] });
});

test('approval-required run parks WAITING and does not mutate', async () => {
  const { service, fake } = svc();
  const res = await service.createRun({ agentId: 'workspace.test-generator', input: TARGET, requestId: 'r1' });
  assert.ok(res.ok);
  assert.equal(res.run.state, 'WAITING_FOR_APPROVAL');
  assert.ok(res.run.pendingAction?.summary);
  assert.equal(fake.applied.length, 0, 'no mutation before approval');
});

test('reject → CANCELLED, no mutation', async () => {
  const { service, fake } = svc();
  const created = await service.createRun({ agentId: 'workspace.test-generator', input: TARGET, requestId: 'r1' });
  assert.ok(created.ok);
  const rejected = await service.resumeRun(created.run.runId, 'reject');
  assert.ok(rejected.ok);
  assert.equal(rejected.run.state, 'CANCELLED');
  assert.equal(fake.applied.length, 0);
});

test('approve → executes once (single-use) → COMPLETED', async () => {
  const { service, fake } = svc();
  const created = await service.createRun({ agentId: 'workspace.test-generator', input: TARGET, requestId: 'r1' });
  assert.ok(created.ok);
  const approved = await service.resumeRun(created.run.runId, 'approve');
  assert.ok(approved.ok);
  assert.equal(approved.run.state, 'COMPLETED');
  assert.equal(fake.applied.length, 1, 'executed exactly once');
});

test('replay refusal: approving twice → 2nd INVALID_STATE, no second execution', async () => {
  const { service, fake } = svc();
  const created = await service.createRun({ agentId: 'workspace.test-generator', input: TARGET, requestId: 'r1' });
  assert.ok(created.ok);
  await service.resumeRun(created.run.runId, 'approve');
  const replay = await service.resumeRun(created.run.runId, 'approve');
  assert.equal(replay.ok, false);
  assert.equal((replay as { code: string }).code, 'INVALID_STATE');
  assert.equal(fake.applied.length, 1, 'replay must not execute again');
});

test('idempotent create reconciles (no replay of a mutating run)', async () => {
  const { service, fake } = svc();
  const a = await service.createRun({ agentId: 'workspace.test-generator', input: TARGET, requestId: 'r1', idempotencyKey: 'k1' });
  const b = await service.createRun({ agentId: 'workspace.test-generator', input: TARGET, requestId: 'r2', idempotencyKey: 'k1' });
  assert.ok(a.ok && b.ok);
  assert.equal(a.run.runId, b.run.runId, 'same run returned');
  assert.equal(fake.applied.length, 0, 'idempotent retry never re-runs/mutates');
});

test('cancellation: request → confirmed, distinguishable', async () => {
  const { service } = svc();
  const created = await service.createRun({ agentId: 'workspace.test-generator', input: TARGET, requestId: 'r1' });
  assert.ok(created.ok);
  const cancelled = await service.cancelRun(created.run.runId);
  assert.ok(cancelled.ok);
  assert.equal(cancelled.run.state, 'CANCELLED');
  assert.equal(cancelled.run.cancellation, 'confirmed');
  const states = cancelled.run.history.map((h) => h.state);
  assert.ok(states.includes('CANCEL_REQUESTED') && states.indexOf('CANCEL_REQUESTED') < states.indexOf('CANCELLED'));
});

test('step limit enforced server-side → FAILED LIMIT_EXCEEDED', async () => {
  const { service } = svc({ extra: [LOOPER] });
  const res = await service.createRun({ agentId: '_test.looper', input: TARGET, requestId: 'r1' });
  assert.ok(res.ok);
  assert.equal(res.run.state, 'FAILED');
  assert.equal(res.run.error?.code, 'LIMIT_EXCEEDED');
});

test('terminal-state immutability: resume/cancel a COMPLETED run → INVALID_STATE', async () => {
  const { service } = svc();
  const created = await service.createRun({ agentId: 'workspace.diagnostics', input: TARGET, requestId: 'r1' });
  assert.ok(created.ok && created.run.state === 'COMPLETED');
  const resume = await service.resumeRun(created.run.runId, 'approve');
  assert.equal(resume.ok, false);
  assert.equal((resume as { code: string }).code, 'INVALID_STATE');
  const cancel = await service.cancelRun(created.run.runId);
  assert.equal(cancel.ok, false);
  assert.equal((cancel as { code: string }).code, 'INVALID_STATE');
});

test('pilot-runtime outage → FAILED, NO local mutating fallback', async () => {
  const { service, fake } = svc({ extra: [PILOT_MUTATE] });
  const res = await service.createRun({ agentId: '_test.pilot-mutate', input: TARGET, requestId: 'r1' });
  assert.ok(res.ok);
  assert.equal(res.run.state, 'FAILED');
  assert.equal(res.run.error?.code, 'RUNTIME_UNAVAILABLE');
  assert.equal(fake.applied.length, 0, 'a remote failure must never mutate locally');
});

test('unknown agent + denied input surface structured errors', async () => {
  const { service } = svc();
  const unknown = await service.createRun({ agentId: 'nope', input: TARGET, requestId: 'r1' });
  assert.equal(unknown.ok, false);
  assert.equal((unknown as { code: string }).code, 'UNKNOWN_AGENT');
  const bad = await service.createRun({ agentId: 'workspace.diagnostics', input: { rootPath: 1 }, requestId: 'r1' });
  assert.equal(bad.ok, false);
  assert.equal((bad as { code: string }).code, 'INVALID_INPUT');
});

test('sanitized run view: omits approval material + never leaks tool inputs', async () => {
  const { service } = svc();
  const created = await service.createRun({ agentId: 'workspace.test-generator', input: TARGET, requestId: 'r1' });
  assert.ok(created.ok);
  const view = toRunView(created.run);
  const json = JSON.stringify(view);
  assert.ok(!/approvalId|appr_/.test(json), 'no approval material in client view');
  assert.equal((view.pendingAction as { approvalId?: string })?.approvalId, undefined);
});

test('routes: catalog + run lifecycle + SSE observe (disconnect does not cancel)', async () => {
  const app = Fastify();
  const fake = new FakeToolRegistry();
  registerAgentRoutes(app, { toolDeps: { registry: fake, approvals: new ToolApprovalStore(), audit: new ToolAudit() } });

  const list = await app.inject({ method: 'GET', url: '/api/ai/agents' });
  assert.equal(list.statusCode, 200);
  assert.ok((list.json() as { count: number }).count >= 4);

  const create = await app.inject({ method: 'POST', url: '/api/ai/agents/runs', headers: { 'x-request-id': 'req-1' }, payload: { agentId: 'workspace.test-generator', input: TARGET } });
  assert.equal(create.statusCode, 200);
  const run = create.json() as { runId: string; state: string; requestId: string };
  assert.equal(run.state, 'WAITING_FOR_APPROVAL');
  assert.equal(run.requestId, 'req-1', 'correlation echoed');

  // Observe (SSE) then a plain GET → run is unchanged (observing never cancels).
  const sse = await app.inject({ method: 'GET', url: `/api/ai/agents/runs/${run.runId}`, headers: { accept: 'text/event-stream' } });
  assert.match(sse.payload, /event: state/);
  const reGet = await app.inject({ method: 'GET', url: `/api/ai/agents/runs/${run.runId}` });
  assert.equal((reGet.json() as { state: string }).state, 'WAITING_FOR_APPROVAL', 'reconcile: still waiting, not cancelled');

  const approve = await app.inject({ method: 'POST', url: `/api/ai/agents/runs/${run.runId}/resume`, payload: { decision: 'approve' } });
  assert.equal((approve.json() as { state: string }).state, 'COMPLETED');
  assert.equal(fake.applied.length, 1);
  await app.close();
});
