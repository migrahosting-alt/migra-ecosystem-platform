// Intelligent Provider Router — Slice 5, commit 1: session policy preference.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExecutionPolicyState, type PolicyMemento } from '../../services/executionPolicyState.js';

function memento(initial: Record<string, unknown> = {}): PolicyMemento & { store: Record<string, unknown> } {
  const store = { ...initial };
  return { store, get: <T>(k: string, d: T) => (k in store ? (store[k] as T) : d), update: async (k: string, v: unknown) => { store[k] = v; } };
}

test('defaults to the server default when unset (never a hard-coded local assumption)', () => {
  const s = new ExecutionPolicyState(memento(), () => 'auto');
  assert.equal(s.get(), 'auto');
  const s2 = new ExecutionPolicyState(memento(), () => 'privacy-first');
  assert.equal(s2.get(), 'privacy-first');
});

test('stores and returns a known policy; ignores unknown values', async () => {
  const m = memento();
  const s = new ExecutionPolicyState(m, () => 'auto');
  await s.set('cloud-first');
  assert.equal(s.get(), 'cloud-first');
  await s.set('arbitrary-nonsense'); // ignored — never accepts an unknown policy
  assert.equal(s.get(), 'cloud-first');
});

test('a stored-but-now-unknown value falls back to the server default', () => {
  const s = new ExecutionPolicyState(memento({ 'migrapilot.executionPolicy': 'removed-policy' }), () => 'auto');
  assert.equal(s.get(), 'auto');
});
