// Operational Readiness Slice 3 — incident + alert pipeline.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IncidentManager, LocalAlertSink, type InconsistentStateAlert, type RaiseInput } from '../src/engine/incidents.js';

let idc = 0;
const ids = () => `inc_${idc++}`;
function raiseInput(over: Partial<RaiseInput> = {}): RaiseInput {
  return {
    correlationId: 'corr_1',
    workspaceIdentityHash: 'ws_abc',
    proposalHashPrefix: 'prop_abc',
    appliedFileCount: 2,
    affectedPathCount: 2,
    rollbackFailureCount: 1,
    failureStage: 'rollback',
    ...over,
  };
}

test('INCONSISTENT_STATE creates ONE critical incident and notifies once', () => {
  idc = 0;
  const sink = new LocalAlertSink();
  const m = new IncidentManager(sink.sink, () => 1, ids);
  const { incident, notified } = m.raiseInconsistentState(raiseInput());
  assert.equal(incident.severity, 'critical');
  assert.equal(incident.state, 'open');
  assert.equal(incident.occurrenceCount, 1);
  assert.equal(notified, true);
  assert.equal(sink.delivered.length, 1);
  // Alert carries only safe metadata.
  const a: InconsistentStateAlert = sink.delivered[0]!;
  assert.equal(a.event, 'workspace_application_inconsistent_state');
  assert.equal(a.correlation_id, 'corr_1');
  const flat = JSON.stringify(a);
  assert.doesNotMatch(flat, /content|\/home|appr_|diff/);
});

test('repeat same incident deduplicates notification but increments occurrences', () => {
  idc = 0;
  const sink = new LocalAlertSink();
  const m = new IncidentManager(sink.sink, () => 1, ids);
  m.raiseInconsistentState(raiseInput());
  const second = m.raiseInconsistentState(raiseInput());
  assert.equal(second.notified, false); // deduped
  assert.equal(second.incident.occurrenceCount, 2); // still counted
  assert.equal(sink.delivered.length, 1); // only one notification
  assert.equal(m.list().length, 1);
});

test('different workspace or proposal creates a SEPARATE incident', () => {
  idc = 0;
  const sink = new LocalAlertSink();
  const m = new IncidentManager(sink.sink, () => 1, ids);
  m.raiseInconsistentState(raiseInput());
  m.raiseInconsistentState(raiseInput({ workspaceIdentityHash: 'ws_other' }));
  m.raiseInconsistentState(raiseInput({ proposalHashPrefix: 'prop_other' }));
  assert.equal(m.list().length, 3);
  assert.equal(sink.delivered.length, 3);
});

test('notification delivery failure is recorded honestly (never silent success)', () => {
  idc = 0;
  const m = new IncidentManager(() => {
    throw new Error('pager down');
  }, () => 1, ids);
  const { incident } = m.raiseInconsistentState(raiseInput());
  assert.equal(incident.lastDeliveryStatus, 'failed');
  assert.equal(incident.state, 'notification_failed');
  assert.equal(m.health().notifications_failed, 1);
  assert.equal(m.health().status, 'degraded');
});

test('incident is NOT auto-resolved by a later success; explicit resolve only', () => {
  idc = 0;
  const sink = new LocalAlertSink();
  const m = new IncidentManager(sink.sink, () => 1, ids);
  const { incident } = m.raiseInconsistentState(raiseInput());
  // A later successful run does not touch this incident — it stays open until acked/resolved.
  assert.equal(m.get(incident.incidentId)!.state, 'open');
  m.acknowledge(incident.incidentId);
  assert.equal(m.get(incident.incidentId)!.state, 'acknowledged');
  m.resolve(incident.incidentId, 'operator recovered workspace');
  assert.equal(m.get(incident.incidentId)!.state, 'resolved');
  assert.ok(m.get(incident.incidentId)!.resolution);
});

test('a repeat occurrence reopens a resolved incident (does not stay resolved)', () => {
  idc = 0;
  const sink = new LocalAlertSink();
  const m = new IncidentManager(sink.sink, () => 1, ids);
  const { incident } = m.raiseInconsistentState(raiseInput());
  m.resolve(incident.incidentId, 'fixed');
  const again = m.raiseInconsistentState(raiseInput());
  assert.equal(again.incident.state, 'open');
  assert.equal(again.incident.occurrenceCount, 2);
});

test('incident health counters stay consistent', () => {
  idc = 0;
  const sink = new LocalAlertSink();
  const m = new IncidentManager(sink.sink, () => 1, ids);
  m.raiseInconsistentState(raiseInput());
  m.raiseInconsistentState(raiseInput()); // dedup, +1 occurrence
  m.raiseInconsistentState(raiseInput({ proposalHashPrefix: 'p2' }));
  const h = m.health();
  assert.equal(h.total_incidents, 2);
  assert.equal(h.total_occurrences, 3);
  assert.equal(h.notifications_delivered, 2);
});
