// Repair memory — what a later attempt is told about the earlier ones.
//
// WHY THIS EXISTS. The driver passed `previousAttempts: []` unconditionally, so
// every repair was authored as though it were the first. A real `qwen3-coder:30b`
// run spent its whole budget that way: told only "the tests still fail", it
// escalated from a field-name change to hallucinating an Express application into
// an ESM codebase that never used Express. Governance refused it — but the model
// was never given the one fact that would have stopped it, namely that its own
// previous attempt had already been rejected and why.
//
// The history is an aid to model COMPETENCE. These tests exist mostly to prove it
// does not become an erosion of AUTHORITY: every boundary that held before — scope,
// evidence-id validity, command ownership — must still hold with history present,
// and history itself must be bounded and free of raw model output. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  createRepairChangesetAuthor,
  changesetFingerprint,
  extractFailureEvidence,
  importedModules,
  renderRepairHistory,
  REPAIR_HISTORY_LIMITS,
  type ObservedFailureEvidence,
  type PreviousRepairAttempt,
} from '../src/engine/coding/modelProposals.js';
import { applyOutcome, rolledBackPaths, type ApplyEvidence } from '../src/engine/coding/codingStageEvidence.js';
import { parseCodingPayload } from '../src/engine/coding/codingRunPayload.js';
import { proposeEditScope, approveEditScope } from '../src/engine/coding/editScope.js';
import { EvidenceLedger } from '../src/engine/grounding/evidenceLedger.js';
import { makeSpanSource } from '../src/engine/planning/workspaceSpanSource.js';
import { runValidation } from '../src/engine/coding/validationRun.js';
import { AgentRunJournal, buildAgentRunJournalConfig } from '../src/engine/agentRunJournal.js';
import { SqliteDurableStore } from '../src/engine/persistence/sqliteStore.js';
import { registerCodingRunRoutes } from '../src/engine/coding/codingRunRoutes.js';
import { CodingRunService } from '../src/engine/coding/codingRunService.js';
import { createProductionCodingDriver } from '../src/engine/coding/productionCodingDriver.js';
import { createFixtureRepo, REQUIRED_FILES, TRAP_FILE, ISSUE } from './fixtures/multifileCodingFixture.js';

const [CONTRACT, SERVICE, ROUTE] = REQUIRED_FILES;
const VALIDATION = { id: 'fixture', command: ['node', '--test', '--test-reporter=tap', 'test/orderTotals.test.js'] };
const RUN = 'cmd_run_1';

const roots: string[] = [];
process.on('exit', () => {
  for (const d of roots) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});
const fixture = (): string => { const r = createFixtureRepo(); roots.push(r); return r; };

// Awaited. An un-awaited ledger is EMPTY when the adapter reads it, and every
// proposal is then rejected as `unsupported-path` — a green-looking guard that is
// really just measuring a race.
async function ledgerFor(root: string): Promise<EvidenceLedger> {
  const l = new EvidenceLedger();
  for (const p of REQUIRED_FILES) await l.request(p, 1, 40, makeSpanSource(root, p, 1, 40));
  return l;
}
function scopeFor() {
  return approveEditScope(proposeEditScope({
    runId: 'run-1',
    rationale: 'exclude cancelled lines',
    files: REQUIRED_FILES.map((p) => ({ path: p, reason: 'participates', sources: [{ path: p, startLine: 1, endLine: 5, excerptHash: 'h' }] })),
  }));
}
async function realEvidence(root: string) {
  const saved = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try {
    const record = await runValidation(VALIDATION, 'final', { rootPath: root });
    return { record, blocks: extractFailureEvidence(record, RUN) };
  } finally {
    if (saved !== undefined) process.env.NODE_TEST_CONTEXT = saved;
  }
}
const EDIT = (p: string, body = `// edited ${p}\n`) => ({ path: p, content: body });

async function author(root: string, model: () => unknown) {
  return createRepairChangesetAuthor({ model: async () => model(), rootPath: root, runId: 'run-1', ledger: await ledgerFor(root) });
}
const input = (blocks: ObservedFailureEvidence[], record: Awaited<ReturnType<typeof runValidation>>, over: Record<string, unknown> = {}) => ({
  scope: scopeFor(), currentDiff: [SERVICE], latestValidation: record, evidence: blocks, commandRunId: RUN,
  previousAttempts: [] as PreviousRepairAttempt[], remainingAttempts: 3, ...over,
});
const attempt = (over: Partial<PreviousRepairAttempt> = {}): PreviousRepairAttempt => ({
  attempt: 1,
  citedEvidenceIds: ['F-001'],
  rationale: 'renamed the field',
  proposedPaths: [CONTRACT],
  proposalDigest: 'digest_1',
  outcome: 'validation_failed',
  outcomeReason: 'the change applied but the tests still failed',
  ...over,
});

// ── 1. History reaches the model ──────────────────────────────────────────────

test('1 — a previous failed repair is included in the next prompt', async () => {
  const root = fixture();
  const { record, blocks } = await realEvidence(root);
  let seen: Record<string, unknown> | undefined;
  const a = createRepairChangesetAuthor({
    model: async (i) => { seen = i as Record<string, unknown>; return null; },
    rootPath: root, runId: 'run-1', ledger: await ledgerFor(root),
  });
  await a.propose(input(blocks, record, {
    previousAttempts: [attempt({ rationale: 'renamed to cancelledCount', outcomeReason: 'tests still expect excludedLineCount' })],
  }));
  const history = String(seen?.repairHistory ?? '');
  assert.match(history, /Attempt 1/);
  assert.match(history, /validation_failed/);
  assert.match(history, /renamed to cancelledCount/, 'what was tried');
  assert.match(history, /tests still expect excludedLineCount/, 'why it failed');
  assert.match(history, new RegExp(CONTRACT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'which files were touched');
  assert.match(history, /F-001/, 'which evidence was cited');
  assert.match(history, /MUST NOT/, 'what must not be repeated');
  assert.match(history, /remaining after this one: 2/, 'remaining budget');
});

// ── 2-4. Repetition is refused; a genuine correction is not ───────────────────

test('2 — an identical proposal digest is rejected', async () => {
  const root = fixture();
  const { record, blocks } = await realEvidence(root);
  const edits = [EDIT(CONTRACT)];
  const digest = changesetFingerprint({ rootPath: root, ops: edits.map((e) => ({ op: 'replace' as const, path: e.path, content: e.content })) });
  const r = await (await author(root, () => ({ rationale: 'same again', edits, observedFailureEvidenceIds: [blocks[0]!.evidenceId] }))).propose(input(blocks, record, { previousAttempts: [attempt({ proposalDigest: digest })] }));
  assert.ok(!r.ok && r.kind === 'rejected' && r.rejection === 'duplicate-repair', JSON.stringify(r));
});

test('3 — a strategy that already failed to land is rejected even when reworded', async () => {
  // Different bytes, same files, same claimed authority, after an outcome that never
  // reached disk. Rewording cannot make a refused apply land.
  const root = fixture();
  const { record, blocks } = await realEvidence(root);
  const id = blocks[0]!.evidenceId;
  const r = await (await author(root, () => ({ rationale: 'trying again, differently worded', edits: [EDIT(CONTRACT, '// totally different bytes\n')], observedFailureEvidenceIds: [id] }))).propose(input(blocks, record, {
      previousAttempts: [attempt({ citedEvidenceIds: [id], proposedPaths: [CONTRACT], outcome: 'apply_refused', outcomeReason: 'the governed apply refused it' })],
    }));
  assert.ok(!r.ok && r.kind === 'rejected' && r.rejection === 'repeated-strategy', JSON.stringify(r));
});

test('4 — a corrected proposal citing new evidence is accepted', async () => {
  const root = fixture();
  const { record, blocks } = await realEvidence(root);
  assert.ok(blocks.length >= 2, 'fixture must produce several failure blocks');
  const r = await (await author(root, () => ({
    rationale: 'the service, not the contract, computes the total',
    edits: [EDIT(SERVICE)],
    observedFailureEvidenceIds: [blocks[1]!.evidenceId],
  }))).propose(input(blocks, record, {
    previousAttempts: [attempt({ citedEvidenceIds: [blocks[0]!.evidenceId], proposedPaths: [CONTRACT], outcome: 'apply_refused', outcomeReason: 'refused' })],
  }));
  assert.ok(r.ok, r.ok ? '' : `${(r as { rejection?: string }).rejection}: ${(r as { message?: string }).message}`);
  assert.deepEqual(r.changeset.ops.map((o) => o.path), [SERVICE]);
});

// ── 5-7. History must not weaken any existing boundary ────────────────────────

test('5 — stale evidence ids are still rejected with history present', async () => {
  const root = fixture();
  const { record, blocks } = await realEvidence(root);
  const r = await (await author(root, () => ({ rationale: 'x', edits: [EDIT(CONTRACT)], observedFailureEvidenceIds: ['F-001'] }))).propose(input(blocks, record, { commandRunId: 'a_different_attempt', previousAttempts: [attempt()] }));
  assert.ok(!r.ok && r.kind === 'rejected', JSON.stringify(r));
  assert.ok(['stale-citation', 'foreign-citation'].includes((r as { rejection: string }).rejection), (r as { rejection: string }).rejection);
});

test('6 — invented evidence ids are still rejected with history present', async () => {
  const root = fixture();
  const { record, blocks } = await realEvidence(root);
  const r = await (await author(root, () => ({ rationale: 'x', edits: [EDIT(CONTRACT)], observedFailureEvidenceIds: ['F-999'] }))).propose(input(blocks, record, { previousAttempts: [attempt()] }));
  assert.ok(!r.ok && r.kind === 'rejected', JSON.stringify(r));
  assert.ok(['unobserved-citation', 'stale-citation'].includes((r as { rejection: string }).rejection), (r as { rejection: string }).rejection);
});

test('7 — repair history cannot be used to expand the approved scope', async () => {
  // The history names a path; that must confer no authority over it whatsoever.
  const root = fixture();
  const { record, blocks } = await realEvidence(root);
  const r = await (await author(root, () => ({ rationale: 'the formatter needs it too', edits: [EDIT(TRAP_FILE)], observedFailureEvidenceIds: [blocks[0]!.evidenceId] }))).propose(input(blocks, record, {
      previousAttempts: [attempt({ proposedPaths: [TRAP_FILE], outcome: 'validation_failed' })],
    }));
  assert.ok(!r.ok && r.kind === 'rejected', JSON.stringify(r));
  assert.ok(['scope-expansion', 'unsupported-path'].includes((r as { rejection: string }).rejection), (r as { rejection: string }).rejection);
});

// ── 8-9. The history itself is bounded and clean ──────────────────────────────

test('8 — history is bounded by count and by size', () => {
  const many = Array.from({ length: 20 }, (_, i) => attempt({
    attempt: i + 1,
    rationale: 'x'.repeat(5_000),
    outcomeReason: 'y'.repeat(5_000),
    proposalDigest: `d${i}`,
  }));
  const text = renderRepairHistory(many, 1);
  // Two separate bounds. The ATTEMPT BLOCKS are charged against the budget; the
  // prohibitions are appended afterwards and are deliberately never truncated,
  // because a history that loses its "MUST NOT" is worse than no history at all.
  const rulesAt = text.indexOf('You MUST NOT:');
  assert.ok(rulesAt > 0, 'the prohibitions must always survive');
  assert.ok(rulesAt <= REPAIR_HISTORY_LIMITS.maxTotalChars, `attempt blocks were ${rulesAt} chars`);
  // 20 attempts × 10k chars of input must not become 200k of prompt.
  assert.ok(text.length < 6_000, `history was ${text.length} chars`);
  // The most RECENT attempts are what a model is about to repeat, so those are kept.
  assert.match(text, /Attempt 20/);
  assert.equal(/Attempt 1 —/.test(text), false, 'the oldest attempts are dropped, not the newest');
  assert.equal(/Attempt 16 —/.test(text), false, 'only the last few attempts are carried');
});

test('9 — raw model responses never enter the history', async () => {
  // The durable payload is the thing that survives a restart, so this is where a
  // transcript would accumulate. `PreviousRepairAttempt` has no field for one, and
  // the parser drops anything that is not the declared shape.
  const smuggled = {
    ...attempt(),
    rawResponse: '{"the entire model reply":"…"}',
    transcript: ['turn 1', 'turn 2'],
  };
  const parsed = parseCodingPayload({
    issueText: ISSUE, phase: 'repairing', attempts: { initialProposal: 1, repair: 1 }, childRefs: [],
    repairHistory: [smuggled],
  });
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.fault);
  const kept = parsed.payload.repairHistory ?? [];
  assert.equal(kept.length, 1);
  const serialized = JSON.stringify(kept[0]);
  assert.equal(serialized.includes('the entire model reply'), false, 'a raw response was carried into durable history');
  assert.equal(serialized.includes('turn 1'), false);
});

// ── 10-12. A rolled-back apply is not a success ───────────────────────────────

const applyEv = (over: Partial<ApplyEvidence> = {}): ApplyEvidence => ({
  changesetDigest: 'd', requestedPaths: [SERVICE], admittedPaths: [SERVICE], refusedPaths: [],
  readback: 'verified', rollback: 'none', mutation: 'complete', status: 'applied', ...over,
});

test('10 — a rolled-back apply is never a successful apply stage', () => {
  const rolled = applyEv({ rollback: 'rolled-back', mutation: 'none' });
  assert.equal(applyOutcome(rolled), 'failure', 'nothing survived, so nothing succeeded');
  assert.equal(applyOutcome(applyEv()), 'success');
  assert.equal(applyOutcome(applyEv({ mutation: 'partial' })), 'failure');
  assert.equal(applyOutcome(applyEv({ status: 'refused', mutation: 'none' })), 'failure');
});

test('11 — rollback evidence reaches the reconciliation as a rollback set', () => {
  assert.deepEqual(rolledBackPaths(applyEv({ rollback: 'rolled-back', mutation: 'none' })), [SERVICE]);
  assert.deepEqual(rolledBackPaths(applyEv()), [], 'an apply that survived rolled nothing back');
  assert.deepEqual(rolledBackPaths(applyEv({ rollback: 'rollback-failed', mutation: 'partial' })), [],
    'a FAILED rollback left the tree mutated; calling it rolled back would excuse a real mismatch');
});

test('12 — a rollback is stated in the final report, not left as an unexplained mismatch', () => {
  // The driver builds `unresolvedRisks` from the derived rollback set; an empty set
  // must stay silent, and a non-empty one must name the paths.
  // Derive the package root rather than counting `..`. `import.meta.url` is `test/`
  // under tsx and `dist/test/` after a build, and a fixed relative path is correct
  // in only one of them — the exact parity bug this suite's sibling fixed.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = here.endsWith(path.join('dist', 'test')) ? path.resolve(here, '../..') : path.resolve(here, '..');
  const source = readFileSync(path.join(packageRoot, 'src/engine/coding/productionCodingDriver.ts'), 'utf8');
  assert.match(source, /rollbacks: allRollbacks/, 'the report carries the derived rollback set');
  assert.match(source, /written and rolled back/, 'the risk names what happened');
  assert.equal(/rollbacks: \[\],/.test(source), false, 'no rollback set is hardcoded empty any more');
});

// ── 13-15. Through the real driver ────────────────────────────────────────────

interface H { app: FastifyInstance; journal: AgentRunJournal; service: CodingRunService; store: SqliteDurableStore; root: string }

function harness(model: (input: unknown) => Promise<unknown>, maxRepairAttempts = 2): H {
  const root = fixture();
  const dbDir = mkdtempSync(path.join(tmpdir(), 'repair-mem-db-'));
  roots.push(dbDir);
  const store = new SqliteDurableStore(path.join(dbDir, 'engine.db'));
  const journal = new AgentRunJournal(store, buildAgentRunJournalConfig(), () => `ev_${Math.random().toString(36).slice(2)}`);
  const driver = createProductionCodingDriver({
    plannerModel: model as never, proposalModel: model, validationCommand: VALIDATION, maxRepairAttempts,
  });
  const service = new CodingRunService({
    journal, driver, boundary: { allowedRoots: [root] },
    config: { maxDomainPayloadBytes: buildAgentRunJournalConfig().maxDomainPayloadBytes },
  });
  const app = Fastify();
  registerCodingRunRoutes(app, { service });
  return { app, journal, service, store, root };
}

function editsFor(root: string, field: string) {
  return [
    { path: CONTRACT, content: readFileSync(path.join(root, CONTRACT), 'utf8').replace(/ORDER_TOTAL_FIELDS = \[[^\]]*\]/, `ORDER_TOTAL_FIELDS = ["subtotalCents", "totalCents", "${field}"]`) },
    { path: SERVICE, content: `export function computeOrderTotal(lines) {\n  const kept = lines.filter((l) => l.status !== "cancelled");\n  const subtotalCents = kept.reduce((s, l) => s + l.amountCents, 0);\n  return { subtotalCents, totalCents: subtotalCents, ${field}: lines.length - kept.length };\n}\n` },
    { path: ROUTE, content: `import { computeOrderTotal } from "../services/orderTotalsService.js";\n\nexport function orderTotalsRoute(body) {\n  const t = computeOrderTotal(body.lines);\n  return { subtotalCents: t.subtotalCents, totalCents: t.totalCents, ${field}: t.${field} };\n}\n` },
  ];
}

async function settle(h: H, runId: string): Promise<void> {
  const saved = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try { await h.service.settle(runId); } finally { if (saved !== undefined) process.env.NODE_TEST_CONTEXT = saved; }
}

async function approvedRun(h: H): Promise<string> {
  const started = await h.app.inject({ method: 'POST', url: '/api/ai/coding/runs', payload: { issueText: ISSUE, workspaceRoot: h.root } });
  const runId = started.json<{ runId: string }>().runId;
  await settle(h, runId);
  const snap = (await h.app.inject({ method: 'GET', url: `/api/ai/coding/runs/${runId}` })).json<{ revision: number; scope?: { pathSetHash: string } }>();
  await h.app.inject({
    method: 'POST', url: `/api/ai/coding/runs/${runId}/scope-decision`,
    payload: { expectedRevision: snap.revision, pathSetHash: snap.scope?.pathSetHash, decision: 'approve' },
  });
  await settle(h, runId);
  return runId;
}

test('13 — repair attempts survive a restart', async () => {
  let root = '';
  let repairs = 0;
  const model = async (i: unknown): Promise<unknown> => {
    const b = i as Record<string, unknown>;
    if ('candidatePaths' in b) {
      return {
        issueSummary: 'Exclude cancelled lines.',
        scope: REQUIRED_FILES.map((p) => ({ path: p, rationale: 'participates' })),
        excluded: [{ path: TRAP_FILE, reason: 'formats only' }],
        edits: editsFor(root, 'wrongName'),
      };
    }
    if ('failureEvidence' in b) {
      repairs += 1;
      const ids = [...String(b.failureEvidence ?? '').matchAll(/\b(F-\d+)\b/g)].map((m) => m[1]!);
      return { rationale: `repair ${repairs}`, observedFailureEvidenceIds: ids.slice(0, 3), edits: editsFor(root, `stillWrong${repairs}`) };
    }
    return { rationale: 'initial', edits: editsFor(root, 'wrongName') };
  };
  const h = harness(model);
  root = h.root;
  const runId = await approvedRun(h);

  // Read the DURABLE record, exactly as a restarted process would.
  const payload = parseCodingPayload(JSON.parse(h.journal.loadRun(runId)!.domainPayloadJson!));
  assert.ok(payload.ok, payload.ok ? '' : payload.fault);
  const history = payload.payload.repairHistory ?? [];
  assert.ok(history.length > 0, 'a restarted run would have no memory of its failed repairs');
  assert.ok(history.every((a) => a.proposalDigest && a.outcome), 'each entry must carry a digest and an outcome');
  await h.app.close(); h.store.close();
});

test('14 — a cancelled run does not record its stop as a repair failure', async () => {
  let root = '';
  const model = async (i: unknown): Promise<unknown> => {
    const b = i as Record<string, unknown>;
    if ('candidatePaths' in b) {
      return {
        issueSummary: 'Exclude cancelled lines.',
        scope: REQUIRED_FILES.map((p) => ({ path: p, rationale: 'participates' })),
        excluded: [{ path: TRAP_FILE, reason: 'formats only' }],
        edits: editsFor(root, 'excludedLineCount'),
      };
    }
    return { rationale: 'initial', edits: editsFor(root, 'excludedLineCount') };
  };
  const h = harness(model);
  root = h.root;
  const started = await h.app.inject({ method: 'POST', url: '/api/ai/coding/runs', payload: { issueText: ISSUE, workspaceRoot: h.root } });
  const runId = started.json<{ runId: string }>().runId;
  await settle(h, runId);
  const snap = (await h.app.inject({ method: 'GET', url: `/api/ai/coding/runs/${runId}` })).json<{ revision: number }>();
  await h.app.inject({ method: 'POST', url: `/api/ai/coding/runs/${runId}/cancel`, payload: { expectedRevision: snap.revision } });
  await settle(h, runId);

  const payload = parseCodingPayload(JSON.parse(h.journal.loadRun(runId)!.domainPayloadJson!));
  assert.ok(payload.ok, payload.ok ? '' : payload.fault);
  const history = payload.payload.repairHistory ?? [];
  assert.deepEqual(history, [], 'a cancellation is not a failed repair and must not be recorded as one');
  await h.app.close(); h.store.close();
});

test('15 — a later attempt still succeeds after an earlier one was rejected', async () => {
  // The whole point: history must narrow the model away from what failed, without
  // making a correct repair unreachable.
  let root = '';
  let repairs = 0;
  const model = async (i: unknown): Promise<unknown> => {
    const b = i as Record<string, unknown>;
    if ('candidatePaths' in b) {
      return {
        issueSummary: 'Exclude cancelled lines.',
        scope: REQUIRED_FILES.map((p) => ({ path: p, rationale: 'participates' })),
        excluded: [{ path: TRAP_FILE, reason: 'formats only' }],
        edits: editsFor(root, 'cancelledCount'),
      };
    }
    if ('failureEvidence' in b) {
      repairs += 1;
      const ids = [...String(b.failureEvidence ?? '').matchAll(/\b(F-\d+)\b/g)].map((m) => m[1]!);
      // First repair is malformed and rejected; the second is correct.
      if (repairs === 1) return { rationale: '', edits: [] };
      return { rationale: 'use the name the tests expect', observedFailureEvidenceIds: ids.slice(0, 3), edits: editsFor(root, 'excludedLineCount') };
    }
    return { rationale: 'initial', edits: editsFor(root, 'cancelledCount') };
  };
  const h = harness(model, 3);
  root = h.root;
  const runId = await approvedRun(h);
  const body = (await h.app.inject({ method: 'GET', url: `/api/ai/coding/runs/${runId}` })).json<{
    state: string; finalReport?: { complete: boolean; stopReason: string };
  }>();
  assert.ok(repairs >= 1, 'the repair path must have been entered');
  assert.equal(body.finalReport?.complete, true, `run did not complete: ${body.finalReport?.stopReason}`);
  assert.equal(body.state, 'COMPLETED');
  await h.app.close(); h.store.close();
});

// ── the dependency guard, which is what caught the hallucinated framework ─────

test('16 — a repair may not introduce a package the repository never uses', () => {
  assert.deepEqual(importedModules('import express from "express";\n').sort(), ['express']);
  assert.deepEqual(importedModules('const r = require("express");\n'), ['express']);
  assert.deepEqual(importedModules('import { a } from "./local.js";\nimport fs from "node:fs";\n'), [],
    'relative and node: specifiers introduce no dependency');
  assert.deepEqual(importedModules('import x from "@scope/pkg/deep";\n'), ['@scope/pkg'], 'scoped packages keep their scope');
});

void writeFileSync;
void execFileSync;
void chmodSync;

// ── 17. the two verdicts are reported separately ─────────────────────────────

test('17 — a mismatched quotation is reported apart from evidence-ID authority', async () => {
  // These answer different questions. Collapsing them would let "the model quoted
  // sloppily" read as "the authority behind this repair is in doubt" — or, worse,
  // let a verified-authority repair look as though its quotation had been checked.
  const root = fixture();
  const { record, blocks } = await realEvidence(root);
  const cited = blocks[0]!;
  const FABRICATED = 'not ok 9 - the database connection was refused';

  const a = await author(root, () => ({
    rationale: 'rename the field the route returns',
    edits: [EDIT(SERVICE)],
    observedFailureEvidenceIds: [cited.evidenceId],
    quotedEvidence: [{ evidenceId: cited.evidenceId, text: FABRICATED }],
  }));
  const r = await a.propose(input(blocks, record));

  assert.ok(r.ok, r.ok ? '' : `${(r as { rejection?: string }).rejection}`);
  assert.equal(r.evidenceIdVerified, true, 'the cited id was current, this run’s, and hashed true');
  assert.equal(r.quotationMatched, false, 'the quotation did not appear in the block it named');

  // The failed quotation must never be carried anywhere it could be read as source.
  assert.equal(JSON.stringify(r).includes(FABRICATED), false, 'the mismatched quotation was retained');
  assert.ok((r.concerns ?? []).some((c) => c.includes(cited.evidenceId)), 'the concern names the id, not the text');

  // And a proposal with no quotation makes no claim about one either way.
  const b = await author(root, () => ({
    rationale: 'rename the field the route returns',
    edits: [EDIT(SERVICE)],
    observedFailureEvidenceIds: [cited.evidenceId],
  }));
  const plain = await b.propose(input(blocks, record));
  assert.ok(plain.ok);
  assert.equal(plain.evidenceIdVerified, true);
  assert.equal(plain.quotationMatched, undefined, 'no quotation offered, so no verdict is invented');
});
