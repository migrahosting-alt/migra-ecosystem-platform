/**
 * CONNECT / SELECT — the chain, and the eleven rules that make it safe.
 *
 *   connect affordance → select an AUTHORIZED project → read-only authority →
 *   bound to the conversation → inspect may proceed
 *
 * Read-only is the acceptance target. The write half stays behind an explicit
 * authorization decision and the durable idempotency primitive.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Scope } from '../src/engine/memory/conversationStore.js';
import {
  InMemoryProjectBindingStore,
  type ProjectBindingStore,
} from '../src/engine/projects/projectBinding.js';
import {
  authorityFromGrant,
  promptFor,
  resolveBoundProject,
  type ProjectGrant,
  type ProjectGrantSource,
} from '../src/engine/projects/projectGrants.js';
import { authoritySatisfies } from '@migrapilot/shared-types/project-authority';

const SCOPE: Scope = { owner: 'owner_a', workspace: 'ws_a' };
const OTHER: Scope = { owner: 'owner_b', workspace: 'ws_b' };

/** A grant source whose answers can be changed between calls, as a real one can. */
class FakeGrants implements ProjectGrantSource {
  constructor(private grants: ProjectGrant[]) {}
  set(grants: ProjectGrant[]): void {
    this.grants = grants;
  }
  async listGrants(scope: Scope): Promise<ProjectGrant[]> {
    return scope.owner === SCOPE.owner ? this.grants : [];
  }
  async resolveGrant(projectId: string, scope: Scope): Promise<ProjectGrant | null> {
    if (scope.owner !== SCOPE.owner) return null;
    return this.grants.find((g) => g.projectId === projectId) ?? null;
  }
}

const readable: ProjectGrant = {
  projectId: 'proj_1',
  label: 'migrateck/ecosystem',
  kind: 'connected-repo',
  canRead: true,
  canPropose: false,
};

const bind = async (store: ProjectBindingStore, projectId: string, scope = SCOPE) =>
  store.bind({ conversationId: 'conv_1', projectId, boundBy: 'user_a', boundAt: 1 }, scope);

/* ------------------------------------------------------------------ *
 * The client never manufactures authority
 * ------------------------------------------------------------------ */

test('🚨 authority comes from the GRANT, never from what the caller claims', async () => {
  const grants = new FakeGrants([readable]);
  const resolved = await resolveBoundProject('proj_1', SCOPE, grants);
  assert.equal(resolved.state, 'usable');
  if (resolved.state !== 'usable') return;
  assert.equal(resolved.authority.canRead, true);
  // The caller sent a project id and nothing else; these came from the source.
  assert.equal(resolved.authority.canPropose, false);
});

test('🚨 connecting is NEVER write access, whatever the grant permits', async () => {
  // A grant that allows proposing still yields no apply in this slice.
  const generous: ProjectGrant = { ...readable, canPropose: true };
  const authority = authorityFromGrant(generous);
  assert.equal(authority.canRead, true);
  assert.equal(authority.canPropose, true, 'proposing follows the grant — a proposal is not a change');
  assert.equal(authority.canApply, false, 'applying is gated behind idempotency and is not wired');
  assert.equal(authoritySatisfies(authority, { apply: true }), false);
});

test('read-only inspect is satisfied; writing is not', async () => {
  const authority = authorityFromGrant(readable);
  assert.equal(authoritySatisfies(authority, { read: true }), true);
  assert.equal(authoritySatisfies(authority, { apply: true }), false);
});

/* ------------------------------------------------------------------ *
 * Cached connection state can never become permanent authority
 * ------------------------------------------------------------------ */

test('🚨 access revoked AFTER connecting fails the very next resolve', async () => {
  const grants = new FakeGrants([readable]);
  const store = new InMemoryProjectBindingStore();
  await bind(store, 'proj_1');

  assert.equal((await resolveBoundProject('proj_1', SCOPE, grants)).state, 'usable');

  // The door closes. Nothing about the binding changed.
  grants.set([{ ...readable, canRead: false }]);

  const after = await resolveBoundProject('proj_1', SCOPE, grants);
  assert.equal(
    after.state,
    'not-permitted',
    'a binding that kept working after revocation would be a permission snapshot',
  );
  const binding = await store.get('conv_1', SCOPE);
  assert.ok(binding, 'the binding itself survives — it is a pointer, not a permission');
});

test('🚨 REVOKED is not MISSING — they get different remedies', async () => {
  const revoked = promptFor({ state: 'not-permitted', projectId: 'proj_1' }, 1);
  assert.equal(revoked.remedy, 'request-read-access');
  assert.match(revoked.message, /no longer have access/i);

  const gone = promptFor({ state: 'unavailable', projectId: 'proj_1' }, 1);
  assert.equal(gone.remedy, 'connect-project');
  assert.match(gone.message, /no longer available/i);

  /*
   * Telling a revoked user their project is missing sends them looking for a
   * deleted repository; telling a user whose project really was deleted to ask
   * for access files a request nobody can grant.
   */
  assert.notEqual(revoked.remedy, gone.remedy);
});

test('a project the source no longer knows about is unavailable, not usable', async () => {
  const grants = new FakeGrants([]);
  assert.equal((await resolveBoundProject('proj_gone', SCOPE, grants)).state, 'unavailable');
});

/* ------------------------------------------------------------------ *
 * Scope, and recovery
 * ------------------------------------------------------------------ */

test('a binding is conversation AND scope bound, not "this browser once picked something"', async () => {
  const store = new InMemoryProjectBindingStore();
  await bind(store, 'proj_1', SCOPE);

  assert.ok(await store.get('conv_1', SCOPE));
  assert.equal(await store.get('conv_1', OTHER), null, 'another workspace must not see it');
  assert.equal(await store.get('conv_2', SCOPE), null, 'another conversation must not inherit it');
});

test('the binding is durable state, so the same conversation recovers it', async () => {
  // The store is the shared product state; a second reader with no client
  // context at all finds the same binding — this is what a reload does.
  const store = new InMemoryProjectBindingStore();
  await bind(store, 'proj_1');
  const recovered = await store.get('conv_1', SCOPE);
  assert.equal(recovered?.projectId, 'proj_1');
  assert.equal(recovered?.boundBy, 'user_a', 'and who connected it is part of the record');
});

test('another actor’s project cannot be resolved into authority', async () => {
  const grants = new FakeGrants([readable]);
  assert.equal((await resolveBoundProject('proj_1', OTHER, grants)).state, 'unavailable');
});

/* ------------------------------------------------------------------ *
 * Truthful empty state, and no leaked vocabulary
 * ------------------------------------------------------------------ */

test('no eligible project gives a truthful empty state, not a dead control', () => {
  const withNone = promptFor({ state: 'none' }, 0);
  assert.match(withNone.message, /No projects are available/i);

  const withSome = promptFor({ state: 'none' }, 3);
  assert.match(withSome.message, /Connect a project/i);
  assert.notEqual(withNone.message, withSome.message, 'an empty list is a different screen');
});

test('🚨 no internal vocabulary reaches user copy', () => {
  const messages = [
    promptFor({ state: 'none' }, 0).message,
    promptFor({ state: 'none' }, 2).message,
    promptFor({ state: 'not-permitted', projectId: 'proj_7f3a' }, 1).message,
    promptFor({ state: 'unavailable', projectId: 'proj_7f3a' }, 1).message,
  ];
  for (const message of messages) {
    assert.doesNotMatch(message, /proj_|grant|connected-repo|platform-project|workspace\.|authority/i,
      `internal vocabulary in user copy: ${JSON.stringify(message)}`);
    assert.doesNotMatch(message, /VS ?Code/i, 'a platform capability must not name one client');
  }
});

test('the project LABEL is the only identifier a person sees', async () => {
  const grants = new FakeGrants([readable]);
  const resolved = await resolveBoundProject('proj_1', SCOPE, grants);
  if (resolved.state !== 'usable') return assert.fail('expected usable');
  assert.equal(resolved.grant.label, 'migrateck/ecosystem');
  assert.doesNotMatch(resolved.grant.label, /proj_/, 'the label must not be an id');
});
