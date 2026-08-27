/**
 * Sub-slice 2 · Group 5 — operational metadata parity and tenant isolation.
 *
 * Same discipline as Group 4: where a comparison is possible the expectation is
 * MEASURED by running the identical calls against a real SqliteDurableStore,
 * not hand-written.
 *
 * Two things here are genuinely PostgreSQL-specific and have no SQLite
 * counterpart, so they are asserted directly rather than compared:
 *
 *   • upserts must not be able to re-home another tenant's row, because the
 *     conflict target is a global primary key;
 *   • a recovery event must not be able to reference another tenant's incident,
 *     which FK evaluation would otherwise permit since it ignores RLS.
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
  appendAuditEvent, appendRecoveryEvent, appendUsageRecord, auditByCorrelation,
  listIncidents, loadBudgetScopes, loadReservations, operationalCounts, pruneOperational,
  recentAuditEvents, recentUsageRecords, removeReservation, saveBudgetScope, saveReservation,
  upsertIncident,
} from '../src/engine/persistence/postgres/operationalRepo.js';
import type {
  DurableAuditEvent, DurableBudgetScope, DurableIncident, DurableRecoveryEvent,
  DurableReservation, DurableUsageRecord,
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
  tmp = mkdtempSync(join(tmpdir(), 'brain-g5-'));
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

const conn = () => new PostgresConnection({ databaseUrl: appUrl, applicationName: 'group5' });

async function scoped<T>(scope: typeof A, fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const c = conn();
  try {
    return await c.transaction((client) => withScope(client, scope, () => fn(client)));
  } finally {
    await c.close();
  }
}

let seq = 0;
const sqlite = (): SqliteDurableStore => new SqliteDurableStore(join(tmp, `op-${++seq}.db`));

/**
 * A fresh tenant pair per test. PostgreSQL shares one database across this file
 * while each SQLite comparison gets its own file, so without this the retention
 * assertions would see rows seeded by earlier tests. Under RLS a unique scope is
 * indistinguishable from a clean database.
 */
let tenantSeq = 0;
function tenantPair(): readonly [typeof A, typeof A] {
  const n = ++tenantSeq;
  return [
    { ownerScope: `user:a${n}`, workspaceScope: `org:a${n}` },
    { ownerScope: `user:b${n}`, workspaceScope: `org:b${n}` },
  ] as const;
}


function audit(over: Partial<DurableAuditEvent> = {}): DurableAuditEvent {
  return {
    eventId: 'ae1', correlationId: 'corr1', causationId: 'cause1', seq: 1, type: 'request',
    at: 1_000, durationMs: 12, component: 'router', outcome: 'ok', requestId: 'req1',
    fieldsJson: '{"a":1}', ...over,
  } as DurableAuditEvent;
}

function usage(over: Partial<DurableUsageRecord> = {}): DurableUsageRecord {
  return {
    usageId: 'u1', correlationId: 'corr1', providerId: 'anthropic', modelId: 'claude',
    executionMode: 'sync', policy: 'default', localOrCloud: 'cloud', at: 1_000,
    outcome: 'ok', costUsd: 0.25, costStatus: 'final', escalationReason: 'none',
    fieldsJson: '{"t":1}', ...over,
  } as DurableUsageRecord;
}

function incident(over: Partial<DurableIncident> = {}): DurableIncident {
  return {
    incidentId: 'i1', deduplicationKey: 'dk1', correlationId: 'corr1', firstSeenAt: 1_000,
    lastSeenAt: 1_000, occurrenceCount: 1, state: 'open', severity: 'high',
    affectedJson: '[]', lastDeliveryStatus: 'sent', resolutionJson: undefined, ...over,
  } as DurableIncident;
}

function recovery(over: Partial<DurableRecoveryEvent> = {}): DurableRecoveryEvent {
  return {
    id: 'r1', recoveryId: 'rec1', correlationId: 'corr1', incidentId: undefined,
    type: 'retry', at: 1_000, outcome: 'ok', fieldsJson: '{}', ...over,
  } as DurableRecoveryEvent;
}

function budget(over: Partial<DurableBudgetScope> = {}): DurableBudgetScope {
  return {
    scopeId: 'b1', kind: 'daily', scopeKeyName: 'user', hardLimitUsd: 10,
    spentUsd: 1.5, reservedUsd: 0.5, periodStart: 1_000, updatedAt: 1_000, ...over,
  } as DurableBudgetScope;
}

function reservation(over: Partial<DurableReservation> = {}): DurableReservation {
  return {
    reservationId: 'res1', amountUsd: 2.5, scopeIdsJson: '["b1"]', correlationId: 'corr1',
    providerId: 'anthropic', modelId: 'claude', createdAt: 1_000, expiresAt: 2_000,
    status: 'held', ...over,
  } as DurableReservation;
}

// ─── Round-trip parity ──────────────────────────────────────────────────────

test('audit events round-trip identically to SQLite and are idempotent', async (t) => {
  if (skip) return t.skip(skip);
  const [A, B] = tenantPair();
  const e = audit();
  const bare = audit({ eventId: 'ae2', durationMs: undefined, outcome: undefined, requestId: undefined, seq: 2 });

  const sq = sqlite();
  sq.appendAuditEvent(e);
  sq.appendAuditEvent(e); // replay
  sq.appendAuditEvent(bare);
  const sqRecent = (await sq.recentAuditEvents(50));
  const sqByCorr = (await sq.auditByCorrelation('corr1'));
  sq.close();

  await scoped(A, async (c) => {
    await appendAuditEvent(c, e);
    await appendAuditEvent(c, e);
    await appendAuditEvent(c, bare);
  });

  assert.deepEqual(await scoped(A, (c) => recentAuditEvents(c, 50)), sqRecent);
  assert.deepEqual(await scoped(A, (c) => auditByCorrelation(c, 'corr1')), sqByCorr);
  assert.equal(sqRecent.length, 2, 'the replay must not have double-counted');
});

test('usage records round-trip identically to SQLite', async (t) => {
  if (skip) return t.skip(skip);
  const [A, B] = tenantPair();
  const r = usage();
  const bare = usage({ usageId: 'u2', costUsd: undefined, escalationReason: undefined, at: 900 });

  const sq = sqlite();
  sq.appendUsageRecord(r);
  sq.appendUsageRecord(r);
  sq.appendUsageRecord(bare);
  const sqRows = (await sq.recentUsageRecords(50));
  sq.close();

  await scoped(A, async (c) => {
    await appendUsageRecord(c, r);
    await appendUsageRecord(c, r);
    await appendUsageRecord(c, bare);
  });
  assert.deepEqual(await scoped(A, (c) => recentUsageRecords(c, 50)), sqRows);
  assert.equal(sqRows.length, 2);
});

test('incident upsert updates the same subset SQLite updates', async (t) => {
  if (skip) return t.skip(skip);
  const [A, B] = tenantPair();
  const first = incident();
  // Everything changed, including fields the upsert must deliberately ignore.
  const second = incident({
    deduplicationKey: 'CHANGED', correlationId: 'CHANGED', firstSeenAt: 9_999,
    severity: 'low', lastSeenAt: 2_000, occurrenceCount: 5, state: 'resolved',
    lastDeliveryStatus: 'failed', resolutionJson: '{"r":1}',
  });

  const sq = sqlite();
  sq.upsertIncident(first);
  sq.upsertIncident(second);
  const sqRows = (await sq.listIncidents(50));
  sq.close();

  await scoped(A, async (c) => {
    await upsertIncident(c, first);
    await upsertIncident(c, second);
  });
  const pgRows = await scoped(A, (c) => listIncidents(c, 50));

  assert.deepEqual(pgRows, sqRows);
  assert.equal(pgRows.length, 1);
  assert.equal(pgRows[0]!.firstSeenAt, 1_000, 'first_seen_at is not refreshed');
  assert.equal(pgRows[0]!.severity, 'high', 'severity is not refreshed');
  assert.equal(pgRows[0]!.occurrenceCount, 5, 'occurrence_count IS refreshed');
});

test('budget scopes and reservations round-trip identically to SQLite', async (t) => {
  if (skip) return t.skip(skip);
  const [A, B] = tenantPair();
  const sq = sqlite();
  sq.saveBudgetScope(budget());
  sq.saveBudgetScope(budget({ hardLimitUsd: 20, spentUsd: 3, kind: 'IGNORED', scopeKeyName: 'IGNORED' }));
  sq.saveBudgetScope(budget({ scopeId: 'b2', kind: 'monthly' }));
  sq.saveReservation(reservation());
  sq.saveReservation(reservation({ status: 'settled', amountUsd: 99 }));
  sq.saveReservation(reservation({ reservationId: 'res2' }));
  const sqScopes = (await sq.loadBudgetScopes());
  const sqRes = (await sq.loadReservations());
  sq.close();

  await scoped(A, async (c) => {
    await saveBudgetScope(c, budget());
    await saveBudgetScope(c, budget({ hardLimitUsd: 20, spentUsd: 3, kind: 'IGNORED', scopeKeyName: 'IGNORED' }));
    await saveBudgetScope(c, budget({ scopeId: 'b2', kind: 'monthly' }));
    await saveReservation(c, reservation());
    await saveReservation(c, reservation({ status: 'settled', amountUsd: 99 }));
    await saveReservation(c, reservation({ reservationId: 'res2' }));
  });

  assert.deepEqual(await scoped(A, (c) => loadBudgetScopes(c)), sqScopes);
  assert.deepEqual(await scoped(A, (c) => loadReservations(c)), sqRes);
  // The reservation upsert refreshes status only — amount must be untouched.
  assert.equal(sqRes.find((r) => r.reservationId === 'res1')!.amountUsd, 2.5);
  assert.equal(sqRes.find((r) => r.reservationId === 'res1')!.status, 'settled');

  await scoped(A, (c) => removeReservation(c, 'res1'));
  assert.equal((await scoped(A, (c) => loadReservations(c))).some((r) => r.reservationId === 'res1'), false);
});

test('retention matches SQLite and spares open incidents', async (t) => {
  if (skip) return t.skip(skip);
  const [A, B] = tenantPair();
  const seed = {
    audits: [audit({ eventId: 'old', at: 100 }), audit({ eventId: 'new', at: 9_000, seq: 2 })],
    usages: [usage({ usageId: 'uold', at: 100 }), usage({ usageId: 'unew', at: 9_000 })],
    incidents: [
      incident({ incidentId: 'i_open', lastSeenAt: 100, state: 'open' }),
      incident({ incidentId: 'i_res', lastSeenAt: 100, state: 'resolved' }),
      incident({ incidentId: 'i_recent', lastSeenAt: 9_000, state: 'resolved' }),
    ],
    recoveries: [recovery({ id: 'rold', at: 100 }), recovery({ id: 'rnew', at: 9_000 })],
  };
  const cutoffs = { auditBefore: 5_000, usageBefore: 5_000, incidentsBefore: 5_000, recoveryBefore: 5_000 };

  const sq = sqlite();
  seed.audits.forEach((x) => sq.appendAuditEvent(x));
  seed.usages.forEach((x) => sq.appendUsageRecord(x));
  seed.incidents.forEach((x) => sq.upsertIncident(x));
  seed.recoveries.forEach((x) => sq.appendRecoveryEvent(x));
  const sqCounts = (await sq.pruneOperational(cutoffs));
  const sqIncidents = (await sq.listIncidents(50));
  sq.close();

  await scoped(A, async (c) => {
    for (const x of seed.audits) await appendAuditEvent(c, x);
    for (const x of seed.usages) await appendUsageRecord(c, x);
    for (const x of seed.incidents) await upsertIncident(c, x);
    for (const x of seed.recoveries) await appendRecoveryEvent(c, x);
  });
  const pgCounts = await scoped(A, (c) => pruneOperational(c, cutoffs));

  assert.deepEqual(pgCounts, sqCounts);
  assert.deepEqual(pgCounts, { audit: 1, usage: 1, incidents: 1, recovery: 1 });
  assert.deepEqual(await scoped(A, (c) => listIncidents(c, 50)), sqIncidents);
  assert.equal(sqIncidents.some((i) => i.incidentId === 'i_open'), true,
    'an open incident outlives its cutoff');
});

test('pruning an incident nulls its recovery reference instead of failing', async (t) => {
  if (skip) return t.skip(skip);
  const [A, B] = tenantPair();
  // The foreign key must not turn retention into an error. SQLite would simply
  // leave a dangling id; here the reference becomes an honest NULL and the
  // recovery event itself survives, so the prune counts still match.
  await scoped(A, async (c) => {
    await upsertIncident(c, incident({ incidentId: 'i_fk', lastSeenAt: 100, state: 'resolved' }));
    await appendRecoveryEvent(c, recovery({ id: 'r_fk', at: 9_000, incidentId: 'i_fk' }));
  });

  const counts = await scoped(A, (c) => pruneOperational(c, {
    auditBefore: 0, usageBefore: 0, incidentsBefore: 5_000, recoveryBefore: 0 }));
  assert.equal(counts.incidents, 1);
  assert.equal(counts.recovery, 0, 'the recovery event must survive');

  const row = await scoped(A, async (c) => {
    const r = await c.query(`SELECT incident_id FROM op_recovery_events WHERE id = $1`, ['r_fk']);
    return r.rows[0] as { incident_id: string | null };
  });
  assert.equal(row.incident_id, null, 'the dangling reference is nulled, not left lying');
});

test('operational counts match SQLite for a single tenant', async (t) => {
  if (skip) return t.skip(skip);
  const [A, B] = tenantPair();
  const sq = sqlite();
  sq.appendAuditEvent(audit({ eventId: 'c1' }));
  sq.appendUsageRecord(usage({ usageId: 'c2' }));
  sq.upsertIncident(incident({ incidentId: 'c3' }));
  sq.appendRecoveryEvent(recovery({ id: 'c4' }));
  sq.saveReservation(reservation({ reservationId: 'c5' }));
  const sqCounts = (await sq.operationalCounts());
  sq.close();

  await scoped(B, async (c) => {
    await appendAuditEvent(c, audit({ eventId: 'c1' }));
    await appendUsageRecord(c, usage({ usageId: 'c2' }));
    await upsertIncident(c, incident({ incidentId: 'c3' }));
    await appendRecoveryEvent(c, recovery({ id: 'c4' }));
    await saveReservation(c, reservation({ reservationId: 'c5' }));
  });
  assert.deepEqual(await scoped(B, (c) => operationalCounts(c)), sqCounts);
});

// ─── PostgreSQL-specific tenancy guarantees ─────────────────────────────────

test('an upsert cannot re-home another tenant incident', async (t) => {
  if (skip) return t.skip(skip);
  const [A, B] = tenantPair();
  await scoped(A, (c) => upsertIncident(c, incident({ incidentId: 'i_owned', state: 'open' })));

  // The conflict target is a GLOBAL primary key, so tenant B's insert does
  // collide with tenant A's row. It must not therefore take it over.
  await assert.rejects(
    scoped(B, (c) => upsertIncident(c, incident({
      incidentId: 'i_owned', state: 'resolved', lastSeenAt: 9_999 }))),
    /row-level security|policy/i,
  );

  const stillA = await scoped(A, (c) => listIncidents(c, 50));
  const owned = stillA.find((i) => i.incidentId === 'i_owned');
  assert.equal(owned?.state, 'open', 'the owner record is unchanged');
  assert.equal((await scoped(B, (c) => listIncidents(c, 50))).some((i) => i.incidentId === 'i_owned'),
    false, 'and it never became visible to the other tenant');
});

test('an upsert cannot re-home another tenant budget scope', async (t) => {
  if (skip) return t.skip(skip);
  const [A, B] = tenantPair();
  await scoped(A, (c) => saveBudgetScope(c, budget({ scopeId: 'b_owned', hardLimitUsd: 10 })));
  await assert.rejects(
    scoped(B, (c) => saveBudgetScope(c, budget({ scopeId: 'b_owned', hardLimitUsd: 999 }))),
    /row-level security|policy/i,
  );
  const owned = (await scoped(A, (c) => loadBudgetScopes(c))).find((s) => s.scopeId === 'b_owned');
  assert.equal(owned?.hardLimitUsd, 10);
});

test('a recovery event cannot reference another tenant incident', async (t) => {
  if (skip) return t.skip(skip);
  const [A, B] = tenantPair();
  await scoped(A, (c) => upsertIncident(c, incident({ incidentId: 'i_secret' })));

  // Foreign key checks are evaluated with RLS NOT applied, so without the scope
  // columns in the key this insert would succeed and bind tenant B's recovery
  // event to tenant A's incident.
  await assert.rejects(
    scoped(B, (c) => appendRecoveryEvent(c, recovery({ id: 'r_cross', incidentId: 'i_secret' }))),
    /foreign key|violates/i,
  );
});

test('a recovery event with no incident is accepted', async (t) => {
  if (skip) return t.skip(skip);
  const [A, B] = tenantPair();
  // MATCH SIMPLE skips the composite check when incident_id IS NULL. If this
  // regressed, every incident-less recovery event would be rejected.
  await scoped(B, (c) => appendRecoveryEvent(c, recovery({ id: 'r_null', incidentId: undefined })));
  const count = await scoped(B, async (c) => {
    const r = await c.query(`SELECT count(*) AS c FROM op_recovery_events WHERE id = $1`, ['r_null']);
    return Number((r.rows[0] as { c: string }).c);
  });
  assert.equal(count, 1);
});

test('operational reads and retention are tenant-isolated', async (t) => {
  if (skip) return t.skip(skip);
  const [A, B] = tenantPair();
  await scoped(A, async (c) => {
    await appendAuditEvent(c, audit({ eventId: 'iso_a', correlationId: 'iso' }));
    await appendUsageRecord(c, usage({ usageId: 'iso_a', correlationId: 'iso' }));
    await upsertIncident(c, incident({ incidentId: 'iso_a', state: 'resolved', lastSeenAt: 1 }));
    await saveBudgetScope(c, budget({ scopeId: 'iso_a' }));
    await saveReservation(c, reservation({ reservationId: 'iso_a' }));
  });

  assert.equal((await scoped(B, (c) => auditByCorrelation(c, 'iso'))).length, 0);
  assert.equal((await scoped(B, (c) => recentUsageRecords(c, 50))).some((u) => u.usageId === 'iso_a'), false);
  assert.equal((await scoped(B, (c) => loadBudgetScopes(c))).some((s) => s.scopeId === 'iso_a'), false);
  assert.equal((await scoped(B, (c) => loadReservations(c))).some((r) => r.reservationId === 'iso_a'), false);

  // Tenant B prunes everything it can reach; tenant A's rows must survive.
  await scoped(B, (c) => pruneOperational(c, {
    auditBefore: 9_999_999, usageBefore: 9_999_999,
    incidentsBefore: 9_999_999, recoveryBefore: 9_999_999 }));

  assert.equal((await scoped(A, (c) => auditByCorrelation(c, 'iso'))).length, 1);
  assert.equal((await scoped(A, (c) => listIncidents(c, 50))).some((i) => i.incidentId === 'iso_a'), true);
});

test('a tenant cannot delete another tenant reservation', async (t) => {
  if (skip) return t.skip(skip);
  const [A, B] = tenantPair();
  await scoped(A, (c) => saveReservation(c, reservation({ reservationId: 'res_owned' })));
  await scoped(B, (c) => removeReservation(c, 'res_owned'));
  assert.equal(
    (await scoped(A, (c) => loadReservations(c))).some((r) => r.reservationId === 'res_owned'),
    true, 'the delete found nothing to remove under the other tenant scope');
});
