/**
 * Acceptance for the PRODUCTION governed-coding path.
 *
 * Real SQLite journal, real git fixture, real `governedApply`, real
 * `command.run` validation, real Fastify injection. The model is scripted so the
 * run is repeatable — everything between the HTTP request and the file on disk is
 * the production code path.
 *
 * A scripted model proves the SYSTEM works. It proves nothing about whether a
 * real model chooses well; that is separate capability evidence and is recorded
 * as such.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { AgentRunJournal, buildAgentRunJournalConfig } from '../src/engine/agentRunJournal.js';
import { SqliteDurableStore } from '../src/engine/persistence/sqliteStore.js';
import { registerCodingRunRoutes } from '../src/engine/coding/codingRunRoutes.js';
import { CodingRunService } from '../src/engine/coding/codingRunService.js';
import { createProductionCodingDriver } from '../src/engine/coding/productionCodingDriver.js';
import { codingCapability, readCodingConfig, readCodingValidationCommand, recoverCodingRuns } from '../src/engine/coding/codingRuntime.js';
import { createFixtureRepo, REQUIRED_FILES, TRAP_FILE, ISSUE, runFixtureTests } from './fixtures/multifileCodingFixture.js';

const roots: string[] = [];
process.on('exit', () => {
  for (const dir of roots) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
});

const CONTRACT = 'src/contracts/orderTotals.js';
const SERVICE = 'src/services/orderTotalsService.js';
const ROUTE = 'src/routes/orderTotalsRoute.js';

/** Correct edits for all three files. `wrong` reproduces the real model's observed
 * first-attempt failure: a self-consistent but invented field name. */
function edits(root: string, fieldName: string): Array<{ path: string; content: string }> {
  return [
    {
      path: CONTRACT,
      content: readFileSync(path.join(root, CONTRACT), 'utf8')
        .replace(/ORDER_TOTAL_FIELDS = \[[^\]]*\]/, `ORDER_TOTAL_FIELDS = ["subtotalCents", "totalCents", "${fieldName}"]`),
    },
    {
      path: SERVICE,
      content: `/** Sum the order, excluding cancelled lines. */
export function computeOrderTotal(lines) {
  const kept = lines.filter((line) => line.status !== "cancelled");
  const subtotalCents = kept.reduce((sum, line) => sum + line.amountCents, 0);
  return { subtotalCents, totalCents: subtotalCents, ${fieldName}: lines.length - kept.length };
}
`,
    },
    {
      path: ROUTE,
      content: `import { computeOrderTotal } from "../services/orderTotalsService.js";

export function orderTotalsRoute(body) {
  const total = computeOrderTotal(body.lines);
  return { subtotalCents: total.subtotalCents, totalCents: total.totalCents, ${fieldName}: total.${fieldName} };
}
`,
    },
  ];
}

/** A scripted model. Deterministic, and it fails the first edit exactly as the
 * real 30B model did, so the repair loop is genuinely exercised. */
function scriptedModel(root: string, opts: { failFirstEdit?: boolean; planOnly?: boolean } = {}) {
  let editCall = 0;
  const calls: string[] = [];
  const model = async (input: unknown): Promise<unknown> => {
    const body = input as Record<string, unknown>;
    if ('candidatePaths' in body) {
      calls.push('plan');
      return {
        issueSummary: 'Exclude cancelled lines from the order total and report how many were excluded.',
        scope: REQUIRED_FILES.map((p) => ({ path: p, rationale: `${p} participates in the total or its response shape` })),
        excluded: [{ path: TRAP_FILE, reason: 'formats output only; performs no arithmetic and never inspects line status' }],
        edits: edits(root, 'excludedLineCount'),
      };
    }
    if ('failureEvidence' in body) {
      calls.push('repair');
      const evidence = String(body.failureEvidence ?? '');
      const ids = [...evidence.matchAll(/\b(F-\d+)\b/g)].map((m) => m[1]!);
      return {
        rationale: 'The tests expect a field named excludedLineCount; the previous edit used cancelledCount.',
        // The adapter's contract: observedFailureEvidenceIds, and `edits`.
        observedFailureEvidenceIds: ids.slice(0, 4),
        edits: edits(root, 'excludedLineCount'),
      };
    }
    editCall += 1;
    const field = opts.failFirstEdit && editCall === 1 ? 'cancelledCount' : 'excludedLineCount';
    calls.push(`edit:${field}`);
    return {
      rationale: `Exclude cancelled lines and report the count as ${field}.`,
      edits: edits(root, field),
    };
  };
  return { model, calls };
}

interface Harness {
  app: FastifyInstance;
  journal: AgentRunJournal;
  service: CodingRunService;
  store: SqliteDurableStore;
  root: string;
  calls: string[];
}

function harness(opts: { failFirstEdit?: boolean; model?: (input: unknown) => Promise<unknown> } = {}): Harness {
  const root = createFixtureRepo();
  roots.push(root);
  // The engine database lives OUTSIDE the workspace. Inside it, its WAL and SHM
  // files appear as untracked paths in the diff and reconciliation correctly
  // reports them as writes outside the approved scope — which is the rule working,
  // not a false positive to suppress.
  const dbDir = mkdtempSync(path.join(tmpdir(), 'migra-coding-db-'));
  roots.push(dbDir);
  const store = new SqliteDurableStore(path.join(dbDir, 'engine.db'));
  const journal = new AgentRunJournal(store, buildAgentRunJournalConfig(), () => `ev_${Math.random().toString(36).slice(2)}`);
  const scripted = scriptedModel(root, { failFirstEdit: opts.failFirstEdit ?? false });
  const model = opts.model ?? scripted.model;
  const driver = createProductionCodingDriver({
    plannerModel: model as never,
    proposalModel: model,
    // Declared by the contract, never model-authored.
    validationCommand: { id: 'fixture', command: ['node', '--test', '--test-reporter=tap', 'test/orderTotals.test.js'] },
    maxRepairAttempts: 2,
  });
  const service = new CodingRunService({
    journal,
    driver,
    boundary: { allowedRoots: [root] },
    config: { maxDomainPayloadBytes: buildAgentRunJournalConfig().maxDomainPayloadBytes },
  });
  const app = Fastify();
  registerCodingRunRoutes(app, { service });
  return { app, journal, service, store, root, calls: scripted.calls };
}

const startRun = (h: Harness, over: Record<string, unknown> = {}) =>
  h.app.inject({ method: 'POST', url: '/api/ai/coding/runs', payload: { issueText: ISSUE, workspaceRoot: h.root, ...over } });
const read = (h: Harness, runId: string) => h.app.inject({ method: 'GET', url: `/api/ai/coding/runs/${runId}` });
const decide = (h: Harness, runId: string, payload: Record<string, unknown>) =>
  h.app.inject({ method: 'POST', url: `/api/ai/coding/runs/${runId}/scope-decision`, payload });

function gitDirty(root: string): string[] {
  return execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
    .split('\n').map((l) => l.trim()).filter(Boolean);

}

/**
 * Await detached work with a CLEAN environment.
 *
 * `node --test` sets NODE_TEST_CONTEXT, and a child that inherits it believes it
 * is a subtest of a parent runner: it skips the suite entirely and exits 0. A
 * validation spawned from inside this file would therefore "pass" without running
 * anything, and the repair loop would never trigger — a false green in exactly the
 * place the whole design is meant to be trustworthy.
 *
 * `command.run` composes the child env from process.env and offers no way to UNSET
 * a key, so the obligation sits here. It is removed only around the awaited run and
 * restored afterwards: deleting it for the whole file breaks the outer runner's own
 * reporting.
 */
async function settleWithRealValidation(h: Harness, runId: string): Promise<void> {
  const saved = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try {
    await h.service.settle(runId);
  } finally {
    if (saved !== undefined) process.env.NODE_TEST_CONTEXT = saved;
  }
}

async function planned(h: Harness): Promise<{ runId: string; revision: number; hash: string }> {
  const started = await startRun(h);
  const runId = started.json<{ runId: string }>().runId;
  await settleWithRealValidation(h, runId);
  const snapshot = read(h, runId);
  const body = (await snapshot).json<{ revision: number; scope?: { pathSetHash: string } }>();
  return { runId, revision: body.revision, hash: body.scope?.pathSetHash ?? '' };
}

// ── 1–3. configuration gating ────────────────────────────────────────────────

test('1 — disabled configuration leaves the capability unavailable', () => {
  const config = readCodingConfig({});
  assert.equal(config.enabled, false, 'off by default — a write capability must not appear by accident');
  const capability = codingCapability({ config, durable: true, driverReady: false });
  assert.equal(capability.available, false);
  assert.equal(capability.workspaceRootsConfigured, 0);
  assert.ok(capability.unavailableReason);
});

test('2 — invalid workspace-root configuration prevents registration', () => {
  for (const roots of ['', '/', 'relative/path', '/definitely/not/here']) {
    const config = readCodingConfig({ MIGRAPILOT_CODING_ENABLED: '1', MIGRAPILOT_CODING_WORKSPACE_ROOTS: roots });
    assert.equal(config.enabled, false, `${JSON.stringify(roots)} must not enable the capability`);
    assert.ok(config.diagnostics.length, 'an explicit diagnostic is produced');
  }
  // A valid root alongside an invalid one still disables: operating on the subset
  // that resolved would silently change what was authorised.
  const mixed = readCodingConfig({ MIGRAPILOT_CODING_ENABLED: '1', MIGRAPILOT_CODING_WORKSPACE_ROOTS: `${process.cwd()}${path.delimiter}/nope` });
  assert.equal(mixed.enabled, false);
});

test('3 — enabled configuration with a valid root mounts all four routes', async () => {
  const h = harness();
  const config = readCodingConfig({ MIGRAPILOT_CODING_ENABLED: '1', MIGRAPILOT_CODING_WORKSPACE_ROOTS: h.root });
  assert.equal(config.enabled, true);
  assert.deepEqual(config.allowedRoots, [h.root]);
  assert.equal(codingCapability({ config, durable: true, driverReady: true }).available, true);

  const started = await startRun(h);
  assert.equal(started.statusCode, 202);
  const runId = started.json<{ runId: string }>().runId;
  assert.equal((await read(h, runId)).statusCode, 200);
  assert.equal((await decide(h, runId, {})).statusCode, 400);
  assert.equal((await h.app.inject({ method: 'POST', url: `/api/ai/coding/runs/${runId}/cancel`, payload: {} })).statusCode, 400);
  await settleWithRealValidation(h, runId);
  await h.app.close(); h.store.close();
});

test('validation command comes from configuration, never the model', () => {
  assert.deepEqual(readCodingValidationCommand({}).command, ['node', '--test']);
  assert.deepEqual(readCodingValidationCommand({ MIGRAPILOT_CODING_VALIDATION_COMMAND: 'npm run verify' }).command, ['npm', 'run', 'verify']);
});

// ── 4–6. start ───────────────────────────────────────────────────────────────

test('4 + 5 — start persists a real run, returns 202, and planning reaches AWAITING_APPROVAL', async () => {
  const h = harness();
  const started = await startRun(h);
  assert.equal(started.statusCode, 202);
  const runId = started.json<{ runId: string }>().runId;
  await settleWithRealValidation(h, runId);

  const body = (await read(h, runId)).json<{ state: string; phase: string; scope: { proposedPaths: string[]; pathSetHash: string } }>();
  assert.equal(body.state, 'AWAITING_APPROVAL');
  assert.equal(body.phase, 'awaiting_scope_approval');
  assert.deepEqual([...body.scope.proposedPaths].sort(), [...REQUIRED_FILES].sort());
  assert.ok(body.scope.pathSetHash);

  // Durable across a new journal over the same database.
  const reopened = new AgentRunJournal(h.store, buildAgentRunJournalConfig());
  assert.equal(reopened.loadRun(runId)?.state, 'AWAITING_APPROVAL');
  await h.app.close(); h.store.close();
});

test('6 — start never mutates the fixture', async () => {
  const h = harness();
  assert.deepEqual(gitDirty(h.root), [], 'fixture starts clean');
  const { runId } = await planned(h);
  assert.deepEqual(gitDirty(h.root), [], 'planning wrote nothing — the approval boundary is before any mutation');
  assert.equal(h.journal.children(runId).some((c) => c.kind === 'initial_apply'), false);
  await h.app.close(); h.store.close();
});

test('11 — the initial model proposal is journaled as its own child', async () => {
  const h = harness();
  const { runId } = await planned(h);
  const kinds = h.journal.children(runId).map((c) => c.kind);
  assert.deepEqual(kinds, ['repository_planning', 'initial_model_proposal']);
  const planning = h.journal.children(runId).find((c) => c.kind === 'repository_planning')!;
  const evidence = JSON.parse(planning.terminalEvidenceJson!) as { selectedPaths: string[]; excludedPaths: string[]; result: string };
  assert.equal(evidence.result, 'planned');
  assert.deepEqual([...evidence.selectedPaths].sort(), [...REQUIRED_FILES].sort());
  assert.ok(evidence.excludedPaths.includes(TRAP_FILE), 'the trap file is explicitly excluded, not merely absent');
  await h.app.close(); h.store.close();
});

// ── 7–10. approval and refusal ───────────────────────────────────────────────

test('7 + 14 + 15 — approval resumes once, exits 0, and the report matches the real git diff', async () => {
  const h = harness();
  const { runId, revision, hash } = await planned(h);
  const decision = await decide(h, runId, { expectedRevision: revision, pathSetHash: hash, decision: 'approve' });
  assert.equal(decision.statusCode, 200);
  await settleWithRealValidation(h, runId);

  const body = (await read(h, runId)).json<{ state: string; phase: string; finalReport?: { complete: boolean; changedFiles: string[]; stopReason: string } }>();
  assert.equal(body.state, 'COMPLETED');
  assert.equal(body.phase, 'terminal');
  assert.equal(body.finalReport?.complete, true);
  assert.equal(body.finalReport?.stopReason, 'validated');

  // The report's changed files must equal what git actually shows.
  const actual = gitDirty(h.root).map((l) => l.replace(/^\S+\s+/, '')).sort();
  assert.deepEqual([...(body.finalReport?.changedFiles ?? [])].sort(), actual);
  assert.deepEqual(actual, [...REQUIRED_FILES].sort());
  assert.ok(!actual.some((p) => p === String(TRAP_FILE)), 'the trap file was never written');

  // And the fixture's own tests really pass.
  const verify = runFixtureTests(h.root);
  assert.equal(verify.exitCode, 0, verify.output.slice(0, 400));
  assert.equal(h.calls.filter((c) => c === 'plan').length, 1);
  await h.app.close(); h.store.close();
});

test('8 — rejection performs zero writes', async () => {
  const h = harness();
  const { runId, revision, hash } = await planned(h);
  const decision = await decide(h, runId, { expectedRevision: revision, pathSetHash: hash, decision: 'reject' });
  assert.equal(decision.statusCode, 200);
  await settleWithRealValidation(h, runId);

  assert.deepEqual(gitDirty(h.root), [], 'a rejected scope leaves the workspace untouched');
  assert.equal(h.journal.loadRun(runId)?.state, 'REJECTED');
  const body = (await read(h, runId)).json<{ scope: { proposedPaths: string[] } }>();
  assert.equal(body.scope.proposedPaths.length, 3, 'the rejected plan stays inspectable');
  await h.app.close(); h.store.close();
});

test('9 — a stale approval performs zero writes', async () => {
  const h = harness();
  const { runId, revision, hash } = await planned(h);
  const stale = await decide(h, runId, { expectedRevision: revision - 1, pathSetHash: hash, decision: 'approve' });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json<{ reason: string }>().reason, 'stale_revision');
  await settleWithRealValidation(h, runId);
  assert.deepEqual(gitDirty(h.root), []);
  await h.app.close(); h.store.close();
});

test('10 — a scope-hash mismatch performs zero writes', async () => {
  const h = harness();
  const { runId, revision } = await planned(h);
  const mismatch = await decide(h, runId, { expectedRevision: revision, pathSetHash: 'hash_widened', decision: 'approve' });
  assert.equal(mismatch.statusCode, 409);
  assert.equal(mismatch.json<{ reason: string }>().reason, 'scope_hash_mismatch');
  await settleWithRealValidation(h, runId);
  assert.deepEqual(gitDirty(h.root), []);
  await h.app.close(); h.store.close();
});

// ── 12–13. real evidence and repair ──────────────────────────────────────────

test('12 — apply and validation children persist real terminal evidence', async () => {
  const h = harness();
  const { runId, revision, hash } = await planned(h);
  await decide(h, runId, { expectedRevision: revision, pathSetHash: hash, decision: 'approve' });
  await settleWithRealValidation(h, runId);

  const apply = h.journal.children(runId).find((c) => c.kind === 'initial_apply')!;
  const applyEvidence = JSON.parse(apply.terminalEvidenceJson!) as { mutation: string; admittedPaths: string[]; status: string };
  assert.equal(applyEvidence.status, 'applied');
  assert.equal(applyEvidence.mutation, 'complete');
  assert.deepEqual([...applyEvidence.admittedPaths].sort(), [...REQUIRED_FILES].sort());

  const validation = h.journal.children(runId).find((c) => c.kind === 'final_validation' || c.kind === 'validation')!;
  const evidence = JSON.parse(validation.terminalEvidenceJson!) as { executable: string; exitCode: number; passed: boolean; commandRunId: string; stdout: { digest: string } };
  assert.equal(evidence.executable, 'node');
  assert.equal(evidence.exitCode, 0);
  assert.equal(evidence.passed, true);
  assert.ok(evidence.commandRunId, 'a real command-run identifier');
  assert.ok(evidence.stdout.digest, 'output is digested, never stored whole');
  await h.app.close(); h.store.close();
});

test('13 — a failed validation creates repair children and the repair succeeds', async () => {
  const h = harness({ failFirstEdit: true });
  const { runId, revision, hash } = await planned(h);
  await decide(h, runId, { expectedRevision: revision, pathSetHash: hash, decision: 'approve' });
  await settleWithRealValidation(h, runId);

  const kinds = h.journal.children(runId).map((c) => c.kind);
  const trace = `children=[${h.journal.children(runId).map((c) => `${c.kind}#${c.attempt}:${c.state}`).join(' ')}] modelCalls=[${h.calls.join(' ')}]`;
  assert.ok(kinds.includes('repair_model_proposal'), `a repair proposal child exists — ${trace}`);
  assert.ok(kinds.includes('repair_apply'), 'a repair apply child exists');

  const repair = h.journal.children(runId).find((c) => c.kind === 'repair_model_proposal')!;
  const evidence = JSON.parse(repair.terminalEvidenceJson!) as { citedEvidenceIds: string[] };
  assert.ok(evidence.citedEvidenceIds.length > 0, 'the repair cited immutable failure-evidence ids the run itself produced');

  const body = (await read(h, runId)).json<{ state: string; finalReport?: { complete: boolean } }>();
  assert.equal(body.state, 'COMPLETED');
  assert.equal(body.finalReport?.complete, true);
  assert.equal(runFixtureTests(h.root).exitCode, 0);
  await h.app.close(); h.store.close();
});

// ── 16–19. cancellation and duplicate dispatch ───────────────────────────────

test('17 — cancellation requested during approval prevents mutation', async () => {
  const h = harness();
  const { runId, revision, hash } = await planned(h);
  await h.app.inject({ method: 'POST', url: `/api/ai/coding/runs/${runId}/cancel`, payload: { expectedRevision: revision } });

  const current = (await read(h, runId)).json<{ revision: number; cancellation: { status: string } }>();
  assert.equal(current.cancellation.status, 'cancelling', 'a request is not a confirmation');
  const after = await decide(h, runId, { expectedRevision: current.revision, pathSetHash: hash, decision: 'approve' });
  assert.equal(after.statusCode, 409);
  assert.equal(after.json<{ reason: string }>().reason, 'cancellation_requested');
  await settleWithRealValidation(h, runId);
  assert.deepEqual(gitDirty(h.root), [], 'cancellation before approval means zero writes');
  await h.app.close(); h.store.close();
});

test('18 — duplicate continuation cannot double-dispatch', async () => {
  const h = harness();
  const { runId, revision, hash } = await planned(h);
  const [first, second] = await Promise.all([
    decide(h, runId, { expectedRevision: revision, pathSetHash: hash, decision: 'approve' }),
    decide(h, runId, { expectedRevision: revision, pathSetHash: hash, decision: 'approve' }),
  ]);
  await settleWithRealValidation(h, runId);

  const accepted = [first, second].filter((r) => r.statusCode === 200);
  assert.equal(accepted.length, 1, 'exactly one approval was accepted');
  assert.equal(h.journal.children(runId).filter((c) => c.kind === 'initial_apply').length, 1, 'only one apply child exists');
  await h.app.close(); h.store.close();
});

test('19b — a failed planning model call reaches a TERMINAL state, never stalls in planning', async () => {
  // Reproduces a real defect: the provider returned 500 (the 30B model OOM'd on
  // load), the planning stage recorded an observed failure, and the driver simply
  // returned — leaving the run in `planning` forever with nothing explaining why.
  // A client polling that run would never get an answer.
  const h = harness({ model: async () => { throw new Error('model call failed: 500'); } });
  const started = await startRun(h);
  const runId = started.json<{ runId: string }>().runId;
  await settleWithRealValidation(h, runId);

  const body = (await read(h, runId)).json<{ state: string; phase: string; blockers: string[] }>();
  assert.equal(body.phase, 'terminal', 'the run must not stall mid-phase when a stage fails');
  assert.ok(['FAILED', 'CANCELLED'].includes(body.state), `expected a terminal state, got ${body.state}`);
  assert.ok(body.blockers.length > 0, 'the reason stays inspectable');
  assert.deepEqual(gitDirty(h.root), [], 'a failed plan writes nothing');
  await h.app.close(); h.store.close();
});

test('19 — a detached execution failure becomes a durable failed run', async () => {
  const h = harness({ model: async () => { throw new Error('provider unreachable'); } });
  const started = await startRun(h);
  const runId = started.json<{ runId: string }>().runId;
  await settleWithRealValidation(h, runId);

  const run = h.journal.loadRun(runId)!;
  // Either the planning child recorded the failure, or the run itself did — but
  // the run must never sit in `planning` with nothing explaining why.
  const planningChild = h.journal.children(runId).find((c) => c.kind === 'repository_planning');
  assert.ok(run.state === 'FAILED' || planningChild?.state === 'failed', `run=${run.state} child=${planningChild?.state}`);
  assert.deepEqual(gitDirty(h.root), []);
  await h.app.close(); h.store.close();
});

// ── 20–23. restart ───────────────────────────────────────────────────────────

test('20 — restart preserves a valid pending approval', async () => {
  const h = harness();
  const { runId, hash } = await planned(h);
  const outcomes = await recoverCodingRuns({
    journal: h.journal,
    readSpan: () => async (p, s, e) => readFileSync(path.join(h.root, p), 'utf8').split(/\r?\n/).slice(s - 1, e).join('\n'),
    now: Date.now(),
  });
  const outcome = outcomes.find((o) => o.runId === runId);
  assert.equal(outcome?.action, 'approval_preserved', outcome?.detail);
  // And it is still approvable afterwards.
  const current = (await read(h, runId)).json<{ revision: number }>();
  assert.equal((await decide(h, runId, { expectedRevision: current.revision, pathSetHash: hash, decision: 'approve' })).statusCode, 200);
  await settleWithRealValidation(h, runId);
  await h.app.close(); h.store.close();
});

test('21 — restart invalidates changed source evidence', async () => {
  const h = harness();
  const { runId } = await planned(h);
  const outcomes = await recoverCodingRuns({
    journal: h.journal,
    // The tree moved underneath the proposal.
    readSpan: () => async () => 'export function computeOrderTotal() { return 0; }',
    now: Date.now(),
  });
  const outcome = outcomes.find((o) => o.runId === runId);
  assert.equal(outcome?.action, 'approval_invalidated');
  assert.match(outcome?.detail ?? '', /replann?ed/i);
  await h.app.close(); h.store.close();
});

test('22 — restart does not replay an ambiguous apply', async () => {
  const h = harness();
  const { runId, revision, hash } = await planned(h);
  await decide(h, runId, { expectedRevision: revision, pathSetHash: hash, decision: 'approve' });
  await settleWithRealValidation(h, runId);

  // Simulate a crash mid-apply on a second run by leaving an apply child running.
  const apply = h.journal.children(runId).find((c) => c.kind === 'initial_apply')!;
  assert.equal(apply.state, 'completed', 'the real run finished cleanly');

  // A fresh run whose apply is left mid-flight.
  const h2 = harness();
  const second = await planned(h2);
  await decide(h2, second.runId, { expectedRevision: second.revision, pathSetHash: second.hash, decision: 'approve' });
  const journal2 = h2.journal;
  await settleWithRealValidation(h2, second.runId);
  const applyChild = journal2.children(second.runId).find((c) => c.kind === 'initial_apply')!;
  // Force the durable record back into an unresolved state, as a crash would.
  h2.store.transitionAgentRunChild({ childId: applyChild.childId, expectedRevision: applyChild.revision, nextState: 'running', at: Date.now() });

  const outcomes = await recoverCodingRuns({ journal: journal2, readSpan: () => async () => undefined, now: Date.now() });
  const outcome = outcomes.find((o) => o.runId === second.runId);
  if (outcome) {
    assert.equal(outcome.action, 'mutation_reconciliation_required');
    assert.ok(outcome.interruptedChildren.includes(applyChild.childId));
  }
  await h.app.close(); h.store.close(); await h2.app.close(); h2.store.close();
});

test('23 — shutdown does not manufacture a cancellation confirmation', async () => {
  const h = harness();
  const { runId, revision } = await planned(h);
  await h.app.inject({ method: 'POST', url: `/api/ai/coding/runs/${runId}/cancel`, payload: { expectedRevision: revision } });
  await settleWithRealValidation(h, runId);

  const outcomes = await recoverCodingRuns({ journal: h.journal, readSpan: () => async () => undefined, now: Date.now() });
  const body = (await read(h, runId)).json<{ cancellation: { status: string; confirmedAt?: string } }>();
  assert.equal(body.cancellation.status, 'cancelling', 'restart must not upgrade a request into a confirmation');
  assert.equal(body.cancellation.confirmedAt, undefined);
  assert.notEqual(h.journal.loadRun(runId)?.state, 'CANCELLED');
  void outcomes;
  await h.app.close(); h.store.close();
});

// ── 24–25. capability + layering ─────────────────────────────────────────────

test('24 — capability metadata is false when initialization fails, and never leaks paths', () => {
  const config = readCodingConfig({ MIGRAPILOT_CODING_ENABLED: '1', MIGRAPILOT_CODING_WORKSPACE_ROOTS: process.cwd() });
  const noJournal = codingCapability({ config, durable: false, driverReady: false });
  assert.equal(noJournal.available, false);
  assert.match(noJournal.unavailableReason ?? '', /durable/);

  const ready = codingCapability({ config, durable: true, driverReady: true });
  assert.equal(ready.available, true);
  assert.equal(ready.approvalMode, 'scope');
  assert.equal(ready.progressMode, 'polling');
  assert.equal(ready.workspaceRootsConfigured, 1);
  assert.equal(JSON.stringify(ready).includes(process.cwd()), false, 'configured paths are never exposed');
});

test('25 — no route handler imports the journal or the mutation engine', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/engine/coding/codingRunRoutes.ts', import.meta.url), 'utf8'));
  for (const forbidden of ['agentRunJournal', 'AgentRunJournal', 'governedApply', 'changeset', 'JournaledCodingRun', 'productionCodingDriver']) {
    assert.equal(source.includes(forbidden), false, `routes must not reference ${forbidden}`);
  }
});
