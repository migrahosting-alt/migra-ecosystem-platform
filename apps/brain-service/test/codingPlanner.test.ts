// The evidence-driven coding planner.
//
// These tests use a SCRIPTED model. They prove the planner CONTRACT and its
// governance — that a file nobody read cannot enter a scope, that every retrieved
// candidate is accounted for, that the validation command cannot be model-authored,
// and that malformed output is refused rather than repaired. They prove nothing
// whatsoever about model competence, and are not evidence that autonomous planning
// works; that requires a live model run, recorded separately. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { planCodingTask, parsePlannerOutput, DEFAULT_PLANNING_LIMITS, type PlannerModel, type PlannerModelInput } from '../src/engine/coding/codingPlanner.js';
import { proposeEditScope, approveEditScope } from '../src/engine/coding/editScope.js';
import { makeSpanSource } from '../src/engine/planning/workspaceSpanSource.js';
import { clearRepoMapCache } from '../src/engine/planning/repoMap.js';
import { createFixtureRepo, ISSUE, REQUIRED_FILES, TRAP_FILE } from './fixtures/multifileCodingFixture.js';

const [CONTRACT, SERVICE, ROUTE] = REQUIRED_FILES;
const VALIDATION = { id: 'tests', command: ['node', '--test', '--test-reporter=tap', 'test/orderTotals.test.js'] };

const EDITS = {
  [CONTRACT]: 'export const ORDER_TOTAL_FIELDS = ["subtotalCents", "totalCents", "excludedLineCount"];\n',
  [SERVICE]: 'export function computeOrderTotal(lines) { return {}; }\n',
  [ROUTE]: 'export function orderTotalsRoute(body) { return {}; }\n',
};

/** A scripted planner that picks the three real files and names the trap. */
const goodModel: PlannerModel = async (input: PlannerModelInput) => ({
  issueSummary: 'Exclude cancelled lines and report the excluded count.',
  scope: REQUIRED_FILES.filter((p) => input.candidatePaths.includes(p)).map((path) => ({ path, rationale: `evidence shows ${path} participates in the total` })),
  excluded: [{ path: TRAP_FILE, reason: 'presentation only; performs no arithmetic on line items' }],
  edits: REQUIRED_FILES.filter((p) => input.candidatePaths.includes(p)).map((path) => ({ path, content: EDITS[path]! })),
});

async function plan(model: PlannerModel, overrides: Partial<Parameters<typeof planCodingTask>[0]> = {}) {
  clearRepoMapCache();
  const root = (overrides.rootPath as string) ?? createFixtureRepo();
  return {
    root,
    result: await planCodingTask({
      issue: ISSUE,
      rootPath: root,
      validationCommand: VALIDATION,
      model,
      openSpan: (rel, s, e) => makeSpanSource(root, rel, s, e),
      ...overrides,
    }),
  };
}

// ── 1-4. Selection and provenance ──────────────────────────────────────────────

test('1 — the planner selects the contract, implementation and route files', async () => {
  const { result } = await plan(goodModel);
  assert.ok(result.ok, result.ok ? '' : `${result.reason}: ${result.message}`);
  assert.deepEqual(result.plan.proposedScope.map((s) => s.path).sort(), [...REQUIRED_FILES].sort());
});

test('2 — the trap file is EXPLICITLY excluded, with a reason', async () => {
  const { result } = await plan(goodModel);
  assert.ok(result.ok);
  const excluded = result.plan.excludedCandidates.find((e) => e.path === TRAP_FILE);
  assert.ok(excluded, `the trap must be accounted for, got ${JSON.stringify(result.plan.excludedCandidates.map((e) => e.path))}`);
  assert.match(excluded!.reason, /presentation only/);
  assert.ok(!result.plan.proposedScope.some((s) => s.path === TRAP_FILE));
});

test('2b — exclusions are COMPUTED, so a silently dropped candidate cannot vanish', async () => {
  // This model proposes the three files and offers NO exclusions at all.
  const silent: PlannerModel = async (input) => ({
    issueSummary: 'x',
    scope: REQUIRED_FILES.filter((p) => input.candidatePaths.includes(p)).map((path) => ({ path, rationale: 'r' })),
    excluded: [],
    edits: REQUIRED_FILES.filter((p) => input.candidatePaths.includes(p)).map((path) => ({ path, content: EDITS[path]! })),
  });
  const { result } = await plan(silent);
  assert.ok(result.ok);
  const opened = result.ledger.readPaths;
  const accounted = new Set([...result.plan.proposedScope.map((s) => s.path), ...result.plan.excludedCandidates.map((e) => e.path)]);
  for (const path of opened) assert.ok(accounted.has(path), `${path} was opened and must be accounted for`);
  const trap = result.plan.excludedCandidates.find((e) => e.path === TRAP_FILE);
  if (opened.includes(TRAP_FILE)) assert.match(trap!.reason, /not proposed for change/);
});

test('3 — every scoped file carries real source evidence', async () => {
  const { result } = await plan(goodModel);
  assert.ok(result.ok);
  for (const entry of result.plan.proposedScope) {
    assert.ok(entry.sources.length > 0, `${entry.path} must cite evidence`);
    for (const s of entry.sources) {
      assert.equal(s.path, entry.path);
      assert.equal(s.excerptHash.length, 16);
      assert.ok(s.startLine >= 1 && s.endLine >= s.startLine);
      // The hash must match a span the run really holds.
      assert.ok(result.ledger.spansFor(entry.path).some((sp) => sp.excerptHash === s.excerptHash));
    }
  }
});

test('4 — a path the run never retrieved cannot enter the scope', async () => {
  const inventing: PlannerModel = async (input) => ({
    issueSummary: 'x',
    scope: [{ path: 'src/services/imaginedTotals.js', rationale: 'sounds right' }],
    excluded: [],
    edits: [{ path: 'src/services/imaginedTotals.js', content: '// nope\n' }],
    ...input,
  });
  const { result } = await plan(inventing);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === 'unsupported-path');
  assert.ok(!result.ok && /never retrieved/.test(result.message));
});

// ── 5-6. Refusal and ceilings ──────────────────────────────────────────────────

test('5 — insufficient evidence produces a refusal, not a guess', async () => {
  let asked = false;
  const { result } = await plan(async () => {
    asked = true;
    return {};
  }, { limits: { minEvidenceFiles: 99 } });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === 'insufficient-evidence');
  assert.equal(asked, false, 'the model is never consulted when evidence is too thin');
  assert.ok(!result.ok && result.openedPaths.length > 0, 'the refusal still says what WAS retrieved');
});

test('5b — an issue matching nothing refuses rather than planning blind', async () => {
  const { result } = await plan(goodModel, { issue: 'zzqqxx nothing in this repository resembles this' });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && ['no-candidates', 'insufficient-evidence'].includes(result.reason));
});

test('6 — the scope stays inside the configured ceilings', async () => {
  const greedy: PlannerModel = async (input) => ({
    issueSummary: 'x',
    scope: input.candidatePaths.map((path) => ({ path, rationale: 'everything looks relevant' })),
    excluded: [],
    edits: input.candidatePaths.map((path) => ({ path, content: '// x\n' })),
  });
  const { result } = await plan(greedy, { limits: { maxScopeFiles: 2 } });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === 'scope-too-large');

  // And the opened-evidence ceiling is honoured too.
  const { result: ok } = await plan(goodModel, { limits: { maxCandidatesOpened: 4 } });
  assert.ok(ok.ok);
  assert.ok(ok.ledger.readPaths.length <= 4, `opened ${ok.ledger.readPaths.length}`);
});

// ── 7-9. Changeset and command integrity ───────────────────────────────────────

test('7 — the initial changeset touches only proposed-scope paths', async () => {
  const { result } = await plan(goodModel);
  assert.ok(result.ok);
  const scoped = new Set(result.plan.proposedScope.map((s) => s.path));
  for (const op of result.plan.initialChangeset.ops) assert.ok(scoped.has(op.path), `${op.path} must be in scope`);

  const stray: PlannerModel = async (input) => ({
    issueSummary: 'x',
    scope: [{ path: SERVICE, rationale: 'r' }],
    excluded: [],
    edits: [{ path: SERVICE, content: '// a\n' }, { path: TRAP_FILE, content: '// sneaky\n' }],
    ...input,
  });
  const { result: bad } = await plan(stray);
  assert.equal(bad.ok, false);
  assert.ok(!bad.ok && bad.reason === 'changeset-outside-scope');
  assert.ok(!bad.ok && bad.message.includes(TRAP_FILE));
});

test('8 — the validation command comes from the contract, not the model', async () => {
  const hijacker: PlannerModel = async (input) => ({
    issueSummary: 'x',
    scope: [{ path: SERVICE, rationale: 'r' }],
    excluded: [],
    edits: [{ path: SERVICE, content: '// a\n' }],
    // A model that could choose its own check could choose one that always passes.
    validationCommand: { id: 'always-green', command: ['node', '-e', 'process.exit(0)'] },
    ...input,
  });
  const { result } = await plan(hijacker);
  assert.ok(result.ok);
  assert.deepEqual(result.plan.validationCommand.command, VALIDATION.command);
  assert.equal(result.plan.validationCommand.id, 'tests');

  // And it is a copy: mutating the plan cannot reach back into the contract.
  result.plan.validationCommand.command.push('--ignore-everything');
  assert.deepEqual(VALIDATION.command, ['node', '--test', '--test-reporter=tap', 'test/orderTotals.test.js']);
});

test('9 — malformed model output is rejected, never repaired', async () => {
  const malformed: unknown[] = [
    null,
    'a string',
    42,
    {},
    { issueSummary: 'x' },
    { issueSummary: 'x', scope: [], edits: [{ path: 'a', content: '' }] },
    { issueSummary: '', scope: [{ path: 'a', rationale: 'r' }], edits: [{ path: 'a', content: '' }] },
    { issueSummary: 'x', scope: [{ path: 'a' }], edits: [{ path: 'a', content: '' }] },
    { issueSummary: 'x', scope: [{ path: 'a', rationale: 'r' }], edits: [] },
    { issueSummary: 'x', scope: [{ path: 'a', rationale: 'r' }], edits: [{ path: 'a' }] },
    { issueSummary: 'x', scope: [{ path: 'a', rationale: 'r' }], edits: [{ path: 'a', content: '' }], excluded: 'nope' },
  ];
  for (const raw of malformed) assert.equal(parsePlannerOutput(raw), null, `must reject ${JSON.stringify(raw)}`);

  const { result } = await plan(async () => ({ issueSummary: 'x', scope: 'not an array', edits: [] }));
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === 'malformed-model-output');
});

// ── 10. Determinism of the frozen scope ────────────────────────────────────────

test('10 — repeated planning yields the same frozen path-set hash', async () => {
  const root = createFixtureRepo();
  const hashes: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const { result } = await plan(goodModel, { rootPath: root });
    assert.ok(result.ok);
    const proposed = proposeEditScope({
      runId: `r${i}`,
      rationale: result.plan.issueSummary,
      files: result.plan.proposedScope.map((s) => ({ path: s.path, reason: s.rationale, sources: s.sources })),
    });
    hashes.push(proposed.scopeHash);
  }
  assert.equal(new Set(hashes).size, 1, `the scope is stable across planning runs: ${JSON.stringify(hashes)}`);
});

test('the plan never mutates the workspace', async () => {
  const root = createFixtureRepo();
  const before = new Map(REQUIRED_FILES.map((p) => [p, fs.readFileSync(path.join(root, p), 'utf8')]));
  const { result } = await plan(goodModel, { rootPath: root });
  assert.ok(result.ok);
  for (const [rel, content] of before) {
    assert.equal(fs.readFileSync(path.join(root, rel), 'utf8'), content, `${rel} untouched by planning`);
  }
});

test('the proposed scope feeds the existing approval boundary unchanged', async () => {
  const { result } = await plan(goodModel);
  assert.ok(result.ok);
  const scope = approveEditScope(
    proposeEditScope({
      runId: 'r',
      rationale: result.plan.issueSummary,
      files: result.plan.proposedScope.map((s) => ({ path: s.path, reason: s.rationale, sources: s.sources })),
    }),
  );
  assert.equal(scope.files.length, 3);
  assert.ok(scope.approvalToken.includes(scope.scopeHash));
  assert.ok(!scope.files.some((f) => f.path === TRAP_FILE));
});
