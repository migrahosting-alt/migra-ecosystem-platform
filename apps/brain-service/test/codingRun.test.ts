// Evidence-governed multi-file coding: the 20 acceptance cases.
//
// These drive the REAL apply engine (`applyChangeset`, with its readback
// verification and all-or-nothing rollback) and the REAL command runner against
// the real fixture repository. Nothing about mutation or validation is simulated,
// because the property under test is precisely that authority, effect and report
// agree — and a mock would let all three agree about nothing. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { nodeChangesetFs } from '../src/tools/changesetFs.js';
import { ChangesetProposalStore } from '../src/tools/changeset.js';
import { approveEditScope, isWorkspaceRelativeContained, proposeEditScope, ScopedEditLedger, SCOPE_TTL_MS } from '../src/engine/coding/editScope.js';
import { governedApply, changesetPaths } from '../src/engine/coding/governedApply.js';
import { runValidation, observedFailure, type DeclaredValidation } from '../src/engine/coding/validationRun.js';
import { runCodingTask, reconcile, citesObservedEvidence, renderCodingReport, type RepairProposal } from '../src/engine/coding/codingRun.js';
import { parseProposal } from '../src/engine/coding/modelProposals.js';
import { parsePlannerOutput } from '../src/engine/coding/codingPlanner.js';
import { createFixtureRepo, runFixtureTests, REQUIRED_FILES, TRAP_FILE, ISSUE } from './fixtures/multifileCodingFixture.js';

const SRC = (p: string) => ({ path: p, startLine: 1, endLine: 9, excerptHash: 'a1b2c3d4e5f60718' });
const CONTRACT = REQUIRED_FILES[0];
const SERVICE = REQUIRED_FILES[1];
const ROUTE = REQUIRED_FILES[2];

/**
 * Clean THIS process's environment before any validation child is spawned.
 *
 * `command.run` builds a child env from `{ ...process.env, ... }` and cannot unset
 * a key, and `node --test` skips its run whenever `NODE_TEST_CONTEXT` is PRESENT —
 * empty or not. So a validation spawned from inside this test file would report a
 * failing suite as exit 0. Deleting it from the parent is the only lever that
 * works, and getting this wrong would silently invalidate every acceptance result
 * below.
 *
 * (`execFileSync` in the fixture harness REPLACES the environment rather than
 * merging it, which is why deleting from a copy is sufficient there and not here.)
 */
async function withoutTestContext<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try {
    return await fn();
  } finally {
    // Restored immediately: removing it for the whole file leaves the OUTER
    // runner reporting this suite as one opaque test.
    if (saved !== undefined) process.env.NODE_TEST_CONTEXT = saved;
  }
}

function childEnv(): NodeJS.ProcessEnv {
  return process.env;
}

const VALIDATIONS = {
  baseline: { id: 'tests', command: ['node', '--test', '--test-reporter=tap', 'test/orderTotals.test.js'] } as DeclaredValidation,
  final: { id: 'tests', command: ['node', '--test', '--test-reporter=tap', 'test/orderTotals.test.js'] } as DeclaredValidation,
};

function scopeFor(paths: readonly string[] = REQUIRED_FILES) {
  return approveEditScope(
    proposeEditScope({
      runId: 'run_accept',
      rationale: ISSUE.split('\n')[0]!,
      files: paths.map((p) => ({ path: p, reason: 'participates in the order total', sources: [SRC(p)] })),
    }),
  );
}

const FIXED_CONTRACT = 'export const ORDER_TOTAL_FIELDS = ["subtotalCents", "totalCents", "excludedLineCount"];\n';
const FIXED_SERVICE = [
  'export function computeOrderTotal(lines) {',
  '  const active = lines.filter((l) => l.status !== "cancelled");',
  '  const subtotalCents = active.reduce((sum, line) => sum + line.amountCents, 0);',
  '  return { subtotalCents, totalCents: subtotalCents, excludedLineCount: lines.length - active.length };',
  '}',
  '',
].join('\n');
const FIXED_ROUTE = [
  'import { computeOrderTotal } from "../services/orderTotalsService.js";',
  '',
  'export function orderTotalsRoute(body) {',
  '  const total = computeOrderTotal(body.lines);',
  '  return { subtotalCents: total.subtotalCents, totalCents: total.totalCents, excludedLineCount: total.excludedLineCount };',
  '}',
  '',
].join('\n');

function replaceOps(root: string, files: Record<string, string>) {
  return {
    rootPath: root,
    ops: Object.entries(files).map(([p, content]) => ({ op: 'replace' as const, path: p, content })),
  };
}

function gitDiffPaths(root: string): string[] {
  const out = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function deps(root: string, scope: ReturnType<typeof scopeFor>) {
  const ledger = new ScopedEditLedger(scope, scope.approvalToken);
  return { ledger, applyDeps: { fs: nodeChangesetFs(), store: new ChangesetProposalStore() } };
}

// ── 1-4. The governed apply gate ───────────────────────────────────────────────

test('1 — a correct three-file changeset applies and the suite passes', async () => {
  const root = createFixtureRepo();
  const scope = scopeFor();
  const d = deps(root, scope);
  const result = await governedApply(
    replaceOps(root, { [CONTRACT]: FIXED_CONTRACT, [SERVICE]: FIXED_SERVICE, [ROUTE]: FIXED_ROUTE }),
    { ...d.applyDeps, scope, approvalToken: scope.approvalToken, ledger: d.ledger },
  );
  assert.equal(result.ok, true, result.ok ? '' : result.message);
  assert.deepEqual(d.ledger.applied.sort(), [...REQUIRED_FILES].sort());
  const run = runFixtureTests(root);
  assert.equal(run.exitCode, 0, run.output.slice(0, 400));
});

test('2 — a one-file changeset applies but cannot reconcile as complete', async () => {
  const root = createFixtureRepo();
  const scope = scopeFor();
  const d = deps(root, scope);
  await governedApply(replaceOps(root, { [SERVICE]: FIXED_SERVICE }), { ...d.applyDeps, scope, approvalToken: scope.approvalToken, ledger: d.ledger });
  const run = runFixtureTests(root);
  assert.notEqual(run.exitCode, 0, 'the suite still fails');

  const rec = reconcile({ scope, ledger: d.ledger, diffPaths: gitDiffPaths(root), rollbacks: [], requiredPaths: REQUIRED_FILES });
  assert.equal(rec.consistent, false);
  assert.deepEqual(rec.unusedScope.sort(), [CONTRACT, ROUTE].sort());
  assert.ok(rec.blockers.some((b) => b.includes(CONTRACT) && /required/.test(b)));
});

test('3 — one out-of-scope path rejects the WHOLE changeset, before any write', async () => {
  const root = createFixtureRepo();
  const scope = scopeFor();
  const d = deps(root, scope);
  const before = fs.readFileSync(path.join(root, SERVICE), 'utf8');

  const result = await governedApply(
    replaceOps(root, { [CONTRACT]: FIXED_CONTRACT, [SERVICE]: FIXED_SERVICE, [TRAP_FILE]: '// hijacked\n' }),
    { ...d.applyDeps, scope, approvalToken: scope.approvalToken, ledger: d.ledger },
  );
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.refusal === 'scope-violation');
  assert.ok(!result.ok && result.offendingPaths.includes(TRAP_FILE));
  assert.equal(result.mutated, false);

  // Nothing was written — not even the two authorised files.
  assert.equal(fs.readFileSync(path.join(root, SERVICE), 'utf8'), before, 'the in-scope subset was NOT partially applied');
  assert.deepEqual(gitDiffPaths(root), []);
  assert.equal(d.ledger.applied.length, 0);
  assert.equal(d.ledger.refused.length, 1, 'the attempt is recorded, not discarded');
});

test('4 — traversal and absolute paths never reach applyChangeset', async () => {
  const root = createFixtureRepo();
  const scope = scopeFor();
  const d = deps(root, scope);
  for (const evil of ['../escape.js', '/etc/passwd', 'src/../../escape.js']) {
    const result = await governedApply(replaceOps(root, { [evil]: 'x' }), {
      ...d.applyDeps,
      scope,
      approvalToken: scope.approvalToken,
      ledger: d.ledger,
    });
    assert.equal(result.ok, false, `${evil} must be refused`);
    assert.equal(result.mutated, false);
  }
  assert.deepEqual(gitDiffPaths(root), []);
  assert.ok(!fs.existsSync(path.join(path.dirname(root), 'escape.js')));
});

// ── 5-7. Authority preconditions ───────────────────────────────────────────────

test('5 — an expired approval blocks writes', async () => {
  const root = createFixtureRepo();
  const t0 = 1_000_000;
  const scope = approveEditScope(proposeEditScope({ runId: 'r', rationale: 'x', files: [{ path: SERVICE, reason: 'r', sources: [SRC(SERVICE)] }] }, t0), t0);
  const d = deps(root, scope);
  const result = await governedApply(replaceOps(root, { [SERVICE]: FIXED_SERVICE }), {
    ...d.applyDeps, scope, approvalToken: scope.approvalToken, ledger: d.ledger, now: () => t0 + SCOPE_TTL_MS,
  });
  assert.ok(!result.ok && result.refusal === 'scope-expired');
  assert.deepEqual(gitDiffPaths(root), []);
});

test('6 — a path-set hash mismatch blocks writes', async () => {
  const root = createFixtureRepo();
  const scope = scopeFor();
  const widened = approveEditScope(proposeEditScope({
    runId: 'r', rationale: 'x',
    files: [...REQUIRED_FILES, TRAP_FILE].map((p) => ({ path: p, reason: 'r', sources: [SRC(p)] })),
  }));
  const d = deps(root, widened);
  // The OLD token against the WIDENED scope: same shape, different path set.
  const result = await governedApply(replaceOps(root, { [SERVICE]: FIXED_SERVICE }), {
    ...d.applyDeps, scope: widened, approvalToken: scope.approvalToken, ledger: d.ledger,
  });
  assert.ok(!result.ok && result.refusal === 'approval-mismatch');
  assert.deepEqual(gitDiffPaths(root), []);
});

test('7 — a scope entry stripped of its evidence blocks writes', async () => {
  const root = createFixtureRepo();
  const scope = scopeFor();
  // Simulate provenance being lost between approval and apply.
  const stripped = { ...scope, files: scope.files.map((f) => (f.path === SERVICE ? { ...f, sources: [] } : f)) };
  const d = deps(root, stripped);
  const result = await governedApply(replaceOps(root, { [SERVICE]: FIXED_SERVICE }), {
    ...d.applyDeps, scope: stripped, approvalToken: scope.approvalToken, ledger: d.ledger,
  });
  assert.ok(!result.ok && result.refusal === 'evidence-missing');
  assert.deepEqual(gitDiffPaths(root), []);
});

// ── 8. Rollback is preserved, not reimplemented ────────────────────────────────

test('8 — a failed write is reported, never silently swallowed, and blocks completion', async () => {
  const root = createFixtureRepo();
  const scope = scopeFor();
  const ledger = new ScopedEditLedger(scope, scope.approvalToken);
  // Fault injection is env-gated in the adapter, deliberately: a test-only hook
  // taking an argument could be reached from production code. The injector makes
  // the 2nd write ONWARD throw, so the engine's own rollback writes fail too —
  // which is the harshest case, INCONSISTENT_STATE.
  process.env.MIGRAPILOT_TEST_FAULT_INJECT_WRITE = '2';
  const faultyFs = nodeChangesetFs();
  delete process.env.MIGRAPILOT_TEST_FAULT_INJECT_WRITE;

  const result = await governedApply(
    replaceOps(root, { [CONTRACT]: FIXED_CONTRACT, [SERVICE]: FIXED_SERVICE, [ROUTE]: FIXED_ROUTE }),
    { fs: faultyFs, store: new ChangesetProposalStore(), scope, approvalToken: scope.approvalToken, ledger },
  );

  // The engine's failure is a RESULT, not an escaped exception: a thrown error
  // would crash the run instead of reporting that the tree may be partial.
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.refusal === 'apply-failed');
  assert.ok(!result.ok && result.engineCode === 'INCONSISTENT_STATE');
  assert.ok(!result.ok && result.mutated === 'partial', 'a possible partial state is declared, not hidden');

  // And an unresolved partial state must block completion.
  const rec = reconcile({ scope, ledger, diffPaths: gitDiffPaths(root), rollbacks: [CONTRACT] });
  assert.equal(rec.consistent, false);
  assert.ok(rec.blockers.some((b) => /unresolved rollback/.test(b)), JSON.stringify(rec.blockers));
});

test('8b — a clean apply reports no rollback and leaves the tree consistent', async () => {
  const root = createFixtureRepo();
  const scope = scopeFor();
  const d = deps(root, scope);
  const result = await governedApply(replaceOps(root, { [SERVICE]: FIXED_SERVICE }), {
    ...d.applyDeps, scope, approvalToken: scope.approvalToken, ledger: d.ledger,
  });
  assert.equal(result.ok, true);
  assert.ok(result.ok && result.result.rolledBack === false);
  assert.deepEqual(gitDiffPaths(root), [SERVICE]);
});

// ── 9-12. The repair loop ──────────────────────────────────────────────────────

const OBSERVED = ['not ok 1 - cancelled lines are excluded from the total', '1750 !== 1250'];

test('9 — failing validation triggers a repair iteration', async () => {
  const root = createFixtureRepo();
  const scope = scopeFor();
  const d = deps(root, scope);
  let asked = 0;
  const report = await withoutTestContext(() => runCodingTask({
    runId: 'r9', rootPath: root, scope, approvalToken: scope.approvalToken, validations: VALIDATIONS,
    initialChangeset: replaceOps(root, { [SERVICE]: FIXED_SERVICE }),
    repairAuthor: async ({ failureLines }) => {
      asked += 1;
      return {
        rationale: 'the contract and route must carry the excluded count',
        citedFailureLines: failureLines.slice(0, 1),
        changeset: replaceOps(root, { [CONTRACT]: FIXED_CONTRACT, [ROUTE]: FIXED_ROUTE }),
      } satisfies RepairProposal;
    },
    maxRepairAttempts: 2, requiredPaths: REQUIRED_FILES, applyDeps: d.applyDeps, gitDiffPaths, env: childEnv(),
  }));
  assert.ok(asked >= 1, 'a repair was requested from the observed failure');
  assert.equal(report.repairs.length >= 1, true);
  assert.equal(report.complete, true, renderCodingReport(report));
  assert.equal(report.stopReason, 'validated');
});

test('10 — the repair author is given the REAL observed failure output', async () => {
  const root = createFixtureRepo();
  const rec = await withoutTestContext(() => runValidation(VALIDATIONS.baseline, 'baseline', { rootPath: root, env: childEnv() }));
  assert.equal(rec.passed, false);
  const observed = observedFailure(rec);
  assert.match(observed.summary, /exit 1/);
  assert.ok(observed.lines.some((l) => /1750 !== 1250|not ok/.test(l)), JSON.stringify(observed.lines.slice(0, 5)));
});

test('10b — a repair citing evidence the run never observed is refused', () => {
  assert.equal(citesObservedEvidence({ rationale: 'x', citedFailureLines: ['ECONNREFUSED to redis'], changeset: { rootPath: '/r', ops: [] } }, OBSERVED), false);
  assert.equal(citesObservedEvidence({ rationale: 'x', citedFailureLines: ['1750 !== 1250'], changeset: { rootPath: '/r', ops: [] } }, OBSERVED), true);
  assert.equal(citesObservedEvidence({ rationale: 'x', citedFailureLines: [], changeset: { rootPath: '/r', ops: [] } }, OBSERVED), false);
});

test('11 — a repair cannot add a file outside the approved scope', async () => {
  const root = createFixtureRepo();
  const scope = scopeFor([CONTRACT, SERVICE]); // ROUTE deliberately unapproved
  const d = deps(root, scope);
  const report = await withoutTestContext(() => runCodingTask({
    runId: 'r11', rootPath: root, scope, approvalToken: scope.approvalToken, validations: VALIDATIONS,
    initialChangeset: replaceOps(root, { [SERVICE]: FIXED_SERVICE }),
    repairAuthor: async ({ failureLines }) => ({
      rationale: 'reach for the route as well',
      citedFailureLines: failureLines.slice(0, 1),
      changeset: replaceOps(root, { [CONTRACT]: FIXED_CONTRACT, [ROUTE]: FIXED_ROUTE }),
    }),
    maxRepairAttempts: 1, applyDeps: d.applyDeps, gitDiffPaths, env: childEnv(),
  }));
  const attempt = report.repairs[0]!;
  assert.equal(attempt.apply.ok, false);
  assert.ok(!attempt.apply.ok && attempt.apply.refusal === 'scope-violation');
  assert.ok(!gitDiffPaths(root).includes(ROUTE), 'the unapproved file was never written');
  assert.equal(report.complete, false);
});

test('12 — the repair ceiling produces an INCOMPLETE result, never a success', async () => {
  const root = createFixtureRepo();
  const scope = scopeFor();
  const d = deps(root, scope);
  const report = await withoutTestContext(() => runCodingTask({
    runId: 'r12', rootPath: root, scope, approvalToken: scope.approvalToken, validations: VALIDATIONS,
    initialChangeset: replaceOps(root, { [SERVICE]: FIXED_SERVICE }),
    // A repair that never actually fixes anything.
    repairAuthor: async ({ failureLines }) => ({
      rationale: 'no-op', citedFailureLines: failureLines.slice(0, 1),
      changeset: replaceOps(root, { [SERVICE]: FIXED_SERVICE }),
    }),
    maxRepairAttempts: 2, requiredPaths: REQUIRED_FILES, applyDeps: d.applyDeps, gitDiffPaths, env: childEnv(),
  }));
  assert.equal(report.complete, false);
  assert.equal(report.stopReason, 'repair-ceiling-exhausted');
  assert.equal(report.repairs.length, 2, 'the ceiling held');
  assert.ok(report.unresolvedRisks.some((r) => /still failing/.test(r)));
});

// ── 13-16. Reconciliation and reporting ────────────────────────────────────────

test('13 — the diff and the ledger must reconcile exactly', async () => {
  const root = createFixtureRepo();
  const scope = scopeFor();
  const d = deps(root, scope);
  await governedApply(replaceOps(root, { [CONTRACT]: FIXED_CONTRACT, [SERVICE]: FIXED_SERVICE, [ROUTE]: FIXED_ROUTE }), {
    ...d.applyDeps, scope, approvalToken: scope.approvalToken, ledger: d.ledger,
  });
  const good = reconcile({ scope, ledger: d.ledger, diffPaths: gitDiffPaths(root), rollbacks: [],
    finalValidation: await withoutTestContext(() => runValidation(VALIDATIONS.final, 'final', { rootPath: root, env: childEnv() })), requiredPaths: REQUIRED_FILES });
  assert.deepEqual(good.blockers, []);
  assert.equal(good.consistent, true);

  // An unrecorded write in the tree is a blocker, however benign it looks.
  fs.writeFileSync(path.join(root, TRAP_FILE), '// touched outside the governed path\n');
  const bad = reconcile({ scope, ledger: d.ledger, diffPaths: gitDiffPaths(root), rollbacks: [], requiredPaths: REQUIRED_FILES });
  assert.equal(bad.consistent, false);
  assert.ok(bad.blockers.some((b) => b.includes(TRAP_FILE) && /outside the approved scope/.test(b)));
});

test('14 — refused edits appear in the final report', async () => {
  const root = createFixtureRepo();
  const scope = scopeFor([CONTRACT, SERVICE]);
  const d = deps(root, scope);
  const report = await withoutTestContext(() => runCodingTask({
    runId: 'r14', rootPath: root, scope, approvalToken: scope.approvalToken, validations: VALIDATIONS,
    initialChangeset: replaceOps(root, { [SERVICE]: FIXED_SERVICE, [TRAP_FILE]: '// no\n' }),
    repairAuthor: async () => null, maxRepairAttempts: 0, applyDeps: d.applyDeps, gitDiffPaths, env: childEnv(),
  }));
  assert.equal(report.stopReason, 'apply-refused');
  assert.ok(report.reconciliation.refused.includes(TRAP_FILE));
  const text = renderCodingReport(report);
  assert.match(text, /Refused \(outside authority\)/);
  assert.match(text, new RegExp(TRAP_FILE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(text, /⛔ incomplete/);
});

test('15 — unusedScope appears when an approved file was never written', async () => {
  const root = createFixtureRepo();
  const scope = scopeFor();
  const d = deps(root, scope);
  await governedApply(replaceOps(root, { [SERVICE]: FIXED_SERVICE }), { ...d.applyDeps, scope, approvalToken: scope.approvalToken, ledger: d.ledger });
  const rec = reconcile({ scope, ledger: d.ledger, diffPaths: gitDiffPaths(root), rollbacks: [] });
  assert.deepEqual(rec.unusedScope.sort(), [CONTRACT, ROUTE].sort());
});

test('16 — success requires a real exit code 0', async () => {
  const root = createFixtureRepo();
  const scope = scopeFor();
  const d = deps(root, scope);
  const failing = await withoutTestContext(() => runValidation(VALIDATIONS.final, 'final', { rootPath: root, env: childEnv() }));
  assert.equal(failing.passed, false);
  assert.equal(failing.exitCode, 1);

  const rec = reconcile({ scope, ledger: d.ledger, diffPaths: [], rollbacks: [], finalValidation: failing });
  assert.ok(rec.blockers.some((b) => /final validation exited 1/.test(b)));

  // A refused command is not a pass either, and is never reported as one.
  const refused = await withoutTestContext(() => runValidation({ id: 'x', command: ['rm', '-rf', '/'] }, 'final', { rootPath: root, env: childEnv() }));
  assert.equal(refused.admitted, false);
  assert.equal(refused.passed, false);
  assert.equal(refused.exitCode, null);
});

// ── 17-18. Cancellation and restart ────────────────────────────────────────────

test('17 — cancellation stays truthful and never claims completion', async () => {
  const root = createFixtureRepo();
  const scope = scopeFor();
  const d = deps(root, scope);
  const ac = new AbortController();
  ac.abort();
  const report = await withoutTestContext(() => runCodingTask({
    runId: 'r17', rootPath: root, scope, approvalToken: scope.approvalToken, validations: VALIDATIONS,
    initialChangeset: replaceOps(root, { [SERVICE]: FIXED_SERVICE }),
    repairAuthor: async () => null, maxRepairAttempts: 1, applyDeps: d.applyDeps, gitDiffPaths,
    env: childEnv(), signal: ac.signal,
  }));
  assert.equal(report.complete, false);
  assert.equal(report.stopReason, 'cancelled');
  assert.match(renderCodingReport(report), /⛔ incomplete \(cancelled\)/);
});

test('18 — an incomplete run reports incomplete from persisted evidence, not memory', async () => {
  const root = createFixtureRepo();
  const scope = scopeFor();
  const d = deps(root, scope);
  // A partial change lands, then the process "restarts": a fresh reconciliation
  // over the tree and ledger must still conclude incomplete.
  await governedApply(replaceOps(root, { [SERVICE]: FIXED_SERVICE }), { ...d.applyDeps, scope, approvalToken: scope.approvalToken, ledger: d.ledger });
  const afterRestart = reconcile({
    scope, ledger: d.ledger, diffPaths: gitDiffPaths(root), rollbacks: [],
    finalValidation: await withoutTestContext(() => runValidation(VALIDATIONS.final, 'final', { rootPath: root, env: childEnv() })),
    requiredPaths: REQUIRED_FILES,
  });
  assert.equal(afterRestart.consistent, false, 'no manufactured success after restart');
  assert.ok(afterRestart.blockers.some((b) => /required by the task contract/.test(b)));
  assert.deepEqual(afterRestart.written, [SERVICE]);
  assert.deepEqual(afterRestart.diffPaths, [SERVICE]);
});

test('an absolute or escaping model path is REFUSED, never normalised into a relative one', () => {
  // Copilot review, PR #143. `normalizePath` strips a leading slash, so
  // normalising before validating turns `/src/x.js` into the innocent-looking
  // `src/x.js` and admits it. That hides the attempt instead of refusing it, and
  // it was inconsistent with editScope, which already validated the RAW path.
  for (const bad of ['/src/x.js', '/etc/passwd', '../outside.js', 'src/../../outside.js', 'C:\\Windows\\x.js']) {
    assert.equal(isWorkspaceRelativeContained(bad), false, `${bad} must be refused`);
    assert.equal(
      parseProposal({ rationale: 'r', edits: [{ path: bad, content: 'x' }] }),
      null,
      `parseProposal must refuse ${bad} rather than rewrite it`,
    );
    assert.equal(
      parsePlannerOutput({ issueSummary: 's', scope: [{ path: bad, rationale: 'r' }], edits: [{ path: 'src/ok.js', content: 'x' }] }),
      null,
      `parsePlannerOutput must refuse ${bad} rather than rewrite it`,
    );
  }
  // A legitimate relative path still parses.
  assert.ok(parseProposal({ rationale: 'r', edits: [{ path: 'src/ok.js', content: 'x' }] }));
  assert.equal(isWorkspaceRelativeContained('src/ok.js'), true);
});

test('cancellation before any write is not reported as a scope violation', async () => {
  // Copilot review, PR #143. The fabricated `scope-violation` told an operator an
  // out-of-scope write had been attempted when nothing had been written at all.
  const root = createFixtureRepo();
  const scope = scopeFor();
  const d = deps(root, scope);
  const controller = new AbortController();
  controller.abort();
  const report = await withoutTestContext(() => runCodingTask({
    runId: 'r_cancel', rootPath: root, scope, approvalToken: scope.approvalToken, validations: VALIDATIONS,
    initialChangeset: replaceOps(root, { [SERVICE]: FIXED_SERVICE }),
    repairAuthor: async () => null,
    maxRepairAttempts: 1, applyDeps: d.applyDeps, gitDiffPaths, env: childEnv(),
    signal: controller.signal,
  }));
  assert.equal(report.stopReason, 'cancelled');
  assert.equal(report.initialApply.ok, false);
  assert.equal(report.initialApply.ok === false && report.initialApply.refusal, 'cancelled-before-apply');
  assert.notEqual(report.initialApply.ok === false && report.initialApply.refusal, 'scope-violation');
  assert.match(report.initialApply.ok === false ? report.initialApply.message : '', /cancelled/i);
});
