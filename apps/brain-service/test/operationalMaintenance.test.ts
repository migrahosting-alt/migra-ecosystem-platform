// Operational Data Foundation — Slice 1, commit 3: retention, integrity, health.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SCHEMA_VERSION, SqliteDurableStore } from '../src/engine/persistence/sqliteStore.js';
import { OperationalMaintenance, DEFAULT_RETENTION, isMaintainable } from '../src/engine/persistence/operationalMaintenance.js';
import type { DurableAuditEvent, DurableIncident } from '../src/engine/persistence/types.js';

function tmpDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'migraai-opmaint-')), 'state.db');
}
function audit(over: Partial<DurableAuditEvent> = {}): DurableAuditEvent {
  return { eventId: 'e', correlationId: 'c', causationId: null, seq: 1, type: 'execution.started', at: 0, component: 'engineer', fieldsJson: '{}', ...over };
}
function incident(over: Partial<DurableIncident> = {}): DurableIncident {
  return { incidentId: 'i', deduplicationKey: 'k', correlationId: 'c', firstSeenAt: 0, lastSeenAt: 0, occurrenceCount: 1, state: 'open', severity: 'critical', affectedJson: '{}', lastDeliveryStatus: 'none', ...over };
}

const DAY = 24 * 60 * 60 * 1000;

test('retention prunes aged rows on the configured windows; open incidents survive', () => {
  const p = tmpDbPath();
  const d = new SqliteDurableStore(p);
  const NOW = 400 * DAY;
  // Usage window is 90d: a 200-day-old usage row is aged out; a fresh one stays.
  d.appendUsageRecord({ usageId: 'old', correlationId: 'c', providerId: 'local', modelId: 'm', executionMode: 'chat', policy: 'auto', localOrCloud: 'local', at: NOW - 200 * DAY, outcome: 'ok', costStatus: 'unknown', fieldsJson: '{}' });
  d.appendUsageRecord({ usageId: 'fresh', correlationId: 'c', providerId: 'local', modelId: 'm', executionMode: 'chat', policy: 'auto', localOrCloud: 'local', at: NOW - 1 * DAY, outcome: 'ok', costStatus: 'unknown', fieldsJson: '{}' });
  // Audit window is 180d: a 200-day-old audit event is aged out.
  d.appendAuditEvent(audit({ eventId: 'oldaudit', at: NOW - 200 * DAY }));
  d.appendAuditEvent(audit({ eventId: 'freshaudit', at: NOW - 1 * DAY }));
  // Incident window is 365d: a 400-day-old OPEN incident is NEVER pruned; a resolved one is.
  d.upsertIncident(incident({ incidentId: 'open', state: 'open', lastSeenAt: NOW - 400 * DAY }));
  d.upsertIncident(incident({ incidentId: 'resolved', deduplicationKey: 'k2', state: 'resolved', lastSeenAt: NOW - 400 * DAY }));

  const maint = new OperationalMaintenance(d, DEFAULT_RETENTION, () => NOW);
  const res = maint.runRetention();
  assert.equal(res.deleted.usage, 1, 'aged usage pruned');
  assert.equal(res.deleted.audit, 1, 'aged audit pruned');
  assert.equal(res.deleted.incidents, 1, 'only the resolved aged incident pruned');
  assert.equal(d.recentUsageRecords(10)[0]!.usageId, 'fresh');
  assert.ok(d.listIncidents(10).some((i) => i.incidentId === 'open'), 'open incident retained past its window');
  d.close();
});

test('verifyIntegrity reports ok and health is healthy on a fresh store', () => {
  const p = tmpDbPath();
  const d = new SqliteDurableStore(p);
  const maint = new OperationalMaintenance(d, DEFAULT_RETENTION, () => 1000);
  assert.equal(maint.verifyIntegrity(), 'ok');
  const h = maint.health();
  assert.equal(h.reachable, true);
  assert.equal(h.schemaCurrent, true);
  assert.equal(h.schemaVersion, SCHEMA_VERSION);
  assert.equal(h.integrity, 'ok');
  assert.equal(h.status, 'healthy');
  assert.ok(typeof h.writeLatencyMs === 'number' && h.writeLatencyMs >= 0);
  assert.ok(typeof h.storageBytes === 'number' && h.storageBytes! > 0);
  d.close();
});

test('health is healthy when an existing store is already at the current schema', () => {
  const p = tmpDbPath();

  // First open creates and migrates the store, producing migrationState=applied.
  const initial = new SqliteDurableStore(p);
  assert.equal(initial.health().migrationState, 'applied');
  initial.close();

  // Reopening the same schema-current store produces migrationState=current.
  const reopened = new SqliteDurableStore(p);
  assert.equal(reopened.health().migrationState, 'current');

  const maint = new OperationalMaintenance(reopened, DEFAULT_RETENTION, () => 1000);
  assert.equal(maint.verifyIntegrity(), 'ok');

  const h = maint.health();
  assert.equal(h.schemaCurrent, true);
  assert.equal(h.schemaVersion, SCHEMA_VERSION);
  assert.equal(h.migrationState, 'current');
  assert.equal(h.status, 'healthy');

  reopened.close();
});

test('health is degraded until integrity has been verified', () => {
  const p = tmpDbPath();
  const d = new SqliteDurableStore(p);
  const maint = new OperationalMaintenance(d, DEFAULT_RETENTION, () => 1000);
  // No verifyIntegrity() called yet → integrity 'unknown' → degraded (not a false green).
  assert.equal(maint.health().status, 'degraded');
  maint.verifyIntegrity();
  assert.equal(maint.health().status, 'healthy');
  d.close();
});

test('the retention worker starts, reports running, and stops on close', () => {
  const p = tmpDbPath();
  const d = new SqliteDurableStore(p);
  const maint = new OperationalMaintenance(d, DEFAULT_RETENTION, () => 1000);
  assert.equal(maint.health().retentionWorker, 'stopped');
  maint.start();
  assert.equal(maint.health().retentionWorker, 'running');
  assert.notEqual(maint.health().lastRetentionAt, null, 'start() runs one pass immediately');
  maint.close();
  assert.equal(maint.health().retentionWorker, 'stopped');
  d.close();
});

// ─── Maintenance is a CAPABILITY, not a class ───────────────────────────────
//
// The SQLite-concrete handle that used to be threaded through server.ts is gone.
// What replaced it must actually work for any adapter, and — just as important —
// must not silently skip maintenance for an adapter that lacks the capability.

test("a store implementing the maintenance surface is detected structurally", () => {
  const p = tmpDbPath();
  const d = new SqliteDurableStore(p);
  assert.equal(isMaintainable(d), true);
  // Detection must be by method presence, never by constructor identity.
  const structural = {
    integrityCheck: () => "ok",
    probeWriteLatencyMs: () => 1,
    storageBytes: () => null,
  };
  assert.equal(isMaintainable(structural), true, "no class relationship is required");
  d.close();
});

test("a store missing the capability is reported, not silently skipped", () => {
  // Each method removed in turn: every one is load-bearing, so dropping any of
  // them must fail detection rather than produce a half-working maintainer.
  const full = {
    integrityCheck: () => "ok",
    probeWriteLatencyMs: () => 1,
    storageBytes: () => null,
  };
  for (const missing of ["integrityCheck", "probeWriteLatencyMs", "storageBytes"] as const) {
    const partial: Record<string, unknown> = { ...full };
    delete partial[missing];
    assert.equal(isMaintainable(partial), false, missing + " is required");
  }
  assert.equal(isMaintainable({}), false);
});

test("storage utilization is answered by the adapter, not by stat-ing a path", () => {
  const p = tmpDbPath();
  const d = new SqliteDurableStore(p);
  const bytes = d.storageBytes();
  assert.ok(typeof bytes === "number" && bytes > 0, "the SQLite adapter reports real file size");
  assert.equal(d.storageBytes(), fs.statSync(p).size);

  // Health must surface whatever the adapter reports, with no path handed in.
  const maint = new OperationalMaintenance(d, DEFAULT_RETENTION, () => Date.now());
  assert.equal(maint.health().storageBytes, bytes);
  d.close();
});

test("an adapter that throws while sizing storage degrades to unknown, not a crash", () => {
  const p = tmpDbPath();
  const d = new SqliteDurableStore(p);
  const hostile = Object.create(d) as SqliteDurableStore;
  Object.defineProperty(hostile, "storageBytes", {
    value: () => { throw new Error("tablespace query failed"); },
  });
  const maint = new OperationalMaintenance(hostile, DEFAULT_RETENTION, () => Date.now());
  assert.equal(maint.health().storageBytes, null, "unknown size is reported, never thrown");
  d.close();
});
