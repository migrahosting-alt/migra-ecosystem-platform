/**
 * Acceptance for the coding dispatch invariant and parent reconciliation.
 *
 * Every case here is a way the system could report work it cannot account for.
 * The bar is not "the happy path persists" — it is that a parent can never claim
 * success while any required child is unresolved, missing, cancelled, or merely
 * believed to have finished.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentRunJournal, DEFAULT_AGENT_RUN_JOURNAL_CONFIG, MemoryAgentRunJournalPersistence } from '../src/engine/agentRunJournal.js';
import type { DurableAgentRun, DurableAgentRunChild } from '../src/engine/persistence/types.js';
import {
  activeRequiredChildren,
  codingCompletionEligibility,
  confirmCodingChildCancellation,
  finishCodingChild,
  markInterruptedChildren,
  reconcileCodingChildren,
  registerCodingChild,
  requestCodingChildCancellation,
  resolveCodingRun,
  startCodingChild,
} from '../src/engine/coding/codingChildren.js';
import { CODING_DOMAIN_KIND, initialCodingPayload, type CodingRunPayloadV1 } from '../src/engine/coding/codingRunPayload.js';

const RUN_ID = 'run_1';

function parentRun(): DurableAgentRun {
  return {
    runId: RUN_ID, correlationId: 'corr_1', activationRef: 'act', workspaceIdentity: 'ws', workspaceRef: 'wsref',
    recipeId: CODING_DOMAIN_KIND, recipePolicyVersion: 'v1', proposalFingerprint: 'fp', proposalHash: 'ph',
    snapshotId: 'snap', snapshotManifestDigest: 'digest', executableDigest: 'exec', state: 'EXECUTING',
    requestedAt: 1_000, proposalAt: 1_000, expiresAt: 9_000_000, timeoutMs: 1_000, outputLimitBytes: 1_024,
    mutationClassification: 'workspace-write-possible', networkPolicy: 'not-required', expectedEffectsJson: '[]',
    approvalLifecycleVersion: 1, approvalLifecycle: 'APPROVED', recoveryClass: 'NONE', recoveryEligible: false,
    recoveryAttemptCount: 0, auditSeq: 1, schemaVersion: 1, version: 1, reconciliationFence: 0, updatedAt: 1_000,
    domainKind: CODING_DOMAIN_KIND, domainSchemaVersion: 1,
  };
}
function createdEvent() {
  return { eventId: 'e1', runId: RUN_ID, seq: 1, at: 1_000, type: 'run.created', nextState: 'AWAITING_APPROVAL' as const, correlationId: 'corr_1', source: 'API' as const, schemaVersion: 1 };
}

/** A harness whose payload writer can be made to fail on demand — the only way to
 * exercise "the reference did not land". */
function harness(opts: { failPayloadWrite?: boolean } = {}) {
  const persistence = new MemoryAgentRunJournalPersistence();
  const journal = new AgentRunJournal(persistence, DEFAULT_AGENT_RUN_JOURNAL_CONFIG, () => 'ev');
  persistence.insertAgentRun(parentRun(), createdEvent());
  let stored: CodingRunPayloadV1 = initialCodingPayload('cancelled lines are counted');
  const writes: string[] = [];
  const state = { fail: opts.failPayloadWrite ?? false };
  const writePayload = async (payload: CodingRunPayloadV1, note: string): Promise<boolean> => {
    if (state.fail) return false;
    stored = payload;
    writes.push(note);
    return true;
  };
  return {
    journal, writePayload, writes, state,
    get payload() { return stored; },
    get children() { return journal.children(RUN_ID); },
  };
}

// ── 1. child created but parent reference fails → zero dispatch ──────────────

test('a child whose parent reference fails is never dispatched', async () => {
  const h = harness({ failPayloadWrite: true });
  const registration = (await registerCodingChild(h.journal, h.writePayload, {
    runId: RUN_ID, payload: h.payload, childId: 'c_apply', kind: 'initial_apply', at: 2_000,
  }));

  assert.equal(registration.decision, 'refused', 'refusal is the ONLY safe answer — dispatch must not proceed');
  assert.equal(registration.decision === 'refused' && registration.reason.includes('parent reference not persisted'), true);

  // The child row exists and is terminal-but-never-started, so nothing can later
  // mistake it for live work.
  const child = (await h.journal.child('c_apply'));
  assert.equal(child?.state, 'failed');
  assert.equal(child?.terminalCategory, 'orphaned_before_dispatch');
  assert.equal(child?.startedAt, undefined, 'a refused child was never started');

  // And the parent must not be claiming it.
  assert.deepEqual(registration.payload.childRefs, []);
  assert.deepEqual(registration.payload.abandonedChildIds, ['c_apply']);
});

test('the reference is persisted BEFORE dispatch is permitted', async () => {
  const h = harness();
  const registration = (await registerCodingChild(h.journal, h.writePayload, {
    runId: RUN_ID, payload: h.payload, childId: 'c_plan', kind: 'repository_planning', at: 2_000,
  }));
  assert.equal(registration.decision, 'dispatch');
  // The payload write happened during registration, not after.
  assert.deepEqual(h.writes, ['child.registered:repository_planning']);
  assert.deepEqual(h.payload.childRefs, [{ childId: 'c_plan', kind: 'repository_planning', attempt: 1 }]);
  assert.equal((await h.journal.child('c_plan'))?.state, 'created', 'still created — the caller has not dispatched yet');
});

// ── 2–3. bidirectional reconciliation ────────────────────────────────────────

test('a parent that references a missing child is a reconciliation failure', () => {
  const findings = reconcileCodingChildren(
    { childRefs: [{ childId: 'c_gone', kind: 'initial_apply', attempt: 1 }] },
    [],
    false,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.kind, 'parent_references_missing_child');
  assert.match(findings[0]?.detail ?? '', /unknowable/);
});

test('an orphaned child is detected, and a never-dispatched one is not alarming', () => {
  const dispatched = { childId: 'c_orphan', runId: RUN_ID, kind: 'initial_apply', attempt: 1, state: 'running', required: true, revision: 2, createdAt: 1, schemaVersion: 1, updatedAt: 1 } as DurableAgentRunChild;
  const never = { ...dispatched, childId: 'c_never', state: 'created' as const, revision: 1 };

  const findings = reconcileCodingChildren({ childRefs: [] }, [dispatched, never], false);
  const orphan = findings.find((f) => f.childId === 'c_orphan');
  const untouched = findings.find((f) => f.childId === 'c_never');
  assert.equal(orphan?.kind, 'child_orphaned', 'work was sent with no parent record naming it');
  assert.equal(untouched?.kind, 'child_never_dispatched', 'created-only is the benign case the ordering guarantees');

  // A child the parent explicitly abandoned is accounted for, not an orphan.
  const accounted = reconcileCodingChildren({ childRefs: [], abandonedChildIds: ['c_orphan'] }, [dispatched], false);
  assert.deepEqual(accounted, []);
});

// ── 4–5. completion gating ───────────────────────────────────────────────────

test('an active required child blocks the parent terminal state', async () => {
  const h = harness();
  const reg = (await registerCodingChild(h.journal, h.writePayload, { runId: RUN_ID, payload: h.payload, childId: 'c1', kind: 'validation', at: 2_000 }));
  assert.equal(reg.decision, 'dispatch');
  startCodingChild(h.journal, (reg as { child: DurableAgentRunChild }).child, 2_100);

  assert.deepEqual((await activeRequiredChildren(h.journal, RUN_ID)).map((c) => c.childId), ['c1']);
  const eligibility = codingCompletionEligibility(h.payload, (await h.children));
  assert.equal(eligibility.mayComplete, false);
  assert.ok(eligibility.blockers.some((b) => b.kind === 'active_required_child'), JSON.stringify(eligibility.blockers));
});

test('a failed required child blocks success even though it is terminal', async () => {
  const h = harness();
  const reg = (await registerCodingChild(h.journal, h.writePayload, { runId: RUN_ID, payload: h.payload, childId: 'c1', kind: 'validation', at: 2_000 }));
  const started = (await startCodingChild(h.journal, (reg as { child: DurableAgentRunChild }).child, 2_100))!;
  finishCodingChild(h.journal, started, 'failure', 2_200, { exitCode: 1 });

  assert.deepEqual((await activeRequiredChildren(h.journal, RUN_ID)), [], 'it IS terminal');
  const eligibility = codingCompletionEligibility(h.payload, (await h.children));
  assert.equal(eligibility.mayComplete, false, 'terminality is not success');
  const failed = eligibility.blockers.find((b) => b.kind === 'required_child_not_successful');
  assert.ok(failed, JSON.stringify(eligibility.blockers));
  assert.equal('category' in failed && failed.category, 'observed_failure');
});

test('an interrupted required child blocks success — the outcome is unknown, not good', async () => {
  const h = harness();
  const reg = (await registerCodingChild(h.journal, h.writePayload, { runId: RUN_ID, payload: h.payload, childId: 'c1', kind: 'initial_apply', at: 2_000 }));
  startCodingChild(h.journal, (reg as { child: DurableAgentRunChild }).child, 2_100);
  const interrupted = (await markInterruptedChildren(h.journal, RUN_ID, 3_000));

  assert.equal(interrupted[0]?.state, 'interrupted');
  assert.equal(interrupted[0]?.terminalCategory, 'interrupted_by_restart');
  assert.equal(codingCompletionEligibility(h.payload, (await h.children)).mayComplete, false);
});

// ── 6–7. cancellation ────────────────────────────────────────────────────────

test('a cancelled child requires a CONFIRMED cancellation', async () => {
  const h = harness();
  const reg = (await registerCodingChild(h.journal, h.writePayload, { runId: RUN_ID, payload: h.payload, childId: 'c1', kind: 'validation', at: 2_000 }));
  const started = (await startCodingChild(h.journal, (reg as { child: DurableAgentRunChild }).child, 2_100))!;

  const cancelling = (await requestCodingChildCancellation(h.journal, started, 2_200))!;
  assert.equal(cancelling.state, 'cancelling', 'a request is not an outcome');
  assert.equal(cancelling.cancellationConfirmedAt, undefined);
  assert.equal((await activeRequiredChildren(h.journal, RUN_ID)).length, 1, 'cancelling work is still unresolved');

  const cancelled = (await confirmCodingChildCancellation(h.journal, cancelling, 2_300, { signal: 'SIGTERM' }))!;
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.cancellationConfirmedAt, 2_300);
  assert.equal(cancelled.terminalCategory, 'cancellation_confirmed');
  assert.equal(codingCompletionEligibility(h.payload, (await h.children)).mayComplete, false, 'a cancelled child is never a success');
});

test('a late child success cannot override a cancelling parent', async () => {
  const h = harness();
  const reg = (await registerCodingChild(h.journal, h.writePayload, { runId: RUN_ID, payload: h.payload, childId: 'c1', kind: 'validation', at: 2_000 }));
  const started = (await startCodingChild(h.journal, (reg as { child: DurableAgentRunChild }).child, 2_100))!;
  const cancelling = (await requestCodingChildCancellation(h.journal, started, 2_200))!;
  const cancelled = (await confirmCodingChildCancellation(h.journal, cancelling, 2_300, {}))!;

  // The work reports success after cancellation was confirmed. It must be
  // discarded: the child is terminal and terminal is immutable.
  const late = (await finishCodingChild(h.journal, cancelled, 'success', 2_400, { exitCode: 0 }));
  assert.equal(late, undefined, 'the late success was refused');
  assert.equal((await h.journal.child('c1'))?.state, 'cancelled');
  assert.equal((await h.journal.child('c1'))?.terminalCategory, 'cancellation_confirmed');

  // And at parent level a confirmed cancellation resolves to CANCELLED, never
  // COMPLETED, regardless of what arrived afterwards.
  const cancelledPayload: CodingRunPayloadV1 = { ...h.payload, cancellation: { requestedAt: 't1', confirmedAt: 't2' } };
  const resolved = resolveCodingRun(cancelledPayload, (await h.children), () => true);
  assert.equal(resolved.state, 'CANCELLED');
});

test('a cancellation requested but never confirmed fails rather than reporting cancelled', () => {
  const h = harness();
  const payload: CodingRunPayloadV1 = { ...h.payload, cancellation: { requestedAt: 't1' } };
  const resolved = resolveCodingRun(payload, [], () => true);
  assert.equal(resolved.state, 'FAILED', 'work may still be running — "cancelled" would be a claim nobody verified');
  assert.equal(resolved.blockers.some((b) => b.kind === 'cancellation_unconfirmed'), true);
});

// ── 8. independent revisions ─────────────────────────────────────────────────

test('parent and child revision conflicts are independent', async () => {
  const h = harness();
  const reg = (await registerCodingChild(h.journal, h.writePayload, { runId: RUN_ID, payload: h.payload, childId: 'c1', kind: 'validation', at: 2_000 }));
  const child = (reg as { child: DurableAgentRunChild }).child;

  const started = (await startCodingChild(h.journal, child, 2_100));
  assert.ok(started);
  assert.equal(started.revision, 2);

  // A caller still holding revision 1 loses; the winner's record is unchanged.
  const stale = (await startCodingChild(h.journal, child, 2_150));
  assert.equal(stale, undefined);
  assert.equal((await h.journal.child('c1'))?.revision, 2);

  // A second, different child keeps its own counter — they do not share one.
  const other = (await registerCodingChild(h.journal, h.writePayload, { runId: RUN_ID, payload: h.payload, childId: 'c2', kind: 'final_validation', at: 2_200 }));
  assert.equal((other as { child: DurableAgentRunChild }).child.revision, 1);
});

// ── 9. terminal persistence failure ──────────────────────────────────────────

test('a terminal write that does not land suppresses the completion claim', async () => {
  const h = harness();
  const reg = (await registerCodingChild(h.journal, h.writePayload, { runId: RUN_ID, payload: h.payload, childId: 'c1', kind: 'validation', at: 2_000 }));
  const started = (await startCodingChild(h.journal, (reg as { child: DurableAgentRunChild }).child, 2_100))!;
  finishCodingChild(h.journal, started, 'success', 2_200, { exitCode: 0 });

  // Every child succeeded, so the run is genuinely eligible...
  assert.equal(codingCompletionEligibility(h.payload, (await h.children)).mayComplete, true);

  // ...but the terminal revision fails to persist. `durable` must report that.
  const resolved = resolveCodingRun(h.payload, (await h.children), () => false);
  assert.equal(resolved.state, 'COMPLETED');
  assert.equal(resolved.durable, false, 'the outcome may be real but is NOT recorded — the caller must not report plain success');

  const persisted = resolveCodingRun(h.payload, (await h.children), () => true);
  assert.equal(persisted.durable, true);
});

test('a fully successful run with every reference intact may complete', async () => {
  const h = harness();
  for (const [id, kind] of [['c1', 'repository_planning'], ['c2', 'initial_apply'], ['c3', 'final_validation']] as const) {
    const reg = (await registerCodingChild(h.journal, h.writePayload, { runId: RUN_ID, payload: h.payload, childId: id, kind, at: 2_000 }));
    assert.equal(reg.decision, 'dispatch');
    const started = (await startCodingChild(h.journal, (reg as { child: DurableAgentRunChild }).child, 2_100))!;
    finishCodingChild(h.journal, started, 'success', 2_200, { exitCode: 0 });
  }
  const eligibility = codingCompletionEligibility(h.payload, (await h.children));
  assert.deepEqual(eligibility.blockers, []);
  assert.deepEqual(eligibility.findings, []);
  assert.equal(eligibility.mayComplete, true);
  assert.equal(resolveCodingRun(h.payload, (await h.children), () => true).state, 'COMPLETED');
});

test('an optional child that fails does not block completion', async () => {
  const h = harness();
  const required = (await registerCodingChild(h.journal, h.writePayload, { runId: RUN_ID, payload: h.payload, childId: 'c1', kind: 'final_validation', at: 2_000 }));
  const startedRequired = (await startCodingChild(h.journal, (required as { child: DurableAgentRunChild }).child, 2_050))!;
  finishCodingChild(h.journal, startedRequired, 'success', 2_100, { exitCode: 0 });

  const optional = (await registerCodingChild(h.journal, h.writePayload, { runId: RUN_ID, payload: h.payload, childId: 'c2', kind: 'reconciliation', required: false, at: 2_200 }));
  const startedOptional = (await startCodingChild(h.journal, (optional as { child: DurableAgentRunChild }).child, 2_250))!;
  finishCodingChild(h.journal, startedOptional, 'failure', 2_300, { note: 'advisory only' });

  assert.equal(codingCompletionEligibility(h.payload, (await h.children)).mayComplete, true);
});

test('a run under cancellation refuses to acquire new children', async () => {
  const h = harness();
  const cancelling: CodingRunPayloadV1 = { ...h.payload, cancellation: { requestedAt: 't1' } };
  const refused = (await registerCodingChild(h.journal, h.writePayload, { runId: RUN_ID, payload: cancelling, childId: 'c_new', kind: 'repair_apply', at: 2_000 }));
  assert.equal(refused.decision, 'refused');
  assert.equal((await h.journal.child('c_new')), undefined, 'no row was written at all');
});

test('a run that recorded no work is never COMPLETED', async () => {
  // Observed in the installed acceptance: planning failed before registering any
  // child, leaving `children: [], blockers: []` — and the run reported COMPLETED
  // because nothing had objected. Completion must rest on positive evidence.
  const empty = codingCompletionEligibility({ childRefs: [] }, []);
  assert.equal(empty.mayComplete, false);
  assert.equal(empty.blockers[0]?.kind, 'no_work_recorded');

  const resolved = resolveCodingRun({ childRefs: [] }, [], () => true);
  assert.equal(resolved.state, 'FAILED', 'a run with no recorded work resolves FAILED, not COMPLETED');

  // A single successful required child is enough to clear this particular blocker.
  const h = harness();
  const reg = (await registerCodingChild(h.journal, h.writePayload, { runId: RUN_ID, payload: h.payload, childId: 'c1', kind: 'final_validation', at: 2_000 }));
  const started = (await startCodingChild(h.journal, (reg as { child: DurableAgentRunChild }).child, 2_050))!;
  finishCodingChild(h.journal, started, 'success', 2_100, { exitCode: 0 });
  assert.equal(codingCompletionEligibility(h.payload, (await h.children)).mayComplete, true);
});
