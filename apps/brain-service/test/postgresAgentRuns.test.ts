/**
 * Sub-slice 2 · Group 4 — agent run journal parity with SQLite.
 *
 * The contention behaviour lives in postgresAgentRunConcurrency.test.ts. This
 * file is about the other half: that every method returns what SQLite returns.
 *
 * Where a comparison is possible it is made against a REAL SqliteDurableStore
 * running the same calls, rather than against hand-written expectations — a
 * hand-written expectation only proves the port matches what I believed SQLite
 * did, which is exactly the assumption most likely to be wrong.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SqliteDurableStore } from '../src/engine/persistence/sqliteStore.js';
import { PostgresConnection } from '../src/engine/persistence/postgres/pool.js';
import { withScope } from '../src/engine/persistence/postgres/conversationRepo.js';
import {
  RecoveryEventInsertError, appendAgentRunEvent, appendAgentRunEventNext,
  appendAgentRunEventUnderFence, claimAgentRunReconciliation, insertAgentRun, loadAgentRun,
  loadAgentRunEvents, loadAgentRunTombstones, loadAgentRuns, pruneAgentRuns, reproposeAgentRun,
  transitionAgentRun,
} from '../src/engine/persistence/postgres/agentRunRepo.js';
import {
  insertAgentRunChild, loadAgentRunChild, loadAgentRunChildren, transitionAgentRunChild,
} from '../src/engine/persistence/postgres/agentRunChildRepo.js';
import { recoveryEventDigest } from '../src/engine/recoverySourceProvenance.js';
import type {
  AgentRunReproposalInput, DurableAgentRun, DurableAgentRunChild, DurableAgentRunEvent,
  DurableAgentRunState,
} from '../src/engine/persistence/types.js';
import {
  appRoleUrl, postgresTestSkipReason, startDisposablePostgres, type DisposablePostgres,
} from './support/disposablePostgres.js';

let pg: DisposablePostgres | undefined;
let skip: string | null = null;
let appUrl: string;
let tmp: string;

const A = { ownerScope: 'user:alice', workspaceScope: 'org:acme' };
const B = { ownerScope: 'user:bob', workspaceScope: 'org:globex' };

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'brain-g4-'));
  skip = await postgresTestSkipReason();
  if (!skip) {
    pg = await startDisposablePostgres();
    const c = new PostgresConnection({ databaseUrl: pg.databaseUrl });
    await c.migrate();
    await c.close();
    appUrl = await appRoleUrl(pg.databaseUrl);
  }
}, { timeout: 180_000 });

after(async () => {
  await pg?.stop();
  rmSync(tmp, { recursive: true, force: true });
});

const conn = () => new PostgresConnection({ databaseUrl: appUrl, applicationName: 'group4' });

async function scoped<T>(scope: typeof A, fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = conn();
  try {
    return await c.transaction((client) => withScope(client, scope, () => fn(client)));
  } finally {
    await c.close();
  }
}

let sqliteSeq = 0;
const sqlite = (): SqliteDurableStore =>
  new SqliteDurableStore(join(tmp, `parity-${++sqliteSeq}.db`));

/** Every optional field populated, so a dropped column cannot hide behind a null. */
function fullRun(runId: string, state: DurableAgentRunState = 'AWAITING_APPROVAL'): DurableAgentRun {
  return {
    runId, correlationId: `corr-${runId}`, externalRequestRef: 'ext-ref',
    activationRef: 'act-1', workspaceIdentity: 'ws-identity', workspaceRef: 'ws-ref',
    recipeId: 'recipe-1', recipePolicyVersion: 'v1', proposalFingerprint: 'fp',
    proposalHash: 'hash', snapshotId: 'snap', snapshotManifestDigest: 'digest',
    executableDigest: 'exec-digest', containmentUnit: 'unit-1', containmentBinding: 'bind-1',
    state, requestedAt: 1_000, proposalAt: 1_100, approvalDisplayedAt: 1_200,
    approvalDecisionAt: 1_300, executionStartedAt: 1_400, terminalAt: 1_500,
    expiresAt: 9_000_000, timeoutMs: 30_000, outputLimitBytes: 1_048_576,
    mutationClassification: 'READ_ONLY', networkPolicy: 'DENY', expectedEffectsJson: '[]',
    previewJson: '{"p":1}', resultJson: '{"r":1}', errorJson: '{"e":1}',
    exitCode: 3, signal: 'SIGTERM', failureCode: 'F1',
    interruptionClassification: 'HOST_RESTART',
    approvalLifecycleVersion: 2, approvalLifecycle: 'APPROVED',
    approvalRequestedAt: 1_250, approvalExpiresAt: 1_900,
    approvalDecisionType: 'APPROVED', approvalInvalidationReason: 'NONE',
    approvalActorRef: 'actor-1',
    recoveryClass: 'REPROPOSAL_ALLOWED', recoveryEligible: true, recoveryReason: 'transient',
    recoverySourceRunId: 'src-run', successorRunId: 'succ-run', reproposalAt: 1_600,
    recoveryAttemptCount: 2, lastRecoveryRequestId: 'req-1',
    recoveryTerminalReason: 'GAVE_UP',
    auditSeq: 0, schemaVersion: 1, version: 1,
    reconciliationOwner: 'worker-0', reconciliationLeaseUntil: 5_000,
    reconciliationFence: 0, updatedAt: 1_000,
    domainKind: 'coding', domainSchemaVersion: 1, domainPayloadJson: '{"d":1}',
  } as DurableAgentRun;
}

function created(runId: string, state: DurableAgentRunState): DurableAgentRunEvent {
  return {
    eventId: `${runId}:0:CREATED`, runId, seq: 0, at: 1_000, type: 'CREATED',
    nextState: state, correlationId: `corr-${runId}`, source: 'API', schemaVersion: 1,
  };
}

// ─── Field-level parity ─────────────────────────────────────────────────────

test('a fully-populated run round-trips identically to SQLite', { skip: skip ?? false }, async () => {
  const run = fullRun('run-parity-1');
  const ev = created('run-parity-1', run.state);

  const sq = sqlite();
  sq.insertAgentRun(run, ev);
  const fromSqlite = sq.loadAgentRun('run-parity-1');
  sq.close();

  await scoped(A, (c) => insertAgentRun(c, run, ev));
  const fromPg = await scoped(A, (c) => loadAgentRun(c, 'run-parity-1'));

  assert.ok(fromSqlite);
  assert.deepEqual(fromPg, fromSqlite, 'every column must survive both engines identically');
});

test('a minimally-populated run round-trips identically to SQLite', { skip: skip ?? false }, async () => {
  // The mirror case: absent optionals must come back absent, not as nulls or
  // empty strings.
  const run = {
    runId: 'run-parity-2', correlationId: 'corr-2', activationRef: 'act',
    workspaceIdentity: 'wsi', workspaceRef: 'wsr', recipeId: 'r', recipePolicyVersion: 'v',
    proposalFingerprint: 'fp', proposalHash: 'h', snapshotId: 's', snapshotManifestDigest: 'd',
    executableDigest: 'ed', state: 'IDLE', requestedAt: 1, expiresAt: 2, timeoutMs: 3,
    outputLimitBytes: 4, mutationClassification: 'READ_ONLY', networkPolicy: 'DENY',
    expectedEffectsJson: '[]', approvalLifecycleVersion: 1, approvalLifecycle: 'NOT_REQUESTED',
    recoveryClass: 'NONE', recoveryEligible: false, recoveryAttemptCount: 0,
    auditSeq: 0, schemaVersion: 1, version: 1, reconciliationFence: 0, updatedAt: 1,
  } as DurableAgentRun;
  const ev = created('run-parity-2', 'IDLE');

  const sq = sqlite();
  sq.insertAgentRun(run, ev);
  const fromSqlite = sq.loadAgentRun('run-parity-2');
  sq.close();

  await scoped(A, (c) => insertAgentRun(c, run, ev));
  const fromPg = await scoped(A, (c) => loadAgentRun(c, 'run-parity-2'));

  assert.deepEqual(fromPg, fromSqlite);
});

test('creation writes the CREATED event at seq 1 and sets audit_seq to 1', { skip: skip ?? false }, async () => {
  const run = fullRun('run-created-1', 'IDLE');
  const ev = created('run-created-1', 'IDLE');

  const sq = sqlite();
  sq.insertAgentRun(run, ev);
  const sqEvents = sq.loadAgentRunEvents('run-created-1');
  const sqAudit = sq.loadAgentRun('run-created-1')!.auditSeq;
  sq.close();

  await scoped(A, (c) => insertAgentRun(c, run, ev));
  const pgEvents = await scoped(A, (c) => loadAgentRunEvents(c, 'run-created-1'));
  const pgAudit = (await scoped(A, (c) => loadAgentRun(c, 'run-created-1')))!.auditSeq;

  assert.deepEqual(pgEvents, sqEvents);
  assert.equal(pgAudit, sqAudit);
  assert.equal(pgAudit, 1);
});

test('a transition writes the same event SQLite writes', { skip: skip ?? false }, async () => {
  const run = fullRun('run-trans-1', 'AWAITING_APPROVAL');
  const ev = created('run-trans-1', 'AWAITING_APPROVAL');
  const input = {
    runId: 'run-trans-1', expectedState: 'AWAITING_APPROVAL' as const,
    nextState: 'APPROVED' as const, at: 2_000, source: 'APPROVAL' as const,
    eventType: 'APPROVED', reason: 'looks fine',
  };

  const sq = sqlite();
  sq.insertAgentRun(run, ev);
  const sqOk = sq.transitionAgentRun(input);
  const sqEvents = sq.loadAgentRunEvents('run-trans-1');
  const sqRun = sq.loadAgentRun('run-trans-1');
  sq.close();

  await scoped(A, (c) => insertAgentRun(c, run, ev));
  const pgOk = await scoped(A, (c) => transitionAgentRun(c, input));
  const pgEvents = await scoped(A, (c) => loadAgentRunEvents(c, 'run-trans-1'));
  const pgRun = await scoped(A, (c) => loadAgentRun(c, 'run-trans-1'));

  assert.equal(pgOk, sqOk);
  assert.deepEqual(pgEvents, sqEvents);
  assert.deepEqual(pgRun, sqRun, 'the whole row must agree, not just the state');
});

// ─── Event append ladder ────────────────────────────────────────────────────

test('appendAgentRunEventNext allocates the next sequence, matching SQLite', { skip: skip ?? false }, async () => {
  const run = fullRun('run-append-1', 'EXECUTING');
  const ev = created('run-append-1', 'EXECUTING');
  const next = {
    eventId: 'run-append-1:note', runId: 'run-append-1', at: 3_000, type: 'NOTE',
    nextState: 'EXECUTING' as const, correlationId: 'corr-run-append-1',
    source: 'API' as const, schemaVersion: 1,
  };

  const sq = sqlite();
  sq.insertAgentRun(run, ev);
  sq.appendAgentRunEvent(next);
  const sqEvents = sq.loadAgentRunEvents('run-append-1');
  const sqAudit = sq.loadAgentRun('run-append-1')!.auditSeq;
  sq.close();

  await scoped(A, (c) => insertAgentRun(c, run, ev));
  await scoped(A, (c) => appendAgentRunEventNext(c, next));
  const pgEvents = await scoped(A, (c) => loadAgentRunEvents(c, 'run-append-1'));
  const pgAudit = (await scoped(A, (c) => loadAgentRun(c, 'run-append-1')))!.auditSeq;

  assert.deepEqual(pgEvents, sqEvents);
  assert.equal(pgAudit, sqAudit);
});

test('appending to an unknown run throws, as in SQLite', { skip: skip ?? false }, async () => {
  await assert.rejects(
    scoped(A, (c) => appendAgentRunEventNext(c, {
      eventId: 'x', runId: 'no-such-run', at: 1, type: 'NOTE', nextState: 'IDLE',
      correlationId: 'c', source: 'API', schemaVersion: 1,
    })),
    /unknown Agent run/,
  );
});

test('re-appending an identical event is a no-op; a changed one is refused', { skip: skip ?? false }, async () => {
  const run = fullRun('run-idem-1', 'EXECUTING');
  await scoped(A, (c) => insertAgentRun(c, run, created('run-idem-1', 'EXECUTING')));

  const e: DurableAgentRunEvent = {
    eventId: 'run-idem-1:5', runId: 'run-idem-1', seq: 5, at: 100, type: 'NOTE',
    nextState: 'EXECUTING', correlationId: 'corr-run-idem-1', source: 'API', schemaVersion: 1,
  };
  await scoped(A, (c) => appendAgentRunEvent(c, e));

  // Identical replay in idempotent mode: silently accepted.
  await scoped(A, (c) => appendAgentRunEvent(c, e));

  // Same id in strict mode: an explicit collision.
  await assert.rejects(
    scoped(A, (c) => appendAgentRunEvent(c, e, 'strict')),
    (err: unknown) => err instanceof RecoveryEventInsertError
      && err.code === 'RECOVERY_EVENT_ID_COLLISION',
  );

  // Same id, different content: never acceptable, in either mode.
  await assert.rejects(
    scoped(A, (c) => appendAgentRunEvent(c, { ...e, reason: 'changed' })),
    (err: unknown) => err instanceof RecoveryEventInsertError
      && err.code === 'RECOVERY_EVENT_CONTENT_MISMATCH',
  );

  // Different id landing on an occupied sequence.
  await assert.rejects(
    scoped(A, (c) => appendAgentRunEvent(c, { ...e, eventId: 'run-idem-1:other' })),
    (err: unknown) => err instanceof RecoveryEventInsertError
      && err.code === 'RECOVERY_EVENT_SEQUENCE_CONFLICT',
  );

  const events = await scoped(A, (c) => loadAgentRunEvents(c, 'run-idem-1'));
  assert.equal(events.filter((x) => x.seq === 5).length, 1, 'exactly one event at seq 5');
});

test('a refused append leaves the transaction usable', { skip: skip ?? false }, async () => {
  // PostgreSQL aborts a transaction on a real constraint violation, so the
  // conflict path deliberately avoids throwing at the SQL layer. If it ever
  // regressed to a raw violation, this second statement would fail with
  // "current transaction is aborted".
  const run = fullRun('run-abort-1', 'EXECUTING');
  await scoped(A, (c) => insertAgentRun(c, run, created('run-abort-1', 'EXECUTING')));

  const out = await scoped(A, async (c) => {
    const e: DurableAgentRunEvent = {
      eventId: 'run-abort-1:1', runId: 'run-abort-1', seq: 1, at: 1, type: 'DUP',
      nextState: 'EXECUTING', correlationId: 'corr-run-abort-1', source: 'API', schemaVersion: 1,
    };
    // seq 1 is already occupied by CREATED.
    await assert.rejects(appendAgentRunEvent(c, e),
      (err: unknown) => err instanceof RecoveryEventInsertError
        && err.code === 'RECOVERY_EVENT_SEQUENCE_CONFLICT');
    const r = await c.query(`SELECT count(*) AS c FROM agent_run_events WHERE run_id = $1`, ['run-abort-1']);
    return Number((r.rows[0] as { c: string }).c);
  });
  assert.equal(out, 1);
});

// ─── Fenced append ──────────────────────────────────────────────────────────

test('a fenced append matches SQLite and is idempotent on replay', { skip: skip ?? false }, async () => {
  const run = fullRun('run-fenced-1', 'EXECUTING');
  const ev = created('run-fenced-1', 'EXECUTING');

  const sq = sqlite();
  sq.insertAgentRun(run, ev);
  const sqClaim = sq.claimAgentRunReconciliation('run-fenced-1', 'w1', 50_000, 10_000)!;
  const sqFenced = sq.appendAgentRunEventUnderFence({
    runId: 'run-fenced-1', at: 11_000, source: 'RECONCILIATION', eventType: 'PROBE',
    eventId: 'run-fenced-1:probe',
    reconciliation: { owner: 'w1', fence: sqClaim.fence, leaseValidAt: 11_000, expectedVersion: sqClaim.version },
  });
  const sqEvents = sq.loadAgentRunEvents('run-fenced-1');
  sq.close();

  await scoped(A, (c) => insertAgentRun(c, run, ev));
  const pgClaim = (await scoped(A, (c) => claimAgentRunReconciliation(c, 'run-fenced-1', 'w1', 50_000, 10_000)))!;
  const pgFenced = await scoped(A, (c) => appendAgentRunEventUnderFence(c, {
    runId: 'run-fenced-1', at: 11_000, source: 'RECONCILIATION', eventType: 'PROBE',
    eventId: 'run-fenced-1:probe',
    reconciliation: { owner: 'w1', fence: pgClaim.fence, leaseValidAt: 11_000, expectedVersion: pgClaim.version },
  }));

  assert.deepEqual(pgClaim, sqClaim);
  assert.deepEqual(pgFenced, sqFenced);
  assert.deepEqual(await scoped(A, (c) => loadAgentRunEvents(c, 'run-fenced-1')), sqEvents);

  // Replaying the same event id under a now-stale version: refused, and — the
  // point of the test — refused without writing a second audit entry.
  const replay = await scoped(A, (c) => appendAgentRunEventUnderFence(c, {
    runId: 'run-fenced-1', at: 12_000, source: 'RECONCILIATION', eventType: 'PROBE',
    eventId: 'run-fenced-1:probe',
    reconciliation: { owner: 'w1', fence: pgClaim.fence, leaseValidAt: 12_000, expectedVersion: pgClaim.version },
  }));
  assert.equal(replay, undefined);
  assert.equal((await scoped(A, (c) => loadAgentRunEvents(c, 'run-fenced-1'))).length, sqEvents.length);
});

test('a fenced append with the wrong fence writes nothing', { skip: skip ?? false }, async () => {
  const run = fullRun('run-fenced-2', 'EXECUTING');
  await scoped(A, (c) => insertAgentRun(c, run, created('run-fenced-2', 'EXECUTING')));
  const claim = (await scoped(A, (c) => claimAgentRunReconciliation(c, 'run-fenced-2', 'w1', 50_000, 10_000)))!;

  const before = await scoped(A, (c) => loadAgentRunEvents(c, 'run-fenced-2'));
  const out = await scoped(A, (c) => appendAgentRunEventUnderFence(c, {
    runId: 'run-fenced-2', at: 11_000, source: 'RECONCILIATION', eventType: 'PROBE',
    reconciliation: { owner: 'w1', fence: claim.fence + 7, leaseValidAt: 11_000, expectedVersion: claim.version },
  }));
  assert.equal(out, undefined);
  assert.deepEqual(await scoped(A, (c) => loadAgentRunEvents(c, 'run-fenced-2')), before);
});

// ─── Ordering and limits ────────────────────────────────────────────────────

test('loadAgentRuns orders by updated_at descending and clamps the limit', { skip: skip ?? false }, async () => {
  for (const [i, id] of ['ord-1', 'ord-2', 'ord-3'].entries()) {
    const run = { ...fullRun(id, 'IDLE'), updatedAt: 100 + i * 10 };
    await scoped(B, (c) => insertAgentRun(c, run, created(id, 'IDLE')));
  }
  const rows = await scoped(B, (c) => loadAgentRuns(c));
  const ids = rows.map((r) => r.runId);
  assert.deepEqual(ids.slice(0, 3), ['ord-3', 'ord-2', 'ord-1']);

  // A zero/negative limit clamps to 1 rather than returning everything.
  assert.equal((await scoped(B, (c) => loadAgentRuns(c, 0))).length, 1);
  assert.equal((await scoped(B, (c) => loadAgentRuns(c, -5))).length, 1);
});

test('loadAgentRunEvents orders by sequence and clamps the limit', { skip: skip ?? false }, async () => {
  const run = fullRun('run-order-ev', 'EXECUTING');
  await scoped(A, (c) => insertAgentRun(c, run, created('run-order-ev', 'EXECUTING')));
  for (let i = 0; i < 4; i++) {
    await scoped(A, (c) => appendAgentRunEventNext(c, {
      eventId: `run-order-ev:${i}`, runId: 'run-order-ev', at: 100 + i, type: 'NOTE',
      nextState: 'EXECUTING', correlationId: 'corr-run-order-ev', source: 'API', schemaVersion: 1,
    }));
  }
  const events = await scoped(A, (c) => loadAgentRunEvents(c, 'run-order-ev'));
  assert.deepEqual(events.map((e) => e.seq), [1, 2, 3, 4, 5]);
  assert.equal((await scoped(A, (c) => loadAgentRunEvents(c, 'run-order-ev', 2))).length, 2);
});

// ─── Retention ──────────────────────────────────────────────────────────────

test('prune removes an eligible run and records a tombstone matching SQLite', { skip: skip ?? false }, async () => {
  const run = {
    ...fullRun('run-prune-1', 'COMPLETED'),
    terminalAt: 1_000, reconciliationOwner: undefined, reconciliationLeaseUntil: undefined,
    successorRunId: undefined, recoverySourceRunId: undefined,
  } as DurableAgentRun;
  const ev = created('run-prune-1', 'COMPLETED');

  const sq = sqlite();
  sq.insertAgentRun(run, ev);
  const sqCounts = sq.pruneAgentRuns(5_000, 10, 6_000);
  const sqTombs = sq.loadAgentRunTombstones();
  sq.close();

  await scoped(A, (c) => insertAgentRun(c, run, ev));
  const pgCounts = await scoped(A, (c) => pruneAgentRuns(c, 5_000, 10, 6_000));
  const pgTombs = await scoped(A, (c) => loadAgentRunTombstones(c));

  assert.deepEqual(pgCounts, sqCounts);
  assert.deepEqual(pgCounts, { runs: 1, events: 1 });
  assert.deepEqual(pgTombs, sqTombs);
  assert.equal(await scoped(A, (c) => loadAgentRun(c, 'run-prune-1')), undefined);
});

test('prune spares a run still under an active reconciliation lease', { skip: skip ?? false }, async () => {
  const run = {
    ...fullRun('run-prune-2', 'COMPLETED'), terminalAt: 1_000,
    reconciliationOwner: 'w1', reconciliationLeaseUntil: 999_000,
    successorRunId: undefined, recoverySourceRunId: undefined,
  } as DurableAgentRun;
  await scoped(A, (c) => insertAgentRun(c, run, created('run-prune-2', 'COMPLETED')));
  const counts = await scoped(A, (c) => pruneAgentRuns(c, 5_000, 10, 6_000));
  assert.deepEqual(counts, { runs: 0, events: 0 });
  assert.ok(await scoped(A, (c) => loadAgentRun(c, 'run-prune-2')));
});

test('prune spares a run whose successor is still live', { skip: skip ?? false }, async () => {
  const successor = {
    ...fullRun('run-succ-live', 'EXECUTING'), terminalAt: undefined,
    reconciliationOwner: undefined, reconciliationLeaseUntil: undefined,
    successorRunId: undefined, recoverySourceRunId: undefined,
  } as DurableAgentRun;
  await scoped(A, (c) => insertAgentRun(c, successor, created('run-succ-live', 'EXECUTING')));

  const source = {
    ...fullRun('run-prune-3', 'COMPLETED'), terminalAt: 1_000,
    reconciliationOwner: undefined, reconciliationLeaseUntil: undefined,
    successorRunId: 'run-succ-live', recoverySourceRunId: undefined,
  } as DurableAgentRun;
  await scoped(A, (c) => insertAgentRun(c, source, created('run-prune-3', 'COMPLETED')));

  assert.deepEqual(await scoped(A, (c) => pruneAgentRuns(c, 5_000, 10, 6_000)), { runs: 0, events: 0 });
  assert.ok(await scoped(A, (c) => loadAgentRun(c, 'run-prune-3')));
});

test('prune cannot reach another tenant runs', { skip: skip ?? false }, async () => {
  const run = {
    ...fullRun('run-prune-iso', 'COMPLETED'), terminalAt: 1_000,
    reconciliationOwner: undefined, reconciliationLeaseUntil: undefined,
    successorRunId: undefined, recoverySourceRunId: undefined,
  } as DurableAgentRun;
  await scoped(A, (c) => insertAgentRun(c, run, created('run-prune-iso', 'COMPLETED')));

  // Tenant B prunes aggressively; RLS means it never sees A's row as a
  // candidate, so nothing of A's is deleted.
  assert.deepEqual(await scoped(B, (c) => pruneAgentRuns(c, 999_999, 100, 999_999)), { runs: 0, events: 0 });
  assert.ok(await scoped(A, (c) => loadAgentRun(c, 'run-prune-iso')));
});

// ─── Reproposal ─────────────────────────────────────────────────────────────

/**
 * A source run that genuinely passes provenance revalidation: rejected by a
 * human, terminal, and carrying a recoverable terminal contract. Built with the
 * same shape the SQLite reproposal tests use, because the provenance validator
 * checks the whole event chain — a hand-waved fixture fails for the wrong reason
 * and would make these tests prove nothing.
 */
function reproposalRun(over: Partial<DurableAgentRun> = {}): DurableAgentRun {
  return {
    runId: 'src_1', correlationId: 'src_corr', activationRef: 'actref',
    workspaceIdentity: 'workspace-id', workspaceRef: 'wsref',
    recipeId: 'git.status', recipePolicyVersion: 'agent-git-readonly-v2',
    proposalFingerprint: 'fingerprint', proposalHash: 'hash', snapshotId: 'snapshot',
    snapshotManifestDigest: 'manifest', executableDigest: 'exec',
    state: 'AWAITING_APPROVAL', requestedAt: 1000, proposalAt: 1000, expiresAt: 2000,
    timeoutMs: 30000, outputLimitBytes: 65536, mutationClassification: 'read-only',
    networkPolicy: 'not-required', expectedEffectsJson: '[]',
    previewJson: '{"recipe":"git.status"}', approvalLifecycleVersion: 1,
    approvalLifecycle: 'PENDING_DISPLAY', approvalRequestedAt: 1000, approvalExpiresAt: 2000,
    recoveryClass: 'NONE', recoveryEligible: false, recoveryAttemptCount: 0,
    reconciliationFence: 0, auditSeq: 0, schemaVersion: 1, version: 1, updatedAt: 1000,
    ...over,
  } as DurableAgentRun;
}

function reproposalEvent(over: Partial<DurableAgentRunEvent> = {}): DurableAgentRunEvent {
  const runId = over.runId ?? 'src_1';
  return {
    eventId: `${runId}:ev1`, runId, seq: 1, at: 1000, type: 'run.created',
    nextState: 'AWAITING_APPROVAL', correlationId: 'src_corr', source: 'API',
    schemaVersion: 1, ...over,
  };
}

const REJECT_PATCH = {
  terminalAt: 1100, failureCode: 'REJECTED', approvalLifecycle: 'REJECTED' as const,
  approvalDecisionType: 'REJECTED' as const, approvalDecisionAt: 1100,
  recoveryClass: 'REPROPOSAL_ALLOWED' as const, recoveryEligible: true,
  recoveryReason: 'REJECTED',
};

/** Seeds the rejected source into BOTH engines so results can be compared. */
async function seedRejectedSource(sq: SqliteDurableStore, runId: string): Promise<DurableAgentRun> {
  const run = reproposalRun({ runId, correlationId: `${runId}_corr` });
  const ev = reproposalEvent({ runId, correlationId: `${runId}_corr` });
  const proposal = {
    eventId: `${runId}:proposal`, runId, at: 1000, type: 'proposal.created',
    priorState: 'AWAITING_APPROVAL' as const, nextState: 'AWAITING_APPROVAL' as const,
    reason: run.recipeId, correlationId: `${runId}_corr`, source: 'API' as const, schemaVersion: 1,
  };
  const reject = {
    runId, expectedState: 'AWAITING_APPROVAL' as const, nextState: 'REJECTED' as const,
    at: 1100, source: 'APPROVAL' as const, eventType: 'approval.rejected',
    reason: 'HUMAN_REJECTED', patch: REJECT_PATCH,
  };

  sq.insertAgentRun(run, ev);
  sq.appendAgentRunEvent(proposal);
  assert.equal(sq.transitionAgentRun(reject), true);

  await scoped(A, (c) => insertAgentRun(c, run, ev));
  await scoped(A, (c) => appendAgentRunEventNext(c, proposal));
  assert.equal(await scoped(A, (c) => transitionAgentRun(c, reject)), true);

  const sqSource = sq.loadAgentRun(runId)!;
  const pgSource = await scoped(A, (c) => loadAgentRun(c, runId));
  assert.deepEqual(pgSource, sqSource, 'both engines must agree on the source before reproposing');
  return sqSource;
}

function reproposalInput(
  source: DurableAgentRun, events: DurableAgentRunEvent[],
  requestId: string, successorId: string, at = 2_000,
): AgentRunReproposalInput {
  const successor = reproposalRun({
    runId: successorId, correlationId: `${successorId}_corr`, requestedAt: at,
    proposalAt: at, expiresAt: at + 1_000, recoverySourceRunId: source.runId,
    proposalFingerprint: `${successorId}_fp`, proposalHash: `${successorId}_hash`,
    snapshotId: `${successorId}_snap`, snapshotManifestDigest: `${successorId}_manifest`,
  });
  return {
    sourceRunId: source.runId, sourceExpectedVersion: source.version, requestId, at,
    provenance: {
      workspaceIdentity: source.workspaceIdentity,
      allowedRecipes: [source.recipeId],
      eventDigest: recoveryEventDigest(events),
      highestSeq: source.auditSeq,
    },
    successor,
    createdEvent: reproposalEvent({
      eventId: `${successorId}:created`, runId: successorId,
      correlationId: `${successorId}_corr`, type: 'run.created' }),
    proposalEvent: reproposalEvent({
      eventId: `${successorId}:proposal`, runId: successorId,
      correlationId: `${successorId}_corr`, seq: 2, type: 'proposal.created' }),
  };
}

test('reproposal links a successor and matches SQLite, including the replay', { skip: skip ?? false }, async () => {
  const sq = sqlite();
  const source = await seedRejectedSource(sq, 'src_ok');
  const events = sq.loadAgentRunEvents('src_ok');
  const input = reproposalInput(source, events, 'req-1', 'succ_ok');

  const sqResult = sq.reproposeAgentRun(input);
  const pgResult = await scoped(A, (c) => reproposeAgentRun(c, input));
  assert.equal(sqResult.ok, true, 'the fixture must actually pass provenance');
  assert.deepEqual(pgResult, sqResult);

  // Source lineage and successor must agree field for field.
  assert.deepEqual(
    await scoped(A, (c) => loadAgentRun(c, 'src_ok')), sq.loadAgentRun('src_ok'));
  assert.deepEqual(
    await scoped(A, (c) => loadAgentRun(c, 'succ_ok')), sq.loadAgentRun('succ_ok'));
  assert.deepEqual(
    await scoped(A, (c) => loadAgentRunEvents(c, 'src_ok')), sq.loadAgentRunEvents('src_ok'));
  assert.deepEqual(
    await scoped(A, (c) => loadAgentRunEvents(c, 'succ_ok')), sq.loadAgentRunEvents('succ_ok'));

  // Replaying the same request id returns the existing successor, not a conflict.
  const replayInput = reproposalInput(
    sq.loadAgentRun('src_ok')!, sq.loadAgentRunEvents('src_ok'), 'req-1', 'succ_ok');
  const sqReplay = sq.reproposeAgentRun(replayInput);
  const pgReplay = await scoped(A, (c) => reproposeAgentRun(c, replayInput));
  assert.equal(sqReplay.ok && sqReplay.created, false);
  assert.deepEqual(pgReplay, sqReplay);
  sq.close();
});

test('reproposal refusals match SQLite code for code', { skip: skip ?? false }, async () => {
  const sq = sqlite();
  const source = await seedRejectedSource(sq, 'src_refuse');
  const events = sq.loadAgentRunEvents('src_refuse');

  // Unknown source.
  const unknown = { ...reproposalInput(source, events, 'r', 's1'), sourceRunId: 'nope' };
  assert.deepEqual(await scoped(A, (c) => reproposeAgentRun(c, unknown)), sq.reproposeAgentRun(unknown));

  // Version moved under the caller.
  const stale = { ...reproposalInput(source, events, 'r', 's2'), sourceExpectedVersion: 999 };
  assert.deepEqual(await scoped(A, (c) => reproposeAgentRun(c, stale)), sq.reproposeAgentRun(stale));

  // Provenance digest that does not match the stored history.
  const tampered = reproposalInput(source, events, 'r', 's3');
  const badDigest = {
    ...tampered,
    provenance: { ...tampered.provenance, eventDigest: 'deadbeef' },
  };
  assert.deepEqual(await scoped(A, (c) => reproposeAgentRun(c, badDigest)), sq.reproposeAgentRun(badDigest));
  sq.close();
});

test('a failed reproposal leaves no successor behind', { skip: skip ?? false }, async () => {
  // The savepoint test. Without ROLLBACK TO SAVEPOINT, the successor row and its
  // two lineage events would be inserted, the source would fail to link, and the
  // caller would COMMIT that half-built state — a run that exists but is
  // reachable from nothing.
  const sq = sqlite();
  const source = await seedRejectedSource(sq, 'src_rollback');
  const events = sq.loadAgentRunEvents('src_rollback');
  const input = reproposalInput(source, events, 'req-x', 'succ_orphan');

  // Occupy the successor's created-event id so the strict append collides
  // AFTER the successor row has already been inserted.
  await scoped(A, (c) => insertAgentRun(
    c,
    reproposalRun({ runId: 'blocker', correlationId: 'blocker_corr', state: 'IDLE' }),
    reproposalEvent({
      eventId: `${input.successor.runId}:created`, runId: 'blocker',
      correlationId: 'blocker_corr', nextState: 'IDLE' }),
  ));

  const result = await scoped(A, (c) => reproposeAgentRun(c, input));
  assert.equal(result.ok, false);

  assert.equal(await scoped(A, (c) => loadAgentRun(c, 'succ_orphan')), undefined,
    'the successor row must not survive a failed reproposal');
  const after = await scoped(A, (c) => loadAgentRun(c, 'src_rollback'));
  assert.equal(after?.successorRunId, undefined, 'the source must not be linked');
  assert.equal(after?.version, source.version, 'the source must be untouched');
  sq.close();
});

// ─── Children ───────────────────────────────────────────────────────────────

function child(childId: string, runId: string, over: Partial<DurableAgentRunChild> = {}): DurableAgentRunChild {
  return {
    childId, runId, kind: 'TOOL', attempt: 1, state: 'created', required: true, revision: 1,
    createdAt: 100, schemaVersion: 1, updatedAt: 100, ...over,
  } as DurableAgentRunChild;
}

test('a child round-trips identically to SQLite', { skip: skip ?? false }, async () => {
  const run = fullRun('run-child-1', 'EXECUTING');
  const ev = created('run-child-1', 'EXECUTING');
  const ch = child('child-1', 'run-child-1', {
    startedAt: 150, metadataJson: '{"m":1}', required: false, attempt: 2,
  });

  const sq = sqlite();
  sq.insertAgentRun(run, ev);
  const sqIns = sq.insertAgentRunChild(ch);
  const sqLoad = sq.loadAgentRunChild('child-1');
  sq.close();

  await scoped(A, (c) => insertAgentRun(c, run, ev));
  const pgIns = await scoped(A, (c) => insertAgentRunChild(c, ch));
  const pgLoad = await scoped(A, (c) => loadAgentRunChild(c, 'child-1'));

  assert.deepEqual(pgIns, sqIns);
  assert.deepEqual(pgLoad, sqLoad);
});

test('a child under an unknown or terminal parent is refused with the SQLite code', { skip: skip ?? false }, async () => {
  assert.deepEqual(
    await scoped(A, (c) => insertAgentRunChild(c, child('orphan', 'no-such-run'))),
    { ok: false, code: 'UNKNOWN_PARENT' });

  const run = fullRun('run-child-term', 'COMPLETED');
  await scoped(A, (c) => insertAgentRun(c, run, created('run-child-term', 'COMPLETED')));
  assert.deepEqual(
    await scoped(A, (c) => insertAgentRunChild(c, child('late', 'run-child-term'))),
    { ok: false, code: 'PARENT_TERMINAL' });
});

test('a duplicate child is refused by id and by (run, kind, attempt)', { skip: skip ?? false }, async () => {
  const run = fullRun('run-child-dup', 'EXECUTING');
  await scoped(A, (c) => insertAgentRun(c, run, created('run-child-dup', 'EXECUTING')));
  await scoped(A, (c) => insertAgentRunChild(c, child('dup-1', 'run-child-dup')));

  const byId = await scoped(A, (c) => insertAgentRunChild(c, child('dup-1', 'run-child-dup')));
  assert.equal(byId.ok, false);
  assert.equal(byId.ok === false ? byId.code : '', 'DUPLICATE_CHILD');

  // Different id, same logical identity.
  const byIdentity = await scoped(A, (c) => insertAgentRunChild(c, child('dup-2', 'run-child-dup')));
  assert.equal(byIdentity.ok, false);
  assert.equal(byIdentity.ok === false ? byIdentity.code : '', 'DUPLICATE_CHILD');
});

test('child transitions enforce SQLite guard order: terminal beats a fresh revision', { skip: skip ?? false }, async () => {
  const run = fullRun('run-child-2', 'EXECUTING');
  const ev = created('run-child-2', 'EXECUTING');
  const ch = child('child-2', 'run-child-2');

  const sq = sqlite();
  sq.insertAgentRun(run, ev);
  sq.insertAgentRunChild(ch);
  sq.transitionAgentRunChild({ childId: 'child-2', expectedRevision: 1, nextState: 'running', at: 200 });
  const sqDone = sq.transitionAgentRunChild({ childId: 'child-2', expectedRevision: 2, nextState: 'completed', at: 300 });
  // Revision 3 is genuinely current, but the child is finished.
  const sqAfter = sq.transitionAgentRunChild({ childId: 'child-2', expectedRevision: 3, nextState: 'failed', at: 400 });
  sq.close();

  await scoped(A, (c) => insertAgentRun(c, run, ev));
  await scoped(A, (c) => insertAgentRunChild(c, ch));
  await scoped(A, (c) => transitionAgentRunChild(c, { childId: 'child-2', expectedRevision: 1, nextState: 'running', at: 200 }));
  const pgDone = await scoped(A, (c) => transitionAgentRunChild(c, { childId: 'child-2', expectedRevision: 2, nextState: 'completed', at: 300 }));
  const pgAfter = await scoped(A, (c) => transitionAgentRunChild(c, { childId: 'child-2', expectedRevision: 3, nextState: 'failed', at: 400 }));

  assert.deepEqual(pgDone, sqDone);
  assert.deepEqual(pgAfter, sqAfter);
  assert.equal(pgAfter.ok, false);
  assert.equal(pgAfter.ok === false ? pgAfter.code : '', 'TERMINAL_CHILD_IMMUTABLE');
});

test('child transitions refuse stale revisions and illegal moves', { skip: skip ?? false }, async () => {
  const run = fullRun('run-child-3', 'EXECUTING');
  await scoped(A, (c) => insertAgentRun(c, run, created('run-child-3', 'EXECUTING')));
  await scoped(A, (c) => insertAgentRunChild(c, child('child-3', 'run-child-3')));

  const stale = await scoped(A, (c) => transitionAgentRunChild(c, {
    childId: 'child-3', expectedRevision: 99, nextState: 'running', at: 200 }));
  assert.equal(stale.ok === false ? stale.code : '', 'STALE_REVISION');

  const illegal = await scoped(A, (c) => transitionAgentRunChild(c, {
    childId: 'child-3', expectedRevision: 1, nextState: 'created', at: 200 }));
  assert.equal(illegal.ok === false ? illegal.code : '', 'ILLEGAL_TRANSITION');

  const unknown = await scoped(A, (c) => transitionAgentRunChild(c, {
    childId: 'nope', expectedRevision: 1, nextState: 'running', at: 200 }));
  assert.deepEqual(unknown, { ok: false, code: 'UNKNOWN_CHILD' });
});

test('children are listed in SQLite order and are tenant-isolated', { skip: skip ?? false }, async () => {
  const run = fullRun('run-child-4', 'EXECUTING');
  await scoped(A, (c) => insertAgentRun(c, run, created('run-child-4', 'EXECUTING')));
  await scoped(A, (c) => insertAgentRunChild(c, child('c-b', 'run-child-4', { createdAt: 100, kind: 'K1' })));
  await scoped(A, (c) => insertAgentRunChild(c, child('c-a', 'run-child-4', { createdAt: 100, kind: 'K2' })));
  await scoped(A, (c) => insertAgentRunChild(c, child('c-z', 'run-child-4', { createdAt: 50, kind: 'K3' })));

  const listed = await scoped(A, (c) => loadAgentRunChildren(c, 'run-child-4'));
  assert.deepEqual(listed.map((x) => x.childId), ['c-z', 'c-a', 'c-b'],
    'created_at ascending, then child_id ascending');

  assert.deepEqual(await scoped(B, (c) => loadAgentRunChildren(c, 'run-child-4')), []);
  assert.equal(await scoped(B, (c) => loadAgentRunChild(c, 'c-a')), undefined);
});

// ─── Tenant isolation on reads ──────────────────────────────────────────────

test('runs, events and tombstones are invisible across tenants', { skip: skip ?? false }, async () => {
  const run = {
    ...fullRun('run-iso-read', 'COMPLETED'), terminalAt: 1_000,
    reconciliationOwner: undefined, reconciliationLeaseUntil: undefined,
    successorRunId: undefined, recoverySourceRunId: undefined,
  } as DurableAgentRun;
  await scoped(A, (c) => insertAgentRun(c, run, created('run-iso-read', 'COMPLETED')));

  assert.equal(await scoped(B, (c) => loadAgentRun(c, 'run-iso-read')), undefined);
  assert.deepEqual(await scoped(B, (c) => loadAgentRunEvents(c, 'run-iso-read')), []);
  assert.equal(
    (await scoped(B, (c) => loadAgentRuns(c))).some((r) => r.runId === 'run-iso-read'), false);

  await scoped(A, (c) => pruneAgentRuns(c, 5_000, 10, 6_000));
  const aTombs = await scoped(A, (c) => loadAgentRunTombstones(c));
  assert.ok(aTombs.some((t) => t.runId === 'run-iso-read'));
  const bTombs = await scoped(B, (c) => loadAgentRunTombstones(c));
  assert.equal(bTombs.some((t) => t.runId === 'run-iso-read'), false);
});
