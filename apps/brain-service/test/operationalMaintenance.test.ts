// Operational Data Foundation — Slice 1, commit 3: retention, integrity, health.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SqliteDurableStore } from '../src/engine/persistence/sqliteStore.js';
import { OperationalMaintenance, DEFAULT_RETENTION } from '../src/engine/persistence/operationalMaintenance.js';
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

  const maint = new OperationalMaintenance(d, DEFAULT_RETENTION, () => NOW, p);
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
  const maint = new OperationalMaintenance(d, DEFAULT_RETENTION, () => 1000, p);
  assert.equal(maint.verifyIntegrity(), 'ok');
  const h = maint.health();
  assert.equal(h.reachable, true);
  assert.equal(h.schemaCurrent, true);
  assert.equal(h.schemaVersion, 4);
  assert.equal(h.integrity, 'ok');
  assert.equal(h.status, 'healthy');
  assert.ok(typeof h.writeLatencyMs === 'number' && h.writeLatencyMs >= 0);
  assert.ok(typeof h.storageBytes === 'number' && h.storageBytes! > 0);
  d.close();
});

test('health is degraded until integrity has been verified', () => {
  const p = tmpDbPath();
  const d = new SqliteDurableStore(p);
  const maint = new OperationalMaintenance(d, DEFAULT_RETENTION, () => 1000, p);
  // No verifyIntegrity() called yet → integrity 'unknown' → degraded (not a false green).
  assert.equal(maint.health().status, 'degraded');
  maint.verifyIntegrity();
  assert.equal(maint.health().status, 'healthy');
  d.close();
});

test('the retention worker starts, reports running, and stops on close', () => {
  const p = tmpDbPath();
  const d = new SqliteDurableStore(p);
  const maint = new OperationalMaintenance(d, DEFAULT_RETENTION, () => 1000, p);
  assert.equal(maint.health().retentionWorker, 'stopped');
  maint.start();
  assert.equal(maint.health().retentionWorker, 'running');
  assert.notEqual(maint.health().lastRetentionAt, null, 'start() runs one pass immediately');
  maint.close();
  assert.equal(maint.health().retentionWorker, 'stopped');
  d.close();
});
