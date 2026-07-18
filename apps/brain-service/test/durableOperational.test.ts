// Operational Data Foundation — Slice 1, commit 1: durable operational store.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteDurableStore, SCHEMA_VERSION } from '../src/engine/persistence/sqliteStore.js';
import type { DurableAuditEvent, DurableUsageRecord, DurableIncident } from '../src/engine/persistence/types.js';

function tmpDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'migraai-opdb-')), 'state.db');
}
function audit(over: Partial<DurableAuditEvent> = {}): DurableAuditEvent {
  return { eventId: 'ev1', correlationId: 'c1', causationId: null, seq: 1, type: 'execution.started', at: 1000, component: 'engineer', fieldsJson: '{"workspace":"abc"}', ...over };
}
function usage(over: Partial<DurableUsageRecord> = {}): DurableUsageRecord {
  return { usageId: 'u1', correlationId: 'c1', providerId: 'local', modelId: 'qwen', executionMode: 'chat', policy: 'auto', localOrCloud: 'local', at: 1000, outcome: 'ok', costStatus: 'unknown', fieldsJson: '{}', ...over };
}
function incident(over: Partial<DurableIncident> = {}): DurableIncident {
  return { incidentId: 'i1', deduplicationKey: 'k', correlationId: 'c1', firstSeenAt: 1000, lastSeenAt: 1000, occurrenceCount: 1, state: 'open', severity: 'critical', affectedJson: '{}', lastDeliveryStatus: 'delivered', ...over };
}

test('SCHEMA_VERSION is 2 (operational tables added)', () => {
  assert.equal(SCHEMA_VERSION, 2);
});

test('operational data survives a restart (write → close → reopen → read)', () => {
  const p = tmpDb();
  let store = new SqliteDurableStore(p);
  store.appendAuditEvent(audit());
  store.appendUsageRecord(usage({ localOrCloud: 'cloud', costUsd: 0.05, costStatus: 'actual' }));
  store.upsertIncident(incident());
  store.appendRecoveryEvent({ id: 'r1', recoveryId: 'rec1', correlationId: 'c1', type: 'recovery.started', at: 1000, fieldsJson: '{}' });
  store.close();

  store = new SqliteDurableStore(p); // reopen — durable across "restart"
  assert.equal(store.recentAuditEvents(10)[0]!.eventId, 'ev1');
  assert.equal(store.recentUsageRecords(10)[0]!.costUsd, 0.05);
  assert.equal(store.listIncidents(10)[0]!.incidentId, 'i1');
  assert.equal(store.operationalCounts().recoveryEvents, 1);
  store.close();
});

test('audit + usage appends are idempotent by id (a replay never double-counts)', () => {
  const store = new SqliteDurableStore(tmpDb());
  store.appendAuditEvent(audit());
  store.appendAuditEvent(audit()); // same eventId
  store.appendUsageRecord(usage());
  store.appendUsageRecord(usage()); // same usageId
  assert.equal(store.operationalCounts().auditEvents, 1);
  assert.equal(store.operationalCounts().usageRecords, 1);
  store.close();
});

test('incident upsert mutates state by id (open → resolved), not a duplicate', () => {
  const store = new SqliteDurableStore(tmpDb());
  store.upsertIncident(incident({ state: 'open' }));
  store.upsertIncident(incident({ state: 'resolved', lastSeenAt: 2000, occurrenceCount: 2, resolutionJson: '{"ok":true}' }));
  const list = store.listIncidents(10);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.state, 'resolved');
  assert.equal(list[0]!.occurrenceCount, 2);
  store.close();
});

test('budget scope + reservation persist and reload', () => {
  const p = tmpDb();
  let store = new SqliteDurableStore(p);
  store.saveBudgetScope({ scopeId: 'monthly:global', kind: 'monthly', scopeKeyName: 'global', hardLimitUsd: 50, spentUsd: 12.48, reservedUsd: 0.07, periodStart: 0, updatedAt: 1000 });
  store.saveReservation({ reservationId: 'rsv1', amountUsd: 0.07, scopeIdsJson: '["monthly:global"]', correlationId: 'c1', providerId: 'anthropic', modelId: 'claude', createdAt: 1000, expiresAt: 9000, status: 'active' });
  store.close();
  store = new SqliteDurableStore(p);
  assert.equal(store.loadBudgetScopes()[0]!.spentUsd, 12.48);
  assert.equal(store.loadReservations()[0]!.status, 'active');
  store.removeReservation('rsv1');
  assert.equal(store.loadReservations().length, 0);
  store.close();
});

test('retention prunes by age; open incidents are NEVER pruned', () => {
  const store = new SqliteDurableStore(tmpDb());
  store.appendAuditEvent(audit({ eventId: 'old', at: 100 }));
  store.appendAuditEvent(audit({ eventId: 'new', at: 10_000 }));
  store.appendUsageRecord(usage({ usageId: 'oldu', at: 100 }));
  store.upsertIncident(incident({ incidentId: 'open1', state: 'open', lastSeenAt: 100 }));
  store.upsertIncident(incident({ incidentId: 'res1', state: 'resolved', lastSeenAt: 100 }));
  const pruned = store.pruneOperational({ auditBefore: 5000, usageBefore: 5000, incidentsBefore: 5000, recoveryBefore: 5000 });
  assert.equal(pruned.audit, 1); // only 'old'
  assert.equal(pruned.usage, 1);
  assert.equal(pruned.incidents, 1); // only the resolved one
  assert.equal(store.recentAuditEvents(10)[0]!.eventId, 'new');
  assert.ok(store.listIncidents(10).some((i) => i.incidentId === 'open1'), 'open incident retained');
  store.close();
});

test('a v1 database upgrades additively to v2 (operational tables created on reopen)', () => {
  const p = tmpDb();
  // Simulate an existing v1 DB: create the base + set schema_version=1, then reopen with the v2 engine.
  const raw = new DatabaseSync(p);
  raw.exec('CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT);');
  raw.prepare('INSERT INTO schema_meta(key,value) VALUES(?,?)').run('schema_version', '1');
  raw.close();
  const store = new SqliteDurableStore(p); // v2 engine migrates additively
  assert.equal(store.health().schemaVersion, 2);
  store.appendAuditEvent(audit()); // op table exists now
  assert.equal(store.operationalCounts().auditEvents, 1);
  store.close();
});

test('integrityCheck reports ok on a healthy store', () => {
  const store = new SqliteDurableStore(tmpDb());
  assert.equal(store.integrityCheck(), 'ok');
  store.close();
});
