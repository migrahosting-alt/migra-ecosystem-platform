import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Fastify from 'fastify';
import { AgentModeCommandProposalRequestSchema } from '@migrapilot/protocol';
import { AgentActivationAuthority } from '../src/engine/agentActivation.js';
import { auditStore } from '../src/engine/auditLog.js';
import { AgentModeCommandService, type AgentModeRequestContext } from '../src/engine/agentModeCommandService.js';
import { registerAgentModeCommandRoutes } from '../src/engine/agentModeCommandRoutes.js';
import { AgentRunJournal, MemoryAgentRunJournalPersistence } from '../src/engine/agentRunJournal.js';
import { AGENT_RECIPE_OUTPUT_CAP_BYTES, AGENT_RECIPE_POLICY_VERSION, AgentRecipePolicyError, AgentRecipeResolver, containmentIdentityForPlan, sanitizeAgentRecipeOutput, SystemdContainmentController, type AgentContainmentIdentity, type AgentContainmentReconcileOutcome, type AgentRecipeExecutionOutcome, type AgentRecipePlan, type AgentRecipeProcessManagerLike, type AgentRecipeResolverLike, type SystemdControlAdapter } from '../src/engine/agentRecipe.js';
import { CapabilityRegistry } from '../src/engine/capabilityRegistry.js';
import { SqliteDurableStore } from '../src/engine/persistence/sqliteStore.js';
import { ToolApprovalStore, hashInput } from '../src/engine/toolApprovalStore.js';
import { ToolAudit } from '../src/engine/toolAudit.js';
import { registerMigraPilotCors } from '../src/http/corsPolicy.js';

const SECRET = 'bootstrap-secret-'.padEnd(48, 'x');
const ACTIVATION = '11111111-1111-4111-8111-111111111111';

function root(): string { return mkdtempSync(path.join(tmpdir(), 'migrapilot-agent-mode-')); }
function context(workspace: string, activationId = ACTIVATION): AgentModeRequestContext {
  return { activationId, extensionProcessId: process.pid, serverInstanceId: 'brain-instance-123456789', workspaceRoot: workspace, workspaceIdentity: 'workspace-id', allowedRecipes: ['git.status', 'git.diff'], externalRequestId: 'external' };
}

function plan(workspace: string, runId = 'agentcmd_1'): AgentRecipePlan {
  const identity: AgentRecipePlan['identity'] = {
    recipe: 'git.status' as const,
    policyVersion: AGENT_RECIPE_POLICY_VERSION,
    runId,
    activationId: ACTIVATION,
    sourceWorkspace: workspace,
    sourceWorkspaceIdentity: 'workspace-id',
    snapshotId: 'snapshot-id',
    snapshotRoot: workspace,
    canonicalCwd: workspace,
    executablePath: process.execPath,
    executableDigest: 'digest',
    executableIdentity: 'exec-id',
    arguments: ['--version'],
    environmentPolicy: 'minimal-git-v2' as const,
    environmentIdentity: hashInput({ PATH: '/safe' }),
    workspaceMaterialIdentity: 'material-id',
    containmentPolicy: 'systemd-user-service-v2' as const,
    timeoutMs: 5_000,
    outputLimitBytes: AGENT_RECIPE_OUTPUT_CAP_BYTES,
    shell: false as const,
    mutationClassification: 'read-only' as const,
    canModifyFiles: false as const,
    networkPolicy: 'not-required' as const,
    expectedEffects: ['test'],
  };
  return { identity, environment: { PATH: '/safe' }, privateRunRoot: workspace };
}

class FakeResolver implements AgentRecipeResolverLike {
  valid = true;
  releases = 0;
  envSecret?: string;
  async prepare(_recipe: 'git.status' | 'git.diff', workspace: string, input: { runId: string }): Promise<AgentRecipePlan> {
    const prepared = plan(workspace, input.runId);
    if (this.envSecret) prepared.environment.MIGRAPILOT_SENTINEL_SECRET = this.envSecret;
    return prepared;
  }
  async verify(): Promise<boolean> { return this.valid; }
  async release(): Promise<void> { this.releases += 1; }
  binding(value: AgentRecipePlan): string { return hashInput(value.identity); }
}

class FakeProcesses implements AgentRecipeProcessManagerLike {
  starts = 0;
  delayMs = 5;
  available = true;
  active = 0;
  shutdownRequested = false;
  failureCode?: 'TERMINATION_FAILED' | 'START_FAILED';
  forcedDisposition?: AgentRecipeExecutionOutcome['disposition'];
  stdout = '';
  stderr = '';
  wake?: () => void;
  async availability() { return this.available ? ({ ok: true, policy: 'fake' } as const) : ({ ok: false, code: 'CONTAINMENT_UNAVAILABLE', message: 'no cgroup' } as const); }
  activeCount(): number { return this.active; }
  reconcileOutcome?: AgentContainmentReconcileOutcome;
  reconcileCalls = 0;
  async execute(runId: string, value: AgentRecipePlan, hooks: { onSpawned(identity: AgentContainmentIdentity): void }, signal?: AbortSignal): Promise<AgentRecipeExecutionOutcome> {
    if (this.failureCode === 'START_FAILED') throw new AgentRecipePolicyError('START_FAILED', 'injected start failure');
    this.starts += 1;
    this.active += 1;
    hooks.onSpawned(containmentIdentityForPlan(runId, value));
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.delayMs);
      this.wake = () => { clearTimeout(timer); resolve(); };
      signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    this.active -= 1;
    if (this.failureCode) throw new AgentRecipePolicyError(this.failureCode, 'injected containment failure');
    const disposition = this.shutdownRequested ? 'shutdown' : signal?.aborted ? 'cancelled' : this.forcedDisposition ?? 'completed';
    return { disposition, result: { recipe: value.identity.recipe, exitCode: disposition === 'completed' ? 0 : null, timedOut: disposition === 'timed_out', stdout: this.stdout, stderr: this.stderr, truncated: false, redacted: false, durationMs: this.delayMs } };
  }
  async reconcileRun(): Promise<AgentContainmentReconcileOutcome> {
    this.reconcileCalls += 1;
    return this.reconcileOutcome ?? { code: 'RESTART_NO_CONTAINMENT_FOUND', terminated: false, cgroupEmpty: true };
  }
  async shutdown(): Promise<void> { this.shutdownRequested = true; this.wake?.(); }
}

function harness(now: () => number = () => Date.now()) {
  let sequence = 0;
  const approvals = new ToolApprovalStore(now, () => `appr_private_${++sequence}`, 100);
  const deps = { registry: new CapabilityRegistry(), approvals, audit: new ToolAudit() };
  const resolver = new FakeResolver();
  const processes = new FakeProcesses();
  const service = new AgentModeCommandService(deps, now, () => `agentcmd_${++sequence}`, resolver, processes);
  return { service, deps, resolver, processes };
}

async function terminal(service: AgentModeCommandService, runId: string, ctx: AgentModeRequestContext) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const found = service.get(runId, ctx, false);
    if (found.ok && ['COMPLETED', 'FAILED', 'CANCELLED', 'STALE'].includes(found.view.state)) return found.view;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('run did not become terminal');
}

test('bootstrap is server-issued, one-time, expiring, workspace-bound, and token-free in audit', async () => {
  const workspace = root();
  const authority = new AgentActivationAuthority(SECRET, () => 1_000, () => 'agentcap_server_issued_value_123456789', process.pid);
  const request = { activationId: ACTIVATION, extensionProcessId: process.pid, bootstrapMode: 'inherited' as const, workspaceRoot: workspace };
  await assert.rejects(() => authority.bootstrap({ ...request, bootstrapSecret: 'attacker-value'.padEnd(40, 'x') }));
  await assert.rejects(() => authority.bootstrap({ ...request, bootstrapSecret: SECRET, extensionProcessId: process.pid + 1 }));
  const issued = await authority.bootstrap({ ...request, bootstrapSecret: SECRET });
  assert.match(issued.activationCapability, /^agentcap_/);
  await assert.rejects(() => authority.bootstrap({ ...request, bootstrapSecret: SECRET }));
  assert.equal((await authority.authorize(issued.activationCapability, workspace)).activationId, ACTIVATION);
  await assert.rejects(() => authority.authorize('invented-capability-value-that-is-long-enough', workspace));
  const activationAudit = JSON.stringify(auditStore.byCorrelation(issued.serverInstanceId));
  assert.doesNotMatch(activationAudit, new RegExp(SECRET));
  assert.doesNotMatch(activationAudit, /agentcap_server_issued/);
  authority.shutdown();
});

test('activation expiry is enforced and disabled npm recipes fail protocol validation', async () => {
  let now = 1_000;
  const workspace = root();
  const authority = new AgentActivationAuthority(SECRET, () => now, () => 'agentcap_expiring_server_value_123456789', process.pid);
  const issued = await authority.bootstrap({ bootstrapSecret: SECRET, activationId: ACTIVATION, extensionProcessId: process.pid, bootstrapMode: 'inherited', workspaceRoot: workspace });
  now = issued.expiresAt + 1;
  await assert.rejects(() => authority.authorize(issued.activationCapability, workspace));
  assert.equal(AgentModeCommandProposalRequestSchema.safeParse({ rootPath: workspace, recipe: 'workspace.test', reason: 'attack' }).success, false);
  authority.shutdown();
});

test('fixed snapshot proposal is token-free and concurrent approval starts exactly once', async () => {
  const workspace = root();
  const { service, processes, deps } = harness();
  const ctx = context(workspace);
  const proposal = await service.propose({ rootPath: workspace, recipe: 'git.status', reason: 'inspect' }, ctx);
  assert.ok(proposal.ok);
  assert.equal(proposal.view.preview?.snapshotId, 'snapshot-id');
  assert.doesNotMatch(JSON.stringify(proposal), /appr_private/);
  assert.ok(service.displayed(proposal.view.runId, proposal.view.preview!.fingerprint, ctx).ok);
  await Promise.all([
    service.decide(proposal.view.runId, 'approve', proposal.view.preview!.fingerprint, ctx),
    service.decide(proposal.view.runId, 'approve', proposal.view.preview!.fingerprint, ctx),
  ]);
  assert.equal((await terminal(service, proposal.view.runId, ctx)).state, 'COMPLETED');
  assert.equal(processes.starts, 1);
  assert.doesNotMatch(JSON.stringify(deps.audit.recent()), /appr_private/);
  const requestId = proposal.view.requestId;
  const beforeGet = auditStore.byCorrelation(requestId).map((event) => event.type);
  service.get(proposal.view.runId, ctx);
  assert.deepEqual(auditStore.byCorrelation(requestId).map((event) => event.type), beforeGet, 'GET must not append lifecycle events');
  assert.deepEqual(beforeGet, ['proposal.created', 'approval.displayed', 'approval.approved', 'approval.consumed', 'execution.spawned', 'execution.completed']);
  await service.shutdown();
});

test('snapshot drift before approval and before spawn fails with zero starts', async () => {
  const workspace = root();
  const { service, resolver, processes } = harness();
  const ctx = context(workspace);
  const proposal = await service.propose({ rootPath: workspace, recipe: 'git.diff', reason: 'inspect' }, ctx);
  assert.ok(proposal.ok);
  assert.ok(service.displayed(proposal.view.runId, proposal.view.preview!.fingerprint, ctx).ok);
  resolver.valid = false;
  const stale = await service.decide(proposal.view.runId, 'approve', proposal.view.preview!.fingerprint, ctx);
  assert.equal(stale.ok, false);
  assert.equal(processes.starts, 0);
  await service.shutdown();
});

test('approval fails closed until the authoritative preview is acknowledged as displayed', async () => {
  const workspace = root();
  const { service, processes } = harness();
  const ctx = context(workspace);
  const proposal = await service.propose({ rootPath: workspace, recipe: 'git.status', reason: 'inspect' }, ctx);
  assert.ok(proposal.ok);
  const denied = await service.decide(proposal.view.runId, 'approve', proposal.view.preview!.fingerprint, ctx);
  assert.equal(denied.ok, false);
  assert.equal(processes.starts, 0);
  assert.ok(service.displayed(proposal.view.runId, proposal.view.preview!.fingerprint, ctx).ok);
  assert.ok((await service.decide(proposal.view.runId, 'approve', proposal.view.preview!.fingerprint, ctx)).ok);
  assert.equal((await terminal(service, proposal.view.runId, ctx)).state, 'COMPLETED');
  await service.shutdown();
});

test('terminal states are immutable and cross-activation access is indistinguishable', async () => {
  const workspace = root();
  const { service } = harness();
  const ctx = context(workspace);
  const proposal = await service.propose({ rootPath: workspace, recipe: 'git.status', reason: 'inspect' }, ctx);
  assert.ok(proposal.ok);
  assert.ok((await service.decide(proposal.view.runId, 'reject', proposal.view.preview!.fingerprint, ctx)).ok);
  assert.equal((await service.decide(proposal.view.runId, 'approve', 'wrong', ctx)).ok, false);
  const foreign = context(workspace, '22222222-2222-4222-8222-222222222222');
  const missing = service.get('does-not-exist', foreign);
  assert.deepEqual(service.get(proposal.view.runId, foreign), missing);
  assert.equal((service.get(proposal.view.runId, ctx) as { ok: true; view: { state: string } }).view.state, 'REJECTED');
  await service.shutdown();
});

test('expired pending runs are swept before capacity without reconcile', async () => {
  let now = 1_000;
  const { service } = harness(() => now);
  const workspace = root();
  const ctx = context(workspace);
  for (let index = 0; index < 10; index += 1) assert.ok((await service.propose({ rootPath: workspace, recipe: 'git.status', reason: `pending ${index}` }, ctx)).ok);
  assert.equal((await service.propose({ rootPath: workspace, recipe: 'git.status', reason: 'overloaded' }, ctx)).ok, false);
  now += 101;
  assert.ok((await service.propose({ rootPath: workspace, recipe: 'git.status', reason: 'after expiry' }, ctx)).ok);
  await service.shutdown();
});

test('containment unavailable fails before snapshot creation or approval mint', async () => {
  const workspace = root();
  const { service, processes, resolver } = harness();
  processes.available = false;
  const outcome = await service.propose({ rootPath: workspace, recipe: 'git.status', reason: 'inspect' }, context(workspace));
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.code, 'CONTAINMENT_UNAVAILABLE');
  assert.equal(resolver.releases, 0);
  await service.shutdown();
});

test('HTTP bootstrap rejects Origin and invented capability; valid bootstrap works exactly once', async () => {
  const workspace = root();
  const authority = new AgentActivationAuthority(SECRET, () => Date.now(), () => 'agentcap_route_server_value_123456789', process.pid);
  const { service, deps } = harness();
  const app = Fastify();
  registerAgentModeCommandRoutes(app, deps, authority, service);
  const payload = { bootstrapSecret: SECRET, activationId: ACTIVATION, extensionProcessId: process.pid, bootstrapMode: 'inherited', workspaceRoot: workspace };
  assert.equal((await app.inject({ method: 'POST', url: '/api/ai/agent-mode/bootstrap', headers: { origin: 'https://pilot.migrateck.com' }, payload })).statusCode, 403);
  const boot = await app.inject({ method: 'POST', url: '/api/ai/agent-mode/bootstrap', payload });
  assert.equal(boot.statusCode, 200);
  const capability = (boot.json() as { activationCapability: string }).activationCapability;
  assert.equal((await app.inject({ method: 'POST', url: '/api/ai/agent-mode/bootstrap', payload })).statusCode, 400);
  const body = { rootPath: workspace, recipe: 'git.status', reason: 'inspect' };
  const attacker = await app.inject({ method: 'POST', url: '/api/ai/agent-mode/commands', headers: { 'x-migrapilot-agent-capability': 'invented-capability-value-that-is-long-enough', 'x-migrapilot-workspace-root': workspace }, payload: body });
  assert.equal(attacker.statusCode, 403);
  const browser = await app.inject({ method: 'POST', url: '/api/ai/agent-mode/commands', headers: { origin: 'https://pilot.migrateck.com', 'x-migrapilot-agent-capability': capability, 'x-migrapilot-workspace-root': workspace }, payload: body });
  assert.equal(browser.statusCode, 403);
  const valid = await app.inject({ method: 'POST', url: '/api/ai/agent-mode/commands', headers: { 'x-migrapilot-agent-capability': capability, 'x-migrapilot-workspace-root': workspace }, payload: body });
  assert.equal(valid.statusCode, 200);
  assert.doesNotMatch(valid.body, /agentcap_|bootstrap-secret|appr_/);
  await app.close();
  authority.shutdown();
});

test('HTTP Agent routes reject every Origin-bearing request at the boundary without consuming bootstrap or starting processes', async () => {
  const workspace = root();
  const authority = new AgentActivationAuthority(SECRET, () => Date.now(), () => 'agentcap_boundary_server_value_123456789', process.pid);
  const { service, deps, processes } = harness();
  const app = Fastify({ logger: false });
  await registerMigraPilotCors(app);
  registerAgentModeCommandRoutes(app, deps, authority, service);

  const payload = { bootstrapSecret: SECRET, activationId: ACTIVATION, extensionProcessId: process.pid, bootstrapMode: 'inherited' as const, workspaceRoot: workspace };
  const hostileHeaders = { origin: 'https://evil.example.invalid' };
  const hostileBoot = await app.inject({ method: 'POST', url: '/api/ai/agent-mode/bootstrap', headers: hostileHeaders, payload });
  assert.equal(hostileBoot.statusCode, 403);
  assert.deepEqual(hostileBoot.json(), { ok: false, code: 'INVALID_CONTEXT', error: 'Agent authorization was refused.' });
  assert.doesNotMatch(hostileBoot.body, /stack|CORS blocked|bootstrap-secret|agentcap_|appr_private/);

  const boot = await app.inject({ method: 'POST', url: '/api/ai/agent-mode/bootstrap', payload });
  assert.equal(boot.statusCode, 200, 'rejected hostile Origin must not consume the one-time bootstrap secret');
  const capability = (boot.json() as { activationCapability: string }).activationCapability;
  const authHeaders = { 'x-migrapilot-agent-capability': capability, 'x-migrapilot-workspace-root': workspace };
  const body = { rootPath: workspace, recipe: 'git.status', reason: 'inspect' };

  const hostilePropose = await app.inject({ method: 'POST', url: '/api/ai/agent-mode/commands', headers: { ...authHeaders, ...hostileHeaders }, payload: body });
  assert.equal(hostilePropose.statusCode, 403);
  assert.equal(processes.starts, 0);

  const validProposal = await app.inject({ method: 'POST', url: '/api/ai/agent-mode/commands', headers: authHeaders, payload: body });
  assert.equal(validProposal.statusCode, 200);
  const run = validProposal.json() as { runId: string; preview: { fingerprint: string } };

  const hostileReconcile = await app.inject({ method: 'GET', url: `/api/ai/agent-mode/commands/${run.runId}`, headers: { ...authHeaders, ...hostileHeaders } });
  assert.equal(hostileReconcile.statusCode, 403);
  const hostileApprove = await app.inject({ method: 'POST', url: `/api/ai/agent-mode/commands/${run.runId}/decision`, headers: { ...authHeaders, ...hostileHeaders }, payload: { decision: 'approve', fingerprint: run.preview.fingerprint } });
  assert.equal(hostileApprove.statusCode, 403);
  const hostileReject = await app.inject({ method: 'POST', url: `/api/ai/agent-mode/commands/${run.runId}/decision`, headers: { ...authHeaders, ...hostileHeaders }, payload: { decision: 'reject', fingerprint: run.preview.fingerprint } });
  assert.equal(hostileReject.statusCode, 403);
  const hostileCancel = await app.inject({ method: 'POST', url: `/api/ai/agent-mode/commands/${run.runId}/cancel`, headers: { ...authHeaders, ...hostileHeaders }, payload: {} });
  assert.equal(hostileCancel.statusCode, 403);
  const hostileRecovery = await app.inject({ method: 'GET', url: `/api/ai/agent-mode/commands/${run.runId}/recovery`, headers: { ...authHeaders, ...hostileHeaders } });
  assert.equal(hostileRecovery.statusCode, 403);
  const hostileReproposal = await app.inject({ method: 'POST', url: `/api/ai/agent-mode/commands/${run.runId}/repropose`, headers: { ...authHeaders, ...hostileHeaders }, payload: { requestId: 'stage3b-hostile-recovery' } });
  assert.equal(hostileReproposal.statusCode, 403);
  assert.equal(processes.starts, 0);
  assert.equal((service.get(run.runId, context(workspace)) as { ok: true; view: { state: string } }).view.state, 'AWAITING_APPROVAL');

  await app.close();
  authority.shutdown();
  await service.shutdown();
});

test('HTTP Agent history is authorized, paginated, sanitized evidence and never execution authority', async () => {
  const workspace = root();
  const persistence = new MemoryAgentRunJournalPersistence();
  const journal = new AgentRunJournal(persistence);
  const authority = new AgentActivationAuthority(SECRET, () => Date.now(), () => 'agentcap_history_server_value_123456789', process.pid);
  const { deps, resolver, processes } = harness();
  resolver.envSecret = 'ghp_SHOULD_NOT_APPEAR_IN_HISTORY_123456789012';
  processes.stdout = 'stdout with sk-' + 'A'.repeat(48);
  processes.stderr = 'stderr with -----BEGIN PRIVATE KEY----- secret -----END PRIVATE KEY-----';
  const service = new AgentModeCommandService(deps, undefined, undefined, resolver, processes, journal);
  const app = Fastify({ logger: false });
  registerAgentModeCommandRoutes(app, deps, authority, service);

  const payload = { bootstrapSecret: SECRET, activationId: ACTIVATION, extensionProcessId: process.pid, bootstrapMode: 'inherited' as const, workspaceRoot: workspace };
  const boot = await app.inject({ method: 'POST', url: '/api/ai/agent-mode/bootstrap', payload });
  assert.equal(boot.statusCode, 200);
  const capability = (boot.json() as { activationCapability: string }).activationCapability;
  const headers = { 'x-migrapilot-agent-capability': capability, 'x-migrapilot-workspace-root': workspace };
  const proposed = await app.inject({ method: 'POST', url: '/api/ai/agent-mode/commands', headers, payload: { rootPath: workspace, recipe: 'git.status', reason: 'history' } });
  assert.equal(proposed.statusCode, 200);
  const run = proposed.json() as { runId: string; preview: { fingerprint: string } };
  await app.inject({ method: 'POST', url: `/api/ai/agent-mode/commands/${run.runId}/displayed`, headers, payload: { fingerprint: run.preview.fingerprint } });
  await app.inject({ method: 'POST', url: `/api/ai/agent-mode/commands/${run.runId}/decision`, headers, payload: { decision: 'approve', fingerprint: run.preview.fingerprint } });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = await app.inject({ method: 'GET', url: `/api/ai/agent-mode/commands/${run.runId}`, headers });
    if ((current.json() as { state?: string }).state === 'COMPLETED') break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal((await app.inject({ method: 'GET', url: `/api/ai/agent-mode/commands/${run.runId}`, headers })).json().state, 'COMPLETED');

  const hostile = await app.inject({ method: 'GET', url: '/api/ai/agent-mode/history/runs', headers: { ...headers, origin: 'https://evil.example.invalid' } });
  assert.equal(hostile.statusCode, 403);
  assert.equal(processes.starts, 1);

  const list = await app.inject({ method: 'GET', url: '/api/ai/agent-mode/history/runs?limit=1', headers });
  assert.equal(list.statusCode, 200, list.body);
  assert.equal((list.json() as { runs: unknown[]; retention: { governance: string } }).runs.length, 1);
  assert.equal((list.json() as { retention: { governance: string } }).retention.governance, 'READ_ONLY');
  assert.doesNotMatch(list.body, /agentcap_|appr_private|SHOULD_NOT_APPEAR|BEGIN PRIVATE KEY|sk-A/);

  const detail = await app.inject({ method: 'GET', url: `/api/ai/agent-mode/history/runs/${run.runId}`, headers });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.match(detail.body, /"timeline"/);
  assert.match(detail.body, /\[REDACTED OUTPUT\]/);
  assert.doesNotMatch(detail.body, new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(detail.body, /agentcap_|appr_private|SHOULD_NOT_APPEAR|BEGIN PRIVATE KEY|sk-A/);
  assert.doesNotMatch(detail.body, /resume|reuse approval|continue execution/i);

  const exported = await app.inject({ method: 'POST', url: `/api/ai/agent-mode/history/runs/${run.runId}/export`, headers, payload: { includeTimeline: true } });
  assert.equal(exported.statusCode, 200, exported.body);
  const manifest = exported.json() as { manifest: { digest: string; redaction: string }; body: { summary: { runId: string } } };
  assert.equal(manifest.body.summary.runId, run.runId);
  assert.match(manifest.manifest.digest, /^[a-f0-9]{64}$/);
  assert.equal(manifest.manifest.redaction, 'sanitized-history-only');
  assert.doesNotMatch(exported.body, new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(exported.body, /agentcap_|appr_private|SHOULD_NOT_APPEAR|BEGIN PRIVATE KEY|sk-A/);

  await app.close();
  authority.shutdown();
  await service.shutdown();
});

test('dynamic sentinel matrix redacts reusable authority across Agent HTTP, audit, durable recovery, and retention surfaces', async () => {
  let now = 10_000;
  let sequence = 0;
  const unique = `stage3b_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const sentinels = {
    bootstrap: `bootstrap-secret-${unique}`.padEnd(48, 'b'),
    capability: `agentcap_${unique}_server_authority_123456789`,
    approval: `appr_private_${unique}_single_use_123456789`,
    authorization: `Bearer ghp_${'A'.repeat(32)}_${unique}`,
    operator: `operator confirmation contains ghp_${'B'.repeat(32)} ${unique}`,
    env: `env_secret_${unique}`,
    stdout: `stdout has ghp_${'C'.repeat(32)} ${unique}`,
    stderr: `stderr has sk-${'D'.repeat(48)} ${unique}`,
    exception: `sqlite locked at /home/bonex/${unique} with token ghp_${'E'.repeat(32)}`,
    privateKey: `-----BEGIN PRIVATE KEY-----\n${'F'.repeat(64)}\n-----END PRIVATE KEY-----`,
  };
  const workspace = root();
  const dbPath = path.join(workspace, 'agent.sqlite');
  const persistence = new SqliteDurableStore(dbPath);
  const approvals = new ToolApprovalStore(() => now, () => sentinels.approval, 100);
  const deps = { registry: new CapabilityRegistry(), approvals, audit: new ToolAudit() };
  const resolver = new FakeResolver();
  resolver.envSecret = sentinels.env;
  const processes = new FakeProcesses();
  processes.stdout = `${sentinels.stdout}\n${sentinels.privateKey}`;
  processes.stderr = sentinels.stderr;
  const journal = new AgentRunJournal(persistence, { terminalRetentionMs: 1, retentionBatchSize: 10, reconciliationLeaseMs: 30_000 }, () => `sentinel_event_${++sequence}`);
  let service = new AgentModeCommandService(deps, () => now, () => `agentcmd_sentinel_${++sequence}`, resolver, processes, journal, `svc_sentinel_${++sequence}`);
  const authority = new AgentActivationAuthority(sentinels.bootstrap, () => now, () => sentinels.capability, process.pid);
  const app = Fastify({ logger: false });
  registerAgentModeCommandRoutes(app, deps, authority, service);
  await app.ready();

  const bootstrapPayload = { bootstrapSecret: sentinels.bootstrap, activationId: ACTIVATION, extensionProcessId: process.pid, bootstrapMode: 'inherited' as const, workspaceRoot: workspace };
  const boot = await app.inject({ method: 'POST', url: '/api/ai/agent-mode/bootstrap', payload: bootstrapPayload });
  assert.equal(boot.statusCode, 200);
  const capability = (boot.json() as { activationCapability: string }).activationCapability;
  const authHeaders = { authorization: sentinels.authorization, 'x-migrapilot-agent-capability': capability, 'x-migrapilot-workspace-root': workspace };
  const proposeBody = { rootPath: workspace, recipe: 'git.status', reason: `${sentinels.operator}\n${sentinels.privateKey}` };

  const rejectedProposal = await app.inject({ method: 'POST', url: '/api/ai/agent-mode/commands', headers: authHeaders, payload: proposeBody });
  assert.equal(rejectedProposal.statusCode, 200);
  const rejected = rejectedProposal.json() as { runId: string; preview: { fingerprint: string } };
  const displayed = await app.inject({ method: 'POST', url: `/api/ai/agent-mode/commands/${rejected.runId}/displayed`, headers: authHeaders, payload: { fingerprint: rejected.preview.fingerprint } });
  assert.equal(displayed.statusCode, 200, displayed.body);
  const reject = await app.inject({ method: 'POST', url: `/api/ai/agent-mode/commands/${rejected.runId}/decision`, headers: authHeaders, payload: { decision: 'reject', fingerprint: rejected.preview.fingerprint } });
  assert.equal(reject.statusCode, 200);

  const completedProposal = await app.inject({ method: 'POST', url: '/api/ai/agent-mode/commands', headers: authHeaders, payload: proposeBody });
  assert.equal(completedProposal.statusCode, 200);
  const completed = completedProposal.json() as { runId: string; preview: { fingerprint: string } };
  await app.inject({ method: 'POST', url: `/api/ai/agent-mode/commands/${completed.runId}/displayed`, headers: authHeaders, payload: { fingerprint: completed.preview.fingerprint } });
  const approved = await app.inject({ method: 'POST', url: `/api/ai/agent-mode/commands/${completed.runId}/decision`, headers: authHeaders, payload: { decision: 'approve', fingerprint: completed.preview.fingerprint } });
  assert.equal(approved.statusCode, 200);
  const completedView = await terminal(service, completed.runId, context(workspace));
  assert.equal(completedView.state, 'COMPLETED');

  const restartProposal = await app.inject({ method: 'POST', url: '/api/ai/agent-mode/commands', headers: authHeaders, payload: proposeBody });
  assert.equal(restartProposal.statusCode, 200);
  const restart = restartProposal.json() as { runId: string };
  await app.close();
  await service.shutdown();

  service = new AgentModeCommandService(deps, () => now, () => `agentcmd_sentinel_${++sequence}`, resolver, processes, journal, `svc_sentinel_${++sequence}`);
  const restartSummary = await service.reconcileOnStartup();
  assert.equal(restartSummary.outcomes.RESTART_AUTHORIZATION_LOST, 1);
  const recoveryContext = { ...context(workspace), workspaceIdentity: persistence.loadAgentRun(restart.runId)!.workspaceIdentity };
  const recoveryStatus = service.getRunRecoveryStatus(restart.runId, recoveryContext);
  assert.equal(recoveryStatus.ok, true);
  const successor = await service.reproposeFromRun(restart.runId, { requestId: 'stage3b-dynamic-sentinel' }, recoveryContext);
  assert.equal(successor.ok, true);
  const duplicate = await service.reproposeFromRun(restart.runId, { requestId: 'stage3b-dynamic-sentinel' }, recoveryContext);
  assert.equal(duplicate.ok, true);
  const policyDenied = await service.reproposeFromRun(restart.runId, { requestId: 'stage3b-dynamic-policy-denied' }, { ...recoveryContext, allowedRecipes: ['git.diff'] });
  assert.equal(policyDenied.ok, false);
  const forgedStatus = service.getRunRecoveryStatus('agentcmd_forged_unknown', recoveryContext);
  assert.equal(forgedStatus.ok, false);

  now += 10_000;
  journal.prune(now);
  await service.shutdown();
  authority.shutdown();
  persistence.close();

  const nonBootstrapResponses = [rejectedProposal.body, displayed.body, reject.body, completedProposal.body, approved.body, JSON.stringify(completedView), JSON.stringify(recoveryStatus), JSON.stringify(successor), JSON.stringify(duplicate), JSON.stringify(policyDenied), JSON.stringify(forgedStatus)].join('\n');
  const durableBytes = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].filter((file) => existsSync(file)).map((file) => readFileSync(file, 'utf8')).join('\n');
  const reopened = new SqliteDurableStore(dbPath);
  const reopenedRuns = reopened.loadAgentRuns();
  const durableRows = JSON.stringify({
    runs: reopenedRuns,
    events: reopenedRuns.flatMap((run) => reopened.loadAgentRunEvents(run.runId)),
    tombstones: reopened.loadAgentRunTombstones(),
    audit: auditStore.byCorrelation(completedView.requestId),
    toolAudit: deps.audit.recent(),
  });
  reopened.close();
  const scanned = `${nonBootstrapResponses}\n${durableBytes}\n${durableRows}`;
  for (const raw of Object.values(sentinels)) {
    assert.doesNotMatch(scanned, new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), raw);
  }
});

test('Agent output strips ANSI and redacts before cap truncation across chunk-equivalent boundaries', () => {
  const secret = 'ghp_' + 'A'.repeat(32);
  const ansiSplit = `ghp_${'A'.repeat(8)}\u001b[31m${'A'.repeat(24)}\u001b[0m`;
  const ansi = sanitizeAgentRecipeOutput(ansiSplit, 1024);
  assert.equal(ansi.redacted, true);
  assert.doesNotMatch(ansi.value, /ghp_/);
  const boundary = sanitizeAgentRecipeOutput(`${'x'.repeat(1017)} ${secret}\n`, 1024);
  assert.equal(boundary.truncated, true);
  assert.equal(boundary.redacted, true);
  assert.doesNotMatch(boundary.value, /ghp_|AAAAAAAAAAAAAAAA/);
});

test('systemd containment tracks detached descendants and escalates the whole cgroup', async () => {
  const calls: string[][] = [];
  const memberships = ['202\n', '']; // leader 101 exited; detached child 202 remains until KILL
  const adapter: SystemdControlAdapter = {
    async capture(_command, args) {
      calls.push(args);
      if (args.includes('show')) return { code: 0, stdout: 'LoadState=loaded\nActiveState=active\nControlGroup=/user.slice/migrapilot.service\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
    async readCgroup() { return memberships.shift() ?? ''; },
    async delay() {},
  };
  const controller = new SystemdContainmentController(adapter);
  assert.equal(await controller.terminateUnit('migrapilot.service'), true);
  assert.ok(calls.some((args) => args.includes('--signal=SIGTERM')));
  assert.ok(calls.some((args) => args.includes('--signal=SIGKILL')));
});

test('systemd containment never reports cancellation when descendants cannot be terminated', async () => {
  const adapter: SystemdControlAdapter = {
    async capture(_command, args) {
      if (args.includes('show')) return { code: 0, stdout: 'LoadState=loaded\nActiveState=active\nControlGroup=/user.slice/migrapilot.service\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    },
    async readCgroup() { return '202\n'; },
    async delay() {},
  };
  assert.equal(await new SystemdContainmentController(adapter).terminateUnit('migrapilot.service'), false);
});

test('shutdown and termination failure produce distinct exact audit endings', async () => {
  const workspace = root();
  const first = harness();
  first.processes.delayMs = 10_000;
  const ctx = context(workspace);
  const proposal = await first.service.propose({ rootPath: workspace, recipe: 'git.status', reason: 'shutdown' }, ctx);
  assert.ok(proposal.ok);
  first.service.displayed(proposal.view.runId, proposal.view.preview!.fingerprint, ctx);
  await first.service.decide(proposal.view.runId, 'approve', proposal.view.preview!.fingerprint, ctx);
  while (first.processes.starts === 0) await new Promise((resolve) => setTimeout(resolve, 1));
  await first.service.shutdown();
  const shutdownTypes = auditStore.byCorrelation(proposal.view.requestId).map((event) => event.type);
  assert.deepEqual(shutdownTypes.slice(-3), ['execution.spawned', 'shutdown.termination_requested', 'shutdown.terminated']);

  const second = harness();
  second.processes.failureCode = 'TERMINATION_FAILED';
  const failed = await second.service.propose({ rootPath: workspace, recipe: 'git.diff', reason: 'failure' }, ctx);
  assert.ok(failed.ok);
  second.service.displayed(failed.view.runId, failed.view.preview!.fingerprint, ctx);
  await second.service.decide(failed.view.runId, 'approve', failed.view.preview!.fingerprint, ctx);
  assert.equal((await terminal(second.service, failed.view.runId, ctx)).state, 'FAILED');
  assert.equal(auditStore.byCorrelation(failed.view.requestId).at(-1)?.type, 'execution.termination_failed');
  await second.service.shutdown();
});

test('rejection, expiry, spawn failure, cancellation, and timeout have exact audit sequences', async () => {
  const workspace = root();
  const ctx = context(workspace);

  const rejected = harness();
  const rejectRun = await rejected.service.propose({ rootPath: workspace, recipe: 'git.status', reason: 'reject' }, ctx);
  assert.ok(rejectRun.ok);
  rejected.service.displayed(rejectRun.view.runId, rejectRun.view.preview!.fingerprint, ctx);
  await rejected.service.decide(rejectRun.view.runId, 'reject', rejectRun.view.preview!.fingerprint, ctx);
  assert.deepEqual(auditStore.byCorrelation(rejectRun.view.requestId).map((event) => event.type), ['proposal.created', 'approval.displayed', 'approval.rejected']);
  await rejected.service.shutdown();

  let now = 1_000;
  const expired = harness(() => now);
  const expireRun = await expired.service.propose({ rootPath: workspace, recipe: 'git.status', reason: 'expire' }, ctx);
  assert.ok(expireRun.ok);
  now += 101;
  assert.ok((await expired.service.propose({ rootPath: workspace, recipe: 'git.status', reason: 'sweep' }, ctx)).ok);
  assert.deepEqual(auditStore.byCorrelation(expireRun.view.requestId).map((event) => event.type), ['proposal.created', 'approval.expired']);
  await expired.service.shutdown();

  const spawnFailed = harness();
  spawnFailed.processes.failureCode = 'START_FAILED';
  const spawnRun = await spawnFailed.service.propose({ rootPath: workspace, recipe: 'git.diff', reason: 'spawn failure' }, ctx);
  assert.ok(spawnRun.ok);
  spawnFailed.service.displayed(spawnRun.view.runId, spawnRun.view.preview!.fingerprint, ctx);
  await spawnFailed.service.decide(spawnRun.view.runId, 'approve', spawnRun.view.preview!.fingerprint, ctx);
  assert.equal((await terminal(spawnFailed.service, spawnRun.view.runId, ctx)).state, 'FAILED');
  assert.deepEqual(auditStore.byCorrelation(spawnRun.view.requestId).map((event) => event.type), ['proposal.created', 'approval.displayed', 'approval.approved', 'approval.consumed', 'execution.failed']);
  await spawnFailed.service.shutdown();

  const cancelled = harness();
  cancelled.processes.delayMs = 10_000;
  const cancelRun = await cancelled.service.propose({ rootPath: workspace, recipe: 'git.status', reason: 'cancel' }, ctx);
  assert.ok(cancelRun.ok);
  cancelled.service.displayed(cancelRun.view.runId, cancelRun.view.preview!.fingerprint, ctx);
  await cancelled.service.decide(cancelRun.view.runId, 'approve', cancelRun.view.preview!.fingerprint, ctx);
  while (cancelled.processes.starts === 0) await new Promise((resolve) => setTimeout(resolve, 1));
  cancelled.service.cancel(cancelRun.view.runId, ctx);
  assert.equal((await terminal(cancelled.service, cancelRun.view.runId, ctx)).state, 'CANCELLED');
  assert.deepEqual(auditStore.byCorrelation(cancelRun.view.requestId).map((event) => event.type).slice(-3), ['execution.spawned', 'cancellation.requested', 'containment.terminated']);
  await cancelled.service.shutdown();

  const timedOut = harness();
  timedOut.processes.forcedDisposition = 'timed_out';
  const timeoutRun = await timedOut.service.propose({ rootPath: workspace, recipe: 'git.diff', reason: 'timeout' }, ctx);
  assert.ok(timeoutRun.ok);
  timedOut.service.displayed(timeoutRun.view.runId, timeoutRun.view.preview!.fingerprint, ctx);
  await timedOut.service.decide(timeoutRun.view.runId, 'approve', timeoutRun.view.preview!.fingerprint, ctx);
  assert.equal((await terminal(timedOut.service, timeoutRun.view.runId, ctx)).state, 'FAILED');
  assert.equal(auditStore.byCorrelation(timeoutRun.view.requestId).at(-1)?.type, 'execution.timed_out');
  await timedOut.service.shutdown();
});

test('real snapshot binds Git digest/material and hardened helper-disabling argv', async () => {
  const workspace = root();
  mkdirSync(path.join(workspace, '.git'));
  writeFileSync(path.join(workspace, '.git', 'config'), '[core]\nrepositoryformatversion=0\n');
  writeFileSync(path.join(workspace, 'README.md'), 'hello');
  const info = await import('node:fs/promises').then(({ stat }) => stat(workspace));
  const workspaceIdentity = `${info.dev}:${info.ino}:${info.birthtimeMs}:${info.ctimeMs}`;
  const resolver = new AgentRecipeResolver();
  const prepared = await resolver.prepare('git.diff', workspace, { runId: 'agentcmd_snapshot', activationId: ACTIVATION, workspaceIdentity });
  assert.equal(await resolver.verify(prepared), true);
  assert.ok(prepared.identity.arguments.includes('--no-textconv'));
  assert.ok(prepared.identity.arguments.includes('--no-ext-diff'));
  assert.ok(prepared.identity.arguments.includes('core.fsmonitor=false'));
  assert.ok(prepared.identity.arguments.includes('--ignore-submodules=all'));
  chmodSync(path.join(prepared.identity.snapshotRoot, 'README.md'), 0o600);
  writeFileSync(path.join(prepared.identity.snapshotRoot, 'README.md'), 'tampered');
  assert.equal(await resolver.verify(prepared), false);
  await resolver.release(prepared);
});
