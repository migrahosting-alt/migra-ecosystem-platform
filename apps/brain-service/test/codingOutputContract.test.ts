// The model-facing output contract.
//
// WHY THIS FILE EXISTS. Every model call in the governed coding path used to send
// its input data and nothing else, under a system prompt that told the model to
// match "the requested shape exactly" — while no shape was ever requested. A real
// `qwen3-coder:30b` run chose the correct three files and wrote correct code, then
// returned it as `{"fixes":[...]}` and was refused as `malformed-model-output`.
// The refusal was correct. The prompt was not.
//
// No scripted-provider test could have caught it, because a scripted provider IS
// the shape — it returns the right keys by construction. So these tests do the one
// thing a scripted test still can: assert that the shape we STATE to the model is
// the shape the parser ENFORCES, and that it is actually sent. A contract that
// drifts from its validator would aim a real model confidently at the wrong keys.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  planCodingTask,
  parsePlannerOutput,
  PLANNER_OUTPUT_CONTRACT,
  type PlannerModelInput,
} from '../src/engine/coding/codingPlanner.js';
import {
  createInitialChangesetAuthor,
  createRepairChangesetAuthor,
  parseProposal,
  PROPOSAL_OUTPUT_CONTRACT,
  REPAIR_OUTPUT_CONTRACT,
} from '../src/engine/coding/modelProposals.js';
import { proposeEditScope, approveEditScope } from '../src/engine/coding/editScope.js';
import { EvidenceLedger } from '../src/engine/grounding/evidenceLedger.js';
import { makeSpanSource } from '../src/engine/planning/workspaceSpanSource.js';
import { clearRepoMapCache } from '../src/engine/planning/repoMap.js';
import { createFixtureRepo, ISSUE, REQUIRED_FILES, TRAP_FILE } from './fixtures/multifileCodingFixture.js';

const [CONTRACT_FILE, SERVICE, ROUTE] = REQUIRED_FILES;
const VALIDATION = { id: 'tests', command: ['node', '--test', 'test/orderTotals.test.js'] };

// ── 1-3. The planner states its shape, and states the one the parser accepts ───

test('1 — the planner sends an explicit responseShape to the model', async () => {
  clearRepoMapCache();
  const root = createFixtureRepo();
  let seen: PlannerModelInput | undefined;
  await planCodingTask({
    issue: ISSUE,
    rootPath: root,
    validationCommand: VALIDATION,
    openSpan: (rel, s, e) => makeSpanSource(root, rel, s, e),
    model: async (input) => {
      seen = input;
      return null; // refused as malformed; this test is about the request, not the reply
    },
  });
  assert.ok(seen, 'the planner never called the model');
  assert.equal(seen.responseShape, PLANNER_OUTPUT_CONTRACT);
});

test('2 — the stated planner shape names every key the parser requires', () => {
  // Drift guard. If `parsePlannerOutput` grows a required key, the contract text
  // must grow with it, or a real model will never be told to send it.
  for (const key of ['issueSummary', 'scope', 'excluded', 'edits', 'path', 'rationale', 'content', 'reason']) {
    assert.ok(PLANNER_OUTPUT_CONTRACT.includes(`"${key}"`), `contract never names "${key}"`);
  }
  // The path rules the parser enforces by REFUSING must be stated, since a refusal
  // is total: one absolute path discards the whole plan.
  assert.match(PLANNER_OUTPUT_CONTRACT, /workspace-relative/);
  assert.match(PLANNER_OUTPUT_CONTRACT, /\.\./);
});

test('3 — output built to the stated planner shape parses', () => {
  // The contract is only worth stating if obeying it works. This is the round trip
  // the real model failed before the shape was sent.
  const built = {
    issueSummary: 'Exclude cancelled lines and report the excluded count.',
    scope: [{ path: CONTRACT_FILE, rationale: 'defines the response shape' }],
    excluded: [{ path: TRAP_FILE, reason: 'presentation only' }],
    edits: [{ path: CONTRACT_FILE, content: 'export const ORDER_TOTAL_FIELDS = [];\n' }],
  };
  const parsed = parsePlannerOutput(built);
  assert.ok(parsed, 'output matching the stated contract was rejected by the parser');
  assert.deepEqual(parsed.scope.map((s) => s.path), [CONTRACT_FILE]);
  assert.deepEqual(parsed.edits.map((e) => e.path), [CONTRACT_FILE]);
});

// ── 4-6. The initial changeset author ──────────────────────────────────────────

function approvedScope() {
  const proposed = proposeEditScope({
    runId: 'run_contract',
    rationale: 'exclude cancelled lines',
    files: REQUIRED_FILES.map((path) => ({
      path,
      reason: 'participates in the total',
      sources: [{ path, startLine: 1, endLine: 5, excerptHash: 'h' }],
    })),
  });
  return approveEditScope(proposed);
}

test('4 — the initial changeset author sends an explicit responseShape', async () => {
  const scope = approvedScope();
  let seen: Record<string, unknown> | undefined;
  const author = createInitialChangesetAuthor({
    model: async (input) => {
      seen = input as Record<string, unknown>;
      return null;
    },
    rootPath: '/tmp/unused',
    ledger: new EvidenceLedger(),
  });
  await author.propose({
    issue: ISSUE,
    scope,
    evidence: [],
    currentFiles: REQUIRED_FILES.map((path) => ({ path, content: '' })),
    validationCommand: VALIDATION,
  });
  assert.ok(seen, 'the author never called the model');
  assert.equal(seen.responseShape, PROPOSAL_OUTPUT_CONTRACT);
});

test('5 — the stated proposal shape names every key parseProposal requires', () => {
  for (const key of ['rationale', 'edits', 'path', 'content']) {
    assert.ok(PROPOSAL_OUTPUT_CONTRACT.includes(`"${key}"`), `contract never names "${key}"`);
  }
  assert.match(PROPOSAL_OUTPUT_CONTRACT, /approvedPaths/);
});

test('6 — output built to the stated proposal shape parses', () => {
  const parsed = parseProposal({
    rationale: 'exclude cancelled lines from the sum',
    edits: [{ path: SERVICE, content: 'export function computeOrderTotal() {}\n' }],
  });
  assert.ok(parsed, 'output matching the stated contract was rejected by the parser');
  assert.equal(parsed.edits[0]?.path, SERVICE);
});

// ── 7-9. The repair author ─────────────────────────────────────────────────────

test('7 — the repair author sends an explicit responseShape', async () => {
  const scope = approvedScope();
  let seen: Record<string, unknown> | undefined;
  const author = createRepairChangesetAuthor({
    model: async (input) => {
      seen = input as Record<string, unknown>;
      return null;
    },
    rootPath: '/tmp/unused',
    runId: 'run_contract',
    ledger: new EvidenceLedger(),
  });
  await author.propose({
    scope,
    currentDiff: [ROUTE],
    latestValidation: { exitCode: 1, stdout: 'F-1 expected excludedLineCount', stderr: '', durationMs: 1 } as never,
    evidence: [],
    commandRunId: 'cmd_1',
    previousAttempts: [],
    remainingAttempts: 2,
  });
  assert.ok(seen, 'the repair author never called the model');
  assert.equal(seen.responseShape, REPAIR_OUTPUT_CONTRACT);
});

test('8 — the stated repair shape names the cited-evidence key', () => {
  // The ids are what give a repair its authority — they are checked against the
  // run's real validation output. A model never told to send them cannot comply.
  for (const key of ['rationale', 'observedFailureEvidenceIds', 'edits', 'path', 'content']) {
    assert.ok(REPAIR_OUTPUT_CONTRACT.includes(`"${key}"`), `contract never names "${key}"`);
  }
});

test('9 — output built to the stated repair shape parses, ids included', () => {
  const parsed = parseProposal({
    rationale: 'the tests expect excludedLineCount',
    observedFailureEvidenceIds: ['F-1', 'F-2'],
    edits: [{ path: ROUTE, content: 'export function orderTotalsRoute() {}\n' }],
  });
  assert.ok(parsed, 'output matching the stated contract was rejected by the parser');
  assert.deepEqual(parsed.citedIds, ['F-1', 'F-2']);
});

// ── 10. The refusal that started this ──────────────────────────────────────────

test('10 — the shape the real model invented is still refused', () => {
  // Verbatim from the recorded `qwen3-coder:30b` run: correct files, correct code,
  // wrong keys. Stating the contract must not have loosened the parser — a plan
  // under invented keys is still a plan nobody can audit.
  const invented = {
    fixes: [
      { path: CONTRACT_FILE, content: 'export const ORDER_TOTAL_FIELDS = [];\n' },
      { path: SERVICE, content: 'export function computeOrderTotal() {}\n' },
    ],
  };
  assert.equal(parsePlannerOutput(invented), null);
  assert.equal(parseProposal(invented), null);
});
