// Chat turns as governed operations.
//
// The defect these exist for: `cancelled: token.isCancellationRequested` was reported
// as a turn outcome. That is a REQUEST signal — it says someone pressed stop, not that
// the work stopped. Every test below distinguishes the two.

import assert from 'node:assert/strict';
import test from 'node:test';

import { BrainStore, type StorageFs } from '../../services/brainPersistence.js';
import {
  ChatTurnExecution,
  createdChildRecord,
  reconcile,
  type PersistedChatTurn,
} from '../../services/chatTurnExecution.js';

function fs() {
  const files = new Map<string, string>();
  let failWrites: RegExp | undefined;
  const impl: StorageFs = {
    mkdir: async () => {},
    readFile: async (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    writeFile: async (p, d) => {
      if (failWrites && failWrites.test(p)) throw new Error('EIO');
      files.set(p, d);
    },
    rename: async (a, b) => {
      if (failWrites && failWrites.test(b)) throw new Error('EIO');
      files.set(b, files.get(a)!);
      files.delete(a);
    },
    readdir: async (p) => [...files.keys()].filter((k) => k.startsWith(`${p}/`)).map((k) => k.slice(p.length + 1)),
    exists: async (p) => files.has(p),
  };
  return { impl, files, failOn: (r: RegExp | undefined) => { failWrites = r; } };
}

async function store() {
  const f = fs();
  const s = new BrainStore('/gs', f.impl, () => '2026-01-01T00:00:00.000Z');
  await s.init();
  return { s, f };
}

const childOf = async (s: BrainStore, id: string) => s.readOperation(id);

// ── chat governance ─────────────────────────────────────────────────────────

test('chat · a turn exists on disk before it can accept any child', async () => {
  const { s, f } = await store();
  const t = await ChatTurnExecution.begin(s, 'turn-1');
  assert.equal(t.state, 'running');
  assert.ok(f.files.has('/gs/turns/turn-1.json'), 'the parent record is durable immediately');
});

test('chat · a cancellation REQUEST is not a cancelled outcome', async () => {
  const { s } = await store();
  const t = await ChatTurnExecution.begin(s, 'turn-2');
  await t.requestCancellation();
  assert.equal(t.state, 'cancelling', 'requesting is not being cancelled');
  const r = await t.finish();
  assert.equal(r.state, 'failed');
  assert.equal(r.failure, 'cancellation_unconfirmed', 'unacknowledged stop is never reported as cancelled');
});

test('chat · an ACKNOWLEDGED cancellation is reported as cancelled', async () => {
  const { s } = await store();
  const t = await ChatTurnExecution.begin(s, 'turn-3');
  await t.requestCancellation();
  t.acknowledgeCancellation();
  const r = await t.finish();
  assert.equal(r.state, 'cancelled');
  assert.equal(r.failure, undefined);
});

test('chat · a turn with no children completes', async () => {
  const { s } = await store();
  const t = await ChatTurnExecution.begin(s, 'turn-4');
  const r = await t.finish();
  assert.equal(r.state, 'completed');
  assert.equal(r.durable, true);
});

test('chat · a turn cannot complete while a child is still unresolved', async () => {
  const { s } = await store();
  const t = await ChatTurnExecution.begin(s, 'turn-5');
  const reg = await t.registerChild('child-a', 'chat');
  assert.equal(reg.decision, 'dispatch');
  // The child stays `created` — never dispatched, never terminal.
  const r = await t.finish();
  assert.equal(r.state, 'failed');
  assert.equal(r.failure, 'child_unresolved');
});

test('chat · a turn completes only when every child reached a terminal record', async () => {
  const { s } = await store();
  const t = await ChatTurnExecution.begin(s, 'turn-6');
  await t.registerChild('child-b', 'chat');
  const c = (await childOf(s, 'child-b'))!;
  await s.saveOperation({ ...c, revision: c.revision + 1, currentState: 'completed' });
  const r = await t.finish();
  assert.equal(r.state, 'completed');
});

test('chat · a failed child fails the turn — never a silent success', async () => {
  const { s } = await store();
  const t = await ChatTurnExecution.begin(s, 'turn-7');
  await t.registerChild('child-c', 'chat');
  const c = (await childOf(s, 'child-c'))!;
  await s.saveOperation({ ...c, revision: c.revision + 1, currentState: 'failed' });
  const r = await t.finish();
  assert.equal(r.state, 'failed');
  assert.equal(r.failure, 'child_failed');
});

test('chat · a child reported terminal without a reference is an invariant violation', async () => {
  const { s } = await store();
  const t = await ChatTurnExecution.begin(s, 'turn-8');
  t.noteChildTerminal('never-registered', 'success');
  assert.match(t.snapshot().invariantViolations.join(' '), /unreferenced child never-registered/);
});

test('chat · a cancelling turn cannot transition straight to completed', async () => {
  const { s } = await store();
  const t = await ChatTurnExecution.begin(s, 'turn-9');
  await t.requestCancellation();
  t.acknowledgeCancellation();
  const snap = t.snapshot();
  assert.equal(snap.currentState, 'cancelling');
  const r = await t.finish();
  assert.notEqual(r.state, 'completed', 'a stopped turn never reports completion');
});

test('chat · a turn stops accepting children once it is no longer running', async () => {
  const { s } = await store();
  const t = await ChatTurnExecution.begin(s, 'turn-10');
  await t.requestCancellation();
  const reg = await t.registerChild('child-late', 'chat');
  assert.equal(reg.decision, 'orphaned_before_dispatch');
  assert.equal(await childOf(s, 'child-late'), undefined, 'no record is created for a refused child');
});

// ── cross-record integrity: existence → reference → dispatch ────────────────

test('cross · the child record exists before the parent references it', async () => {
  const { s, f } = await store();
  const t = await ChatTurnExecution.begin(s, 'turn-11');
  const order: string[] = [];
  const realWrite = f.impl.writeFile;
  f.impl.writeFile = async (p, d) => { order.push(p); return realWrite(p, d); };
  await t.registerChild('child-d', 'chat');
  const firstChild = order.findIndex((p) => p.includes('child-d'));
  const firstParent = order.findIndex((p) => p.includes('turn-11'));
  assert.ok(firstChild >= 0 && firstParent >= 0, 'both were written');
  assert.ok(firstChild < firstParent, 'existence first, reference second');
});

test('cross · a failed parent-reference write REFUSES dispatch', async () => {
  const { s, f } = await store();
  const t = await ChatTurnExecution.begin(s, 'turn-12');
  f.failOn(/turns\/turn-12/);
  const reg = await t.registerChild('child-e', 'chat');
  f.failOn(undefined);
  assert.equal(reg.decision, 'orphaned_before_dispatch');
  assert.equal(t.childIds.includes('child-e'), false, 'the reference is rolled back');
});

test('cross · an undispatched child is left provably never-dispatched', async () => {
  const { s, f } = await store();
  const t = await ChatTurnExecution.begin(s, 'turn-13');
  f.failOn(/turns\/turn-13/);
  await t.registerChild('child-f', 'chat');
  f.failOn(undefined);
  const c = await childOf(s, 'child-f');
  assert.ok(c, 'the child record still exists — evidence is never deleted');
  // Marked, not removed: `failed` + explicit orphan evidence is what proves nothing was
  // sent. Leaving it in `created` would be indistinguishable from a child still waiting
  // to be dispatched.
  assert.equal(c.currentState, 'failed');
  assert.match(c.failures.join(' '), /orphaned_before_dispatch/);
});

test('cross · a parent naming a missing child fails referential integrity', async () => {
  const { s, f } = await store();
  const t = await ChatTurnExecution.begin(s, 'turn-14');
  await t.registerChild('child-g', 'chat');
  f.files.delete('/gs/operations/child-g.json'); // simulate external loss
  const r = await t.finish();
  assert.equal(r.state, 'failed');
  assert.equal(r.failure, 'referential_integrity_violated');
  assert.match(t.snapshot().invariantViolations.join(' '), /child-g/);
});

test('cross · revisions on the parent stay monotonic across child registrations', async () => {
  const { s } = await store();
  const t = await ChatTurnExecution.begin(s, 'turn-15');
  const revs = [t.snapshot().revision];
  for (const id of ['c1', 'c2', 'c3']) {
    await t.registerChild(id, 'chat');
    revs.push(t.snapshot().revision);
  }
  assert.deepEqual(revs, [...revs].sort((a, b) => a - b));
  assert.equal(new Set(revs).size, revs.length, 'no revision reused');
});

test('cross · recovery reports a parent that references a missing child', () => {
  const turn = { turnId: 't', childOperationIds: ['gone'], currentState: 'running' } as PersistedChatTurn;
  const f = reconcile([turn], []);
  assert.equal(f[0]?.kind, 'parent_references_missing_child');
});

test('cross · recovery reports a never-dispatched child as safe', () => {
  const turn = { turnId: 't', childOperationIds: ['c'], currentState: 'running' } as PersistedChatTurn;
  const child = createdChildRecord('c', 'chat', '2026-01-01T00:00:00.000Z');
  const f = reconcile([turn], [child]);
  assert.equal(f[0]?.kind, 'child_never_dispatched');
  assert.match(f[0]!.detail, /provably no work was sent/);
});

test('cross · recovery reports an orphaned child that WAS dispatched', () => {
  const child = { ...createdChildRecord('c', 'chat', 'x'), currentState: 'running' as const };
  const f = reconcile([], [child]);
  assert.equal(f[0]?.kind, 'child_orphaned');
  assert.match(f[0]!.detail, /no owning turn/);
});

test('cross · recovery reports an active child under an interrupted parent', () => {
  const turn = { turnId: 't', childOperationIds: ['c'], currentState: 'failed' } as PersistedChatTurn;
  const child = { ...createdChildRecord('c', 'chat', 'x'), currentState: 'running' as const };
  const f = reconcile([turn], [child]);
  assert.equal(f.some((x) => x.kind === 'active_child_under_interrupted_parent'), true);
});

test('cross · recovery reports a terminal child under a nonterminal parent', () => {
  const turn = { turnId: 't', childOperationIds: ['c'], currentState: 'running' } as PersistedChatTurn;
  const child = { ...createdChildRecord('c', 'chat', 'x'), currentState: 'completed' as const };
  const f = reconcile([turn], [child]);
  assert.equal(f.some((x) => x.kind === 'terminal_child_under_nonterminal_parent'), true);
});

// ── the wrapper contract: every exit path resolves the turn ─────────────────

test('chat · finish is idempotent — an explicitly resolved turn is not re-resolved', async () => {
  const { s } = await store();
  const t = await ChatTurnExecution.begin(s, 'turn-16');
  const first = await t.finish();
  const revAfterFirst = t.snapshot().revision;
  const second = await t.finish();
  assert.equal(second.state, first.state, 'the answer does not change');
  assert.equal(t.snapshot().revision, revAfterFirst, 'and no second terminal revision is written');
});

test('chat · a turn resolved as cancelled is not reopened by a later finish', async () => {
  const { s } = await store();
  const t = await ChatTurnExecution.begin(s, 'turn-17');
  await t.requestCancellation();
  t.acknowledgeCancellation();
  assert.equal((await t.finish()).state, 'cancelled');
  // The wrapper's `finally` calls finish() again on every path.
  assert.equal((await t.finish()).state, 'cancelled');
});

test('chat · pressing stop after the turn resolved does not rewrite the outcome', async () => {
  const { s } = await store();
  const t = await ChatTurnExecution.begin(s, 'turn-18');
  assert.equal((await t.finish()).state, 'completed');
  await t.requestCancellation(); // late token event
  assert.equal(t.state, 'completed', 'a completed turn ignores a late cancellation request');
});
