// Operational Readiness Slice 2 — proposal/approval telemetry, health, eviction.
// Model calls are absent; stores + executor are exercised directly with injected
// time and telemetry sinks.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { ChangesetProposalStore, proposeChangeset, applyChangeset } from '../src/tools/changeset.js';
import type { ChangesetRequest } from '@migrapilot/protocol';
import { nodeChangesetFs } from '../src/tools/changesetFs.js';
import { ToolApprovalStore, hashInput } from '../src/engine/toolApprovalStore.js';
import { StoreHealth, type TelemetryEvent } from '../src/engine/storeTelemetry.js';

const fs = nodeChangesetFs();
function ws(seed: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'telem-'));
  for (const [rel, c] of Object.entries(seed)) writeFileSync(path.join(root, rel), c);
  return root;
}
function cs(root: string, ops: ChangesetRequest['ops'], allowDelete?: boolean): ChangesetRequest {
  return { rootPath: root, ops, ...(allowDelete ? { allowDelete: true } : {}) };
}

// ── proposal store lifecycle events ──────────────────────────────────────────────

test('proposal.created emits ONE metadata-only event (no content/paths/hash)', () => {
  const events: TelemetryEvent[] = [];
  const store = new ChangesetProposalStore(() => 1000, (e) => events.push(e));
  const root = ws();
  const p = proposeChangeset(cs(root, [{ op: 'create', path: 'src/x.js', content: 'SECRET_CONTENT\n' }]), fs, store, 'corr_1');
  const created = events.filter((e) => e.event === 'proposal.created');
  assert.equal(created.length, 1);
  assert.equal(created[0]!.correlationId, 'corr_1');
  assert.equal(created[0]!.fields.opCount, 1);
  const flat = JSON.stringify(events);
  assert.doesNotMatch(flat, /SECRET_CONTENT/, 'no file content');
  assert.ok(!flat.includes(root), 'no raw workspace path');
  assert.ok(!flat.includes(p.proposalHash), 'no full proposal hash');
});

test('proposal lifecycle: created → looked_up → consumed, correlated throughout', () => {
  const events: TelemetryEvent[] = [];
  const store = new ChangesetProposalStore(() => 1000, (e) => events.push(e));
  const root = ws();
  const p = proposeChangeset(cs(root, [{ op: 'create', path: 'a.js', content: '1\n' }]), fs, store, 'corr_x');
  store.get(p.proposalHash, 'corr_x');
  applyChangeset({ rootPath: root, proposalHash: p.proposalHash }, fs, store, 'corr_x');
  const seq = events.map((e) => e.event);
  assert.ok(seq.includes('proposal.created') && seq.includes('proposal.looked_up') && seq.includes('proposal.consumed'));
  assert.ok(events.every((e) => e.correlationId === 'corr_x'));
});

test('proposal.expired vs proposal.unknown are distinguishable', () => {
  const events: TelemetryEvent[] = [];
  let now = 1000;
  const store = new ChangesetProposalStore(() => now, (e) => events.push(e));
  const root = ws();
  const p = proposeChangeset(cs(root, [{ op: 'create', path: 'a.js', content: '1\n' }]), fs, store);
  assert.equal(store.take('deadbeef')?.rootPath, undefined);
  now += 31 * 60_000; // past 30-min TTL
  store.take(p.proposalHash);
  const kinds = events.map((e) => e.event);
  assert.ok(kinds.includes('proposal.unknown'), 'unknown hash → proposal.unknown');
  assert.ok(kinds.includes('proposal.expired'), 'expired proposal → proposal.expired');
});

test('capacity eviction is visible and reason-coded (ttl vs capacity)', () => {
  const events: TelemetryEvent[] = [];
  let now = 1000;
  const store = new ChangesetProposalStore(() => now, (e) => events.push(e));
  const root = ws();
  // Fill beyond capacity with a mix; force capacity path by exceeding MAX (512).
  for (let i = 0; i < 513; i++) proposeChangeset(cs(root, [{ op: 'create', path: `f${i}.js`, content: 'x' }]), fs, store);
  const evictions = events.filter((e) => e.event === 'proposal.evicted');
  assert.ok(evictions.length >= 1, 'at least one eviction event');
  assert.ok(evictions.some((e) => e.fields.reason === 'capacity'), 'a capacity-pressure eviction is reason-coded');
});

// ── approval store lifecycle events ──────────────────────────────────────────────

test('approval.minted / consumed / replayed emit events without the token', () => {
  const events: TelemetryEvent[] = [];
  let id = 0;
  const store = new ToolApprovalStore(() => 1000, () => `appr_TOKEN${id++}`, 5 * 60_000, (e) => events.push(e));
  const rec = store.mint({ tool: 'edit.apply', inputHash: hashInput({ a: 1 }), requestId: 'r1', correlationId: 'corr_a' });
  assert.equal(store.consume(rec.id, { tool: 'edit.apply', inputHash: hashInput({ a: 1 }), correlationId: 'corr_a' }).ok, true);
  assert.equal(store.consume(rec.id, { tool: 'edit.apply', inputHash: hashInput({ a: 1 }), correlationId: 'corr_a' }).ok, false); // replay
  const kinds = events.map((e) => e.event);
  assert.ok(kinds.includes('approval.minted') && kinds.includes('approval.consumed') && kinds.includes('approval.replayed'));
  assert.ok(events.every((e) => e.correlationId === 'corr_a'));
  const flat = JSON.stringify(events);
  assert.ok(!flat.includes('appr_TOKEN'), 'the approval token is never logged');
});

test('approval.expired and approval.unknown are distinguishable', () => {
  const events: TelemetryEvent[] = [];
  let now = 1000;
  const store = new ToolApprovalStore(() => now, undefined, 5 * 60_000, (e) => events.push(e));
  const rec = store.mint({ tool: 't', inputHash: 'h', requestId: 'r' });
  const unknown = store.consume('nope', { tool: 't', inputHash: 'h' });
  assert.equal(unknown.ok === false && unknown.reason, 'unknown');
  now += 6 * 60_000;
  const expired = store.consume(rec.id, { tool: 't', inputHash: 'h' });
  assert.equal(expired.ok === false && expired.reason, 'expired');
  const kinds = events.map((e) => e.event);
  assert.ok(kinds.includes('approval.unknown') && kinds.includes('approval.expired'));
});

// ── health model ─────────────────────────────────────────────────────────────────

test('StoreHealth: healthy → degraded at threshold → unhealthy on cleanup failure → recovers', () => {
  const h = new StoreHealth('x', 10, () => 1, 80);
  assert.equal(h.snapshot(5, null, null).status, 'healthy'); // 50%
  assert.equal(h.snapshot(8, null, null).status, 'degraded'); // 80%
  assert.equal(h.snapshot(11, null, null).status, 'unhealthy'); // over capacity
  h.onCleanup(1, true);
  assert.equal(h.snapshot(1, null, null).status, 'unhealthy'); // cleanup failed
  h.onCleanup(1, false);
  assert.equal(h.snapshot(1, null, null).status, 'healthy'); // recovered
});

test('proposal store health() reports truthful counts and utilization', () => {
  const store = new ChangesetProposalStore(() => 1000);
  const root = ws();
  proposeChangeset(cs(root, [{ op: 'create', path: 'a.js', content: '1\n' }]), fs, store);
  const health = store.health();
  assert.equal(health.name, 'proposal');
  assert.equal(health.current_entries, 1);
  assert.equal(health.created_total, 1);
  assert.equal(health.status, 'healthy');
});

// ── invariants: telemetry must not weaken enforcement ────────────────────────────

test('a throwing telemetry sink does not break a lifecycle operation (invariant #8)', () => {
  const store = new ChangesetProposalStore(() => 1000, () => {
    throw new Error('sink exploded');
  });
  const root = ws();
  // Must not throw despite the sink throwing.
  const p = proposeChangeset(cs(root, [{ op: 'create', path: 'a.js', content: '1\n' }]), fs, store);
  assert.ok(p.proposalHash);
  assert.equal(store.take(p.proposalHash)?.rootPath, root); // consume still works
});

