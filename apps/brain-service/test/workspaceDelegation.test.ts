// Delegating workspace tools to whoever actually holds the files.
//
// The invariant that matters most: a delegated call ALWAYS settles. A client
// that disconnects, crashes, or never answers must produce a tool FAILURE, never
// a hung loop and never a fabricated empty result — an empty answer for a
// missing workspace is exactly how an agent starts inventing files.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WorkspaceDelegate,
  CLIENT_WORKSPACE_TOOLS,
  registerDelegate,
  delegateFor,
  unregisterDelegate,
  activeDelegateCount,
  DelegationError,
  type DelegatedCall,
} from '../src/engine/workspace/workspaceDelegation.js';

test('filesystem tools are delegated; model and index tools are not', () => {
  for (const t of ['workspace.list', 'file.read', 'git.status', 'fs.proposeChangeset', 'edit.apply']) {
    assert.equal(CLIENT_WORKSPACE_TOOLS.has(t), true, t);
  }
  for (const t of ['command.run', 'agent.recipe', 'plan.update']) {
    assert.equal(CLIENT_WORKSPACE_TOOLS.has(t), false, t);
  }
});

test('a request reaches the client and its answer resolves the call', async () => {
  const seen: DelegatedCall[] = [];
  const d = new WorkspaceDelegate((c) => seen.push(c));
  const p = d.request('file.read', { path: 'a.txt' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.tool, 'file.read');
  assert.equal(d.inFlight, 1);
  d.settle(seen[0]!.callId, { ok: true, result: { text: 'hello' } });
  assert.deepEqual(await p, { text: 'hello' });
  assert.equal(d.inFlight, 0, 'a settled call must not stay in flight');
});

test('a client-side failure becomes a tool failure, not a silent success', async () => {
  const seen: DelegatedCall[] = [];
  const d = new WorkspaceDelegate((c) => seen.push(c));
  const p = d.request('git.status', {});
  d.settle(seen[0]!.callId, { ok: false, error: 'not a git repository' });
  await assert.rejects(() => p, /not a git repository/);
});

test('a call that is never answered TIMES OUT rather than hanging forever', async () => {
  const d = new WorkspaceDelegate(() => {}, 20);
  await assert.rejects(() => d.request('workspace.list', {}), /timed out .* waiting for the client workspace/);
  assert.equal(d.inFlight, 0);
});

test('disposing fails everything still waiting — a dropped client cannot suspend the loop', async () => {
  const d = new WorkspaceDelegate(() => {});
  const a = d.request('file.read', {});
  const b = d.request('workspace.list', {});
  d.dispose('the client stream ended');
  await assert.rejects(() => a, /abandoned/);
  await assert.rejects(() => b, /abandoned/);
  assert.equal(d.inFlight, 0);
});

test('a request after disposal is refused immediately', async () => {
  const d = new WorkspaceDelegate(() => {});
  d.dispose();
  await assert.rejects(() => d.request('file.read', {}), DelegationError);
});

test('an emit that throws fails the call instead of leaving it pending', async () => {
  const d = new WorkspaceDelegate(() => {
    throw new Error('socket closed');
  });
  await assert.rejects(() => d.request('file.read', {}), /could not reach the client/);
  assert.equal(d.inFlight, 0);
});

test('settling an unknown or already-settled call reports false', () => {
  const seen: DelegatedCall[] = [];
  const d = new WorkspaceDelegate((c) => seen.push(c));
  void d.request('file.read', {}).catch(() => {});
  assert.equal(d.settle('nope', { ok: true, result: 1 }), false);
  assert.equal(d.settle(seen[0]!.callId, { ok: true, result: 1 }), true);
  assert.equal(d.settle(seen[0]!.callId, { ok: true, result: 1 }), false, 'a call settles exactly once');
  d.dispose();
});

test('call ids are unique, so two in-flight calls cannot collide', () => {
  const seen: DelegatedCall[] = [];
  const d = new WorkspaceDelegate((c) => seen.push(c));
  void d.request('file.read', {}).catch(() => {});
  void d.request('file.read', {}).catch(() => {});
  assert.notEqual(seen[0]!.callId, seen[1]!.callId);
  d.dispose();
});

test('the registry finds a run and releases it', () => {
  const before = activeDelegateCount();
  const d = new WorkspaceDelegate(() => {});
  registerDelegate('corr_x', d);
  assert.equal(delegateFor('corr_x'), d);
  assert.equal(activeDelegateCount(), before + 1);
  unregisterDelegate('corr_x');
  assert.equal(delegateFor('corr_x'), undefined);
  assert.equal(activeDelegateCount(), before, 'no delegate may be left behind');
});

test('unregistering disposes, so a closed stream cannot strand a pending call', async () => {
  const d = new WorkspaceDelegate(() => {});
  registerDelegate('corr_y', d);
  const p = d.request('workspace.search', {});
  unregisterDelegate('corr_y');
  await assert.rejects(() => p, /abandoned/);
});
