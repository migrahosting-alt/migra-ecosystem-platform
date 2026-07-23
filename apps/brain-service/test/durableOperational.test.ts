// Operational Data Foundation — Slice 1, commit 1: durable operational store.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteDurableStore, SCHEMA_VERSION } from '../src/engine/persistence/sqliteStore.js';
import type { DurableAgentRun, DurableAgentRunEvent, DurableAuditEvent, DurableUsageRecord, DurableIncident } from '../src/engine/persistence/types.js';

function tmpDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'migraai-opdb-')), 'state.db');
}
function initializedDb(): string {
  const p = tmpDb();
  const store = new SqliteDurableStore(p);
  store.close();
  return p;
}
function replaceCreateSql(dbPath: string, objectType: 'table' | 'index', objectName: string, search: string, replacement: string): void {
  const raw = new DatabaseSync(dbPath);
  raw.exec('PRAGMA writable_schema=ON;');
  raw.prepare("UPDATE sqlite_schema SET sql = replace(sql, ?, ?) WHERE type = ? AND name = ?").run(search, replacement, objectType, objectName);
  raw.exec('PRAGMA writable_schema=OFF;');
  raw.close();
}
function expectCorruptV4(name: string, mutate: (dbPath: string) => void, pattern = /db schema v4|malformed database schema|schema v999/): void {
  const p = initializedDb();
  mutate(p);
  assert.throws(() => new SqliteDurableStore(p), pattern, name);
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
function agentRun(over: Partial<DurableAgentRun> = {}): DurableAgentRun {
  return {
    runId: 'agentcmd_1', correlationId: 'agentcorr_1', activationRef: 'actref', workspaceIdentity: 'workspace-id', workspaceRef: 'wsref',
    recipeId: 'git.status', recipePolicyVersion: 'agent-git-readonly-v2', proposalFingerprint: 'fingerprint', proposalHash: 'hash',
    snapshotId: 'snapshot', snapshotManifestDigest: 'manifest', executableDigest: 'exec', state: 'AWAITING_APPROVAL',
    requestedAt: 1000, proposalAt: 1000, expiresAt: 2000, timeoutMs: 30000, outputLimitBytes: 65536,
    mutationClassification: 'read-only', networkPolicy: 'not-required', expectedEffectsJson: '[]', previewJson: '{"recipe":"git.status"}',
    reconciliationFence: 0,
    auditSeq: 0, schemaVersion: 1, version: 1, updatedAt: 1000, ...over,
  };
}
function agentEvent(over: Partial<DurableAgentRunEvent> = {}): DurableAgentRunEvent {
  return { eventId: 'agev1', runId: 'agentcmd_1', seq: 1, at: 1000, type: 'run.created', nextState: 'AWAITING_APPROVAL', correlationId: 'agentcorr_1', source: 'API', schemaVersion: 1, ...over };
}

test('SCHEMA_VERSION is 4 (Agent run journal fencing and tombstones added)', () => {
  assert.equal(SCHEMA_VERSION, 4);
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

test('a v2 database upgrades additively to v3 (Agent journal tables created on reopen)', () => {
  const p = tmpDb();
  // Simulate an existing v2 DB: create the base + set schema_version=2, then reopen with the v3 engine.
  const raw = new DatabaseSync(p);
  raw.exec('CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT);');
  raw.prepare('INSERT INTO schema_meta(key,value) VALUES(?,?)').run('schema_version', '2');
  raw.close();
  const store = new SqliteDurableStore(p); // v4 engine migrates additively
  assert.equal(store.health().schemaVersion, 4);
  assert.deepEqual(store.loadAgentRuns(), []);
  store.close();
});

test('a v4 database startup is idempotent and refuses newer schemas', () => {
  const p = tmpDb();
  let store = new SqliteDurableStore(p);
  store.close();
  store = new SqliteDurableStore(p);
  assert.equal(store.health().schemaVersion, 4);
  store.close();

  const bad = tmpDb();
  const raw = new DatabaseSync(bad);
  raw.exec('CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT);');
  raw.prepare('INSERT INTO schema_meta(key,value) VALUES(?,?)').run('schema_version', '999');
  raw.close();
  assert.throws(() => new SqliteDurableStore(bad), /schema v999 > engine v4/);
});

test('v4 schema integrity fails closed on missing index or malformed tombstone table', () => {
  const missingIndex = tmpDb();
  let store = new SqliteDurableStore(missingIndex);
  store.close();
  let raw = new DatabaseSync(missingIndex);
  raw.exec('DROP INDEX idx_agent_runs_terminal;');
  raw.close();
  assert.throws(() => new SqliteDurableStore(missingIndex), /missing index idx_agent_runs_terminal/);

  const malformed = tmpDb();
  raw = new DatabaseSync(malformed);
  raw.exec(`
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO schema_meta(key,value) VALUES('schema_version','4');
    CREATE TABLE agent_runs (run_id TEXT PRIMARY KEY);
    CREATE TABLE agent_run_events (event_id TEXT PRIMARY KEY);
    CREATE TABLE agent_run_tombstones (tombstone_id TEXT PRIMARY KEY, run_id TEXT);
  `);
  raw.close();
  assert.throws(() => new SqliteDurableStore(malformed), /db schema v4 (missing|has nullable|has incompatible)/);

  const missingForeignKey = tmpDb();
  store = new SqliteDurableStore(missingForeignKey);
  store.close();
  raw = new DatabaseSync(missingForeignKey);
  raw.exec('PRAGMA writable_schema=ON;');
  raw.prepare(
    `UPDATE sqlite_schema
     SET sql = replace(sql, ' REFERENCES agent_runs(run_id) ON DELETE CASCADE', '')
     WHERE type = 'table' AND name = 'agent_run_events'`,
  ).run();
  raw.exec('PRAGMA writable_schema=OFF;');
  raw.close();
  assert.throws(() => new SqliteDurableStore(missingForeignKey), /missing foreign key agent_run_events\(run_id\) -> agent_runs\(run_id\)/);
});

test('v4 Agent schema contract rejects every critical missing or malformed object', () => {
  const requiredRunColumns = [
    'activation_ref',
    'proposal_hash',
    'snapshot_id',
    'workspace_identity',
    'recipe_id',
    'recipe_policy_version',
    'snapshot_manifest_digest',
    'executable_digest',
    'state',
    'version',
    'reconciliation_owner',
    'reconciliation_fence',
    'reconciliation_lease_until',
    'containment_unit',
    'containment_binding',
    'audit_seq',
  ];
  for (const column of requiredRunColumns) {
    expectCorruptV4(`missing agent_runs.${column}`, (p) => replaceCreateSql(p, 'table', 'agent_runs', `,\n  ${column} `, ',\n  __removed__ '), /missing agent_runs\.|malformed database schema/);
  }

  expectCorruptV4('agent_runs.version nullable', (p) => replaceCreateSql(p, 'table', 'agent_runs', 'version INTEGER NOT NULL DEFAULT 1', 'version INTEGER DEFAULT 1'), /nullable agent_runs\.version/);
  expectCorruptV4('agent_runs.version wrong default', (p) => replaceCreateSql(p, 'table', 'agent_runs', 'version INTEGER NOT NULL DEFAULT 1', 'version INTEGER NOT NULL DEFAULT 0'), /default on agent_runs\.version/);
  expectCorruptV4('agent_runs.reconciliation_fence nullable', (p) => replaceCreateSql(p, 'table', 'agent_runs', 'reconciliation_fence INTEGER NOT NULL DEFAULT 0', 'reconciliation_fence INTEGER DEFAULT 0'), /nullable agent_runs\.reconciliation_fence/);
  expectCorruptV4('agent_runs.reconciliation_fence wrong default', (p) => replaceCreateSql(p, 'table', 'agent_runs', 'reconciliation_fence INTEGER NOT NULL DEFAULT 0', 'reconciliation_fence INTEGER NOT NULL DEFAULT 1'), /default on agent_runs\.reconciliation_fence/);
  expectCorruptV4('agent_runs.state nullable', (p) => replaceCreateSql(p, 'table', 'agent_runs', 'state TEXT NOT NULL', 'state TEXT'), /nullable agent_runs\.state/);
  expectCorruptV4('agent_runs.run_id no primary key', (p) => replaceCreateSql(p, 'table', 'agent_runs', 'run_id TEXT PRIMARY KEY', 'run_id TEXT'), /primary key on agent_runs\.run_id|malformed database schema/);
  expectCorruptV4('agent_runs.containment_binding wrong type', (p) => replaceCreateSql(p, 'table', 'agent_runs', 'containment_binding TEXT', 'containment_binding INTEGER'), /agent_runs\.containment_binding type/);

  expectCorruptV4('agent_run_events missing sequence', (p) => replaceCreateSql(p, 'table', 'agent_run_events', ',\n  seq INTEGER NOT NULL', ''), /missing agent_run_events\.seq|malformed database schema/);
  expectCorruptV4('agent_run_events missing unique run sequence', (p) => replaceCreateSql(p, 'table', 'agent_run_events', ',\n  UNIQUE(run_id, seq)', ''), /unique index|malformed database schema/);
  expectCorruptV4('agent_run_events wrong foreign key delete behavior', (p) => replaceCreateSql(p, 'table', 'agent_run_events', 'ON DELETE CASCADE', 'ON DELETE RESTRICT'), /missing foreign key/);
  expectCorruptV4('agent_run_events nullable run ID', (p) => replaceCreateSql(p, 'table', 'agent_run_events', 'run_id TEXT NOT NULL', 'run_id TEXT'), /nullable agent_run_events\.run_id/);
  expectCorruptV4('agent_run_events nullable event ID by missing primary key', (p) => replaceCreateSql(p, 'table', 'agent_run_events', 'event_id TEXT PRIMARY KEY', 'event_id TEXT'), /primary key on agent_run_events\.event_id|malformed database schema/);

  expectCorruptV4('agent_run_tombstones missing deleted run ID', (p) => replaceCreateSql(p, 'table', 'agent_run_tombstones', ',\n  run_id TEXT NOT NULL', ''), /missing agent_run_tombstones\.run_id/);
  expectCorruptV4('agent_run_tombstones missing final state', (p) => replaceCreateSql(p, 'table', 'agent_run_tombstones', ',\n  final_state TEXT NOT NULL', ''), /missing agent_run_tombstones\.final_state/);
  expectCorruptV4('agent_run_tombstones missing deletion timestamp', (p) => replaceCreateSql(p, 'table', 'agent_run_tombstones', ',\n  deleted_at INTEGER NOT NULL', ''), /missing agent_run_tombstones\.deleted_at|malformed database schema/);
  expectCorruptV4('agent_run_tombstones wrong nullability', (p) => replaceCreateSql(p, 'table', 'agent_run_tombstones', 'run_id TEXT NOT NULL', 'run_id TEXT'), /nullable agent_run_tombstones\.run_id/);
  expectCorruptV4('agent_run_tombstones missing uniqueness', (p) => replaceCreateSql(p, 'table', 'agent_run_tombstones', 'tombstone_id TEXT PRIMARY KEY', 'tombstone_id TEXT'), /primary key on agent_run_tombstones\.tombstone_id|malformed database schema/);
  expectCorruptV4('agent_run_tombstones missing retention index', (p) => {
    const raw = new DatabaseSync(p);
    raw.exec('DROP INDEX idx_agent_run_tombstones_deleted;');
    raw.close();
  }, /missing index idx_agent_run_tombstones_deleted/);

  for (const index of ['idx_agent_runs_nonterminal', 'idx_agent_runs_reconciliation', 'idx_agent_runs_terminal']) {
    expectCorruptV4(`missing ${index}`, (p) => {
      const raw = new DatabaseSync(p);
      raw.exec(`DROP INDEX ${index};`);
      raw.close();
    }, new RegExp(`missing index ${index}`));
  }
  expectCorruptV4('wrong reconciliation index column order', (p) => replaceCreateSql(p, 'index', 'idx_agent_runs_reconciliation', 'reconciliation_owner, reconciliation_fence, version, reconciliation_lease_until', 'reconciliation_owner, version, reconciliation_fence, reconciliation_lease_until'), /columns for idx_agent_runs_reconciliation/);

  expectCorruptV4('schema_meta missing version row', (p) => {
    const raw = new DatabaseSync(p);
    raw.prepare("DELETE FROM schema_meta WHERE key='schema_version'").run();
    raw.close();
  }, /schema metadata missing for non-empty database/);
  expectCorruptV4('schema_meta malformed table', (p) => replaceCreateSql(p, 'table', 'schema_meta', 'key TEXT PRIMARY KEY', 'key TEXT'), /primary key on schema_meta\.key|malformed database schema/);
  expectCorruptV4('unsupported newer schema', (p) => {
    const raw = new DatabaseSync(p);
    raw.prepare("UPDATE schema_meta SET value='999' WHERE key='schema_version'").run();
    raw.close();
  }, /schema v999 > engine v4/);
});

test('clean v4 initialization and v2/v3 migrations create every validator-required Agent object', () => {
  for (const p of [initializedDb()]) {
    const store = new SqliteDurableStore(p);
    assert.equal(store.health().schemaVersion, 4);
    store.close();
  }
  for (const version of ['2', '3']) {
    const p = tmpDb();
    const raw = new DatabaseSync(p);
    raw.exec('CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT);');
    raw.prepare('INSERT INTO schema_meta(key,value) VALUES(?,?)').run('schema_version', version);
    raw.close();
    const store = new SqliteDurableStore(p);
    assert.equal(store.health().schemaVersion, 4);
    store.close();
  }
});

test('Agent run journal persists runs, CAS transitions, leases, events, and bounded retention', () => {
  const store = new SqliteDurableStore(tmpDb());
  store.insertAgentRun(agentRun(), agentEvent());
  assert.equal(store.loadAgentRun('agentcmd_1')?.state, 'AWAITING_APPROVAL');
  assert.equal(store.transitionAgentRun({ runId: 'agentcmd_1', expectedState: 'AWAITING_APPROVAL', nextState: 'APPROVED', at: 1100, source: 'APPROVAL', eventType: 'approval.approved', reason: 'HUMAN_APPROVED', patch: { approvalDecisionAt: 1100 } }), true);
  assert.equal(store.transitionAgentRun({ runId: 'agentcmd_1', expectedState: 'AWAITING_APPROVAL', nextState: 'FAILED', at: 1110, source: 'RECONCILIATION', eventType: 'restart.interrupted_execution' }), false);
  const claim = store.claimAgentRunReconciliation('agentcmd_1', 'owner-a', 5000, 1200);
  assert.equal(claim?.fence, 1);
  assert.equal(store.claimAgentRunReconciliation('agentcmd_1', 'owner-b', 5000, 1300), undefined);
  assert.equal(store.transitionAgentRun({ runId: 'agentcmd_1', expectedState: 'APPROVED', nextState: 'STALE', at: 1400, source: 'RECONCILIATION', eventType: 'restart.authorization_lost', reason: 'RESTART_BEFORE_EXECUTION', patch: { terminalAt: 1400, failureCode: 'RESTART_BEFORE_EXECUTION' } }), true);
  assert.equal(store.transitionAgentRun({ runId: 'agentcmd_1', nextState: 'COMPLETED', at: 1500, source: 'EXECUTION', eventType: 'execution.completed' }), false, 'terminal states are immutable');
  assert.equal(store.loadAgentRunEvents('agentcmd_1').map((e) => e.type).join(','), 'run.created,approval.approved,restart.authorization_lost');
  const pruned = store.pruneAgentRuns(2000, 10, 3000);
  assert.equal(pruned.runs, 1);
  assert.equal(store.loadAgentRun('agentcmd_1'), undefined);
  assert.equal(store.loadAgentRunTombstones()[0]?.runId, 'agentcmd_1');
  store.close();
});

test('reconciliation fencing rejects stale owners after lease expiry', () => {
  const store = new SqliteDurableStore(tmpDb());
  store.insertAgentRun(agentRun({ runId: 'agentcmd_fence', correlationId: 'agentcorr_fence' }), agentEvent({ runId: 'agentcmd_fence', correlationId: 'agentcorr_fence' }));
  const ownerA = store.claimAgentRunReconciliation('agentcmd_fence', 'owner-a', 2_000, 1_000)!;
  const ownerB = store.claimAgentRunReconciliation('agentcmd_fence', 'owner-b', 5_000, 3_000)!;
  assert.equal(ownerB.fence, ownerA.fence + 1);
  assert.equal(store.transitionAgentRun({ runId: 'agentcmd_fence', expectedState: 'AWAITING_APPROVAL', nextState: 'EXPIRED', at: 3_100, source: 'RECONCILIATION', eventType: 'owner-a-stale', reason: 'STALE', reconciliation: { owner: ownerA.owner, fence: ownerA.fence, leaseValidAt: 3_100, expectedVersion: ownerA.version }, patch: { terminalAt: 3_100 } }), false);
  assert.equal(store.transitionAgentRun({ runId: 'agentcmd_fence', expectedState: 'AWAITING_APPROVAL', nextState: 'EXPIRED', at: 3_200, source: 'RECONCILIATION', eventType: 'owner-b-terminal', reason: 'OK', reconciliation: { owner: ownerB.owner, fence: ownerB.fence, leaseValidAt: 3_200, expectedVersion: ownerB.version }, patch: { terminalAt: 3_200 } }), true);
  assert.equal(store.loadAgentRun('agentcmd_fence')?.state, 'EXPIRED');
  assert.deepEqual(store.loadAgentRunEvents('agentcmd_fence').map((event) => event.type), ['run.created', 'owner-b-terminal']);
  store.close();
});

test('reconciliation fenced events reject stale owners after a newer fence exists', () => {
  const store = new SqliteDurableStore(tmpDb());
  store.insertAgentRun(agentRun({ runId: 'agentcmd_eventfence', correlationId: 'agentcorr_eventfence' }), agentEvent({ runId: 'agentcmd_eventfence', correlationId: 'agentcorr_eventfence' }));
  const ownerA = store.claimAgentRunReconciliation('agentcmd_eventfence', 'owner-a', 2_000, 1_000)!;
  const startedA = store.appendAgentRunEventUnderFence({ runId: 'agentcmd_eventfence', expectedState: 'AWAITING_APPROVAL', at: 1_100, source: 'RECONCILIATION', eventType: 'restart.reconciliation_started', reason: 'test', reconciliation: { owner: ownerA.owner, fence: ownerA.fence, leaseValidAt: 1_100, expectedVersion: ownerA.version } })!;
  const ownerB = store.claimAgentRunReconciliation('agentcmd_eventfence', 'owner-b', 5_000, 3_000)!;
  assert.equal(ownerB.fence, startedA.fence + 1);
  assert.equal(store.appendAgentRunEventUnderFence({ runId: 'agentcmd_eventfence', expectedState: 'AWAITING_APPROVAL', at: 3_100, source: 'RECONCILIATION', eventType: 'restart.reconciliation_completed', reason: 'stale', reconciliation: { owner: startedA.owner, fence: startedA.fence, leaseValidAt: 3_100, expectedVersion: startedA.version } }), undefined);
  assert.ok(store.appendAgentRunEventUnderFence({ runId: 'agentcmd_eventfence', expectedState: 'AWAITING_APPROVAL', at: 3_200, source: 'RECONCILIATION', eventType: 'restart.reconciliation_started', reason: 'owner-b', reconciliation: { owner: ownerB.owner, fence: ownerB.fence, leaseValidAt: 3_200, expectedVersion: ownerB.version } }));
  assert.deepEqual(store.loadAgentRunEvents('agentcmd_eventfence').map((event) => event.type), ['run.created', 'restart.reconciliation_started', 'restart.reconciliation_started']);
  store.close();
});

test('reconciliation renewal cannot extend an already expired owner lease', () => {
  const store = new SqliteDurableStore(tmpDb());
  store.insertAgentRun(agentRun({ runId: 'agentcmd_expired_renew', correlationId: 'agentcorr_expired_renew' }), agentEvent({ runId: 'agentcmd_expired_renew', correlationId: 'agentcorr_expired_renew' }));
  const claim = store.claimAgentRunReconciliation('agentcmd_expired_renew', 'owner-a', 2_000, 1_000)!;
  assert.equal(store.renewAgentRunReconciliation('agentcmd_expired_renew', claim.owner, claim.fence, 10_000, 3_000), undefined);
  const ownerB = store.claimAgentRunReconciliation('agentcmd_expired_renew', 'owner-b', 10_000, 3_000)!;
  assert.equal(ownerB.fence, claim.fence + 1);
  assert.equal(store.appendAgentRunEventUnderFence({ runId: 'agentcmd_expired_renew', expectedState: 'AWAITING_APPROVAL', at: 3_100, source: 'RECONCILIATION', eventType: 'restart.reconciliation_started', reason: 'expired-owner', reconciliation: { owner: claim.owner, fence: claim.fence, leaseValidAt: 3_100, expectedVersion: claim.version } }), undefined);
  store.close();
});

test('retention preserves actively leased terminal runs and tombstones only selected rows', () => {
  const store = new SqliteDurableStore(tmpDb());
  const leased = agentRun({ runId: 'agentcmd_leased_terminal', correlationId: 'agentcorr_leased', state: 'COMPLETED', terminalAt: 10, reconciliationOwner: 'owner-live', reconciliationLeaseUntil: 10_000, reconciliationFence: 4 });
  const eligible = agentRun({ runId: 'agentcmd_eligible_terminal', correlationId: 'agentcorr_eligible', state: 'COMPLETED', terminalAt: 10 });
  store.insertAgentRun(leased, agentEvent({ runId: leased.runId, correlationId: leased.correlationId, nextState: 'COMPLETED' }));
  store.insertAgentRun(eligible, agentEvent({ runId: eligible.runId, correlationId: eligible.correlationId, nextState: 'COMPLETED' }));
  const pruned = store.pruneAgentRuns(100, 10, 1_000);
  assert.equal(pruned.runs, 1);
  assert.ok(store.loadAgentRun(leased.runId), 'actively leased terminal run must remain');
  assert.equal(store.loadAgentRunEvents(leased.runId).length, 1, 'leased run events must remain');
  assert.equal(store.loadAgentRun(eligible.runId), undefined);
  assert.deepEqual(store.loadAgentRunTombstones().map((t) => t.runId), [eligible.runId]);
  store.close();
});

test('retention tombstone failure preserves the run and its events atomically', () => {
  const db = tmpDb();
  let store = new SqliteDurableStore(db);
  const run = agentRun({ runId: 'agentcmd_tombstone_conflict', correlationId: 'agentcorr_tombstone_conflict', state: 'COMPLETED', terminalAt: 10 });
  store.insertAgentRun(run, agentEvent({ runId: run.runId, correlationId: run.correlationId, nextState: 'COMPLETED' }));
  store.close();

  const raw = new DatabaseSync(db);
  raw.prepare(
    `INSERT INTO agent_run_tombstones(tombstone_id,run_id,workspace_identity,recipe_id,final_state,terminal_at,deleted_at,deletion_reason,final_audit_seq,event_count,schema_version)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(`tombstone_${run.runId}_1000`, run.runId, run.workspaceIdentity, run.recipeId, run.state, run.terminalAt!, 999, 'TEST_CONFLICT', run.auditSeq, 1, 1);
  raw.close();

  store = new SqliteDurableStore(db);
  assert.throws(() => store.pruneAgentRuns(100, 10, 1_000), /UNIQUE constraint failed|constraint/i);
  assert.ok(store.loadAgentRun(run.runId), 'run must remain when tombstone cannot be inserted');
  assert.equal(store.loadAgentRunEvents(run.runId).length, 1, 'events must remain when tombstone cannot be inserted');
  store.close();
});

test('retention is bounded and repeated workers do not prune leased terminal rows', () => {
  const store = new SqliteDurableStore(tmpDb());
  const first = agentRun({ runId: 'agentcmd_retention_first', correlationId: 'agentcorr_retention_first', state: 'COMPLETED', terminalAt: 10 });
  const second = agentRun({ runId: 'agentcmd_retention_second', correlationId: 'agentcorr_retention_second', state: 'FAILED', terminalAt: 20 });
  const leased = agentRun({ runId: 'agentcmd_retention_leased', correlationId: 'agentcorr_retention_leased', state: 'COMPLETED', terminalAt: 5, reconciliationOwner: 'owner-live', reconciliationLeaseUntil: 10_000, reconciliationFence: 9 });
  for (const run of [first, second, leased]) store.insertAgentRun(run, agentEvent({ runId: run.runId, correlationId: run.correlationId, nextState: run.state }));
  assert.equal(store.pruneAgentRuns(100, 1, 1_000).runs, 1);
  assert.equal(store.loadAgentRunTombstones().length, 1);
  assert.ok(store.loadAgentRun(second.runId), 'batch limit must leave the second eligible row for a later worker');
  assert.ok(store.loadAgentRun(leased.runId), 'active lease must remain protected even when older than eligible rows');
  assert.equal(store.pruneAgentRuns(100, 1, 1_000).runs, 1);
  assert.equal(store.pruneAgentRuns(100, 1, 1_000).runs, 0);
  assert.ok(store.loadAgentRun(leased.runId));
  assert.deepEqual(store.loadAgentRunTombstones().map((t) => t.runId).sort(), [first.runId, second.runId].sort());
  store.close();
});

test('integrityCheck reports ok on a healthy store', () => {
  const store = new SqliteDurableStore(tmpDb());
  assert.equal(store.integrityCheck(), 'ok');
  store.close();
});
