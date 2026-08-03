// Model proposal adapters — the point where an untrusted model meets a governed
// system. Scripted responses, including adversarial ones. These prove the ADAPTER
// contract, not that any model behaves well. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EvidenceLedger } from '../src/engine/grounding/evidenceLedger.js';
import { approveEditScope, proposeEditScope } from '../src/engine/coding/editScope.js';
import { governedApply } from '../src/engine/coding/governedApply.js';
import { ScopedEditLedger } from '../src/engine/coding/editScope.js';
import { nodeChangesetFs } from '../src/tools/changesetFs.js';
import { ChangesetProposalStore } from '../src/tools/changeset.js';
import { runValidation } from '../src/engine/coding/validationRun.js';
import {
  createInitialChangesetAuthor,
  createRepairChangesetAuthor,
  extractFailureEvidence,
  renderFailureEvidence,
  parseProposal,
  changesetFingerprint,
  hashEvidence,
  materiallyRelates,
  type ObservedFailureEvidence,
} from '../src/engine/coding/modelProposals.js';
import { createFixtureRepo, REQUIRED_FILES, TRAP_FILE, ISSUE } from './fixtures/multifileCodingFixture.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const [CONTRACT, SERVICE, ROUTE] = REQUIRED_FILES;
const VALIDATION = { id: 'tests', command: ['node', '--test', '--test-reporter=tap', 'test/orderTotals.test.js'] };
const RUN = 'run-1#attempt-1';

function ledgerFor(root: string): EvidenceLedger {
  const l = new EvidenceLedger();
  for (const p of [...REQUIRED_FILES, TRAP_FILE]) {
    l.recordRead(p, 1, 40, fs.readFileSync(path.join(root, p), 'utf8'));
  }
  return l;
}
const SRC = (p: string) => ({ path: p, startLine: 1, endLine: 40, excerptHash: hashEvidence(p) });
const scopeFor = (paths: readonly string[] = REQUIRED_FILES) =>
  approveEditScope(proposeEditScope({ runId: 'r', rationale: ISSUE.split('\n')[0]!, files: paths.map((p) => ({ path: p, reason: 'r', sources: [SRC(p)] })) }));

async function realEvidence(root: string): Promise<{ record: Awaited<ReturnType<typeof runValidation>>; blocks: ObservedFailureEvidence[] }> {
  const saved = process.env.NODE_TEST_CONTEXT;
  delete process.env.NODE_TEST_CONTEXT;
  try {
    const record = await runValidation(VALIDATION, 'final', { rootPath: root });
    return { record, blocks: extractFailureEvidence(record, RUN) };
  } finally {
    if (saved !== undefined) process.env.NODE_TEST_CONTEXT = saved;
  }
}

const EDIT = (p: string) => ({ path: p, content: `// edited ${p}\n` });

// ── 1-6. Initial changeset adapter ─────────────────────────────────────────────

test('1 — a valid initial proposal is accepted', async () => {
  const root = createFixtureRepo();
  const author = createInitialChangesetAuthor({ model: async () => ({ rationale: 'fix the total', edits: REQUIRED_FILES.map(EDIT) }), rootPath: root, ledger: ledgerFor(root) });
  const r = await author.propose({ issue: ISSUE, scope: scopeFor(), evidence: [], currentFiles: [], validationCommand: VALIDATION });
  assert.ok(r.ok, r.ok ? '' : `${(r as { rejection?: string }).rejection}`);
  assert.equal(r.changeset.ops.length, 3);
});

test('2 — malformed structured output is rejected as malformed-output', async () => {
  const root = createFixtureRepo();
  for (const bad of [null, 'text', 42, [], {}, { rationale: 'x' }, { rationale: '', edits: [EDIT(SERVICE)] }, { rationale: 'x', edits: [] }, { rationale: 'x', edits: [{ path: SERVICE }] }, { rationale: 'x', edits: [EDIT(SERVICE)], observedFailureEvidenceIds: 'F-001' }]) {
    assert.equal(parseProposal(bad), null, `parse must reject ${JSON.stringify(bad)}`);
  }
  const author = createInitialChangesetAuthor({ model: async () => 'not an object', rootPath: root, ledger: ledgerFor(root) });
  const r = await author.propose({ issue: ISSUE, scope: scopeFor(), evidence: [], currentFiles: [], validationCommand: VALIDATION });
  assert.ok(!r.ok && r.kind === 'rejected' && r.rejection === 'malformed-output');
});

test('3 — an unapproved path is rejected as scope-expansion', async () => {
  const root = createFixtureRepo();
  const author = createInitialChangesetAuthor({ model: async () => ({ rationale: 'x', edits: [EDIT(SERVICE), EDIT(TRAP_FILE)] }), rootPath: root, ledger: ledgerFor(root) });
  const r = await author.propose({ issue: ISSUE, scope: scopeFor(), evidence: [], currentFiles: [], validationCommand: VALIDATION });
  assert.ok(!r.ok && r.kind === 'rejected' && r.rejection === 'scope-expansion');
  assert.ok(!r.ok && r.message.includes(TRAP_FILE));
});

test('4 — an approved path with no retrieved evidence is rejected as unsupported-path', async () => {
  const root = createFixtureRepo();
  const emptyLedger = new EvidenceLedger(); // nothing retrieved
  const author = createInitialChangesetAuthor({ model: async () => ({ rationale: 'x', edits: [EDIT(SERVICE)] }), rootPath: root, ledger: emptyLedger });
  const r = await author.propose({ issue: ISSUE, scope: scopeFor(), evidence: [], currentFiles: [], validationCommand: VALIDATION });
  assert.ok(!r.ok && r.kind === 'rejected' && r.rejection === 'unsupported-path');
});

test('5 — a model-supplied validation command is rejected as command-override', async () => {
  const root = createFixtureRepo();
  const author = createInitialChangesetAuthor({
    model: async () => ({ rationale: 'x', edits: [EDIT(SERVICE)], validationCommand: ['node', '-e', 'process.exit(0)'] }),
    rootPath: root, ledger: ledgerFor(root),
  });
  const r = await author.propose({ issue: ISSUE, scope: scopeFor(), evidence: [], currentFiles: [], validationCommand: VALIDATION });
  assert.ok(!r.ok && r.kind === 'rejected' && r.rejection === 'command-override');
});

test('6 — conflicting duplicate edits are rejected; identical duplicates collapse', async () => {
  const root = createFixtureRepo();
  const conflicting = createInitialChangesetAuthor({
    model: async () => ({ rationale: 'x', edits: [{ path: SERVICE, content: 'A' }, { path: SERVICE, content: 'B' }] }),
    rootPath: root, ledger: ledgerFor(root),
  });
  const bad = await conflicting.propose({ issue: ISSUE, scope: scopeFor(), evidence: [], currentFiles: [], validationCommand: VALIDATION });
  assert.ok(!bad.ok && bad.kind === 'rejected' && bad.rejection === 'conflicting-edits');

  const same = createInitialChangesetAuthor({
    model: async () => ({ rationale: 'x', edits: [{ path: SERVICE, content: 'A' }, { path: SERVICE, content: 'A' }] }),
    rootPath: root, ledger: ledgerFor(root),
  });
  const ok = await same.propose({ issue: ISSUE, scope: scopeFor(), evidence: [], currentFiles: [], validationCommand: VALIDATION });
  assert.ok(ok.ok && ok.changeset.ops.length === 1, 'an identical repeat is not a conflict');
});

// ── 7-12. Citation authority ───────────────────────────────────────────────────

function repairAuthor(root: string, over: Partial<Parameters<typeof createRepairChangesetAuthor>[0]> = {}, model?: () => unknown) {
  return createRepairChangesetAuthor({
    model: async () => (model ? model() : { rationale: 'r', edits: [EDIT(CONTRACT)], observedFailureEvidenceIds: ['F-003'] }),
    rootPath: root, runId: 'run-1', ledger: ledgerFor(root), ...over,
  });
}
const repairInput = (blocks: ObservedFailureEvidence[], record: Awaited<ReturnType<typeof runValidation>>, over: Record<string, unknown> = {}) => ({
  scope: scopeFor(), currentDiff: [SERVICE], latestValidation: record, evidence: blocks, commandRunId: RUN,
  previousAttempts: [], remainingAttempts: 3, ...over,
});

test('7 — a repair citing a current failure id is accepted', async () => {
  const root = createFixtureRepo();
  const { record, blocks } = await realEvidence(root);
  assert.ok(blocks.length >= 3, `real evidence blocks: ${blocks.length}`);
  const contractBlock = blocks.find((b) => /contract/.test(b.text))!;
  const r = await repairAuthor(root, {}, () => ({ rationale: 'the contract omits the field', edits: [EDIT(CONTRACT)], observedFailureEvidenceIds: [contractBlock.evidenceId] }))
    .propose(repairInput(blocks, record));
  assert.ok(r.ok, r.ok ? '' : `${(r as { rejection?: string; message?: string }).rejection}: ${(r as { message?: string }).message}`);
  assert.deepEqual(r.citedEvidenceIds, [contractBlock.evidenceId]);
});

test('8 — a repair with no citation is rejected as no-citation', async () => {
  const root = createFixtureRepo();
  const { record, blocks } = await realEvidence(root);
  const r = await repairAuthor(root, {}, () => ({ rationale: 'trust me', edits: [EDIT(CONTRACT)] })).propose(repairInput(blocks, record));
  assert.ok(!r.ok && r.kind === 'rejected' && r.rejection === 'no-citation');
});

test('9 — an unknown citation id is rejected as unobserved-citation', async () => {
  const root = createFixtureRepo();
  const { record, blocks } = await realEvidence(root);
  const r = await repairAuthor(root, {}, () => ({ rationale: 'x', edits: [EDIT(CONTRACT)], observedFailureEvidenceIds: ['ECONNREFUSED-redis'] })).propose(repairInput(blocks, record));
  assert.ok(!r.ok && r.kind === 'rejected' && r.rejection === 'unobserved-citation');
});

test('10 — a stale id from a prior attempt is rejected as stale-citation', async () => {
  const root = createFixtureRepo();
  const { record, blocks } = await realEvidence(root);
  // Attempt 2 produced only two blocks; F-005 existed only in attempt 1.
  const attempt2 = blocks.slice(0, 2).map((b) => ({ ...b, commandRunId: 'run-1#attempt-2' }));
  const r = await repairAuthor(root, {}, () => ({ rationale: 'x', edits: [EDIT(CONTRACT)], observedFailureEvidenceIds: ['F-005'] }))
    .propose(repairInput(attempt2, record, { commandRunId: 'run-1#attempt-2' }));
  assert.ok(!r.ok && r.kind === 'rejected' && r.rejection === 'stale-citation', `got ${JSON.stringify(r)}`);
});

test('11 — evidence from another coding run is rejected as foreign-citation', async () => {
  const root = createFixtureRepo();
  const { record, blocks } = await realEvidence(root);
  const foreign = blocks.map((b) => ({ ...b, commandRunId: 'run-99#attempt-1' }));
  const r = await repairAuthor(root, {}, () => ({ rationale: 'x', edits: [EDIT(CONTRACT)], observedFailureEvidenceIds: [foreign[2]!.evidenceId] }))
    .propose(repairInput(foreign, record));
  assert.ok(!r.ok && r.kind === 'rejected' && r.rejection === 'foreign-citation');
});

test('12 — hash-mismatched evidence is rejected', async () => {
  const root = createFixtureRepo();
  const { record, blocks } = await realEvidence(root);
  const tampered = blocks.map((b, i) => (i === 2 ? { ...b, text: `${b.text}\n(edited after the fact)` } : b));
  const r = await repairAuthor(root, {}, () => ({ rationale: 'x', edits: [EDIT(CONTRACT)], observedFailureEvidenceIds: [tampered[2]!.evidenceId] }))
    .propose(repairInput(tampered, record));
  assert.ok(!r.ok && r.kind === 'rejected' && r.rejection === 'evidence-hash-mismatch');
});

// ── 13-17. Scope, repetition, ceilings, transport ──────────────────────────────

test('13 — a repair expanding the scope is rejected', async () => {
  const root = createFixtureRepo();
  const { record, blocks } = await realEvidence(root);
  const r = await repairAuthor(root, {}, () => ({ rationale: 'x', edits: [EDIT(TRAP_FILE)], observedFailureEvidenceIds: [blocks[0]!.evidenceId] })).propose(repairInput(blocks, record));
  assert.ok(!r.ok && r.kind === 'rejected' && r.rejection === 'scope-expansion');
});

test('14 — an identical already-failed repair is not retried', async () => {
  const root = createFixtureRepo();
  const { record, blocks } = await realEvidence(root);
  const contractBlock = blocks.find((b) => /contract/.test(b.text))!;
  const edits = [EDIT(CONTRACT)];
  const fingerprint = changesetFingerprint({ rootPath: root, ops: edits.map((e) => ({ op: 'replace' as const, path: e.path, content: e.content })) });
  const r = await repairAuthor(root, {}, () => ({ rationale: 'same again', edits, observedFailureEvidenceIds: [contractBlock.evidenceId] }))
    .propose(repairInput(blocks, record, {
      previousAttempts: [{
        attempt: 1,
        citedEvidenceIds: [contractBlock.evidenceId],
        rationale: 'first try',
        proposedPaths: [CONTRACT],
        proposalDigest: fingerprint,
        outcome: 'validation_failed',
        outcomeReason: 'the change applied but the tests still failed',
      }],
    }));
  assert.ok(!r.ok && r.kind === 'rejected' && r.rejection === 'duplicate-repair');
});

test('15 — a malformed repair consumes an attempt; an exhausted ceiling does not', async () => {
  const root = createFixtureRepo();
  const { record, blocks } = await realEvidence(root);
  const malformed = await repairAuthor(root, {}, () => ({ nope: true })).propose(repairInput(blocks, record));
  assert.ok(!malformed.ok && malformed.kind === 'rejected' && malformed.rejection === 'malformed-output');
  assert.equal(!malformed.ok && malformed.consumedAttempt, true, 'a real call that returned garbage cost an attempt');

  const exhausted = await repairAuthor(root).propose(repairInput(blocks, record, { remainingAttempts: 0 }));
  assert.ok(!exhausted.ok && exhausted.kind === 'rejected' && exhausted.rejection === 'ceiling-exhausted');
  assert.equal(!exhausted.ok && exhausted.consumedAttempt, false, 'refusing to call cannot consume an attempt');
});

test('16 — transport failure and invalid proposal are reported distinctly', async () => {
  const root = createFixtureRepo();
  const { record, blocks } = await realEvidence(root);
  const author = createRepairChangesetAuthor({
    model: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:11434'); },
    rootPath: root, runId: 'run-1', ledger: ledgerFor(root),
  });
  const r = await author.propose(repairInput(blocks, record));
  assert.ok(!r.ok && r.kind === 'transport', 'a dead provider is not a bad proposal');
  assert.ok(!r.ok && r.kind === 'transport' && r.retryable === true);
  assert.equal(!r.ok && r.consumedAttempt, false, 'the model never answered, so no attempt was spent');
  assert.match((r as { message: string }).message, /ECONNREFUSED/);
});

test('17 — a model claiming the tests pass is rejected', async () => {
  const root = createFixtureRepo();
  const { record, blocks } = await realEvidence(root);
  const r = await repairAuthor(root, {}, () => ({ rationale: 'all good now', edits: [EDIT(CONTRACT)], observedFailureEvidenceIds: [blocks[0]!.evidenceId], testsPass: true }))
    .propose(repairInput(blocks, record));
  assert.ok(!r.ok && r.kind === 'rejected' && r.rejection === 'claims-passed');
});

// ── 18-20. Paraphrase, quotation, and the outer boundary ───────────────────────

test('18 — the rationale may paraphrase freely while the cited id carries authority', async () => {
  const root = createFixtureRepo();
  const { record, blocks } = await realEvidence(root);
  const contractBlock = blocks.find((b) => /contract/.test(b.text))!;
  const r = await repairAuthor(root, {}, () => ({
    // Nothing here appears verbatim in the TAP output. That is fine.
    rationale: 'The shared field list is missing the newly required count, so the deep-equality check disagrees.',
    edits: [EDIT(CONTRACT)],
    observedFailureEvidenceIds: [contractBlock.evidenceId],
  })).propose(repairInput(blocks, record));
  assert.ok(r.ok, r.ok ? '' : `${(r as { rejection?: string }).rejection}`);
});

test('19 — a direct quotation that does not match its evidence is recorded, not fatal', async () => {
  const root = createFixtureRepo();
  const { record, blocks } = await realEvidence(root);
  const contractBlock = blocks.find((b) => /contract/.test(b.text))!;
  const bad = await repairAuthor(root, {}, () => ({
    rationale: 'x', edits: [EDIT(CONTRACT)], observedFailureEvidenceIds: [contractBlock.evidenceId],
    quotedEvidence: [{ evidenceId: contractBlock.evidenceId, text: 'not ok 3 - the database connection was refused' }],
  })).propose(repairInput(blocks, record));
  // A quotation grants no authority, so a paraphrased one can no longer veto a
  // repair whose cited IDs are current and unaltered — measured on a real model, the
  // strict veto took completion from 3/8 to 0/8. It is recorded as a concern instead.
  assert.ok(bad.ok, bad.ok ? '' : `${(bad as { rejection?: string }).rejection}`);
  assert.deepEqual(bad.concerns, ['the quotation attributed to F-002 does not appear in it verbatim'.replace('F-002', contractBlock.evidenceId)]);

  const good = await repairAuthor(root, {}, () => ({
    rationale: 'x', edits: [EDIT(CONTRACT)], observedFailureEvidenceIds: [contractBlock.evidenceId],
    quotedEvidence: [{ evidenceId: contractBlock.evidenceId, text: contractBlock.text.split('\n')[0]! }],
  })).propose(repairInput(blocks, record));
  assert.ok(good.ok, 'a correct quotation is fine');
});

test('20 — an accepted proposal still cannot bypass governedApply', async () => {
  const root = createFixtureRepo();
  const scope = scopeFor([CONTRACT, SERVICE]); // ROUTE deliberately unapproved
  const ledger = ledgerFor(root);
  // The adapter is handed a WIDER scope than the one the ledger will enforce, so
  // an accepted proposal meets a narrower authority downstream.
  const author = createInitialChangesetAuthor({ model: async () => ({ rationale: 'x', edits: [EDIT(CONTRACT), EDIT(ROUTE)] }), rootPath: root, ledger });
  const accepted = await author.propose({ issue: ISSUE, scope: scopeFor(), evidence: [], currentFiles: [], validationCommand: VALIDATION });
  assert.ok(accepted.ok, 'the adapter accepts it against the wider scope');

  const editLedger = new ScopedEditLedger(scope, scope.approvalToken);
  const applied = await governedApply(accepted.changeset, {
    fs: nodeChangesetFs(), store: new ChangesetProposalStore(), scope, approvalToken: scope.approvalToken, ledger: editLedger,
  });
  assert.equal(applied.ok, false, 'the real boundary still refuses it');
  assert.ok(!applied.ok && applied.refusal === 'scope-violation');
  assert.equal(applied.mutated, false);
});

// ── Evidence extraction ────────────────────────────────────────────────────────

test('evidence blocks are id-bearing, hashed, and rendered id-first', async () => {
  const root = createFixtureRepo();
  const { record, blocks } = await realEvidence(root);
  assert.equal(blocks.length, 5, 'one block per failing assertion');
  assert.deepEqual(blocks.map((b) => b.evidenceId), ['F-001', 'F-002', 'F-003', 'F-004', 'F-005']);
  for (const b of blocks) {
    assert.equal(b.commandRunId, RUN);
    assert.equal(b.textHash, hashEvidence(b.text));
    assert.match(b.text, /^not ok /);
  }
  assert.match(renderFailureEvidence(blocks), /^FAILURE-EVIDENCE F-001\nnot ok 1/);
  assert.equal(extractFailureEvidence({ ...record, passed: true }, RUN).length, 0, 'a passing run has no failure evidence');
});

test('materiallyRelates connects a block to a file by path OR retrieved source', async () => {
  const root = createFixtureRepo();
  const { blocks } = await realEvidence(root);
  const ledger = ledgerFor(root);
  const contractBlock = blocks.find((b) => /contract declares/.test(b.text))!;
  const routeBlock = blocks.find((b) => /the route returns/.test(b.text))!;
  const totalBlock = blocks.find((b) => /cancelled lines are excluded/.test(b.text))!;

  assert.ok(materiallyRelates(contractBlock, CONTRACT, ledger), 'by path token');
  assert.ok(materiallyRelates(routeBlock, ROUTE, ledger), 'by path token');
  // Names no file, but shares `cancelled` with the service's own source.
  assert.ok(materiallyRelates(totalBlock, SERVICE, ledger), 'by retrieved source vocabulary');
});
