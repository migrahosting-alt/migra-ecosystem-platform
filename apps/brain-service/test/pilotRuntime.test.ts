import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { CapabilityRegistry } from '../src/engine/capabilityRegistry.js';
import { ToolApprovalStore } from '../src/engine/toolApprovalStore.js';
import { ToolAudit } from '../src/engine/toolAudit.js';
import { AgentRegistry, type AgentDefinition, type AgentDescriptor } from '../src/engine/agentRegistry.js';
import { AgentRunStore } from '../src/engine/agentRunStore.js';
import { AgentService, toRunView } from '../src/engine/agentRuntime.js';
import type { PilotRuntimeClient, PilotRunOutcome } from '../src/engine/pilot/pilotRuntimeClient.js';

// A tool registry whose edit.apply records mutations — a delegated (pilot) run
// must NEVER touch it, so `applied` staying empty proves no local execution.
class FakeToolRegistry extends CapabilityRegistry {
  applied: unknown[] = [];
  override runnable(id: string) {
    const base = super.runnable(id);
    if (!base) return base;
    if (id === 'edit.apply') {
      return { ...base, handler: async (input: unknown) => { this.applied.push(input); return { ok: true }; }, preview: async () => ({}) };
    }
    return base;
  }
}

/** A scriptable fake pilot-api runtime. Records every call; outcomes/throws are
 * set per test. No network. */
class FakePilot implements PilotRuntimeClient {
  probeResult = true;
  startOutcome: PilotRunOutcome = { status: 'completed', pilotRunId: 'pr_1', result: { done: true } };
  decideOutcome: PilotRunOutcome = { status: 'completed', pilotRunId: 'pr_1', result: { done: true } };
  throwOn = new Set<string>();
  calls: string[] = [];
  async probe() { this.calls.push('probe'); if (this.throwOn.has('probe')) throw new Error('net'); return this.probeResult; }
  async startRun() { this.calls.push('startRun'); if (this.throwOn.has('start')) throw new Error('drop'); return this.startOutcome; }
  async decide(req: { decision: string }) { this.calls.push(`decide:${req.decision}`); if (this.throwOn.has('decide')) throw new Error('drop'); return this.decideOutcome; }
  async cancel(req: { pilotRunId: string }) { this.calls.push('cancel'); if (this.throwOn.has('cancel')) throw new Error('drop'); return { status: 'cancelled' as const, pilotRunId: req.pilotRunId }; }
  async reconcile(req: { pilotRunId: string }) { this.calls.push('reconcile'); return { status: 'completed' as const, pilotRunId: req.pilotRunId }; }
}

function descriptor(over: Partial<AgentDescriptor> & Pick<AgentDescriptor, 'id'>): AgentDescriptor {
  return {
    kind: 'agent', version: '1', displayName: over.id, purpose: 'test', operationClasses: ['propose-edit'],
    requiredModelCapabilities: [], requiredToolCapabilities: [], readOnly: false, approvalRequired: true,
    resumable: true, cancellable: true, maxSteps: 8, maxRuntimeMs: 60_000, available: true, ...over,
  };
}

// A pilot-delegated agent. Its `plan` is intentionally a no-op: the pilot adapter
// delegates to pilot-api and never runs the local plan.
const PILOT_AGENT: AgentDefinition = {
  descriptor: descriptor({ id: '_test.pilot' }),
  runtime: 'pilot',
  inputSchema: z.object({ task: z.string() }),
  async plan() { return { kind: 'result', result: {} }; },
};

function svc(client?: PilotRuntimeClient) {
  const fake = new FakeToolRegistry();
  const store = new AgentRunStore();
  const service = new AgentService(
    new AgentRegistry([PILOT_AGENT]),
    store,
    { registry: fake, approvals: new ToolApprovalStore(), audit: new ToolAudit() },
    { pilotClient: client },
  );
  return { service, store, fake };
}
const REQ = { agentId: '_test.pilot', input: { task: 'do it' }, requestId: 'req_1' };
// Run-oriented: no approvalId on the seam (pilot-api holds it).
const WAITING: PilotRunOutcome = { status: 'waiting', pilotRunId: 'pr_1', action: { actionId: 'pact_1', tool: 'edit.apply', summary: 'edit f.ts' } };

test('delegated start → COMPLETED, result surfaced, NO local tool execution', async () => {
  const client = new FakePilot();
  const { service, fake } = svc(client);
  const { run } = await service.createRun(REQ) as { run: import('../src/engine/agentRunStore.js').RunRecord };
  assert.equal(run.state, 'COMPLETED');
  assert.deepEqual(run.result, { done: true });
  assert.deepEqual(client.calls, ['probe', 'startRun']);
  assert.equal(fake.applied.length, 0, 'the engine never executed a tool locally (fully delegated)');
});

test('start → WAITING → approve → COMPLETED; approval material never leaves the engine; single-use', async () => {
  const client = new FakePilot();
  client.startOutcome = WAITING;
  client.decideOutcome = { status: 'completed', pilotRunId: 'pr_1', result: { applied: true } };
  const { service, store, fake } = svc(client);
  const { run } = await service.createRun(REQ) as { run: { runId: string; state: string } };
  assert.equal(run.state, 'WAITING_FOR_APPROVAL');

  // The sanitized view exposes the action but NOT the approvalId.
  const view = toRunView(store.get(run.runId)!);
  assert.equal(view.pendingAction?.actionId, 'pact_1');
  assert.ok(!JSON.stringify(view).includes('appr_secret'), 'approvalId is held server-side, never in the client view');

  const resumed = await service.resumeRun(run.runId, 'approve');
  assert.equal(resumed.ok, true);
  assert.equal((resumed as { run: { state: string } }).run.state, 'COMPLETED');
  assert.deepEqual(client.calls, ['probe', 'startRun', 'decide:approve']);
  assert.equal(fake.applied.length, 0, 'execution happened remotely, not on the local boundary');

  // Replay refusal: a second approve on a terminal run is INVALID_STATE (409).
  const replay = await service.resumeRun(run.runId, 'approve');
  assert.equal(replay.ok, false);
  assert.equal((replay as { code: string }).code, 'INVALID_STATE');
});

test('reject → CANCELLED; pilot informed; no execution', async () => {
  const client = new FakePilot();
  client.startOutcome = WAITING;
  const { service, store, fake } = svc(client);
  const { run } = await service.createRun(REQ) as { run: { runId: string } };
  const rejected = await service.resumeRun(run.runId, 'reject');
  assert.equal(rejected.ok, true);
  assert.equal(store.get(run.runId)!.state, 'CANCELLED');
  assert.ok(client.calls.includes('decide:reject'), 'pilot-api was told to reject');
  assert.equal(fake.applied.length, 0);
});

test('cancel a parked run → CANCEL_REQUESTED → CANCELLED, pilot informed', async () => {
  const client = new FakePilot();
  client.startOutcome = WAITING;
  const { service, store } = svc(client);
  const { run } = await service.createRun(REQ) as { run: { runId: string } };
  const cancelled = await service.cancelRun(run.runId);
  assert.equal(cancelled.ok, true);
  const rec = store.get(run.runId)!;
  assert.equal(rec.state, 'CANCELLED');
  assert.equal(rec.cancellation, 'confirmed');
  assert.ok(client.calls.includes('cancel'));
  // history proves the ordered path CANCEL_REQUESTED → CANCELLED.
  const states = rec.history.map((h) => h.state);
  assert.ok(states.indexOf('CANCEL_REQUESTED') < states.indexOf('CANCELLED'));
});

test('dropped delegated call (network) → FAILED, never a false completion or local fallback', async () => {
  const client = new FakePilot();
  client.throwOn.add('start');
  const { service, store, fake } = svc(client);
  const { run } = await service.createRun(REQ) as { run: { runId: string } };
  const rec = store.get(run.runId)!;
  assert.equal(rec.state, 'FAILED');
  assert.equal(rec.error?.code, 'RUNTIME_UNAVAILABLE');
  assert.notEqual(rec.state, 'COMPLETED', 'a dropped connection is never reported as done');
  assert.equal(fake.applied.length, 0);
});

test('probe false → FAILED closed; delegation is never attempted', async () => {
  const client = new FakePilot();
  client.probeResult = false;
  const { service, store, fake } = svc(client);
  const { run } = await service.createRun(REQ) as { run: { runId: string } };
  const rec = store.get(run.runId)!;
  assert.equal(rec.state, 'FAILED');
  assert.equal(rec.error?.code, 'RUNTIME_UNAVAILABLE');
  assert.deepEqual(client.calls, ['probe'], 'startRun is never called when the runtime is down');
  assert.equal(fake.applied.length, 0);
});

test('NO client injected (delegation disabled) → FAILED closed, no local mutation (the pinned invariant)', async () => {
  const { service, store, fake } = svc(undefined);
  const { run } = await service.createRun(REQ) as { run: { runId: string } };
  const rec = store.get(run.runId)!;
  assert.equal(rec.state, 'FAILED');
  assert.equal(rec.error?.code, 'RUNTIME_UNAVAILABLE');
  assert.equal(fake.applied.length, 0);
});
