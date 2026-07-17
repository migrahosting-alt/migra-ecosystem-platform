// Operational Readiness Slice 3 — durable audit model. Correlation, causation,
// dedup, ordering, retention, queries, fail-closed on critical write failure,
// and redaction.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuditStore, AuditCriticalWriteError, auditHash, type AuditRecord } from '../src/engine/auditLog.js';

let idc = 0;
const ids = () => `ev_${idc++}`;

test('append assigns monotonic seq + auto-causation per correlation (stable order)', () => {
  idc = 0;
  const s = new AuditStore(() => 1, null, 100, ids);
  const a = s.append({ correlationId: 'c1', type: 'execution.started', component: 'x' });
  const b = s.append({ correlationId: 'c1', type: 'execution.routed', component: 'x' });
  const c = s.append({ correlationId: 'c1', type: 'loop.started', component: 'x' });
  assert.equal(a.causationId, null); // root
  assert.equal(b.causationId, a.eventId);
  assert.equal(c.causationId, b.eventId);
  assert.deepEqual([a.seq, b.seq, c.seq], [1, 2, 3]);
});

test('correlations are independent chains', () => {
  idc = 0;
  const s = new AuditStore(() => 1, null, 100, ids);
  s.append({ correlationId: 'c1', type: 'execution.started', component: 'x' });
  const b2 = s.append({ correlationId: 'c2', type: 'execution.started', component: 'x' });
  assert.equal(b2.causationId, null); // c2 root, not chained to c1
  assert.equal(b2.seq, 1);
});

test('event ids deduplicate retries (idempotent append)', () => {
  idc = 0;
  const s = new AuditStore(() => 1, null, 100, ids);
  const a = s.append({ correlationId: 'c1', type: 'tool.completed', component: 'x', eventId: 'fixed' });
  const b = s.append({ correlationId: 'c1', type: 'tool.completed', component: 'x', eventId: 'fixed' });
  assert.equal(a.eventId, b.eventId);
  assert.equal(s.byCorrelation('c1').length, 1);
});

test('queries: byCorrelation / byOutcome / byTimeRange / byProposal', () => {
  idc = 0;
  let now = 100;
  const s = new AuditStore(() => now, null, 100, ids);
  s.append({ correlationId: 'c1', type: 'proposal.created', component: 'p', outcome: 'ok', fields: { proposal: 'abc123' } });
  now = 200;
  s.append({ correlationId: 'c1', type: 'application.failed', component: 'c', outcome: 'INCONSISTENT_STATE' });
  now = 300;
  s.append({ correlationId: 'c2', type: 'execution.started', component: 'e' });
  assert.equal(s.byCorrelation('c1').length, 2);
  assert.equal(s.byOutcome('INCONSISTENT_STATE').length, 1);
  assert.equal(s.byProposal('abc123').length, 1);
  assert.equal(s.byTimeRange(150, 250).length, 1);
});

test('byCorrelation returns ONLY the requested chain (no leakage)', () => {
  idc = 0;
  const s = new AuditStore(() => 1, null, 100, ids);
  s.append({ correlationId: 'c1', type: 'execution.started', component: 'x' });
  s.append({ correlationId: 'c2', type: 'execution.started', component: 'x' });
  const chain = s.byCorrelation('c1');
  assert.ok(chain.every((r) => r.correlationId === 'c1'));
});

test('redaction: content / paths / tokens / diffs are stripped before persistence', () => {
  idc = 0;
  const s = new AuditStore(() => 1, null, 100, ids);
  const r = s.append({
    correlationId: 'c1',
    type: 'application.completed',
    component: 'changeset',
    fields: { content: 'SECRET', rootPath: '/home/x/ws', path: 'a.js', diff: '- x\n+ y', token: 'appr_TOK', command: ['npm', 'test'], created: 2, workspace: auditHash('/home/x/ws') },
  });
  const flat = JSON.stringify(r);
  assert.doesNotMatch(flat, /SECRET|\/home\/x\/ws|appr_TOK|a\.js/);
  assert.equal(r.fields.created, 2); // safe metadata preserved
  assert.ok(typeof r.fields.workspace === 'string');
});

test('critical write failure FAILS CLOSED (throws) before persisting', () => {
  idc = 0;
  const failing = () => {
    throw new Error('durable sink down');
  };
  const s = new AuditStore(() => 1, failing, 100, ids);
  // application.started is critical → must throw.
  assert.throws(() => s.append({ correlationId: 'c1', type: 'application.started', component: 'c' }), AuditCriticalWriteError);
  // and the record is NOT in memory (fail closed before commit).
  assert.equal(s.byCorrelation('c1').length, 0);
});

test('non-critical write failure degrades health but does NOT throw', () => {
  idc = 0;
  const failing = () => {
    throw new Error('durable sink down');
  };
  const s = new AuditStore(() => 1, failing, 100, ids);
  const r = s.append({ correlationId: 'c1', type: 'tool.completed', component: 'x' }); // non-critical
  assert.ok(r.eventId); // continued with in-memory fallback
  assert.equal(s.healthSnapshot().status, 'unhealthy'); // durable sink failed
  assert.ok(s.healthSnapshot().write_failures >= 1);
});

test('retention prunes oldest beyond capacity; never mutates via query', () => {
  idc = 0;
  const s = new AuditStore(() => 1, null, 3, ids);
  for (let i = 0; i < 5; i++) s.append({ correlationId: `c${i}`, type: 'execution.started', component: 'x' });
  // Only the last 3 survive; earliest evicted.
  const all: AuditRecord[] = ['c0', 'c1', 'c2', 'c3', 'c4'].flatMap((c) => s.byCorrelation(c));
  assert.equal(all.length, 3);
});
