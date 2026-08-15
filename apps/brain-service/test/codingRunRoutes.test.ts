/**
 * Acceptance for the governed coding run API.
 *
 * Driven through a real Fastify instance with `app.inject`, so status codes,
 * body shapes and the ordering of validation are exercised as a client sees them
 * rather than as the service happens to return them.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { AgentRunJournal, MemoryAgentRunJournalPersistence, DEFAULT_AGENT_RUN_JOURNAL_CONFIG } from '../src/engine/agentRunJournal.js';
import { auditStore } from '../src/engine/auditLog.js';
import { registerCodingRunRoutes } from '../src/engine/coding/codingRunRoutes.js';
import {
  CodingRunService,
  resolveWorkspaceRoot,
  type CodingWorkflowContext,
  type CodingWorkflowDriver,
} from '../src/engine/coding/codingRunService.js';
import type { CodingRunPayloadV1 } from '../src/engine/coding/codingRunPayload.js';

/**
 * Read a file from the package SOURCE tree, wherever this test is running from.
 *
 * `import.meta.url` points at `test/` under tsx and at `dist/test/` after a build,
 * so a bare `../src/...` resolves to a path that does not exist in the compiled
 * layout. That is precisely how CI runs these (`node --test dist/test/*.test.js`)
 * and how the package's own `npm test` does — so a structural assertion written
 * against the source tree silently became an error there while passing locally.
 */
async function readSource(relative: string): Promise<string> {
  const { fileURLToPath } = await import('node:url');
  const nodePath = await import('node:path');
  const { readFile } = await import('node:fs/promises');
  const here = nodePath.dirname(fileURLToPath(import.meta.url));
  const packageRoot = here.endsWith(nodePath.join('dist', 'test')) ? nodePath.resolve(here, '../..') : nodePath.resolve(here, '..');
  return readFile(nodePath.join(packageRoot, 'src', relative), 'utf8');
}

const dirs: string[] = [];
function workspace(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'migrapilot-coding-ws-')));
  dirs.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const dir of dirs) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
});

const SCOPE_HASH = 'hash_abc123';

function scopeFor(paths: string[], over: Partial<NonNullable<CodingRunPayloadV1['scope']>> = {}): NonNullable<CodingRunPayloadV1['scope']> {
  return {
    proposedPaths: paths,
    pathSetHash: SCOPE_HASH,
    sourcesByPath: Object.fromEntries(paths.map((p) => [p, [{ path: p, startLine: 1, endLine: 9, excerptHash: 'e1' }]])),
    proposalRevision: 2,
    proposedAt: '2026-08-01T00:00:00.000Z',
    approvalExpiresAt: '2026-08-01T00:05:00.000Z',
    approvalState: 'displayed',
    ...over,
  };
}

/** A driver whose planning and resumption are controllable, so the tests can
 * observe the boundary between "returned" and "finished". */
class TestDriver implements CodingWorkflowDriver {
  planCalls = 0;
  resumeCalls = 0;
  mutationsDispatched = 0;
  planGate?: () => void;
  planThrows = false;
  scope = scopeFor(['src/a.ts', 'src/b.ts']);
  private planned = new Promise<void>((resolve) => { this.planGate = resolve; });

  async plan(ctx: CodingWorkflowContext): Promise<void> {
    this.planCalls += 1;
    await this.planned;
    if (this.planThrows) throw new Error('planner exploded');
    ctx.run.patchPayload({
      plan: {
        issueSummary: 'exclude cancelled lines',
        proposedScope: this.scope.proposedPaths.map((p) => ({ path: p, rationale: `${p} participates`, sources: this.scope.sourcesByPath[p]! })),
        excludedCandidates: [{ path: 'src/formatter.ts', reason: 'display only' }],
        validationCommand: { command: ['node', '--test'] },
      },
    }, 'plan.recorded');
    ctx.run.awaitScopeApproval(this.scope);
  }

  async resume(ctx: CodingWorkflowContext): Promise<void> {
    this.resumeCalls += 1;
    const stage = await ctx.run.runStage({ kind: 'initial_apply', phase: 'executing_initial_changeset' }, async () => {
      this.mutationsDispatched += 1;
      return { outcome: 'success' as const, evidence: { applied: true }, value: null };
    });
    if (stage.status === 'cancelled') return;
    ctx.run.finalize({});
  }

  releasePlan(): void { this.planGate?.(); }
}

interface Harness {
  app: FastifyInstance;
  journal: AgentRunJournal;
  driver: TestDriver;
  service: CodingRunService;
  root: string;
}

async function harness(over: { now?: () => number } = {}): Promise<Harness> {
  const root = workspace();
  const journal = new AgentRunJournal(new MemoryAgentRunJournalPersistence(), DEFAULT_AGENT_RUN_JOURNAL_CONFIG, () => `ev_${Math.random().toString(36).slice(2)}`);
  const driver = new TestDriver();
  let seq = 0;
  const service = new CodingRunService({
    journal,
    driver,
    boundary: { allowedRoots: [root] },
    config: { maxDomainPayloadBytes: DEFAULT_AGENT_RUN_JOURNAL_CONFIG.maxDomainPayloadBytes },
    now: over.now ?? (() => Date.parse('2026-08-01T00:01:00.000Z')),
    newRunId: () => `codingrun_${++seq}`,
  });
  const app = Fastify();
  registerCodingRunRoutes(app, { service });
  await app.ready();
  return { app, journal, driver, service, root };
}

const start = (h: Harness, body: Record<string, unknown> = {}) =>
  h.app.inject({ method: 'POST', url: '/api/ai/coding/runs', payload: { issueText: 'cancelled lines are counted', workspaceRoot: h.root, ...body } });

async function plannedRun(h: Harness): Promise<{ runId: string; revision: number }> {
  const started = await start(h);
  const runId = started.json<{ runId: string }>().runId;
  h.driver.releasePlan();
  await h.service.settle(runId);
  const read = await h.app.inject({ method: 'GET', url: `/api/ai/coding/runs/${runId}` });
  return { runId, revision: read.json<{ revision: number }>().revision };
}

// ── 1–2. start ───────────────────────────────────────────────────────────────

test('1 — start returns 202 with a durable run id', async () => {
  const h = await harness();
  const res = await start(h);
  assert.equal(res.statusCode, 202, 'planning continues after the response — 200 would assert a completion');
  const body = res.json<{ runId: string; revision: number; state: string; phase: string; statusUrl: string }>();
  assert.match(body.runId, /^codingrun_/);
  assert.equal(body.phase, 'planning');
  assert.equal(body.statusUrl, `/api/ai/coding/runs/${body.runId}`);
  assert.ok((await h.journal.loadRun(body.runId)), 'the run is durable before the response returns');
  h.driver.releasePlan();
  await h.app.close();
});

test('2 — start returns before planning completes', async () => {
  const h = await harness();
  const res = await start(h);
  const runId = res.json<{ runId: string }>().runId;
  // The driver is still parked inside plan().
  assert.equal(h.driver.planCalls, 1);
  const read = await h.app.inject({ method: 'GET', url: `/api/ai/coding/runs/${runId}` });
  assert.equal(read.json<{ phase: string }>().phase, 'planning', 'still planning after the response was sent');
  h.driver.releasePlan();
  await h.service.settle(runId);
  assert.equal((await h.app.inject({ method: 'GET', url: `/api/ai/coding/runs/${runId}` })).json<{ phase: string }>().phase, 'awaiting_scope_approval');
  await h.app.close();
});

// ── 3–6. read ────────────────────────────────────────────────────────────────

test('3 — an unknown run reads 404', async () => {
  const h = await harness();
  const res = await h.app.inject({ method: 'GET', url: '/api/ai/coding/runs/codingrun_nope' });
  assert.equal(res.statusCode, 404);
  await h.app.close();
});

test('4 — a malformed durable payload is 422, never 404', async () => {
  const h = await harness();
  const { runId } = await plannedRun(h);
  // Corrupt the payload underneath the service.
  const persistence = (h.journal as unknown as { persistence: MemoryAgentRunJournalPersistence }).persistence;
  persistence.runs.get(runId)!.domainPayloadJson = '{"issueText": TRUNCA';

  const res = await h.app.inject({ method: 'GET', url: `/api/ai/coding/runs/${runId}` });
  assert.equal(res.statusCode, 422, 'the record exists — reporting 404 would hide corruption behind a missing resource');
  const body = res.json<{ error: string; reason: string; recoverable: boolean }>();
  assert.equal(body.error, 'coding_run_unreadable');
  assert.equal(body.reason, 'payload_malformed');
  assert.equal(body.recoverable, false);
  await h.app.close();
});

test('4b — a payload from a newer build is 422 and reported recoverable', async () => {
  const h = await harness();
  const { runId } = await plannedRun(h);
  const persistence = (h.journal as unknown as { persistence: MemoryAgentRunJournalPersistence }).persistence;
  persistence.runs.get(runId)!.domainSchemaVersion = 99;

  const res = await h.app.inject({ method: 'GET', url: `/api/ai/coding/runs/${runId}` });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json<{ reason: string; recoverable: boolean }>().reason, 'payload_unsupported_version');
  assert.equal(res.json<{ recoverable: boolean }>().recoverable, true, 'a newer build can read it again');
  await h.app.close();
});

test('5 — read exposes the current revision and phase', async () => {
  const h = await harness();
  const { runId, revision } = await plannedRun(h);
  const res = await h.app.inject({ method: 'GET', url: `/api/ai/coding/runs/${runId}` });
  assert.equal(res.statusCode, 200);
  const body = res.json<{ revision: number; phase: string; scope: { pathSetHash: string; proposedPaths: string[] } }>();
  assert.equal(body.revision, revision);
  assert.equal(body.phase, 'awaiting_scope_approval');
  assert.equal(body.scope.pathSetHash, SCOPE_HASH);
  assert.deepEqual(body.scope.proposedPaths, ['src/a.ts', 'src/b.ts']);
  await h.app.close();
});

test('6 — read returns evidence references, never file contents or raw output', async () => {
  const h = await harness();
  const { runId } = await plannedRun(h);
  const res = await h.app.inject({ method: 'GET', url: `/api/ai/coding/runs/${runId}` });
  const raw = res.body;
  const body = res.json<{ scope: { evidence: Array<{ path: string; spans: Array<{ startLine: number; excerptHash: string }> }> } }>();

  assert.equal(body.scope.evidence[0]?.spans[0]?.startLine, 1);
  assert.equal(body.scope.evidence[0]?.spans[0]?.excerptHash, 'e1');
  // Line ranges and hashes only — no `text`, no `codeText`, no stdout stream.
  assert.equal(raw.includes('"text"'), false, 'span text must not reach the API surface');
  assert.equal(raw.includes('sourcesByPath'), false, 'the raw payload structure is not echoed verbatim');
  await h.app.close();
});

// ── 7–12. approval conflicts ─────────────────────────────────────────────────

const decide = (h: Harness, runId: string, payload: Record<string, unknown>) =>
  h.app.inject({ method: 'POST', url: `/api/ai/coding/runs/${runId}/scope-decision`, payload });

test('7 — approval requires expectedRevision, and a non-integer is a 400', async () => {
  const h = await harness();
  const { runId } = await plannedRun(h);
  for (const bad of [undefined, '3', 3.5, null]) {
    const res = await decide(h, runId, { pathSetHash: SCOPE_HASH, decision: 'approve', ...(bad === undefined ? {} : { expectedRevision: bad }) });
    assert.equal(res.statusCode, 400, `expectedRevision ${JSON.stringify(bad)} is malformed transport, not a conflict`);
    assert.equal(res.json<{ error: string }>().error, 'invalid_request');
  }
  await h.app.close();
});

test('8 — a stale revision is 409 stale_revision', async () => {
  const h = await harness();
  const { runId, revision } = await plannedRun(h);
  const res = await decide(h, runId, { expectedRevision: revision - 1, pathSetHash: SCOPE_HASH, decision: 'approve' });
  assert.equal(res.statusCode, 409);
  const body = res.json<{ error: string; reason: string; currentRevision: number; currentPhase: string }>();
  assert.equal(body.error, 'coding_run_conflict');
  assert.equal(body.reason, 'stale_revision');
  assert.equal(body.currentRevision, revision);
  assert.equal(body.currentPhase, 'awaiting_scope_approval');
  assert.equal(h.driver.mutationsDispatched, 0);
  await h.app.close();
});

test('9 — a wrong scope hash is 409 scope_hash_mismatch, not a generic lifecycle error', async () => {
  const h = await harness();
  const { runId, revision } = await plannedRun(h);
  const res = await decide(h, runId, { expectedRevision: revision, pathSetHash: 'hash_WIDENED', decision: 'approve' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json<{ reason: string }>().reason, 'scope_hash_mismatch', 'an operator needs to know the plan changed, not merely that something is wrong');
  assert.equal(h.driver.mutationsDispatched, 0);
  await h.app.close();
});

test('10 — an expired approval is 409 approval_expired', async () => {
  let clock = Date.parse('2026-08-01T00:01:00.000Z');
  const h = await harness({ now: () => clock });
  const { runId, revision } = await plannedRun(h);
  clock = Date.parse('2026-08-01T00:06:00.000Z'); // past approvalExpiresAt
  const res = await decide(h, runId, { expectedRevision: revision, pathSetHash: SCOPE_HASH, decision: 'approve' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json<{ reason: string }>().reason, 'approval_expired');
  await h.app.close();
});

test('11 — an invalidated approval is 409 approval_invalidated', async () => {
  const h = await harness();
  const { runId, revision } = await plannedRun(h);
  // Restart re-verification found the evidence had moved.
  const service = h.service;
  const snapshot = (await service.read(runId));
  assert.ok(snapshot.ok);
  const persistence = (h.journal as unknown as { persistence: MemoryAgentRunJournalPersistence }).persistence;
  const stored = JSON.parse(persistence.runs.get(runId)!.domainPayloadJson!) as CodingRunPayloadV1;
  stored.scope!.approvalState = 'invalidated';
  persistence.runs.get(runId)!.domainPayloadJson = JSON.stringify(stored);

  const res = await decide(h, runId, { expectedRevision: revision, pathSetHash: SCOPE_HASH, decision: 'approve' });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json<{ reason: string }>().reason, 'approval_invalidated');
  await h.app.close();
});

test('12 + 15 — an approval is consumed once and cannot dispatch twice', async () => {
  const h = await harness();
  const { runId, revision } = await plannedRun(h);

  const first = await decide(h, runId, { expectedRevision: revision, pathSetHash: SCOPE_HASH, decision: 'approve' });
  assert.equal(first.statusCode, 200);
  await h.service.settle(runId);
  assert.equal(h.driver.resumeCalls, 1);
  assert.equal(h.driver.mutationsDispatched, 1);

  // Replay with the CURRENT revision, so the conflict cannot be explained away
  // as merely stale — the approval itself must be what refuses it.
  const current = ((await h.service.read(runId)) as { value: { revision: number } }).value.revision;
  const replay = await decide(h, runId, { expectedRevision: current, pathSetHash: SCOPE_HASH, decision: 'approve' });
  assert.equal(replay.statusCode, 409);
  assert.ok(['approval_already_consumed', 'invalid_state'].includes(replay.json<{ reason: string }>().reason), `a consumed approval must refuse a replay (got ${replay.json<{ reason: string }>().reason})`);
  await h.service.settle(runId);
  assert.equal(h.driver.mutationsDispatched, 1, 'a replayed approval must not dispatch a second mutation');
  await h.app.close();
});

// ── 13–14. decisions ─────────────────────────────────────────────────────────

test('13 — rejection launches no mutation child and preserves the proposal', async () => {
  const h = await harness();
  const { runId, revision } = await plannedRun(h);
  const res = await decide(h, runId, { expectedRevision: revision, pathSetHash: SCOPE_HASH, decision: 'reject' });
  assert.equal(res.statusCode, 200);
  await h.service.settle(runId);

  assert.equal(h.driver.resumeCalls, 0);
  assert.equal(h.driver.mutationsDispatched, 0);
  assert.equal((await h.journal.children(runId)).some((c) => c.kind === 'initial_apply'), false);
  assert.equal((await h.journal.loadRun(runId))?.state, 'REJECTED');

  const body = res.json<{ scope: { proposedPaths: string[]; approvalState: string } }>();
  assert.deepEqual(body.scope.proposedPaths, ['src/a.ts', 'src/b.ts'], 'the rejected proposal stays inspectable');
  await h.app.close();
});

test('14 — approval resumes execution exactly once', async () => {
  const h = await harness();
  const { runId, revision } = await plannedRun(h);
  await decide(h, runId, { expectedRevision: revision, pathSetHash: SCOPE_HASH, decision: 'approve' });
  await h.service.settle(runId);
  assert.equal(h.driver.resumeCalls, 1);
  assert.equal((await h.journal.children(runId)).filter((c) => c.kind === 'initial_apply').length, 1);
  await h.app.close();
});

// ── 16–19. cancellation ──────────────────────────────────────────────────────

const cancel = (h: Harness, runId: string, payload: Record<string, unknown>) =>
  h.app.inject({ method: 'POST', url: `/api/ai/coding/runs/${runId}/cancel`, payload });

test('16 + 17 — cancellation persists the request and answers `cancelling`, never `cancelled`', async () => {
  const h = await harness();
  const { runId, revision } = await plannedRun(h);
  const res = await cancel(h, runId, { expectedRevision: revision });
  assert.equal(res.statusCode, 200);
  const body = res.json<{ cancellation: { requestedAt: string; confirmedAt?: string; status: string } }>();
  assert.equal(body.cancellation.status, 'cancelling', 'accepting a request is not observing that work stopped');
  assert.equal(body.cancellation.confirmedAt, undefined);
  assert.ok(body.cancellation.requestedAt, 'the request itself is durable');
  await h.app.close();
});

test('18 — cancellation prevents the next stage from launching', async () => {
  const h = await harness();
  const { runId, revision } = await plannedRun(h);
  await cancel(h, runId, { expectedRevision: revision });

  // Approving after cancellation must not start mutation.
  const after = await decide(h, runId, { expectedRevision: ((await h.service.read(runId)) as { value: { revision: number } }).value.revision, pathSetHash: SCOPE_HASH, decision: 'approve' });
  assert.equal(after.statusCode, 409);
  assert.equal(after.json<{ reason: string }>().reason, 'cancellation_requested');
  await h.service.settle(runId);
  assert.equal(h.driver.mutationsDispatched, 0);
  await h.app.close();
});

test('19 — repeated cancellation is idempotent', async () => {
  const h = await harness();
  const { runId, revision } = await plannedRun(h);
  const first = await cancel(h, runId, { expectedRevision: revision });
  const firstRevision = first.json<{ revision: number }>().revision;

  const repeat = await cancel(h, runId, { expectedRevision: firstRevision });
  assert.equal(repeat.statusCode, 200);
  assert.equal(repeat.json<{ revision: number }>().revision, firstRevision, 'no duplicate cancellation was recorded');
  assert.equal(repeat.json<{ cancellation: { requestedAt: string } }>().cancellation.requestedAt, first.json<{ cancellation: { requestedAt: string } }>().cancellation.requestedAt);

  // A stale revision still conflicts rather than silently succeeding.
  const stale = await cancel(h, runId, { expectedRevision: firstRevision - 1 });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json<{ reason: string }>().reason, 'stale_revision');
  await h.app.close();
});

// ── 20–21. detached execution ────────────────────────────────────────────────

test('20 — a detached task failure is persisted as a truthful workflow failure', async () => {
  const h = await harness();
  h.driver.planThrows = true;
  const started = await start(h);
  const runId = started.json<{ runId: string }>().runId;
  h.driver.releasePlan();
  await h.service.settle(runId);

  assert.equal((await h.journal.loadRun(runId))?.state, 'FAILED', 'the run did not silently stay in planning');
  assert.equal((await h.journal.loadRun(runId))?.failureCode, 'WORKFLOW_THREW');
  const res = await h.app.inject({ method: 'GET', url: `/api/ai/coding/runs/${runId}` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json<{ state: string }>().state, 'FAILED');
  await h.app.close();
});

test('21 — after restart the registry is empty and the journal is still authoritative', async () => {
  const h = await harness();
  const { runId } = await plannedRun(h);
  assert.equal(h.service.hasExecutor(runId), false, 'planning finished, so no executor is held');

  // A fresh service over the SAME journal — this is what a restart looks like.
  const restarted = new CodingRunService({
    journal: h.journal,
    driver: h.driver,
    boundary: { allowedRoots: [h.root] },
    config: { maxDomainPayloadBytes: DEFAULT_AGENT_RUN_JOURNAL_CONFIG.maxDomainPayloadBytes },
    now: () => Date.parse('2026-08-01T00:01:00.000Z'),
  });
  assert.equal(restarted.hasExecutor(runId), false);
  const snapshot = (await restarted.read(runId));
  assert.ok(snapshot.ok);
  assert.equal(snapshot.value.phase, 'awaiting_scope_approval', 'absence from the registry is not completion');
  assert.equal(snapshot.value.scope?.pathSetHash, SCOPE_HASH);
  await h.app.close();
});

// ── 22–23. containment ───────────────────────────────────────────────────────

test('22 — a workspace outside the allowed boundary is rejected', async () => {
  const h = await harness();
  const outside = workspace();
  const res = await start(h, { workspaceRoot: outside });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json<{ error: string }>().error, 'workspace_not_permitted');
  assert.equal(h.driver.planCalls, 0, 'nothing was planned for a workspace we may not touch');
  await h.app.close();
});

test('22b — a sibling directory sharing a prefix is not inside the boundary', async () => {
  const base = workspace();
  const allowed = path.join(base, 'work');
  const sibling = path.join(base, 'work-evil');
  mkdirSync(allowed);
  mkdirSync(sibling);
  const decision = await resolveWorkspaceRoot(sibling, { allowedRoots: [allowed] });
  assert.equal(decision.ok, false, 'a prefix compare would have admitted work-evil for a boundary of work');
});

test('23 — traversal, UNC and symlink escapes are rejected', async () => {
  const h = await harness();
  const outside = workspace();

  const traversal = await start(h, { workspaceRoot: `${h.root}/../etc` });
  assert.equal(traversal.statusCode, 403);

  const unc = await start(h, { workspaceRoot: '\\\\server\\share' });
  assert.equal(unc.statusCode, 403);

  const relative = await start(h, { workspaceRoot: 'relative/path' });
  assert.equal(relative.statusCode, 403);

  // A symlink INSIDE the boundary pointing out of it must not launder access.
  const escape = path.join(h.root, 'escape');
  symlinkSync(outside, escape, 'dir');
  const symlinked = await start(h, { workspaceRoot: escape });
  assert.equal(symlinked.statusCode, 403, 'realpath resolves the link before the boundary check');
  assert.equal(h.driver.planCalls, 0);
  await h.app.close();
});

// ── 24–25. audit + layering ──────────────────────────────────────────────────

test('24 — every mutating route emits audit evidence', async () => {
  const h = await harness();
  const { runId, revision } = await plannedRun(h);
  await decide(h, runId, { expectedRevision: revision, pathSetHash: SCOPE_HASH, decision: 'approve' });
  await h.service.settle(runId);
  const after = auditStore.byCorrelation(runId, 500).map((e) => e.type);

  assert.ok(after.includes('coding.run_started'), 'start is audited');
  assert.ok(after.includes('coding.scope_approved'), 'approval is audited');
  assert.ok(auditStore.byCorrelation(runId, 500).length >= 2, `start and approval are both audited (saw ${after.join(", ")})`);

  const h2 = await harness();
  const rejected = await plannedRun(h2);
  await decide(h2, rejected.runId, { expectedRevision: rejected.revision, pathSetHash: SCOPE_HASH, decision: 'reject' });
  assert.ok(auditStore.byCorrelation(rejected.runId, 500).some((e) => e.type === 'coding.scope_rejected'));

  const h3 = await harness();
  const cancelled = await plannedRun(h3);
  await cancel(h3, cancelled.runId, { expectedRevision: cancelled.revision });
  assert.ok(auditStore.byCorrelation(cancelled.runId, 500).some((e) => e.type === 'coding.cancellation_requested'));

  await h.app.close(); await h2.app.close(); await h3.app.close();
});

test('25 — the route module reaches the journal only through the coding service', async () => {
  // Structural: the routes import the service and Fastify types, and nothing that
  // would let a handler write to the journal directly.
  const source = await readSource('engine/coding/codingRunRoutes.ts');
  for (const forbidden of ['agentRunJournal', 'AgentRunJournal', 'journalCodingStore', 'JournaledCodingRun', 'serializeDomainPayload', 'transitionAgentRun']) {
    assert.equal(source.includes(forbidden), false, `routes must not reference ${forbidden} — workflow transitions belong to the service`);
  }
  assert.ok(source.includes("from './codingRunService.js'"), 'routes go through the service');
});

test('a terminal run refuses cancellation instead of reporting it accepted', async () => {
  const h = await harness();
  const { runId, revision } = await plannedRun(h);
  await decide(h, runId, { expectedRevision: revision, pathSetHash: SCOPE_HASH, decision: 'approve' });
  await h.service.settle(runId);

  const current = ((await h.service.read(runId)) as { value: { revision: number; phase: string } }).value;
  assert.equal(current.phase, 'terminal');
  const res = await cancel(h, runId, { expectedRevision: current.revision });
  assert.equal(res.statusCode, 409, 'a finished run cannot be cancelled');
  assert.equal(res.json<{ reason: string }>().reason, 'invalid_state');
  await h.app.close();
});
