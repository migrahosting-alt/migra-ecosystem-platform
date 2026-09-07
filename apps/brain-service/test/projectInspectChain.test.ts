/**
 * THE CHAIN, END TO END, AGAINST A REAL DATABASE AND A REAL DIRECTORY.
 *
 *   durable binding → bound project re-resolved → inspect succeeds read-only
 *
 * ---------------------------------------------------------------------------
 * THE REGRESSION THIS SUITE EXISTS FOR
 *
 *   1. connect a project while read access exists
 *   2. inspect succeeds
 *   3. revoke the grant WITHOUT touching the binding
 *   4. inspect again
 *   5. it must fail as ACCESS REVOKED — not succeed from a cached authority,
 *      and not pretend the project disappeared
 *
 * Step 5 is three separate ways to be wrong, and only one is right. Succeeding
 * is a security failure. Reporting the project as missing sends the user to
 * reconnect something they already have, which will fail identically and teach
 * them the product is broken.
 * ---------------------------------------------------------------------------
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Scope } from '../src/engine/memory/conversationStore.js';
import { SqliteProjectBindingStore } from '../src/engine/projects/sqliteProjectBinding.js';
import { inspectAuthorityFor } from '../src/engine/projects/projectInspect.js';
import type { ProjectGrant, ProjectGrantSource } from '../src/engine/projects/projectGrants.js';
import { runInspection } from '../src/engine/workspace/inspectRoutes.js';

const SCOPE: Scope = { owner: 'owner_a', workspace: 'ws_a' };
const CONVERSATION = 'conv_chain';

/** A real directory, so the inspection is a real read rather than a stub. */
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'proj-'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'README.md'), '# The connected project\n');
  writeFileSync(join(root, 'src', 'index.ts'), 'export const answer = 42\n');
  return root;
}

class Grants implements ProjectGrantSource {
  constructor(private grants: ProjectGrant[]) {}
  revokeAll(): void {
    this.grants = this.grants.map((g) => ({ ...g, canRead: false }));
  }
  deleteAll(): void {
    this.grants = [];
  }
  async listGrants(): Promise<ProjectGrant[]> {
    return this.grants;
  }
  async resolveGrant(projectId: string): Promise<ProjectGrant | null> {
    return this.grants.find((g) => g.projectId === projectId) ?? null;
  }
}

const dbFile = () => join(mkdtempSync(join(tmpdir(), 'bind-')), 'brain.db');

test('🚨 connect → inspect → revoke → inspect fails as ACCESS REVOKED', async () => {
  const rootPath = project();
  const grants = new Grants([
    { projectId: 'proj_1', label: 'migrateck/ecosystem', kind: 'connected-repo', canRead: true, canPropose: false, rootPath },
  ]);
  const db = new DatabaseSync(dbFile());
  const bindings = new SqliteProjectBindingStore(db);

  // 1. connect
  await bindings.bind(
    { conversationId: CONVERSATION, projectId: 'proj_1', boundBy: 'user_a', boundAt: 1 },
    SCOPE,
  );

  // 2. inspect succeeds, and really reads the project
  const first = await inspectAuthorityFor(CONVERSATION, SCOPE, { grants, bindings });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.rootPath, rootPath, 'the root came from the GRANT, not from any caller');
  const listed = await runInspection({ rootPath: first.rootPath, op: 'list' });
  assert.ok(JSON.stringify(listed.data).includes('README.md'), 'a real read of a real directory');

  // 3. revoke, WITHOUT touching the binding
  grants.revokeAll();

  // 4. inspect again
  const second = await inspectAuthorityFor(CONVERSATION, SCOPE, { grants, bindings });

  // 5. the only correct outcome
  assert.equal(second.ok, false, '🚨 a cached authority would have let this through');
  if (second.ok) return;
  assert.equal(second.remedy, 'request-read-access', 'revoked is not missing');
  assert.equal(second.status, 403);
  assert.match(second.message, /no longer have access/i);

  // …and the binding is INTACT. Erasing it would turn "you lost access" into
  // "you never connected anything".
  const binding = await bindings.get(CONVERSATION, SCOPE);
  assert.equal(binding?.projectId, 'proj_1', 'the pointer survives; only the permission changed');
  db.close();
});

test('a project that truly disappeared is UNAVAILABLE, and asks to connect', async () => {
  const grants = new Grants([
    { projectId: 'proj_1', label: 'repo', kind: 'connected-repo', canRead: true, canPropose: false, rootPath: project() },
  ]);
  const db = new DatabaseSync(dbFile());
  const bindings = new SqliteProjectBindingStore(db);
  await bindings.bind({ conversationId: CONVERSATION, projectId: 'proj_1', boundBy: 'u', boundAt: 1 }, SCOPE);

  grants.deleteAll();
  const result = await inspectAuthorityFor(CONVERSATION, SCOPE, { grants, bindings });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.remedy, 'connect-project', 'gone is not revoked');
  assert.equal(result.status, 409);
  db.close();
});

test('no binding at all asks to connect, and says so without jargon', async () => {
  const grants = new Grants([
    { projectId: 'proj_1', label: 'repo', kind: 'connected-repo', canRead: true, canPropose: false, rootPath: project() },
  ]);
  const db = new DatabaseSync(dbFile());
  const result = await inspectAuthorityFor('conv_unbound', SCOPE, {
    grants,
    bindings: new SqliteProjectBindingStore(db),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.remedy, 'connect-project');
  assert.doesNotMatch(result.message, /proj_|grant|authority|workspace\.|VS ?Code/i);
  db.close();
});

/* ------------------------------------------------------------------ *
 * Durability
 * ------------------------------------------------------------------ */

test('🚨 the binding survives a Brain restart', async () => {
  const path = dbFile();
  const rootPath = project();

  const before = new DatabaseSync(path);
  await new SqliteProjectBindingStore(before).bind(
    { conversationId: CONVERSATION, projectId: 'proj_1', boundBy: 'user_a', boundAt: 7 },
    SCOPE,
  );
  before.close();

  // A new process would see exactly this: a fresh handle to the same file.
  const after = new DatabaseSync(path);
  const bindings = new SqliteProjectBindingStore(after);
  const grants = new Grants([
    { projectId: 'proj_1', label: 'migrateck/ecosystem', kind: 'connected-repo', canRead: true, canPropose: false, rootPath },
  ]);

  const resolved = await inspectAuthorityFor(CONVERSATION, SCOPE, { grants, bindings });
  assert.equal(resolved.ok, true, 'a restart must not lose the project a conversation was using');
  if (!resolved.ok) return;
  assert.equal(resolved.label, 'migrateck/ecosystem');
  after.close();
});

test('the durable row stores a POINTER — no permission columns exist to cache', () => {
  const db = new DatabaseSync(dbFile());
  new SqliteProjectBindingStore(db);
  const columns = (
    db.prepare('SELECT name FROM pragma_table_info(?)').all('conversation_project') as { name: string }[]
  ).map((c) => c.name);

  assert.deepEqual(
    columns.sort(),
    ['bound_at', 'bound_by', 'conversation_id', 'owner_scope', 'project_id', 'workspace_scope'],
  );
  for (const forbidden of ['can_read', 'can_propose', 'can_apply', 'permissions', 'authority']) {
    assert.ok(
      !columns.includes(forbidden),
      `${forbidden} would make the binding a snapshot of a grant — the exact bug this design refuses`,
    );
  }
  db.close();
});

test('rebinding replaces, and never leaves the conversation pointing at nothing', async () => {
  const db = new DatabaseSync(dbFile());
  const bindings = new SqliteProjectBindingStore(db);
  await bindings.bind({ conversationId: CONVERSATION, projectId: 'proj_1', boundBy: 'u', boundAt: 1 }, SCOPE);
  await bindings.bind({ conversationId: CONVERSATION, projectId: 'proj_2', boundBy: 'u', boundAt: 2 }, SCOPE);
  const binding = await bindings.get(CONVERSATION, SCOPE);
  assert.equal(binding?.projectId, 'proj_2');
  assert.equal(binding?.boundAt, 2);
  db.close();
});

test('scope isolation is enforced by the durable row, not only in code', async () => {
  const db = new DatabaseSync(dbFile());
  const bindings = new SqliteProjectBindingStore(db);
  await bindings.bind({ conversationId: CONVERSATION, projectId: 'proj_1', boundBy: 'u', boundAt: 1 }, SCOPE);
  assert.equal(await bindings.get(CONVERSATION, { owner: 'owner_b', workspace: 'ws_a' }), null);
  assert.equal(await bindings.get(CONVERSATION, { owner: 'owner_a', workspace: 'ws_b' }), null);
  db.close();
});
