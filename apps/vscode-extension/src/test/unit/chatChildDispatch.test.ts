// Parent/child governance end to end, through the approved dispatcher.
//
// The claim under test: no child dispatch can occur before durable parent registration,
// and no parent success can occur without durable child evidence.

import assert from 'node:assert/strict';
import test from 'node:test';

import { BrainStore, type StorageFs } from '../../services/brainPersistence.js';
import { ChatTurnExecution } from '../../services/chatTurnExecution.js';
import { ChildDispatchRefused, classOf, governedChild } from '../../services/chatChildDispatch.js';
import { REQUIRED_CHILD_SITES } from '../../services/chatDispatchRegistry.js';

function fsHarness() {
  const files = new Map<string, string>();
  const writes: string[] = [];
  let failWrites: RegExp | undefined;
  const impl: StorageFs = {
    mkdir: async () => {},
    readFile: async (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    writeFile: async (p, d) => {
      if (failWrites?.test(p)) throw new Error('EIO');
      files.set(p, d);
    },
    rename: async (a, b) => {
      if (failWrites?.test(b)) throw new Error('EIO');
      writes.push(b);
      files.set(b, files.get(a)!);
      files.delete(a);
    },
    readdir: async (p) => [...files.keys()].filter((k) => k.startsWith(`${p}/`)).map((k) => k.slice(p.length + 1)),
    exists: async (p) => files.has(p),
  };
  return { impl, files, writes, failOn: (r?: RegExp) => { failWrites = r; } };
}

async function harness(turnId = 't') {
  const h = fsHarness();
  const store = new BrainStore('/gs', h.impl, () => '2026-01-01T00:00:00.000Z');
  await store.init();
  const turn = await ChatTurnExecution.begin(store, turnId);
  h.writes.length = 0;
  return { ...h, store, turn };
}

// 1
test('parent-child · all nine required sites resolve to a distinct execution class', () => {
  assert.equal(REQUIRED_CHILD_SITES.length, 9, 'the registry must still describe nine required sites');
  for (const s of REQUIRED_CHILD_SITES) {
    assert.notEqual(classOf(s.id), 'passive_local', `${s.id} must carry a real execution class`);
  }
  const classes = new Set(REQUIRED_CHILD_SITES.map((s) => classOf(s.id)));
  assert.ok(classes.size >= 4, `children must not collapse into one kind — saw ${[...classes]}`);
});

// 2 + 3
test('parent-child · child persists before the parent reference, which persists before dispatch', async () => {
  const h = await harness('t2');
  let dispatchedAt = -1;
  await governedChild(h.turn, 'engineer_turn', async () => {
    dispatchedAt = h.writes.length;
    return 'ok';
  });
  const childWrite = h.writes.findIndex((w) => w.includes('/operations/'));
  const parentWrite = h.writes.findIndex((w) => w.includes('/turns/'));
  assert.ok(childWrite >= 0 && parentWrite >= 0, 'both records were written');
  assert.ok(childWrite < parentWrite, 'existence before reference');
  assert.ok(parentWrite < dispatchedAt, 'reference durable before dispatch');
});

// 4 + 5
test('parent-child · a failed parent write produces ZERO dispatch calls', async () => {
  const h = await harness('t3');
  let dispatched = 0;
  h.failOn(/turns\/t3/);
  await assert.rejects(
    () => governedChild(h.turn, 'engineer_turn', async () => { dispatched += 1; return 'x'; }),
    (e: unknown) => e instanceof ChildDispatchRefused,
  );
  h.failOn(undefined);
  assert.equal(dispatched, 0, 'nothing was sent');
  const child = [...h.files.keys()].find((k) => k.includes('/operations/'));
  assert.ok(child, 'the child record survives as evidence');
  assert.match(h.files.get(child)!, /orphaned_before_dispatch/);
});

// 6
test('parent-child · a missing child record blocks completion', async () => {
  const h = await harness('t4');
  await governedChild(h.turn, 'engineer_turn', async () => 'ok');
  for (const k of [...h.files.keys()]) if (k.includes('/operations/')) h.files.delete(k);
  const r = await h.turn.finish();
  assert.equal(r.state, 'failed');
  assert.equal(r.failure, 'referential_integrity_violated');
});

// 7
test('parent-child · an active child blocks completion', async () => {
  const h = await harness('t5');
  const started = h.turn.registerChild('c-active', 'provider_stream:x');
  await started;
  await h.turn.startChild('c-active');
  const r = await h.turn.finish();
  assert.equal(r.state, 'failed');
  assert.equal(r.failure, 'child_unresolved');
});

// 8
test('parent-child · a failed child blocks parent success', async () => {
  const h = await harness('t6');
  await assert.rejects(() =>
    governedChild(h.turn, 'engineer_turn', async () => { throw new Error('provider exploded'); }),
  );
  const r = await h.turn.finish();
  assert.equal(r.state, 'failed');
  assert.equal(r.failure, 'child_failed');
});

// 9
test('parent-child · a confirmed child cancellation permits parent cancellation', async () => {
  const h = await harness('t7');
  await assert.rejects(() =>
    governedChild(h.turn, 'engineer_turn', async () => {
      throw Object.assign(new Error('stopped'), { name: 'AbortError' });
    }),
  );
  await h.turn.requestCancellation();
  h.turn.acknowledgeCancellation();
  const r = await h.turn.finish();
  assert.equal(r.state, 'cancelled', 'child confirmed cancelled and the loop stopped');
});

// 10
test('parent-child · an unconfirmed cancellation blocks parent cancellation', async () => {
  const h = await harness('t8');
  await h.turn.requestCancellation();
  const r = await h.turn.finish();
  assert.equal(r.state, 'failed');
  assert.equal(r.failure, 'cancellation_unconfirmed');
});

// 11
test('parent-child · a late child success cannot complete a cancelling parent', async () => {
  const h = await harness('t9');
  await governedChild(h.turn, 'engineer_turn', async () => 'ok');
  await h.turn.requestCancellation();
  // The child is completed on disk, but the turn was stopped without acknowledgement.
  const r = await h.turn.finish();
  assert.notEqual(r.state, 'completed', 'a stopped turn never completes on a child success');
  assert.equal(r.failure, 'cancellation_unconfirmed');
});

// 12 + 13
test('parent-child · one completed child cannot hide another that is still active', async () => {
  const h = await harness('t10');
  await governedChild(h.turn, 'engineer_turn', async () => 'ok');
  await h.turn.registerChild('c-still-running', 'provider_stream:x');
  await h.turn.startChild('c-still-running');
  const r = await h.turn.finish();
  assert.equal(r.state, 'failed');
  assert.equal(r.failure, 'child_unresolved');
  assert.equal(h.turn.childIds.length, 2, 'both children are referenced');
});

test('parent-child · multiple children must all reach acceptable terminal states', async () => {
  const h = await harness('t11');
  for (const site of ['engineer_turn', 'local_chat_stream', 'workspace_find']) {
    await governedChild(h.turn, site, async () => 'ok');
  }
  const r = await h.turn.finish();
  assert.equal(r.state, 'completed');
  assert.equal(h.turn.childIds.length, 3);
});

// 14
test('parent-child · parent terminal-write failure suppresses visible success', async () => {
  const h = await harness('t12');
  await governedChild(h.turn, 'engineer_turn', async () => 'ok');
  h.failOn(/turns\/t12/);
  const r = await h.turn.finish();
  h.failOn(undefined);
  assert.equal(r.durable, false, 'the terminal revision was not written');
  assert.equal(r.failure, 'terminal_not_persisted');
});

// 17
test('parent-child · parent and child revisions stay independently monotonic', async () => {
  const h = await harness('t13');
  await governedChild(h.turn, 'engineer_turn', async () => 'ok');
  await governedChild(h.turn, 'workspace_find', async () => 'ok');
  const parentRev = h.turn.snapshot().revision;
  const childRevs = [...h.files.entries()]
    .filter(([k]) => k.includes('/operations/'))
    .map(([, v]) => (JSON.parse(v) as { revision: number }).revision);
  assert.ok(parentRev >= 3, `parent advanced per child, saw ${parentRev}`);
  for (const r of childRevs) {
    assert.ok(r >= 3, 'each child advanced through created -> running -> terminal');
    assert.notEqual(r, parentRev * 100, 'child revisions are their own chain, not derived');
  }
});

test('parent-child · a child record carries its execution class, not a generic label', async () => {
  const h = await harness('t14');
  await governedChild(h.turn, 'cloud_escalation', async () => 'ok');
  const rec = [...h.files.entries()].find(([k]) => k.includes('/operations/'))![1];
  assert.match(rec, /external_provider:cloud_escalation/);
});

test('parent-child · with no turn the work still runs, ungoverned and unfaked', async () => {
  let ran = false;
  const v = await governedChild(undefined, 'engineer_turn', async () => { ran = true; return 42; });
  assert.equal(v, 42);
  assert.equal(ran, true);
});

// ── review findings (PR #139, copilot-pull-request-reviewer) ────────────────

test('review · a repeated finish after a failed terminal write still reports NOT durable', async () => {
  const h = await harness('t15');
  await governedChild(h.turn, 'engineer_turn', async () => 'ok');
  h.failOn(/turns\/t15/);
  const first = await h.turn.finish();
  h.failOn(undefined);
  assert.equal(first.durable, false, 'the first call saw the write fail');

  // The wrapper's `finally` calls finish() again on every path. The fast-path used to
  // hardcode durable:true, which masked exactly this failure.
  const second = await h.turn.finish();
  assert.equal(second.durable, false, 'a second call must not manufacture durability');
  assert.equal(second.failure, 'terminal_not_persisted');
});
