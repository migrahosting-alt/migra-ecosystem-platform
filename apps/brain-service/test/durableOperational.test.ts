// Operational Data Foundation — Slice 1, commit 1: durable operational store.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteDurableStore, SCHEMA_VERSION, type AgentRunReproposalFaultPhase } from '../src/engine/persistence/sqliteStore.js';
import type { DurableAgentRun, DurableAgentRunEvent, DurableAuditEvent, DurableUsageRecord, DurableIncident, AgentRunReproposalInput } from '../src/engine/persistence/types.js';
import { recoveryEventDigest } from '../src/engine/recoverySourceProvenance.js';

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
function expectCorruptV5(name: string, mutate: (dbPath: string) => void, pattern = /db schema v5|malformed database schema|schema v999/): void {
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
    approvalLifecycleVersion: 1, approvalLifecycle: 'PENDING_DISPLAY', approvalRequestedAt: 1000, approvalExpiresAt: 2000,
    recoveryClass: 'NONE', recoveryEligible: false, recoveryAttemptCount: 0, reconciliationFence: 0,
    auditSeq: 0, schemaVersion: 1, version: 1, updatedAt: 1000, ...over,
  };
}
function agentEvent(over: Partial<DurableAgentRunEvent> = {}): DurableAgentRunEvent {
  const runId = over.runId ?? 'agentcmd_1';
  return { eventId: `${runId}:agev1`, runId, seq: 1, at: 1000, type: 'run.created', nextState: 'AWAITING_APPROVAL', correlationId: 'agentcorr_1', source: 'API', schemaVersion: 1, ...over };
}
function seedRejectedSource(store: SqliteDurableStore, over: Partial<DurableAgentRun> = {}): DurableAgentRun {
  const run = agentRun({
    runId: 'agentcmd_recovery_source',
    correlationId: 'agentcorr_recovery_source',
    ...over,
  });
  store.insertAgentRun(run, agentEvent({ runId: run.runId, correlationId: run.correlationId, nextState: 'AWAITING_APPROVAL' }));
  store.appendAgentRunEvent({ eventId: `${run.runId}:proposal`, runId: run.runId, at: 1000, type: 'proposal.created', priorState: 'AWAITING_APPROVAL', nextState: 'AWAITING_APPROVAL', reason: run.recipeId, correlationId: run.correlationId, source: 'API', schemaVersion: 1 });
  assert.equal(store.transitionAgentRun({
    runId: run.runId,
    expectedState: 'AWAITING_APPROVAL',
    nextState: 'REJECTED',
    at: 1100,
    source: 'APPROVAL',
    eventType: 'approval.rejected',
    reason: 'HUMAN_REJECTED',
    patch: {
      terminalAt: 1100,
      failureCode: 'REJECTED',
      approvalLifecycle: 'REJECTED',
      approvalDecisionType: 'REJECTED',
      approvalDecisionAt: 1100,
      recoveryClass: 'REPROPOSAL_ALLOWED',
      recoveryEligible: true,
      recoveryReason: 'REJECTED',
    },
  }), true);
  return store.loadAgentRun(run.runId)!;
}
function reproposalProvenance(store: SqliteDurableStore, source: DurableAgentRun) {
  const events = store.loadAgentRunEvents(source.runId);
  return {
    workspaceIdentity: source.workspaceIdentity,
    allowedRecipes: [source.recipeId],
    eventDigest: recoveryEventDigest(events),
    highestSeq: source.auditSeq,
  };
}
function reproposalInput(store: SqliteDurableStore, source: DurableAgentRun, requestId: string, successorId: string, at = 2_000): AgentRunReproposalInput {
  const successor = agentRun({
    runId: successorId,
    correlationId: `${successorId}_corr`,
    requestedAt: at,
    proposalAt: at,
    expiresAt: at + 1_000,
    recoverySourceRunId: source.runId,
    proposalFingerprint: `${successorId}_fingerprint`,
    proposalHash: `${successorId}_hash`,
    snapshotId: `${successorId}_snapshot`,
    snapshotManifestDigest: `${successorId}_manifest`,
  });
  return {
    sourceRunId: source.runId,
    sourceExpectedVersion: source.version,
    requestId,
    at,
    provenance: reproposalProvenance(store, source),
    successor,
    createdEvent: agentEvent({ eventId: `${successorId}:created`, runId: successor.runId, correlationId: successor.correlationId, type: 'run.created' }),
    proposalEvent: agentEvent({ eventId: `${successorId}:proposal`, runId: successor.runId, correlationId: successor.correlationId, seq: 2, type: 'proposal.created' }),
  };
}

test('SCHEMA_VERSION is 5 (Agent approval lifecycle and recovery lineage added)', () => {
  assert.equal(SCHEMA_VERSION, 5);
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
  const store = new SqliteDurableStore(p); // v5 engine migrates additively
  assert.equal(store.health().schemaVersion, 5);
  assert.deepEqual(store.loadAgentRuns(), []);
  store.close();
});

test('a v5 database startup is idempotent and refuses newer schemas', () => {
  const p = tmpDb();
  let store = new SqliteDurableStore(p);
  store.close();
  store = new SqliteDurableStore(p);
  assert.equal(store.health().schemaVersion, 5);
  store.close();

  const bad = tmpDb();
  const raw = new DatabaseSync(bad);
  raw.exec('CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT);');
  raw.prepare('INSERT INTO schema_meta(key,value) VALUES(?,?)').run('schema_version', '999');
  raw.close();
  assert.throws(() => new SqliteDurableStore(bad), /schema v999 > engine v5/);
});

test('v5 schema integrity fails closed on missing index or malformed tombstone table', () => {
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
    INSERT INTO schema_meta(key,value) VALUES('schema_version','5');
    CREATE TABLE agent_runs (run_id TEXT PRIMARY KEY);
    CREATE TABLE agent_run_events (event_id TEXT PRIMARY KEY);
    CREATE TABLE agent_run_tombstones (tombstone_id TEXT PRIMARY KEY, run_id TEXT);
  `);
  raw.close();
  assert.throws(() => new SqliteDurableStore(malformed), /db schema v5 (missing|has nullable|has incompatible)/);

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

test('v5 Agent schema contract rejects every critical missing or malformed object', () => {
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
    'approval_lifecycle_version',
    'approval_lifecycle',
    'recovery_class',
    'recovery_eligible',
    'recovery_attempt_count',
  ];
  for (const column of requiredRunColumns) {
    expectCorruptV5(`missing agent_runs.${column}`, (p) => replaceCreateSql(p, 'table', 'agent_runs', `,\n  ${column} `, ',\n  __removed__ '), /missing agent_runs\.|malformed database schema/);
  }

  expectCorruptV5('agent_runs.version nullable', (p) => replaceCreateSql(p, 'table', 'agent_runs', ',\n  version INTEGER NOT NULL DEFAULT 1', ',\n  version INTEGER DEFAULT 1'), /nullable agent_runs\.version/);
  expectCorruptV5('agent_runs.version wrong default', (p) => replaceCreateSql(p, 'table', 'agent_runs', ',\n  version INTEGER NOT NULL DEFAULT 1', ',\n  version INTEGER NOT NULL DEFAULT 0'), /default on agent_runs\.version/);
  expectCorruptV5('agent_runs.approval lifecycle nullable', (p) => replaceCreateSql(p, 'table', 'agent_runs', "approval_lifecycle TEXT NOT NULL DEFAULT 'NOT_REQUESTED'", "approval_lifecycle TEXT DEFAULT 'NOT_REQUESTED'"), /nullable agent_runs\.approval_lifecycle/);
  expectCorruptV5('agent_runs.recovery class wrong default', (p) => replaceCreateSql(p, 'table', 'agent_runs', "recovery_class TEXT NOT NULL DEFAULT 'NONE'", "recovery_class TEXT NOT NULL DEFAULT 'REPROPOSAL_ALLOWED'"), /default on agent_runs\.recovery_class/);
  expectCorruptV5('agent_runs.recovery eligibility wrong default', (p) => replaceCreateSql(p, 'table', 'agent_runs', 'recovery_eligible INTEGER NOT NULL DEFAULT 0', 'recovery_eligible INTEGER NOT NULL DEFAULT 1'), /default on agent_runs\.recovery_eligible/);
  expectCorruptV5('agent_runs.reconciliation_fence nullable', (p) => replaceCreateSql(p, 'table', 'agent_runs', 'reconciliation_fence INTEGER NOT NULL DEFAULT 0', 'reconciliation_fence INTEGER DEFAULT 0'), /nullable agent_runs\.reconciliation_fence/);
  expectCorruptV5('agent_runs.reconciliation_fence wrong default', (p) => replaceCreateSql(p, 'table', 'agent_runs', 'reconciliation_fence INTEGER NOT NULL DEFAULT 0', 'reconciliation_fence INTEGER NOT NULL DEFAULT 1'), /default on agent_runs\.reconciliation_fence/);
  expectCorruptV5('agent_runs.state nullable', (p) => replaceCreateSql(p, 'table', 'agent_runs', 'state TEXT NOT NULL', 'state TEXT'), /nullable agent_runs\.state/);
  expectCorruptV5('agent_runs.run_id no primary key', (p) => replaceCreateSql(p, 'table', 'agent_runs', 'run_id TEXT PRIMARY KEY', 'run_id TEXT'), /primary key on agent_runs\.run_id|malformed database schema/);
  expectCorruptV5('agent_runs.containment_binding wrong type', (p) => replaceCreateSql(p, 'table', 'agent_runs', 'containment_binding TEXT', 'containment_binding INTEGER'), /agent_runs\.containment_binding type/);

  expectCorruptV5('agent_run_events missing sequence', (p) => replaceCreateSql(p, 'table', 'agent_run_events', ',\n  seq INTEGER NOT NULL', ''), /missing agent_run_events\.seq|malformed database schema/);
  expectCorruptV5('agent_run_events missing unique run sequence', (p) => replaceCreateSql(p, 'table', 'agent_run_events', ',\n  UNIQUE(run_id, seq)', ''), /unique index|malformed database schema/);
  expectCorruptV5('agent_run_events wrong foreign key delete behavior', (p) => replaceCreateSql(p, 'table', 'agent_run_events', 'ON DELETE CASCADE', 'ON DELETE RESTRICT'), /missing foreign key/);
  expectCorruptV5('agent_run_events nullable run ID', (p) => replaceCreateSql(p, 'table', 'agent_run_events', 'run_id TEXT NOT NULL', 'run_id TEXT'), /nullable agent_run_events\.run_id/);
  expectCorruptV5('agent_run_events nullable event ID by missing primary key', (p) => replaceCreateSql(p, 'table', 'agent_run_events', 'event_id TEXT PRIMARY KEY', 'event_id TEXT'), /primary key on agent_run_events\.event_id|malformed database schema/);

  expectCorruptV5('agent_run_tombstones missing deleted run ID', (p) => replaceCreateSql(p, 'table', 'agent_run_tombstones', ',\n  run_id TEXT NOT NULL', ''), /missing agent_run_tombstones\.run_id/);
  expectCorruptV5('agent_run_tombstones missing final state', (p) => replaceCreateSql(p, 'table', 'agent_run_tombstones', ',\n  final_state TEXT NOT NULL', ''), /missing agent_run_tombstones\.final_state/);
  expectCorruptV5('agent_run_tombstones missing deletion timestamp', (p) => replaceCreateSql(p, 'table', 'agent_run_tombstones', ',\n  deleted_at INTEGER NOT NULL', ''), /missing agent_run_tombstones\.deleted_at|malformed database schema/);
  expectCorruptV5('agent_run_tombstones wrong nullability', (p) => replaceCreateSql(p, 'table', 'agent_run_tombstones', 'run_id TEXT NOT NULL', 'run_id TEXT'), /nullable agent_run_tombstones\.run_id/);
  expectCorruptV5('agent_run_tombstones missing uniqueness', (p) => replaceCreateSql(p, 'table', 'agent_run_tombstones', 'tombstone_id TEXT PRIMARY KEY', 'tombstone_id TEXT'), /primary key on agent_run_tombstones\.tombstone_id|malformed database schema/);
  expectCorruptV5('agent_run_tombstones missing retention index', (p) => {
    const raw = new DatabaseSync(p);
    raw.exec('DROP INDEX idx_agent_run_tombstones_deleted;');
    raw.close();
  }, /missing index idx_agent_run_tombstones_deleted/);

  for (const index of ['idx_agent_runs_nonterminal', 'idx_agent_runs_reconciliation', 'idx_agent_runs_terminal']) {
    expectCorruptV5(`missing ${index}`, (p) => {
      const raw = new DatabaseSync(p);
      raw.exec(`DROP INDEX ${index};`);
      raw.close();
    }, new RegExp(`missing index ${index}`));
  }
  for (const index of ['idx_agent_runs_recovery_source', 'idx_agent_runs_active_successor']) {
    expectCorruptV5(`missing ${index}`, (p) => {
      const raw = new DatabaseSync(p);
      raw.exec(`DROP INDEX ${index};`);
      raw.close();
    }, new RegExp(`missing index ${index}`));
  }
  expectCorruptV5('wrong reconciliation index column order', (p) => replaceCreateSql(p, 'index', 'idx_agent_runs_reconciliation', 'reconciliation_owner, reconciliation_fence, version, reconciliation_lease_until', 'reconciliation_owner, version, reconciliation_fence, reconciliation_lease_until'), /columns for idx_agent_runs_reconciliation/);
  expectCorruptV5('wrong active successor partial predicate', (p) => replaceCreateSql(p, 'index', 'idx_agent_runs_active_successor', "state NOT IN ('COMPLETED','REJECTED','EXPIRED','STALE','FAILED','CANCELLED')", "state NOT IN ('COMPLETED')"), /partial predicate for idx_agent_runs_active_successor/);

  expectCorruptV5('schema_meta missing version row', (p) => {
    const raw = new DatabaseSync(p);
    raw.prepare("DELETE FROM schema_meta WHERE key='schema_version'").run();
    raw.close();
  }, /schema metadata missing for non-empty database/);
  expectCorruptV5('schema_meta malformed table', (p) => replaceCreateSql(p, 'table', 'schema_meta', 'key TEXT PRIMARY KEY', 'key TEXT'), /primary key on schema_meta\.key|malformed database schema/);
  expectCorruptV5('unsupported newer schema', (p) => {
    const raw = new DatabaseSync(p);
    raw.prepare("UPDATE schema_meta SET value='999' WHERE key='schema_version'").run();
    raw.close();
  }, /schema v999 > engine v5/);
});

test('clean v5 initialization and v2/v3/v4 migrations create every validator-required Agent object', () => {
  for (const p of [initializedDb()]) {
    const store = new SqliteDurableStore(p);
    assert.equal(store.health().schemaVersion, 5);
    store.close();
  }
  for (const version of ['2', '3', '4']) {
    const p = tmpDb();
    const raw = new DatabaseSync(p);
    raw.exec('CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT);');
    raw.prepare('INSERT INTO schema_meta(key,value) VALUES(?,?)').run('schema_version', version);
    raw.close();
    const store = new SqliteDurableStore(p);
    assert.equal(store.health().schemaVersion, 5);
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

test('Agent recovery reproposal links successor transactionally and idempotently', () => {
  const store = new SqliteDurableStore(tmpDb());
  const source = seedRejectedSource(store);
  const successor = agentRun({
    runId: 'agentcmd_recovery_successor',
    correlationId: 'agentcorr_recovery_successor',
    requestedAt: 2_000,
    proposalAt: 2_000,
    expiresAt: 3_000,
    recoverySourceRunId: source.runId,
  });
  const result = store.reproposeAgentRun({
    sourceRunId: source.runId,
    sourceExpectedVersion: source.version,
    requestId: 'stage3b-sqlite-reproposal',
    at: 2_000,
    provenance: reproposalProvenance(store, source),
    successor,
    createdEvent: agentEvent({ eventId: 'agev_successor_created', runId: successor.runId, correlationId: successor.correlationId, type: 'run.created' }),
    proposalEvent: agentEvent({ eventId: 'agev_successor_proposal', runId: successor.runId, correlationId: successor.correlationId, seq: 2, type: 'proposal.created' }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.created, true);
  assert.equal(store.loadAgentRun(source.runId)?.successorRunId, successor.runId);
  assert.equal(store.loadAgentRun(successor.runId)?.recoverySourceRunId, source.runId);
  assert.deepEqual(store.loadAgentRunEvents(source.runId).map((event) => event.type), ['run.created', 'proposal.created', 'approval.rejected', 'recovery.reproposal_requested', 'recovery.successor_linked']);

  const replay = store.reproposeAgentRun({
    sourceRunId: source.runId,
    sourceExpectedVersion: store.loadAgentRun(source.runId)!.version,
    requestId: 'stage3b-sqlite-reproposal',
    at: 2_100,
    provenance: reproposalProvenance(store, store.loadAgentRun(source.runId)!),
    successor,
    createdEvent: agentEvent({ eventId: 'agev_duplicate_created', runId: successor.runId, correlationId: successor.correlationId }),
    proposalEvent: agentEvent({ eventId: 'agev_duplicate_proposal', runId: successor.runId, correlationId: successor.correlationId, seq: 2, type: 'proposal.created' }),
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.ok && replay.created, false);

  const pruned = store.pruneAgentRuns(5_000, 10, 1_000);
  assert.equal(pruned.runs, 0, 'terminal source with active successor must be retained');
  store.close();
});

test('Agent recovery reproposal rejects stale provenance when source events mutate before transaction', () => {
  const p = tmpDb();
  const store = new SqliteDurableStore(p);
  const source = seedRejectedSource(store);
  const staleProvenance = reproposalProvenance(store, source);
  const successor = agentRun({
    runId: 'agentcmd_recovery_stale_successor',
    correlationId: 'agentcorr_recovery_stale_successor',
    requestedAt: 2_000,
    proposalAt: 2_000,
    expiresAt: 3_000,
    recoverySourceRunId: source.runId,
  });
  const raw = new DatabaseSync(p);
  raw.prepare(
    `INSERT INTO agent_run_events(event_id,run_id,seq,at,type,prior_state,next_state,reason,correlation_id,source,schema_version)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
  ).run('agev_source_race', source.runId, source.auditSeq + 1, 1500, 'forged.extra_event', 'REJECTED', 'REJECTED', 'race', source.correlationId, 'RECOVERY', 1);
  raw.close();
  const result = store.reproposeAgentRun({
    sourceRunId: source.runId,
    sourceExpectedVersion: source.version,
    requestId: 'stage3b-sqlite-race',
    at: 2_000,
    provenance: staleProvenance,
    successor,
    createdEvent: agentEvent({ eventId: 'agev_race_successor_created', runId: successor.runId, correlationId: successor.correlationId, type: 'run.created' }),
    proposalEvent: agentEvent({ eventId: 'agev_race_successor_proposal', runId: successor.runId, correlationId: successor.correlationId, seq: 2, type: 'proposal.created' }),
  });
  assert.deepEqual(result, { ok: false, code: 'SOURCE_PROVENANCE_FAILED' });
  assert.equal(store.loadAgentRun(successor.runId), undefined);
  assert.equal(store.loadAgentRun(source.runId)?.successorRunId, undefined);
  store.close();
});

test('Agent recovery event id collisions fail the transaction without partial lineage', () => {
  const p = tmpDb();
  const store = new SqliteDurableStore(p);
  const source = seedRejectedSource(store);
  const successor = agentRun({
    runId: 'agentcmd_recovery_collision_successor',
    correlationId: 'agentcorr_recovery_collision_successor',
    requestedAt: 2_000,
    proposalAt: 2_000,
    expiresAt: 3_000,
    recoverySourceRunId: source.runId,
  });
  const collidingEventId = `${source.runId}:reproposal:stage3b-sqlite-collision:requested`;
  const raw = new DatabaseSync(p);
  raw.prepare(
    `INSERT INTO agent_runs(run_id,correlation_id,activation_ref,workspace_identity,workspace_ref,recipe_id,recipe_policy_version,proposal_fingerprint,proposal_hash,snapshot_id,snapshot_manifest_digest,executable_digest,state,requested_at,proposal_at,expires_at,timeout_ms,output_limit_bytes,mutation_classification,network_policy,expected_effects_json,approval_lifecycle_version,approval_lifecycle,recovery_class,recovery_eligible,recovery_attempt_count,audit_seq,schema_version,version,reconciliation_fence,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run('agentcmd_collision_holder', 'agentcorr_collision_holder', 'actref', 'workspace-id', 'wsref', 'git.status', 'agent-git-readonly-v2', 'fingerprint', 'hash', 'snapshot', 'manifest', 'exec', 'AWAITING_APPROVAL', 900, 900, 1900, 30000, 65536, 'read-only', 'not-required', '[]', 1, 'PENDING_DISPLAY', 'NONE', 0, 0, 1, 1, 1, 0, 900);
  raw.prepare(
    `INSERT INTO agent_run_events(event_id,run_id,seq,at,type,next_state,correlation_id,source,schema_version)
     VALUES(?,?,?,?,?,?,?,?,?)`,
  ).run(collidingEventId, 'agentcmd_collision_holder', 1, 900, 'run.created', 'AWAITING_APPROVAL', 'agentcorr_collision_holder', 'API', 1);
  raw.close();
  const result = store.reproposeAgentRun({
    sourceRunId: source.runId,
    sourceExpectedVersion: source.version,
    requestId: 'stage3b-sqlite-collision',
    at: 2_000,
    provenance: reproposalProvenance(store, source),
    successor,
    createdEvent: agentEvent({ eventId: 'agev_collision_successor_created', runId: successor.runId, correlationId: successor.correlationId, type: 'run.created' }),
    proposalEvent: agentEvent({ eventId: 'agev_collision_successor_proposal', runId: successor.runId, correlationId: successor.correlationId, seq: 2, type: 'proposal.created' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.code, 'RECOVERY_EVENT_CONTENT_MISMATCH');
  assert.equal(store.loadAgentRun(successor.runId), undefined);
  assert.equal(store.loadAgentRun(source.runId)?.successorRunId, undefined);
  assert.equal(store.loadAgentRunEvents(source.runId).some((event) => event.type.startsWith('recovery.')), false);
  store.close();
});

test('Agent recovery reproposal under SQLite writer lock fails closed and retries deterministically', () => {
  const p = tmpDb();
  const store = new SqliteDurableStore(p);
  const source = seedRejectedSource(store);
  const successor = agentRun({
    runId: 'agentcmd_recovery_locked_successor',
    correlationId: 'agentcorr_recovery_locked_successor',
    requestedAt: 2_000,
    proposalAt: 2_000,
    expiresAt: 3_000,
    recoverySourceRunId: source.runId,
  });
  const input = {
    sourceRunId: source.runId,
    sourceExpectedVersion: source.version,
    requestId: 'stage3b-sqlite-locked',
    at: 2_000,
    provenance: reproposalProvenance(store, source),
    successor,
    createdEvent: agentEvent({ eventId: 'agev_locked_successor_created', runId: successor.runId, correlationId: successor.correlationId, type: 'run.created' }),
    proposalEvent: agentEvent({ eventId: 'agev_locked_successor_proposal', runId: successor.runId, correlationId: successor.correlationId, seq: 2, type: 'proposal.created' }),
  };
  const raw = new DatabaseSync(p);
  raw.exec('BEGIN EXCLUSIVE');
  try {
    const locked = store.reproposeAgentRun(input);
    assert.deepEqual(locked, { ok: false, code: 'PARTIAL_FAILURE' });
  } finally {
    raw.exec('ROLLBACK');
    raw.close();
  }
  assert.equal(store.loadAgentRun(successor.runId), undefined);
  assert.equal(store.loadAgentRun(source.runId)?.successorRunId, undefined);
  assert.equal(store.loadAgentRun(source.runId)?.version, source.version);
  assert.equal(store.loadAgentRun(source.runId)?.auditSeq, source.auditSeq);
  assert.equal(store.loadAgentRunEvents(source.runId).some((event) => event.type.startsWith('recovery.')), false);

  const retry = store.reproposeAgentRun(input);
  assert.equal(retry.ok, true);
  assert.equal(retry.ok && retry.created, true);
  assert.equal(store.loadAgentRun(source.runId)?.successorRunId, successor.runId);
  assert.equal(store.loadAgentRun(successor.runId)?.recoverySourceRunId, source.runId);
  store.close();
});

test('Agent recovery reproposal SQLite ten-phase fault matrix rolls back and retries deterministically', () => {
  const phases: AgentRunReproposalFaultPhase[] = [
    'recovery-status source read',
    'source event read',
    'provenance revalidation',
    'idempotency lookup',
    'successor run insert',
    'successor proposal/event insert',
    'source recovery event insert',
    'successor lineage event insert',
    'source lineage update',
    'transaction commit',
  ];

  for (const phase of phases) {
    const store = new SqliteDurableStore(tmpDb());
    const source = seedRejectedSource(store, { runId: `agentcmd_source_${phase.replaceAll(/[^a-z0-9]+/gi, '_')}` });
    const sourceEvents = store.loadAgentRunEvents(source.runId);
    const sourceJson = JSON.stringify(store.loadAgentRun(source.runId));
    const sourceEventsJson = JSON.stringify(sourceEvents);
    const input = reproposalInput(store, source, `stage3b-${phase}`, `agentcmd_successor_${phase.replaceAll(/[^a-z0-9]+/gi, '_')}`);

    store.injectAgentRunReproposalFaultForTest(phase);
    const failed = store.reproposeAgentRun(input);
    assert.deepEqual(failed, { ok: false, code: 'PARTIAL_FAILURE' }, phase);
    assert.equal(store.loadAgentRun(input.successor.runId), undefined, phase);
    assert.equal(JSON.stringify(store.loadAgentRun(source.runId)), sourceJson, phase);
    assert.equal(JSON.stringify(store.loadAgentRunEvents(source.runId)), sourceEventsJson, phase);
    assert.equal(store.loadAgentRunEvents(source.runId).some((event) => event.type.startsWith('recovery.')), false, phase);

    const retry = store.reproposeAgentRun(input);
    assert.equal(retry.ok, true, phase);
    assert.equal(retry.ok && retry.created, true, phase);
    assert.equal(store.loadAgentRun(source.runId)?.successorRunId, input.successor.runId, phase);
    assert.equal(store.loadAgentRun(input.successor.runId)?.recoverySourceRunId, source.runId, phase);

    const sameRequestReplay = store.reproposeAgentRun({
      ...input,
      sourceExpectedVersion: store.loadAgentRun(source.runId)!.version,
      provenance: reproposalProvenance(store, store.loadAgentRun(source.runId)!),
      successor: agentRun({ runId: `${input.successor.runId}_duplicate`, correlationId: `${input.successor.runId}_duplicate_corr`, recoverySourceRunId: source.runId }),
    });
    assert.equal(sameRequestReplay.ok, true, phase);
    assert.equal(sameRequestReplay.ok && sameRequestReplay.created, false, phase);
    assert.equal(sameRequestReplay.ok && sameRequestReplay.successor.runId, input.successor.runId, phase);

    const differentRequest = store.reproposeAgentRun({
      ...reproposalInput(store, store.loadAgentRun(source.runId)!, `stage3b-${phase}-different`, `${input.successor.runId}_other`, 2_100),
      sourceExpectedVersion: store.loadAgentRun(source.runId)!.version,
    });
    assert.equal(differentRequest.ok, false, phase);
    assert.equal(differentRequest.ok ? undefined : differentRequest.code, 'ACTIVE_SUCCESSOR_EXISTS', phase);
    assert.equal(store.loadAgentRuns().filter((run) => run.recoverySourceRunId === source.runId).length, 1, phase);
    store.close();
  }
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
