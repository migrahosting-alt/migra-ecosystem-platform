/**
 * Sub-slice 2 · Group 4 — agent run CAS and fencing under REAL concurrency.
 *
 * Every contention test here runs on genuinely separate pooled connections with
 * genuinely overlapping transactions, synchronised by a countdown latch so the
 * competing statements are in flight at the same time. This is deliberate: a
 * CAS test that runs its contenders sequentially on one connection passes
 * against an implementation with a wide-open check-then-act race, which is
 * exactly the bug class this suite exists to catch.
 *
 * Confirmed by mutation, not assumed: reverting the adapter to the literal
 * SQLite shape (plain snapshot read, no row lock, sequence derived from the
 * pre-read audit_seq) fails three of these tests — single-winner CAS,
 * self-transition parity, and gap-free sequencing.
 *
 * Note that a self-transition (nextState === current state, e.g. a heartbeat)
 * is deliberately NOT a one-winner race. SQLite appends one event per call, so
 * all N succeed; what must hold is that the resulting sequence is dense and
 * duplicate-free. That expectation is measured against a real SqliteDurableStore
 * in the test rather than hard-coded, so the two engines are compared directly.
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
  claimAgentRunReconciliation, insertAgentRun, renewAgentRunReconciliation, transitionAgentRun,
} from '../src/engine/persistence/postgres/agentRunRepo.js';
import type {
  DurableAgentRun, DurableAgentRunEvent, DurableAgentRunState,
} from '../src/engine/persistence/types.js';
import {
  appRoleUrl, postgresTestSkipReason, startDisposablePostgres, type DisposablePostgres,
} from './support/disposablePostgres.js';

let pg: DisposablePostgres | undefined;
let skip: string | null = null;
let appUrl: string;

const A = { ownerScope: 'user:alice', workspaceScope: 'org:acme' };
const B = { ownerScope: 'user:bob', workspaceScope: 'org:globex' };

/** Contenders per contention test. Enough to force real lock queueing. */
const N = 8;

before(async () => {
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
});

/**
 * Shared pool sized above the contender count — if the pool were smaller than
 * N the contenders would queue in the CLIENT rather than in the database, and
 * the test would silently stop testing concurrency.
 */
const conn = () => new PostgresConnection({
  databaseUrl: appUrl,
  applicationName: 'group4-concurrency',
  max: N + 4,
});

/** Countdown latch: releases only once all N participants have arrived. */
function latch(n: number) {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let arrived = 0;
  return async function arrive(): Promise<void> {
    if (++arrived >= n) release();
    await gate;
  };
}

function makeRun(runId: string, state: DurableAgentRunState = 'AWAITING_APPROVAL'): DurableAgentRun {
  return {
    runId,
    correlationId: `corr-${runId}`,
    activationRef: 'act-1',
    workspaceIdentity: 'ws-identity',
    workspaceRef: 'ws-ref',
    recipeId: 'recipe-1',
    recipePolicyVersion: 'v1',
    proposalFingerprint: 'fp',
    proposalHash: 'hash',
    snapshotId: 'snap',
    snapshotManifestDigest: 'digest',
    executableDigest: 'exec-digest',
    state,
    requestedAt: 1_000,
    expiresAt: 9_000_000,
    timeoutMs: 30_000,
    outputLimitBytes: 1_048_576,
    mutationClassification: 'READ_ONLY',
    networkPolicy: 'DENY',
    expectedEffectsJson: '[]',
    approvalLifecycleVersion: 1,
    approvalLifecycle: 'NOT_REQUESTED',
    recoveryClass: 'NONE',
    recoveryEligible: false,
    recoveryAttemptCount: 0,
    auditSeq: 0,
    schemaVersion: 1,
    version: 1,
    reconciliationFence: 0,
    updatedAt: 1_000,
  } as DurableAgentRun;
}

/**
 * The creation event every run gets. SQLite forces it to seq 1 and sets
 * audit_seq = 1, so the first *transition* event on any run is seq 2.
 */
function createdEvent(runId: string, state: DurableAgentRunState): DurableAgentRunEvent {
  return {
    eventId: `${runId}:0:CREATED`, runId, seq: 0, at: 1_000, type: 'CREATED',
    nextState: state, correlationId: `corr-${runId}`, source: 'API', schemaVersion: 1,
  };
}

/** One scoped transaction on its own pooled connection. */
async function scoped<T>(
  pool: PostgresConnection,
  scope: typeof A,
  fn: (c: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  return pool.transaction((client) => withScope(client, scope, () => fn(client)));
}

async function seed(pool: PostgresConnection, runId: string, state: DurableAgentRunState = 'AWAITING_APPROVAL', scope = A) {
  await scoped(pool, scope, (c) => insertAgentRun(c, makeRun(runId, state), createdEvent(runId, state)));
}

async function readRun(pool: PostgresConnection, runId: string, scope = A) {
  return scoped(pool, scope, async (c) => {
    const r = await c.query(
      `SELECT state, audit_seq, version, reconciliation_owner, reconciliation_fence,
              reconciliation_lease_until, terminal_at
       FROM agent_runs WHERE run_id = $1`, [runId]);
    return r.rows[0] as Record<string, unknown> | undefined;
  });
}

/**
 * Transition events only. Every run is created with a CREATED event at seq 1
 * (SQLite's contract), so transition sequences legitimately start at 2 — these
 * assertions are about what the transitions wrote, not about that baseline.
 */
async function readTransitionSeqs(pool: PostgresConnection, runId: string, scope = A): Promise<number[]> {
  return scoped(pool, scope, async (c) => {
    const r = await c.query(
      `SELECT seq FROM agent_run_events WHERE run_id = $1 AND type <> 'CREATED'
       ORDER BY seq, ins_seq`, [runId]);
    return r.rows.map((x: { seq: string }) => Number(x.seq));
  });
}

// ─── Contention: state-changing transition ──────────────────────────────────

test('N concurrent transitions produce exactly one winner and exactly one event', { skip: skip ?? false }, async () => {
  const pool = conn();
  try {
    await seed(pool, 'run-cas-1');
    const arrive = latch(N);

    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => scoped(pool, A, async (c) => {
        await arrive();
        return transitionAgentRun(c, {
          runId: 'run-cas-1',
          expectedState: 'AWAITING_APPROVAL',
          nextState: 'APPROVED',
          at: 2_000 + i,
          source: 'APPROVAL',
          eventType: 'APPROVED',
        });
      })),
    );

    assert.equal(results.filter(Boolean).length, 1, 'exactly one transition may succeed');

    const row = await readRun(pool, 'run-cas-1');
    assert.equal(row?.state, 'APPROVED');
    assert.equal(Number(row?.audit_seq), 2, 'audit_seq advances exactly once past the CREATED event');
    assert.equal(Number(row?.version), 2, 'version advances exactly once');

    assert.deepEqual(await readTransitionSeqs(pool, 'run-cas-1'), [2]);
  } finally {
    await pool.close();
  }
});

// ─── Contention: SELF-transition (the case a literal port fails) ────────────

test('N concurrent self-transitions match SQLite exactly and never duplicate a sequence', { skip: skip ?? false }, async () => {
  const pool = conn();
  const dir = mkdtempSync(join(tmpdir(), 'brain-g4-self-'));
  try {
    // A self-transition (nextState === current state, e.g. a heartbeat) is NOT
    // a one-winner race: SQLite appends one event per call, so all N succeed.
    // Measured against SQLite rather than assumed — the whole point of the port
    // is that the two engines agree.
    const sq = new SqliteDurableStore(join(dir, 'parity.db'));
    const sqRun = makeRun('run-self-1', 'EXECUTING');
    sq.insertAgentRun(sqRun, {
      eventId: 'run-self-1:0:CREATED', runId: 'run-self-1', seq: 0, at: 1_000,
      type: 'CREATED', nextState: 'EXECUTING', correlationId: sqRun.correlationId,
      source: 'API', schemaVersion: 1,
    });
    let sqliteWins = 0;
    for (let i = 0; i < N; i++) {
      if (await sq.transitionAgentRun({
        runId: 'run-self-1', expectedState: 'EXECUTING', nextState: 'EXECUTING',
        at: 3_000 + i, source: 'EXECUTION', eventType: 'HEARTBEAT',
        eventId: `run-self-1:heartbeat:${i}`,
      })) sqliteWins++;
    }
    const sqliteSeqs = (await sq.loadAgentRunEvents('run-self-1'))
      .filter((e) => e.type === 'HEARTBEAT').map((e) => e.seq);
    sq.close();

    // Now the same N, concurrently, on separate connections.
    await seed(pool, 'run-self-1', 'EXECUTING');
    const arrive = latch(N);
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => scoped(pool, A, async (c) => {
        await arrive();
        return transitionAgentRun(c, {
          runId: 'run-self-1',
          expectedState: 'EXECUTING',
          nextState: 'EXECUTING',
          at: 3_000 + i,
          source: 'EXECUTION',
          eventType: 'HEARTBEAT',
          eventId: `run-self-1:heartbeat:${i}`,
        });
      })),
    );

    assert.equal(results.filter(Boolean).length, sqliteWins,
      'same number of successful self-transitions as SQLite');

    // The sharp assertion. A literal port derives each event's seq from a
    // pre-read audit_seq, so concurrent callers all compute the SAME seq and
    // collide on UNIQUE (run_id, seq) — surfacing as a thrown error rather than
    // a clean result. Deriving the seq from the UPDATE's RETURNING makes the
    // sequence dense and unique by construction.
    const pgSeqs = await readTransitionSeqs(pool, 'run-self-1');
    assert.equal(new Set(pgSeqs).size, pgSeqs.length, 'no duplicate audit sequence');
    assert.deepEqual(pgSeqs, sqliteSeqs, 'PostgreSQL sequences match SQLite exactly');

    const row = await readRun(pool, 'run-self-1');
    assert.equal(Number(row?.audit_seq), N + 1, 'audit_seq counted CREATED plus every transition');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    await pool.close();
  }
});

test('a rejected transition writes no event at all', { skip: skip ?? false }, async () => {
  const pool = conn();
  try {
    await seed(pool, 'run-noevent');
    const ok = await scoped(pool, A, (c) => transitionAgentRun(c, {
      runId: 'run-noevent',
      expectedState: 'EXECUTING', // wrong — run is AWAITING_APPROVAL
      nextState: 'COMPLETED',
      at: 4_000,
      source: 'API',
      eventType: 'COMPLETED',
    }));
    assert.equal(ok, false);
    assert.deepEqual(await readTransitionSeqs(pool, 'run-noevent'), []);
    const row = await readRun(pool, 'run-noevent');
    assert.equal(Number(row?.version), 1, 'a refused transition must not bump version');
  } finally {
    await pool.close();
  }
});

test('a terminal run refuses all further transitions concurrently', { skip: skip ?? false }, async () => {
  const pool = conn();
  try {
    await seed(pool, 'run-terminal', 'EXECUTING');
    assert.equal(await scoped(pool, A, (c) => transitionAgentRun(c, {
      runId: 'run-terminal', nextState: 'COMPLETED', at: 5_000,
      source: 'EXECUTION', eventType: 'COMPLETED',
    })), true);

    const arrive = latch(N);
    const results = await Promise.all(
      Array.from({ length: N }, () => scoped(pool, A, async (c) => {
        await arrive();
        return transitionAgentRun(c, {
          runId: 'run-terminal', nextState: 'FAILED', at: 6_000,
          source: 'EXECUTION', eventType: 'FAILED',
        });
      })),
    );
    assert.equal(results.filter(Boolean).length, 0, 'terminal is immutable');
    assert.deepEqual(await readTransitionSeqs(pool, 'run-terminal'), [2]);
  } finally {
    await pool.close();
  }
});

test('entering a terminal state releases the reconciliation lease', { skip: skip ?? false }, async () => {
  const pool = conn();
  try {
    await seed(pool, 'run-lease-release', 'EXECUTING');
    const claim = await scoped(pool, A, (c) =>
      claimAgentRunReconciliation(c, 'run-lease-release', 'worker-1', 50_000, 10_000));
    assert.ok(claim);

    assert.equal(await scoped(pool, A, (c) => transitionAgentRun(c, {
      runId: 'run-lease-release', nextState: 'FAILED', at: 11_000,
      source: 'RECONCILIATION', eventType: 'FAILED',
      reconciliation: { owner: 'worker-1', fence: claim.fence, leaseValidAt: 11_000 },
    })), true);

    const row = await readRun(pool, 'run-lease-release');
    assert.equal(row?.reconciliation_owner, null);
    assert.equal(row?.reconciliation_lease_until, null);
    assert.equal(Number(row?.terminal_at), 11_000, 'terminal_at stamped from `at`');
  } finally {
    await pool.close();
  }
});

// ─── Contention: reconciliation leases and fencing ──────────────────────────

test('N concurrent lease claims yield one holder and a fence advanced by exactly one', { skip: skip ?? false }, async () => {
  const pool = conn();
  try {
    await seed(pool, 'run-lease-1', 'EXECUTING');
    const arrive = latch(N);

    const claims = await Promise.all(
      Array.from({ length: N }, (_, i) => scoped(pool, A, async (c) => {
        await arrive();
        return claimAgentRunReconciliation(c, 'run-lease-1', `worker-${i}`, 60_000, 10_000);
      })),
    );

    const won = claims.filter(Boolean);
    assert.equal(won.length, 1, 'a lease has exactly one holder');
    assert.equal(won[0]!.fence, 1, 'fence advances by exactly one');

    const row = await readRun(pool, 'run-lease-1');
    assert.equal(Number(row?.reconciliation_fence), 1);
    assert.equal(row?.reconciliation_owner, won[0]!.owner);
  } finally {
    await pool.close();
  }
});

test('a stolen lease fences out the previous owner', { skip: skip ?? false }, async () => {
  const pool = conn();
  try {
    await seed(pool, 'run-fence-1', 'EXECUTING');

    const first = await scoped(pool, A, (c) =>
      claimAgentRunReconciliation(c, 'run-fence-1', 'worker-a', 20_000, 10_000));
    assert.ok(first);
    assert.equal(first.fence, 1);

    // Lease expires (now = 25_000 > leaseUntil = 20_000), so a different worker
    // may take it. This is the ugly case: worker-a is still alive and believes
    // it holds the lease.
    const second = await scoped(pool, A, (c) =>
      claimAgentRunReconciliation(c, 'run-fence-1', 'worker-b', 40_000, 25_000));
    assert.ok(second);
    assert.equal(second.fence, 2, 'a steal must advance the fence');

    // worker-a writes with its stale fence — must be refused even though its
    // owner string is still a real past holder.
    assert.equal(await scoped(pool, A, (c) => transitionAgentRun(c, {
      runId: 'run-fence-1', nextState: 'FAILED', at: 26_000,
      source: 'RECONCILIATION', eventType: 'FAILED',
      reconciliation: { owner: 'worker-a', fence: 1, leaseValidAt: 26_000 },
    })), false, 'stale fence must not write');

    // worker-b, holding the current fence, succeeds.
    assert.equal(await scoped(pool, A, (c) => transitionAgentRun(c, {
      runId: 'run-fence-1', nextState: 'FAILED', at: 27_000,
      source: 'RECONCILIATION', eventType: 'FAILED',
      reconciliation: { owner: 'worker-b', fence: 2, leaseValidAt: 27_000 },
    })), true);

    assert.deepEqual(await readTransitionSeqs(pool, 'run-fence-1'), [2]);
  } finally {
    await pool.close();
  }
});

test('an expired lease refuses its own holder mid-write', { skip: skip ?? false }, async () => {
  const pool = conn();
  try {
    await seed(pool, 'run-fence-2', 'EXECUTING');
    const claim = await scoped(pool, A, (c) =>
      claimAgentRunReconciliation(c, 'run-fence-2', 'worker-a', 20_000, 10_000));
    assert.ok(claim);

    // Correct owner, correct fence, but the lease has lapsed by the time the
    // write lands. leaseValidAt (30_000) is past reconciliation_lease_until.
    assert.equal(await scoped(pool, A, (c) => transitionAgentRun(c, {
      runId: 'run-fence-2', nextState: 'FAILED', at: 30_000,
      source: 'RECONCILIATION', eventType: 'FAILED',
      reconciliation: { owner: 'worker-a', fence: claim.fence, leaseValidAt: 30_000 },
    })), false, 'an expired lease grants no write, even to its rightful owner');
  } finally {
    await pool.close();
  }
});

test('reconciliation write is refused when expectedVersion has moved', { skip: skip ?? false }, async () => {
  const pool = conn();
  try {
    await seed(pool, 'run-fence-3', 'EXECUTING');
    const claim = await scoped(pool, A, (c) =>
      claimAgentRunReconciliation(c, 'run-fence-3', 'worker-a', 60_000, 10_000));
    assert.ok(claim);

    assert.equal(await scoped(pool, A, (c) => transitionAgentRun(c, {
      runId: 'run-fence-3', nextState: 'FAILED', at: 12_000,
      source: 'RECONCILIATION', eventType: 'FAILED',
      reconciliation: {
        owner: 'worker-a', fence: claim.fence, leaseValidAt: 12_000,
        expectedVersion: claim.version + 99,
      },
    })), false);

    assert.equal(await scoped(pool, A, (c) => transitionAgentRun(c, {
      runId: 'run-fence-3', nextState: 'FAILED', at: 13_000,
      source: 'RECONCILIATION', eventType: 'FAILED',
      reconciliation: {
        owner: 'worker-a', fence: claim.fence, leaseValidAt: 13_000,
        expectedVersion: claim.version,
      },
    })), true);
  } finally {
    await pool.close();
  }
});

test('a lease cannot be claimed on a terminal run', { skip: skip ?? false }, async () => {
  const pool = conn();
  try {
    await seed(pool, 'run-lease-terminal', 'EXECUTING');
    await scoped(pool, A, (c) => transitionAgentRun(c, {
      runId: 'run-lease-terminal', nextState: 'CANCELLED', at: 5_000,
      source: 'API', eventType: 'CANCELLED',
    }));
    assert.equal(await scoped(pool, A, (c) =>
      claimAgentRunReconciliation(c, 'run-lease-terminal', 'worker-x', 60_000, 6_000)), undefined);
  } finally {
    await pool.close();
  }
});

test('renewal requires the current fence and a still-valid lease', { skip: skip ?? false }, async () => {
  const pool = conn();
  try {
    await seed(pool, 'run-renew-1', 'EXECUTING');
    const claim = await scoped(pool, A, (c) =>
      claimAgentRunReconciliation(c, 'run-renew-1', 'worker-a', 20_000, 10_000));
    assert.ok(claim);

    assert.equal(await scoped(pool, A, (c) =>
      renewAgentRunReconciliation(c, 'run-renew-1', 'worker-a', claim.fence + 5, 30_000, 15_000)),
      undefined, 'wrong fence cannot renew');

    assert.equal(await scoped(pool, A, (c) =>
      renewAgentRunReconciliation(c, 'run-renew-1', 'worker-b', claim.fence, 30_000, 15_000)),
      undefined, 'wrong owner cannot renew');

    const renewed = await scoped(pool, A, (c) =>
      renewAgentRunReconciliation(c, 'run-renew-1', 'worker-a', claim.fence, 30_000, 15_000));
    assert.ok(renewed);
    assert.equal(renewed.leaseUntil, 30_000);
    assert.equal(renewed.fence, claim.fence, 'renewal does not advance the fence');

    // Once lapsed, renewal is no longer available — the holder must re-claim,
    // which is what forces the fence to move and invalidates stale writers.
    assert.equal(await scoped(pool, A, (c) =>
      renewAgentRunReconciliation(c, 'run-renew-1', 'worker-a', claim.fence, 60_000, 45_000)),
      undefined, 'a lapsed lease cannot be renewed, only re-claimed');
  } finally {
    await pool.close();
  }
});

test('N concurrent renewals of a held lease never advance the fence', { skip: skip ?? false }, async () => {
  const pool = conn();
  try {
    await seed(pool, 'run-renew-2', 'EXECUTING');
    const claim = await scoped(pool, A, (c) =>
      claimAgentRunReconciliation(c, 'run-renew-2', 'worker-a', 50_000, 10_000));
    assert.ok(claim);

    const arrive = latch(N);
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => scoped(pool, A, async (c) => {
        await arrive();
        return renewAgentRunReconciliation(c, 'run-renew-2', 'worker-a', claim.fence, 60_000 + i, 20_000);
      })),
    );

    assert.equal(results.filter(Boolean).length, N, 'the holder may renew repeatedly');
    const row = await readRun(pool, 'run-renew-2');
    assert.equal(Number(row?.reconciliation_fence), claim.fence, 'renewals never move the fence');
  } finally {
    await pool.close();
  }
});

// ─── Event sequencing ───────────────────────────────────────────────────────

test('a contended transition chain yields contiguous gap-free event sequences', { skip: skip ?? false }, async () => {
  const pool = conn();
  try {
    await seed(pool, 'run-seq-1', 'IDLE');

    // Each round has N contenders for one legal step; only one wins, so after
    // four rounds the journal must read exactly 1,2,3,4 with no gaps and no
    // duplicates — even though 32 transactions competed to write it.
    const steps: Array<[DurableAgentRunState, DurableAgentRunState]> = [
      ['IDLE', 'PLANNING'],
      ['PLANNING', 'AWAITING_APPROVAL'],
      ['AWAITING_APPROVAL', 'APPROVED'],
      ['APPROVED', 'EXECUTING'],
    ];

    for (const [from, to] of steps) {
      const arrive = latch(N);
      const results = await Promise.all(
        Array.from({ length: N }, (_, i) => scoped(pool, A, async (c) => {
          await arrive();
          return transitionAgentRun(c, {
            runId: 'run-seq-1', expectedState: from, nextState: to,
            at: 7_000 + i, source: 'API', eventType: to,
          });
        })),
      );
      assert.equal(results.filter(Boolean).length, 1, `${from}->${to} must be exactly-once`);
    }

    assert.deepEqual(await readTransitionSeqs(pool, 'run-seq-1'), [2, 3, 4, 5]);

    const ordered = await scoped(pool, A, async (c) => {
      const r = await c.query(
        `SELECT prior_state, next_state FROM agent_run_events
         WHERE run_id = $1 AND type <> 'CREATED' ORDER BY seq, ins_seq`, ['run-seq-1']);
      return r.rows as Array<{ prior_state: string; next_state: string }>;
    });
    assert.deepEqual(ordered.map((e) => e.next_state), ['PLANNING', 'AWAITING_APPROVAL', 'APPROVED', 'EXECUTING']);
    assert.deepEqual(ordered.map((e) => e.prior_state), ['IDLE', 'PLANNING', 'AWAITING_APPROVAL', 'APPROVED'],
      'each event records the state it actually moved from');
  } finally {
    await pool.close();
  }
});

// ─── Tenant isolation, enforced under a non-superuser role ──────────────────

test('another tenant cannot transition a run it does not own', { skip: skip ?? false }, async () => {
  const pool = conn();
  try {
    await seed(pool, 'run-tenant-1', 'EXECUTING');

    assert.equal(await scoped(pool, B, (c) => transitionAgentRun(c, {
      runId: 'run-tenant-1', nextState: 'CANCELLED', at: 8_000,
      source: 'API', eventType: 'CANCELLED',
    })), false, 'RLS hides the row, so the CAS finds nothing to update');

    const row = await readRun(pool, 'run-tenant-1');
    assert.equal(row?.state, 'EXECUTING', 'owner still sees the untouched run');
    assert.deepEqual(await readTransitionSeqs(pool, 'run-tenant-1'), []);
  } finally {
    await pool.close();
  }
});

test('another tenant cannot claim a lease on a run it does not own', { skip: skip ?? false }, async () => {
  const pool = conn();
  try {
    await seed(pool, 'run-tenant-2', 'EXECUTING');
    assert.equal(await scoped(pool, B, (c) =>
      claimAgentRunReconciliation(c, 'run-tenant-2', 'worker-b', 60_000, 10_000)), undefined);
    const row = await readRun(pool, 'run-tenant-2');
    assert.equal(Number(row?.reconciliation_fence), 0, 'fence untouched by the outsider');
  } finally {
    await pool.close();
  }
});

test('an event cannot be filed against another tenant run', { skip: skip ?? false }, async () => {
  const pool = conn();
  try {
    await seed(pool, 'run-tenant-3', 'EXECUTING');

    // The composite foreign key is what makes this structural. A plain
    // REFERENCES agent_runs(run_id) would be checked by PostgreSQL with RLS
    // NOT applied, so this insert would succeed and attach tenant B's event to
    // tenant A's run.
    await assert.rejects(
      scoped(pool, B, (c) => c.query(
        `INSERT INTO agent_run_events
           (event_id, run_id, seq, at, type, prior_state, next_state, reason,
            correlation_id, source, schema_version, owner_scope, workspace_scope)
         VALUES ('evt-x','run-tenant-3',1,1,'T',NULL,'FAILED',NULL,'c','API',1,
                 current_setting('migrapilot.owner_scope'),
                 current_setting('migrapilot.workspace_scope'))`)),
      /foreign key|violates/i,
    );

    assert.deepEqual(await readTransitionSeqs(pool, 'run-tenant-3'), []);
  } finally {
    await pool.close();
  }
});

test('a child cannot be filed against another tenant run', { skip: skip ?? false }, async () => {
  const pool = conn();
  try {
    await seed(pool, 'run-tenant-4', 'EXECUTING');
    await assert.rejects(
      scoped(pool, B, (c) => c.query(
        `INSERT INTO agent_run_children
           (child_id, run_id, kind, attempt, state, required, revision, created_at,
            schema_version, updated_at, owner_scope, workspace_scope)
         VALUES ('child-x','run-tenant-4','TOOL',1,'PENDING',1,1,1,1,1,
                 current_setting('migrapilot.owner_scope'),
                 current_setting('migrapilot.workspace_scope'))`)),
      /foreign key|violates/i,
    );
  } finally {
    await pool.close();
  }
});

test('two tenants transition same-named runs without interfering', { skip: skip ?? false }, async () => {
  const pool = conn();
  try {
    // Distinct run ids — run_id is globally unique by primary key — but the
    // point is that concurrent cross-tenant work is fully independent.
    await seed(pool, 'run-iso-a', 'EXECUTING', A);
    await seed(pool, 'run-iso-b', 'EXECUTING', B);

    const arrive = latch(2);
    const [ra, rb] = await Promise.all([
      scoped(pool, A, async (c) => {
        await arrive();
        return transitionAgentRun(c, {
          runId: 'run-iso-a', nextState: 'COMPLETED', at: 9_000, source: 'API', eventType: 'COMPLETED',
        });
      }),
      scoped(pool, B, async (c) => {
        await arrive();
        return transitionAgentRun(c, {
          runId: 'run-iso-b', nextState: 'FAILED', at: 9_000, source: 'API', eventType: 'FAILED',
        });
      }),
    ]);

    assert.equal(ra, true);
    assert.equal(rb, true);
    assert.equal((await readRun(pool, 'run-iso-a', A))?.state, 'COMPLETED');
    assert.equal((await readRun(pool, 'run-iso-b', B))?.state, 'FAILED');
    assert.equal(await readRun(pool, 'run-iso-b', A), undefined, 'A cannot see B\'s run');
  } finally {
    await pool.close();
  }
});
