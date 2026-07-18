// Operational Data Foundation — Slice 1, commit 2: durable evidence survives a
// restart when routed THROUGH the live in-memory stores (audit / usage / incident
// / budget), via wireOperationalPersistence. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SqliteDurableStore } from '../src/engine/persistence/sqliteStore.js';
import { wireOperationalPersistence } from '../src/engine/persistence/operationalBridge.js';
import { AuditStore } from '../src/engine/auditLog.js';
import { UsageLedger } from '../src/engine/providers/budget/usageLedger.js';
import { IncidentManager, LocalAlertSink } from '../src/engine/incidents.js';
import { BudgetManager, type BudgetScope } from '../src/engine/providers/budget/budgetManager.js';
import type { CostEstimate } from '../src/engine/providers/budget/costEstimation.js';

function tmpDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'migraai-opbridge-')), 'state.db');
}

let clock = 1_000;
const now = (): number => clock;
let idN = 0;
const mkId = (): string => `id${++idN}`;

function scope(over: Partial<BudgetScope> = {}): BudgetScope {
  return { kind: 'monthly', key: 'global', enabled: true, currency: 'USD', hardLimitUsd: 50, warningThreshold: 0.8, periodMs: undefined, periodStart: 0, spentUsd: 0, reservedUsd: 0, ...over };
}
function estimate(worst: number): CostEstimate {
  return { providerId: 'anthropic', modelId: 'claude', estimatedInputTokens: 100, maximumOutputTokens: 500, estimatedCostUsd: worst, worstCaseCostUsd: worst, pricingStatus: 'verified', costUnavailable: false };
}

function build(durable: SqliteDurableStore): { audit: AuditStore; usage: UsageLedger; incidents: IncidentManager; budget: BudgetManager } {
  const audit = new AuditStore(now);
  const usage = new UsageLedger(now, mkId);
  const incidents = new IncidentManager(new LocalAlertSink().sink, now, mkId);
  const budget = new BudgetManager(true, [scope()], now, mkId);
  wireOperationalPersistence(durable, { auditStore: audit, usageLedger: usage, incidentManager: incidents, budgetManager: budget }, { now, recentLimit: 500 });
  return { audit, usage, incidents, budget };
}

test('audit + usage written through the stores survive a restart', () => {
  const p = tmpDb();
  let d = new SqliteDurableStore(p);
  let s = build(d);
  s.audit.append({ correlationId: 'c1', type: 'execution.started', component: 'engineer', fields: { workspace: 'ws1' } });
  s.usage.append({ executionCorrelationId: 'c1', providerId: 'local', modelId: 'qwen', executionMode: 'chat', policy: 'auto', localOrCloud: 'local', outcome: 'ok', costStatus: 'unknown' });
  d.close();

  d = new SqliteDurableStore(p);
  s = build(d); // fresh managers, hydrated from durable
  assert.equal(s.audit.byCorrelation('c1')[0]!.type, 'execution.started');
  assert.equal(s.usage.summary().totalRecords, 1);
  assert.equal(d.operationalCounts().auditEvents, 1);
  d.close();
});

test('an OPEN incident survives a restart and still dedups the repeat occurrence', () => {
  const p = tmpDb();
  let d = new SqliteDurableStore(p);
  let s = build(d);
  const raised = s.incidents.raiseInconsistentState({ correlationId: 'c2', workspaceIdentityHash: 'wh', proposalHashPrefix: 'ph', appliedFileCount: 2, affectedPathCount: 2, rollbackFailureCount: 1, failureStage: 'rollback' });
  d.close();

  d = new SqliteDurableStore(p);
  s = build(d);
  // Same workspace+proposal+stage after restart → dedups to the restored incident.
  const again = s.incidents.raiseInconsistentState({ correlationId: 'c2b', workspaceIdentityHash: 'wh', proposalHashPrefix: 'ph', appliedFileCount: 2, affectedPathCount: 2, rollbackFailureCount: 1, failureStage: 'rollback' });
  assert.equal(again.notified, false, 'repeat after restart must NOT re-notify');
  assert.equal(again.incident.incidentId, raised.incident.incidentId);
  assert.equal(again.incident.occurrenceCount, 2);
  assert.equal(d.operationalCounts().incidents, 1);
  d.close();
});

test('budget running totals + active reservation survive a restart (reconciled to env scope)', () => {
  const p = tmpDb();
  let d = new SqliteDurableStore(p);
  let s = build(d);
  const r = s.budget.reserve({ correlationId: 'c3', providerId: 'anthropic', modelId: 'claude', estimate: estimate(2) });
  assert.equal(r.ok, true);
  d.close();

  // Reopen: spent=0 reserved=2 must reconcile onto the still-existing monthly:global scope.
  d = new SqliteDurableStore(p);
  s = build(d);
  const pf = s.budget.preflight({ correlationId: 'c3b', providerId: 'anthropic', modelId: 'claude', estimate: estimate(1) });
  assert.equal(pf.remainingUsd, 48, 'reserved 2 of 50 survived the restart');
  // The restored reservation is still consumable (single-use continuity).
  if (r.ok) {
    const consumed = s.budget.consume(r.reservation.reservationId, 2);
    assert.equal(consumed.ok, true);
  }
  d.close();

  // Third boot: spent=2 persisted, reservation removed on consume.
  d = new SqliteDurableStore(p);
  s = build(d);
  const pf2 = s.budget.preflight({ correlationId: 'c3c', providerId: 'anthropic', modelId: 'claude', estimate: estimate(1) });
  assert.equal(pf2.remainingUsd, 48, 'spent 2 persisted after consume');
  assert.equal(d.operationalCounts().reservations, 0, 'consumed reservation dropped from durable');
  d.close();
});

test('a removed env scope does NOT resurrect persisted totals (config-change safe)', () => {
  const p = tmpDb();
  const d = new SqliteDurableStore(p);
  // Persist a scope id that will NOT exist in the next boot's env config.
  d.saveBudgetScope({ scopeId: 'provider:openai', kind: 'provider', scopeKeyName: 'openai', hardLimitUsd: 10, spentUsd: 9, reservedUsd: 0, periodStart: 0, updatedAt: 1000 });
  // Next boot only defines monthly:global — the orphaned provider:openai total is dropped.
  const audit = new AuditStore(now);
  const usage = new UsageLedger(now, mkId);
  const incidents = new IncidentManager(new LocalAlertSink().sink, now, mkId);
  const budget = new BudgetManager(true, [scope()], now, mkId);
  wireOperationalPersistence(d, { auditStore: audit, usageLedger: usage, incidentManager: incidents, budgetManager: budget }, { now });
  // The only surviving scope is monthly:global, untouched: the orphaned $9 spend on
  // the removed provider:openai scope was DROPPED, never leaked onto a live scope.
  const pf = budget.preflight({ correlationId: 'c4', providerId: 'openai', modelId: 'gpt', estimate: estimate(1) });
  assert.equal(pf.remainingUsd, 50, 'monthly:global untouched — orphaned total not resurrected');
  d.close();
});
