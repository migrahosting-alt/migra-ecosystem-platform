/**
 * Integration acceptance for journaling the governed coding workflow.
 *
 * These prove ORDERING and RESUMPTION, not domain behaviour — the planner, apply
 * and validation modules already have their own suites. What is at stake here is
 * whether the durable record can ever describe work that did not happen, or miss
 * work that did.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentRunJournal, DEFAULT_AGENT_RUN_JOURNAL_CONFIG, MemoryAgentRunJournalPersistence } from '../src/engine/agentRunJournal.js';
import type { DurableAgentRun, DurableAgentRunChild, DurableAgentRunState } from '../src/engine/persistence/types.js';
import { JournaledCodingRun, type CodingRunStore, type StageWorkResult } from '../src/engine/coding/journaledCodingRun.js';
import { markInterruptedChildren, reconcileCodingChildren } from '../src/engine/coding/codingChildren.js';
import {
  applyEvidence,
  applyOutcome,
  digest,
  reconciliationEvidence,
  validationEvidence,
} from '../src/engine/coding/codingStageEvidence.js';
import { CODING_DOMAIN_KIND, initialCodingPayload, type CodingRunPayloadV1 } from '../src/engine/coding/codingRunPayload.js';
import type { ValidationRecord } from '../src/engine/coding/validationRun.js';

const RUN_ID = 'run_1';

function parentRow(state: DurableAgentRunState = 'EXECUTING'): DurableAgentRun {
  return {
    runId: RUN_ID, correlationId: 'corr_1', activationRef: 'act', workspaceIdentity: 'ws', workspaceRef: 'wsref',
    recipeId: CODING_DOMAIN_KIND, recipePolicyVersion: 'v1', proposalFingerprint: 'fp', proposalHash: 'ph',
    snapshotId: 'snap', snapshotManifestDigest: 'digest', executableDigest: 'exec', state,
    requestedAt: 1_000, proposalAt: 1_000, expiresAt: 9_000_000, timeoutMs: 1_000, outputLimitBytes: 1_024,
    mutationClassification: 'workspace-write-possible', networkPolicy: 'not-required', expectedEffectsJson: '[]',
    approvalLifecycleVersion: 1, approvalLifecycle: 'APPROVED', recoveryClass: 'NONE', recoveryEligible: false,
    recoveryAttemptCount: 0, auditSeq: 1, schemaVersion: 1, version: 1, reconciliationFence: 0, updatedAt: 1_000,
    domainKind: CODING_DOMAIN_KIND, domainSchemaVersion: 1,
  };
}

/** A store whose writes can be failed on demand — the only way to exercise "the
 * record did not land", which is the case every truthfulness rule turns on. */
class TestStore implements CodingRunStore {
  failPayloadWrite = false;
  failParentTransition = false;
  readonly notes: string[] = [];
  state: DurableAgentRunState = 'EXECUTING';
  constructor(private payload: CodingRunPayloadV1) {}
  readPayload(): CodingRunPayloadV1 { return this.payload; }
  writePayload(payload: CodingRunPayloadV1, note: string): boolean {
    if (this.failPayloadWrite) return false;
    this.payload = payload;
    this.notes.push(note);
    return true;
  }
  parentState(): DurableAgentRunState { return this.state; }
  transitionParent(next: DurableAgentRunState, note: string, payload?: CodingRunPayloadV1): boolean {
    if (this.failParentTransition) return false;
    // Mirrors the real store: state and payload land in ONE revision or neither.
    this.state = next;
    if (payload) this.payload = payload;
    this.notes.push(note);
    return true;
  }
}

function harness(payload = initialCodingPayload('cancelled lines are counted')) {
  const persistence = new MemoryAgentRunJournalPersistence();
  const journal = new AgentRunJournal(persistence, DEFAULT_AGENT_RUN_JOURNAL_CONFIG, () => 'ev');
  persistence.insertAgentRun(parentRow(), { eventId: 'e1', runId: RUN_ID, seq: 1, at: 1_000, type: 'run.created', nextState: 'AWAITING_APPROVAL', correlationId: 'corr_1', source: 'API', schemaVersion: 1 });
  const store = new TestStore(payload);
  let clock = 2_000;
  const run = new JournaledCodingRun(journal, RUN_ID, store, () => (clock += 10));
  return { journal, store, run };
}

const ok = async <T>(evidence: unknown, value: T) => ({ outcome: 'success' as const, evidence, value });

/** A stage that never settles — the process is imagined to die inside it. */
const neverSettles = <T = never>(): Promise<StageWorkResult<T>> => new Promise<StageWorkResult<T>>(() => { /* interrupted */ });

// ── 1. correct child kinds ───────────────────────────────────────────────────

test('1 — every stage records its own explicit child kind', async () => {
  const h = harness();
  const kinds = [
    'repository_planning', 'initial_model_proposal', 'initial_apply', 'validation',
    'repair_model_proposal', 'repair_apply', 'final_validation', 'reconciliation',
  ] as const;
  for (const kind of kinds) {
    const result = await h.run.runStage({ kind, phase: 'validating' }, () => ok({ kind }, kind));
    assert.equal(result.status, 'completed', `${kind} should complete`);
  }
  assert.deepEqual(h.journal.children(RUN_ID).map((c) => c.kind), [...kinds]);
  assert.equal(h.journal.children(RUN_ID).every((c) => c.kind !== 'coding_step'), true, 'nothing was collapsed into a generic kind');
});

// ── 2–4. the dispatch invariant ──────────────────────────────────────────────

test('2 + 3 — the child row and then the parent reference are durable BEFORE the work runs', async () => {
  const h = harness();
  let observedAtDispatch: { childExists: boolean; referenced: boolean } | undefined;

  await h.run.runStage({ kind: 'initial_apply', phase: 'executing_initial_changeset' }, async (child) => {
    observedAtDispatch = {
      childExists: h.journal.child(child.childId) !== undefined,
      referenced: h.store.readPayload().childRefs.some((r) => r.childId === child.childId),
    };
    return ok({ applied: true }, 'done');
  });

  assert.equal(observedAtDispatch?.childExists, true, 'the child row existed before dispatch');
  assert.equal(observedAtDispatch?.referenced, true, 'the parent already named it before dispatch');
});

test('4 — a parent-reference failure causes ZERO stage execution', async () => {
  const h = harness();
  h.store.failPayloadWrite = true;
  let ran = false;

  const result = await h.run.runStage({ kind: 'initial_apply', phase: 'executing_initial_changeset' }, async () => {
    ran = true;
    return ok({}, 'should never happen');
  });

  assert.equal(ran, false, 'the mutation must not run when nothing can account for it');
  assert.equal(result.status, 'refused');
  const child = h.journal.children(RUN_ID)[0];
  assert.equal(child?.state, 'failed');
  assert.equal(child?.terminalCategory, 'orphaned_before_dispatch');
  assert.equal(child?.startedAt, undefined);
});

// ── 5–7. the approval boundary ───────────────────────────────────────────────

const scopeFor = (paths: string[]): NonNullable<CodingRunPayloadV1['scope']> => ({
  proposedPaths: paths,
  pathSetHash: 'hash_abc',
  sourcesByPath: Object.fromEntries(paths.map((p) => [p, [{ path: p, startLine: 1, endLine: 5, excerptHash: 'e1' }]])),
  proposalRevision: 2,
  proposedAt: '2026-08-01T00:00:00.000Z',
  approvalExpiresAt: '2026-08-01T00:05:00.000Z',
  approvalState: 'displayed',
});

test('5 — planning stops at AWAITING_APPROVAL', async () => {
  const h = harness();
  await h.run.runStage({ kind: 'repository_planning', phase: 'planning' }, () => ok({ planned: true }, 1));
  assert.equal(h.run.awaitScopeApproval(scopeFor(['src/a.ts'])), true);

  assert.equal(h.store.parentState(), 'AWAITING_APPROVAL');
  assert.equal(h.run.payload.phase, 'awaiting_scope_approval');
  assert.equal(h.journal.children(RUN_ID).some((c) => c.kind === 'initial_apply'), false, 'no mutation child exists at the boundary');
});

test('6 — mutation cannot start before a durable approval', async () => {
  const h = harness();
  h.run.awaitScopeApproval(scopeFor(['src/a.ts']));

  // A wrong hash is not a late approval; it is an approval for a different plan.
  assert.deepEqual(h.run.consumeApproval({ pathSetHash: 'hash_WIDENED', at: 't' }), { ok: false, code: 'scope-mismatch' });
  assert.equal(h.run.payload.phase, 'awaiting_scope_approval', 'still waiting');

  // And when the approval cannot be persisted, it did not happen.
  h.store.failPayloadWrite = true;
  assert.deepEqual(h.run.consumeApproval({ pathSetHash: 'hash_abc', at: 't' }), { ok: false, code: 'not-persisted' });
  h.store.failPayloadWrite = false;
  assert.notEqual(h.run.payload.scope?.approvalState, 'consumed');
});

test('7 — an approval is consumed exactly once', async () => {
  const h = harness();
  h.run.awaitScopeApproval(scopeFor(['src/a.ts']));

  assert.deepEqual(h.run.consumeApproval({ pathSetHash: 'hash_abc', at: 't1' }), { ok: true });
  assert.equal(h.run.payload.scope?.approvalState, 'consumed');
  assert.equal(h.run.payload.phase, 'executing_initial_changeset');

  // A replayed approval must not re-authorise mutation.
  assert.deepEqual(h.run.consumeApproval({ pathSetHash: 'hash_abc', at: 't2' }), { ok: false, code: 'already-consumed' });
  assert.equal(h.run.payload.scope?.approvedAt, 't1', 'the original decision is untouched');
});

// ── 8–11, 20. restart ────────────────────────────────────────────────────────

test('8 + 20 — a completed stage is reused after restart and never runs twice', async () => {
  const h = harness();
  let executions = 0;
  const stage = () => h.run.runStage({ kind: 'repository_planning', phase: 'planning', reuseIfCompleted: true }, async () => {
    executions += 1;
    return ok({ selectedPaths: ['src/a.ts'] }, 'planned');
  });

  const first = await stage();
  assert.equal(first.status, 'completed');

  // Simulated restart: same durable state, fresh call.
  const second = await stage();
  assert.equal(second.status, 'reused');
  assert.equal(executions, 1, 'the stage did not run a second time');
  assert.deepEqual(second.reusedEvidence, { selectedPaths: ['src/a.ts'] }, 'the prior result is recovered from durable evidence');
  assert.equal(h.journal.children(RUN_ID).length, 1, 'no duplicate child was created');
});

test('9 — a created-but-undispatched apply child can be abandoned safely', async () => {
  const h = harness();
  h.store.failPayloadWrite = true;
  await h.run.runStage({ kind: 'initial_apply', phase: 'executing_initial_changeset' }, () => ok({}, 1));
  h.store.failPayloadWrite = false;

  const plan = h.run.resumePlan();
  assert.equal(plan.action, 'continue', 'nothing was dispatched, so nothing is ambiguous');
  assert.deepEqual(plan.ambiguousChildren, []);

  // A fresh attempt takes the next attempt number under the unique constraint.
  assert.equal(h.run.nextAttempt('initial_apply'), 2);
  const retry = await h.run.runStage({ kind: 'initial_apply', phase: 'executing_initial_changeset' }, () => ok({ applied: true }, 'ok'));
  assert.equal(retry.status, 'completed');
  assert.equal(retry.child?.attempt, 2);
});

test('10 — a running apply at restart blocks blind replay', async () => {
  const h = harness();
  // Register + start an apply, then die mid-flight.
  await h.run.runStage({ kind: 'initial_apply', phase: 'executing_initial_changeset' }, async () => {
    throw Object.assign(new Error('process died'), { simulated: true });
  }).catch(() => undefined);

  // The throw path records an observed failure; simulate a true interruption
  // instead by leaving a child running.
  const h2 = harness();
  const registered = await new Promise<DurableAgentRunChild>((resolve) => {
    void h2.run.runStage({ kind: 'repair_apply', phase: 'executing_initial_changeset' }, async (child) => {
      resolve(child);
      return neverSettles();
    });
  });
  assert.equal(registered.state, 'running');

  markInterruptedChildren(h2.journal, RUN_ID, 9_000);
  const plan = h2.run.resumePlan();
  assert.equal(plan.action, 'reconcile_mutation');
  assert.deepEqual(plan.ambiguousChildren, [registered.childId]);
  assert.equal(h.journal.children(RUN_ID)[0]?.state, 'failed', 'a thrown stage is an observed failure, not a gap');
});

test('11 — an interrupted validation creates a NEW attempt and preserves the old child', async () => {
  const h = harness();
  const started = await new Promise<DurableAgentRunChild>((resolve) => {
    void h.run.runStage({ kind: 'final_validation', phase: 'validating' }, async (child) => {
      resolve(child);
      return neverSettles();
    });
  });
  markInterruptedChildren(h.journal, RUN_ID, 9_000);

  const plan = h.run.resumePlan();
  assert.equal(plan.action, 'new_validation_attempt');

  const retry = await h.run.runStage({ kind: 'final_validation', phase: 'validating' }, () => ok({ exitCode: 0 }, 'passed'));
  assert.equal(retry.status, 'completed');
  assert.equal(retry.child?.attempt, 2);
  assert.equal(h.journal.child(started.childId)?.state, 'interrupted', 'the interrupted child was preserved, never rewritten');
  assert.equal(h.journal.child(started.childId)?.terminalCategory, 'interrupted_by_restart');
});

// ── 12–13. cancellation ──────────────────────────────────────────────────────

test('12 — cancellation prevents the next child from launching', async () => {
  const h = harness();
  assert.equal(h.run.requestCancellation('2026-08-01T00:01:00.000Z'), true);

  let ran = false;
  const result = await h.run.runStage({ kind: 'repair_apply', phase: 'repairing' }, async () => { ran = true; return ok({}, 1); });
  assert.equal(result.status, 'cancelled');
  assert.equal(ran, false);
  assert.equal(h.journal.children(RUN_ID).length, 0, 'no child row was written at all');
});

test('13 — an unconfirmed child cancellation prevents the parent reporting CANCELLED', async () => {
  const h = harness();
  const running = await new Promise<DurableAgentRunChild>((resolve) => {
    void h.run.runStage({ kind: 'final_validation', phase: 'validating' }, async (child) => {
      resolve(child);
      return neverSettles();
    });
  });
  h.run.requestCancellation('t1');

  // The work does NOT stop.
  const outcome = await h.run.confirmCancellation({ at: 't2', observeStopped: async () => false });
  assert.equal(outcome.confirmed, false);
  assert.deepEqual(outcome.unconfirmed, [running.childId]);
  assert.equal(h.run.payload.cancellation?.confirmedAt, undefined);

  const final = h.run.finalize({});
  assert.equal(final.state, 'FAILED', 'work may still be running — CANCELLED would be unverified');
  assert.equal(final.blockers.some((b) => b.kind === 'cancellation_unconfirmed'), true);
});

test('13b — a confirmed cancellation resolves CANCELLED', async () => {
  const h = harness();
  await new Promise<DurableAgentRunChild>((resolve) => {
    void h.run.runStage({ kind: 'final_validation', phase: 'validating' }, async (child) => {
      resolve(child);
      return neverSettles();
    });
  });
  h.run.requestCancellation('t1');
  const outcome = await h.run.confirmCancellation({ at: 't2', observeStopped: async () => true });
  assert.equal(outcome.confirmed, true);
  assert.equal(h.run.finalize({}).state, 'CANCELLED');
});

// ── 14–15. completion gating ─────────────────────────────────────────────────

test('14 — a failed required child blocks final success', async () => {
  const h = harness();
  await h.run.runStage({ kind: 'final_validation', phase: 'validating' }, async () => ({ outcome: 'failure', evidence: { exitCode: 1 }, value: null }));
  const final = h.run.finalize({});
  assert.equal(final.state, 'FAILED');
  assert.equal(final.blockers.some((b) => b.kind === 'required_child_not_successful'), true);
});

test('15 — an optional child does not block success', async () => {
  const h = harness();
  await h.run.runStage({ kind: 'final_validation', phase: 'validating' }, () => ok({ exitCode: 0 }, 1));
  await h.run.runStage({ kind: 'reconciliation', phase: 'reconciling', required: false }, async () => ({ outcome: 'failure', evidence: { advisory: true }, value: null }));
  const final = h.run.finalize({});
  assert.equal(final.state, 'COMPLETED');
  assert.deepEqual(final.blockers, []);
});

// ── 16. reconciliation findings ──────────────────────────────────────────────

test('16 — reconciliation detects missing and orphaned children', async () => {
  const h = harness();
  await h.run.runStage({ kind: 'validation', phase: 'validating' }, () => ok({ exitCode: 0 }, 1));

  // A reference whose row vanished, and a row nobody references.
  const withGhost: CodingRunPayloadV1 = {
    ...h.run.payload,
    childRefs: [...h.run.payload.childRefs, { childId: 'c_ghost', kind: 'initial_apply', attempt: 1 }],
  };
  h.journal.registerChild({ childId: 'c_orphan', runId: RUN_ID, kind: 'repair_apply', at: 5_000 });
  const orphan = h.journal.child('c_orphan')!;
  h.journal.transitionChild({ childId: orphan.childId, expectedRevision: orphan.revision, nextState: 'running', at: 5_010 });

  const findings = reconcileCodingChildren(withGhost, h.journal.children(RUN_ID), false);
  assert.equal(findings.some((f) => f.kind === 'parent_references_missing_child' && f.childId === 'c_ghost'), true);
  assert.equal(findings.some((f) => f.kind === 'child_orphaned' && f.childId === 'c_orphan'), true);
});

// ── 17–19. report + terminal durability ──────────────────────────────────────

test('17 — the final report matches the child terminal evidence', async () => {
  const h = harness();
  const record: ValidationRecord = {
    id: 'cmdrun_7', stage: 'final', command: ['node', '--test', 'test/orderTotals.test.js'], cwd: '.',
    admitted: true, startedAt: 1, endedAt: 5, durationMs: 4, exitCode: 0, timedOut: false,
    stdout: 'ok 1 - totals exclude cancelled lines', stderr: '', truncated: false, passed: true,
  };
  const evidence = validationEvidence({ record });
  const stage = await h.run.runStage({ kind: 'final_validation', phase: 'validating' }, () => ok(evidence, record));
  assert.equal(stage.status, 'completed');

  const persisted = JSON.parse(h.journal.child(stage.child!.childId)!.terminalEvidenceJson!) as typeof evidence;
  assert.equal(persisted.commandRunId, 'cmdrun_7');
  assert.equal(persisted.executable, 'node');
  assert.deepEqual(persisted.arguments, ['--test', 'test/orderTotals.test.js']);
  assert.equal(persisted.exitCode, 0);
  assert.equal(persisted.passed, true);
  assert.equal(persisted.stdout.digest, digest(record.stdout), 'output is digested, never stored whole');
  assert.equal(persisted.cancellation, 'none');
});

test('18 — parent completion waits for the durable reconciliation child', async () => {
  const h = harness();
  await h.run.runStage({ kind: 'final_validation', phase: 'validating' }, () => ok({ exitCode: 0 }, 1));

  // A required reconciliation child that is registered but still running blocks.
  const pending = await new Promise<DurableAgentRunChild>((resolve) => {
    void h.run.runStage({ kind: 'reconciliation', phase: 'reconciling' }, async (child) => {
      resolve(child);
      return neverSettles();
    });
  });
  const blocked = h.run.finalize({});
  assert.equal(blocked.state, 'FAILED');
  assert.equal(blocked.blockers.some((b) => b.kind === 'active_required_child' && b.childId === pending.childId), true);
});

test('19 — a parent terminal write that fails reports a non-durable outcome', async () => {
  const h = harness();
  await h.run.runStage({ kind: 'final_validation', phase: 'validating' }, () => ok({ exitCode: 0 }, 1));

  h.store.failParentTransition = true;
  const final = h.run.finalize({});
  assert.equal(final.state, 'COMPLETED', 'the evidence says complete');
  assert.equal(final.durable, false, 'but nothing recorded it');
  assert.notEqual(h.run.payload.phase, 'terminal', 'phase must NOT claim terminal without a durable parent revision');

  h.store.failParentTransition = false;
  const retried = h.run.finalize({});
  assert.equal(retried.durable, true);
  assert.equal(h.run.payload.phase, 'terminal');
});

// ── phase advancement ────────────────────────────────────────────────────────

test('the payload phase advances only after the child terminal revision is durable', async () => {
  const h = harness();
  const phasesDuringWork: string[] = [];
  await h.run.runStage({ kind: 'initial_apply', phase: 'executing_initial_changeset' }, async () => {
    phasesDuringWork.push(h.run.payload.phase);
    return ok({ applied: true }, 1);
  });
  assert.deepEqual(phasesDuringWork, ['planning'], 'the phase had not advanced while work was still in flight');
  assert.equal(h.run.payload.phase, 'executing_initial_changeset', 'it advanced once the child was terminal');
});

// ── evidence contracts ───────────────────────────────────────────────────────

test('a partial mutation never terminates as successful', () => {
  const partial = applyEvidence({
    changeset: { ops: [] },
    requestedPaths: ['src/a.ts'],
    result: { ok: false, refusal: 'apply-failed', message: 'rollback failed', offendingPaths: ['src/a.ts'], mutated: 'partial', engineCode: 'INCONSISTENT_STATE' },
  });
  assert.equal(partial.mutation, 'partial');
  assert.equal(partial.rollback, 'rollback-failed');
  assert.equal(applyOutcome(partial), 'failure', 'a partial mutation is never a success');

  const clean = applyEvidence({
    changeset: { ops: [] }, requestedPaths: ['src/a.ts'],
    result: { ok: true, mutated: true, proposalHash: 'p', paths: ['src/a.ts'], result: { rolledBack: false } as never },
  });
  assert.equal(clean.mutation, 'complete');
  assert.equal(applyOutcome(clean), 'success');

  const rolledBack = applyEvidence({
    changeset: { ops: [] }, requestedPaths: ['src/a.ts'],
    result: { ok: true, mutated: true, proposalHash: 'p', paths: ['src/a.ts'], result: { rolledBack: true } as never },
  });
  assert.equal(rolledBack.mutation, 'none', 'a rolled-back apply left nothing behind');
});

test('reconciliation evidence summarises authoritative records without inventing state', () => {
  const evidence = reconciliationEvidence({
    reconciliation: {
      approved: ['src/a.ts', 'src/b.ts'], attempted: ['src/a.ts'], refused: [], written: ['src/a.ts'],
      unusedScope: ['src/b.ts'], diffPaths: ['src/a.ts'], blockers: [], consistent: true,
    },
    findings: [{ kind: 'child_orphaned', childId: 'c9', detail: 'x' }],
    blockers: [{ kind: 'active_required_child', childId: 'c1', state: 'running' }],
    terminalDurable: false,
  });
  assert.deepEqual(evidence.approvedPaths, ['src/a.ts', 'src/b.ts']);
  assert.deepEqual(evidence.unusedScope, ['src/b.ts']);
  assert.deepEqual(evidence.childFindings, [{ kind: 'child_orphaned', childId: 'c9' }]);
  assert.equal(evidence.completion, 'incomplete', 'a child blocker makes it incomplete even though the diff reconciled');
  assert.equal(evidence.terminalWrite, 'not-durable');
});

test('two runs in ONE journal each register their own children', async () => {
  // The defect this closes: child_id is a global PRIMARY KEY, and the default id
  // was `kind_attempt` — so the FIRST coding run in a database worked and every
  // one after it was refused DUPLICATE_CHILD before registering anything. Unit
  // tests never saw it because each built a fresh in-memory journal.
  const persistence = new MemoryAgentRunJournalPersistence();
  const journal = new AgentRunJournal(persistence, DEFAULT_AGENT_RUN_JOURNAL_CONFIG, () => 'ev');

  const results: string[] = [];
  for (const runId of ['run_a', 'run_b']) {
    persistence.insertAgentRun({ ...parentRow(), runId }, { eventId: `e_${runId}`, runId, seq: 1, at: 1_000, type: 'run.created', nextState: 'AWAITING_APPROVAL', correlationId: 'corr_1', source: 'API', schemaVersion: 1 });
    const store = new TestStore(initialCodingPayload('issue'));
    const run = new JournaledCodingRun(journal, runId, store, () => 1_000);
    const stage = await run.runStage({ kind: 'repository_planning', phase: 'planning' }, () => ok({ planned: true }, runId));
    results.push(`${runId}:${stage.status}`);
  }

  assert.deepEqual(results, ['run_a:completed', 'run_b:completed'], 'the second run must not collide with the first');
  assert.equal(journal.children('run_a').length, 1);
  assert.equal(journal.children('run_b').length, 1);
  assert.notEqual(journal.children('run_a')[0]!.childId, journal.children('run_b')[0]!.childId, 'child ids are namespaced by run');
});
