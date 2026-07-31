import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrainStore,
  SCHEMA_VERSION,
  StaleRevisionError,
  deriveFlags,
  isStaleRender,
  recoverOperation,
  scrub,
  selectPrunable,
  type PersistedBrainConnection,
  type PersistedBrainOperation,
  operationPersister,
  type StorageFs,
} from '../../services/brainPersistence.js';

/** In-memory filesystem with a fault injector, so an interrupted write is deterministic
 * rather than timing-dependent. */
function memFs() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  let failNextWrite = false;
  let failNextRename = false;
  const fs: StorageFs = {
    mkdir: async (p) => { dirs.add(p); },
    readFile: async (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    writeFile: async (p, d) => {
      if (failNextWrite) { failNextWrite = false; throw new Error('EIO during temp write'); }
      files.set(p, d);
    },
    rename: async (from, to) => {
      if (failNextRename) { failNextRename = false; throw new Error('EIO during rename'); }
      const v = files.get(from);
      if (v === undefined) throw new Error(`ENOENT ${from}`);
      files.delete(from);
      files.set(to, v);
    },
    readdir: async (p) => [...files.keys()].filter((f) => f.startsWith(`${p}/`)).map((f) => f.slice(p.length + 1)),
    exists: async (p) => files.has(p),
  };
  return {
    fs,
    files,
    breakWrite: () => { failNextWrite = true; },
    breakRename: () => { failNextRename = true; },
  };
}

const op = (over: Partial<PersistedBrainOperation> = {}): PersistedBrainOperation => ({
  schemaVersion: SCHEMA_VERSION,
  revision: 1,
  operationId: 'op-1',
  requestedAction: 'chat',
  operationKind: 'consequential',
  currentState: 'completed',
  startedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
  endedAt: '2026-01-01T00:00:01.000Z',
  transitions: [],
  invariantViolations: [],
  precondition: { required: false },
  transportAttempts: [],
  commands: [],
  changedFiles: [],
  tests: [],
  failures: [],
  remainingWork: [],
  terminalEvidence: { observedAt: '2026-01-01T00:00:01.000Z', outcome: 'success', evidenceType: 'parsed-body' },
  ...over,
});

const store = () => {
  const m = memFs();
  return { m, s: new BrainStore('/gs/brain-execution', m.fs, () => '2026-01-02T00:00:00.000Z') };
};

// 1 ── atomic write and reload
test('1 · a written operation reloads intact', async () => {
  const { m, s } = store();
  await s.init();
  await s.saveOperation(op());
  const { operations, quarantined } = await s.loadOperations();
  assert.equal(quarantined.length, 0);
  assert.equal(operations.length, 1);
  assert.equal(operations[0]!.operationId, 'op-1');
  assert.equal(operations[0]!.currentState, 'completed');
  assert.equal([...m.files.keys()].some((f) => f.includes('/tmp/')), false, 'temp file must not linger');
});

// 2 ── interrupted temp write preserves the previous record
test('2 · an interrupted write leaves the prior valid record intact', async () => {
  const { m, s } = store();
  await s.init();
  await s.saveOperation(op({ revision: 1 }));
  m.breakWrite();
  await assert.rejects(() => s.saveOperation(op({ revision: 2, currentState: 'failed' })));
  const { operations } = await s.loadOperations();
  assert.equal(operations[0]!.revision, 1, 'the prior record survives');
  assert.equal(operations[0]!.currentState, 'completed');
});

test('2b · a failed rename also leaves the prior record intact', async () => {
  const { m, s } = store();
  await s.init();
  await s.saveOperation(op({ revision: 1 }));
  m.breakRename();
  await assert.rejects(() => s.saveOperation(op({ revision: 2, currentState: 'failed' })));
  const { operations } = await s.loadOperations();
  assert.equal(operations[0]!.revision, 1);
});

// 3 ── stale revision rejected
test('3 · a stale revision write is rejected', async () => {
  const { s } = store();
  await s.init();
  await s.saveOperation(op({ revision: 5 }));
  await assert.rejects(
    () => s.saveOperation(op({ revision: 4 })),
    (e: unknown) => e instanceof StaleRevisionError,
  );
});

// 4/5 ── quarantine
test('4 · a malformed record is quarantined, never treated as authoritative', async () => {
  const { m, s } = store();
  await s.init();
  m.files.set('/gs/brain-execution/operations/bad.json', '{not json');
  const { operations, quarantined } = await s.loadOperations();
  assert.equal(operations.length, 0);
  assert.equal(quarantined.length, 1);
  assert.equal(quarantined[0]!.failure, 'malformed_json');
  assert.match(quarantined[0]!.destination, /quarantine\/bad\.json\..*\.invalid\.json/);
  assert.equal(m.files.has('/gs/brain-execution/operations/bad.json'), false, 'moved, not left');
});

test('5 · an unsupported schema version is quarantined', async () => {
  const { m, s } = store();
  await s.init();
  m.files.set('/gs/brain-execution/operations/v9.json', JSON.stringify({ ...op(), schemaVersion: 9 }));
  const { operations, quarantined } = await s.loadOperations();
  assert.equal(operations.length, 0);
  assert.equal(quarantined[0]!.failure, 'unsupported_schema_version');
});

// 6-9 ── restart recovery
test('6 · completed remains completed after restart', () => {
  const r = recoverOperation(op({ currentState: 'completed' }), 'T');
  assert.equal(r.currentState, 'completed');
  assert.equal(r.recovery, undefined);
});

test('7 · failed remains failed after restart', () => {
  const r = recoverOperation(op({ currentState: 'failed' }), 'T');
  assert.equal(r.currentState, 'failed');
});

test('8 · running becomes interrupted, never completed', () => {
  const r = recoverOperation(op({ currentState: 'running', endedAt: undefined }), 'T');
  assert.equal(r.currentState, 'failed');
  assert.equal(r.recovery?.evidence, 'operation_interrupted');
  assert.ok(r.failures.some((f) => /terminal_state_unverified/.test(f)));
  assert.notEqual(r.currentState as string, 'completed');
});

test('9 · cancelling without acknowledgement recovers as cancellation_unconfirmed', () => {
  const r = recoverOperation(op({ currentState: 'cancelling', endedAt: undefined }), 'T');
  assert.equal(r.recovery?.evidence, 'cancellation_acknowledgment_missing');
  assert.ok(r.failures.some((f) => /cancellation_unconfirmed/.test(f)));
  assert.notEqual(r.currentState, 'cancelled');
});

test('9b · a cancelled record without confirmation is not trusted as cancelled', () => {
  const r = recoverOperation(
    op({ currentState: 'cancelled', cancellation: { requestedAt: 'T', confirmed: false } }),
    'T',
  );
  assert.notEqual(r.currentState, 'cancelled');
  assert.equal(r.recovery?.evidence, 'cancellation_acknowledgment_missing');
});

test('9c · connecting recovers as transport_lost_on_restart, never ready', () => {
  const r = recoverOperation(op({ currentState: 'connecting', endedAt: undefined }), 'T');
  assert.equal(r.recovery?.evidence, 'transport_lost_on_restart');
  assert.notEqual(r.currentState as string, 'ready');
});

// 10 ── attempt records use truthful statuses, never `superseded`
test('10 · attempt records carry sequential statuses and no supersession claim', async () => {
  const { s } = store();
  await s.init();
  const rec = op({
    transportAttempts: [
      { attemptId: 'op-1#a1', attemptNumber: 1, startedAt: 'T1', endedAt: 'T2', status: 'failed', category: 'connection_lost', retryReason: 'retryable', retryDelayMs: 50, followedByAnotherAttempt: true, producedAuthoritativeResult: false },
      { attemptId: 'op-1#a2', attemptNumber: 2, startedAt: 'T3', endedAt: 'T4', status: 'succeeded', followedByAnotherAttempt: false, producedAuthoritativeResult: true },
    ],
  });
  await s.saveOperation(rec);
  const { operations } = await s.loadOperations();
  const a = operations[0]!.transportAttempts;
  assert.equal(a.length, 2);
  assert.equal(a[1]!.producedAuthoritativeResult, true);
  assert.equal(a[0]!.followedByAnotherAttempt, true);
  assert.doesNotMatch(JSON.stringify(operations[0]), /supersed/i, 'no supersession in schema v1');
});

// 11/12 ── scrubbing
test('11 · scrubbing is recursive over unknown nested structures', () => {
  const dirty = {
    level1: { level2: { note: 'Bearer abcdefghijklmnopqrst', arr: ['sk_live_ABCDEFGH12345678'] } },
    jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
    dsn: 'postgres://user:hunter2pass@host:5432/db',
    keep: 'status=503 bytes=411 ms=87',
  };
  const clean = JSON.stringify(scrub(dirty));
  for (const leak of ['Bearer abcdefghijklmnopqrst', 'sk_live_ABCDEFGH12345678', 'eyJhbGciOiJIUzI1NiJ9', 'hunter2pass']) {
    assert.equal(clean.includes(leak), false, `must not leak ${leak}`);
  }
  assert.match(clean, /status=503 bytes=411 ms=87/, 'useful metadata is preserved');
});

test('12 · authorization headers and cookies never reach disk', async () => {
  const { m, s } = store();
  await s.init();
  await s.saveOperation(
    op({ failures: ['ok'], commands: ['x'] , transportAttempts: [
      { attemptId: 'a', attemptNumber: 1, startedAt: 'T', status: 'failed', followedByAnotherAttempt: false, producedAuthoritativeResult: false,
        diagnostic: JSON.stringify({ Authorization: 'Bearer supersecrettokenvalue', Cookie: 'session=abc' }) },
    ] } as Partial<PersistedBrainOperation>),
  );
  const onDisk = [...m.files.values()].join('\n');
  assert.equal(/supersecrettokenvalue/.test(onDisk), false);
});

test('12b · a key named like a credential is redacted regardless of its value', () => {
  const clean = JSON.stringify(scrub({ authorization: 'anything', api_key: 'plain', nested: { cookie: 'v' } }));
  assert.equal(clean.includes('anything'), false);
  assert.equal(clean.includes('plain'), false);
});

// 13 ── connection cannot mutate an operation
test('13 · a connection update cannot touch any operation record', async () => {
  const { m, s } = store();
  await s.init();
  await s.saveOperation(op({ revision: 1, currentState: 'completed' }));
  const before = m.files.get('/gs/brain-execution/operations/op-1.json');

  const conn: PersistedBrainConnection = {
    schemaVersion: SCHEMA_VERSION, revision: 1, endpointIdentity: 'http://127.0.0.1:3988',
    readiness: 'failed', updatedAt: 'T', consecutiveFailures: 9, reconnectAttempts: 3,
  };
  await s.saveConnection(conn);

  assert.equal(m.files.get('/gs/brain-execution/operations/op-1.json'), before, 'operation file byte-identical');
  const { operations } = await s.loadOperations();
  assert.equal(operations[0]!.currentState, 'completed', 'a failed connection does not fail a completed run');
});

// 14/15 ── report convergence
test('14 · derived flags come from one snapshot; cancelled is not independent', () => {
  assert.deepEqual(deriveFlags(op({ currentState: 'completed' })).success, true);
  const cancelled = deriveFlags(op({ currentState: 'cancelled', terminalEvidence: undefined }));
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.success, false, 'cancelled can never be success');
  const completedNoEvidence = deriveFlags(op({ currentState: 'completed', terminalEvidence: undefined }));
  assert.equal(completedNoEvidence.success, false, 'completed WITHOUT terminal evidence is not success');
});

test('15 · a render from a different revision is flagged stale', () => {
  assert.equal(isStaleRender({ operationId: 'op-1', revision: 2 }, { operationId: 'op-1', revision: 3 }), true);
  assert.equal(isStaleRender({ operationId: 'op-1', revision: 3 }, { operationId: 'op-2', revision: 3 }), true);
  assert.equal(isStaleRender({ operationId: 'op-1', revision: 3 }, { operationId: 'op-1', revision: 3 }), false);
});

// 16 ── retention
test('16 · retention never removes active or incomplete records', () => {
  const old = '2020-01-01T00:00:00.000Z';
  const records = [
    op({ operationId: 'a', currentState: 'running', endedAt: undefined }),
    op({ operationId: 'b', currentState: 'cancelling', endedAt: undefined }),
    op({ operationId: 'c', currentState: 'connecting', endedAt: undefined }),
    op({ operationId: 'd', currentState: 'completed', endedAt: old }),
  ];
  const prunable = selectPrunable(records, { maxRecords: 100, maxAgeMs: 1000 }, Date.parse('2026-01-01T00:00:00.000Z'));
  assert.deepEqual(prunable.map((r) => r.operationId), ['d'], 'only the terminal record is eligible');
});

test('16b · overflow prunes oldest terminal records first', () => {
  const records = [
    op({ operationId: 'old', endedAt: '2021-01-01T00:00:00.000Z' }),
    op({ operationId: 'new', endedAt: '2025-01-01T00:00:00.000Z' }),
  ];
  const prunable = selectPrunable(records, { maxRecords: 1, maxAgeMs: Number.MAX_SAFE_INTEGER }, Date.parse('2025-06-01T00:00:00.000Z'));
  assert.deepEqual(prunable.map((r) => r.operationId), ['old']);
});

// ── live connection persistence ─────────────────────────────────────────────

import { BrainConnectionState, type ConnectionPersister } from '../../services/brainConnection.js';

function recordingPersister() {
  const writes: Array<Record<string, unknown>> = [];
  const p: ConnectionPersister = { persist: (r) => { writes.push(r as Record<string, unknown>); } };
  return { p, writes };
}

test('connection · a readiness change is persisted', () => {
  const { p, writes } = recordingPersister();
  const c = new BrainConnectionState('http://127.0.0.1:3988', { failureThreshold: 3 }, () => 'T', p);
  c.probeStarted();
  c.probeSucceeded();
  assert.ok(writes.length >= 2);
  assert.equal(writes.at(-1)!.readiness, 'ready');
  assert.equal(writes.at(-1)!.endpointIdentity, 'http://127.0.0.1:3988');
});

test('connection · an identical repeated poll result is NOT rewritten', () => {
  const { p, writes } = recordingPersister();
  const c = new BrainConnectionState('http://x', { failureThreshold: 3 }, () => 'T', p);
  c.probeStarted();
  c.probeSucceeded();
  const after = writes.length;
  c.probeStarted();   // already ready — no readiness change
  c.probeSucceeded(); // still ready, failures still 0
  assert.equal(writes.length, after, 'a healthy Brain must not rewrite the record every poll');
});

test('connection · failure counters and category are persisted as they change', () => {
  const { p, writes } = recordingPersister();
  const c = new BrainConnectionState('http://x', { failureThreshold: 3 }, () => 'T', p);
  c.probeFailed({ cause: { code: 'ECONNREFUSED' } });
  assert.equal(writes.at(-1)!.readiness, 'disconnected');
  assert.equal(writes.at(-1)!.lastFailureCategory, 'connection_refused');
  assert.equal(writes.at(-1)!.consecutiveFailures, 1);
  c.probeFailed({ cause: { code: 'ECONNREFUSED' } });
  c.probeFailed({ cause: { code: 'ECONNREFUSED' } });
  assert.equal(writes.at(-1)!.readiness, 'failed', 'threshold escalation is persisted');
  assert.equal(writes.at(-1)!.consecutiveFailures, 3);
});

test('connection · the persister surface cannot express an operation write', () => {
  // Structural: `persist` accepts a connection shape only. There is no operationId,
  // no state, no terminal evidence — so a health poll has no capability to touch a run.
  const { p, writes } = recordingPersister();
  const c = new BrainConnectionState('http://x', { failureThreshold: 3 }, () => 'T', p);
  c.probeFailed({ cause: { code: 'ECONNREFUSED' } });
  const keys = Object.keys(writes.at(-1)!);
  for (const forbidden of ['operationId', 'currentState', 'terminalEvidence', 'transportAttempts']) {
    assert.equal(keys.includes(forbidden), false, `connection writes must not carry ${forbidden}`);
  }
});

// ── operation persister: the terminal write is the success gate ──────────────



const bare = (over: Partial<PersistedBrainOperation> = {}) => {
  const { schemaVersion: _s, revision: _r, ...rest } = op(over);
  return rest;
};

test('operation persister · revisions are monotonic across progress then terminal', async () => {
  const { m, s } = store();
  await s.init();
  const p = operationPersister(s, () => {});
  p.persistProgress(bare({ currentState: 'connecting' }));
  p.persistProgress(bare({ currentState: 'running' }));
  const ok = await p.persistTerminal(bare({ currentState: 'completed' }));
  assert.equal(ok, true);
  assert.equal(p.currentRevision(), 3);
  const written = JSON.parse(m.files.get('/gs/brain-execution/operations/op-1.json')!);
  assert.equal(written.revision, 3, 'the terminal revision must be the highest on disk');
  assert.equal(written.currentState, 'completed');
});

test('operation persister · a failed TERMINAL write returns false — the success gate closes', async () => {
  const { m, s } = store();
  await s.init();
  const p = operationPersister(s, () => {});
  m.breakWrite();
  const ok = await p.persistTerminal(bare({ currentState: 'completed' }));
  assert.equal(ok, false, 'caller must suppress success when the terminal revision is not durable');
});

test('operation persister · each operation owns its own revision chain', async () => {
  const { s } = store();
  await s.init();
  const a = operationPersister(s, () => {});
  const b = operationPersister(s, () => {});
  a.persistProgress(bare({ operationId: 'op-a' }));
  await a.persistTerminal(bare({ operationId: 'op-a' }));
  await b.persistTerminal(bare({ operationId: 'op-b' }));
  assert.equal(a.currentRevision(), 2);
  assert.equal(b.currentRevision(), 1, 'operations must not share a counter');
});
