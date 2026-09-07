import type { PoolClient } from 'pg';

import type { Scope } from '../../memory/conversationStore.js';
import type { ProjectBinding } from '../../projects/projectBinding.js';

/**
 * Which project a conversation is working with — durably, on the canonical
 * backend.
 *
 * 🚨 WHY THIS FILE EXISTS AT ALL, stated plainly because the gap was mine.
 *
 * The binding shipped with a SQLite table and a composition root that read
 * `durable instanceof SqliteDurableStore ? … : new InMemoryProjectBindingStore()`.
 * Production runs PostgreSQL, so production took the memory branch: a connected
 * project would have been lost on the next Brain restart, silently. Local
 * acceptance could not see it — the rig runs SQLite, so the durable branch was
 * always the one taken.
 *
 * The codebase already knew better. `operationalMaintenance.ts` warns that an
 * `instanceof SqliteDurableStore` check "would silently disable maintenance for
 * every future adapter rather than telling anyone". The rule was written down
 * and I wrote the exception.
 *
 * ---------------------------------------------------------------------------
 * A POINTER, NOT A PERMISSION
 *
 * No can_read, no can_propose, no can_apply — here or in the SQLite table. A
 * binding that recorded what the user was allowed to do at connect time is a
 * SNAPSHOT OF A GRANT, and a snapshot of a grant is how a revoked user keeps
 * working: the check passes because it was true once. Permissions are resolved
 * against the grant source on every use.
 */

interface Row {
  conversation_id: string;
  project_id: string;
  bound_by: string;
  bound_at: string | number;
}

export async function getBinding(
  client: PoolClient,
  conversationId: string,
  scope: Scope,
): Promise<ProjectBinding | null> {
  const { rows } = await client.query<Row>(
    `SELECT conversation_id, project_id, bound_by, bound_at
       FROM conversation_project
      WHERE conversation_id = $1 AND owner_scope = $2 AND workspace_scope = $3`,
    [conversationId, scope.owner, scope.workspace],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    conversationId: row.conversation_id,
    projectId: row.project_id,
    boundBy: row.bound_by,
    // BIGINT arrives as a string from node-postgres; a silent NaN here would
    // make every binding look like it was created at the epoch.
    boundAt: Number(row.bound_at),
  };
}

/**
 * Point the conversation at a project, replacing whatever it pointed at.
 *
 * An UPSERT rather than delete-then-insert: rebinding is one state change, and a
 * window where the conversation points at nothing would let a concurrent
 * inspect see "no project connected" for a thread that has one.
 */
export async function bindProject(
  client: PoolClient,
  binding: ProjectBinding,
  scope: Scope,
): Promise<void> {
  await client.query(
    `INSERT INTO conversation_project
       (conversation_id, owner_scope, workspace_scope, project_id, bound_by, bound_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (conversation_id, owner_scope, workspace_scope) DO UPDATE SET
       project_id = EXCLUDED.project_id,
       bound_by   = EXCLUDED.bound_by,
       bound_at   = EXCLUDED.bound_at`,
    [binding.conversationId, scope.owner, scope.workspace, binding.projectId, binding.boundBy, binding.boundAt],
  );
}

/** Stop using a project. The project itself is untouched. */
export async function unbindProject(
  client: PoolClient,
  conversationId: string,
  scope: Scope,
): Promise<void> {
  await client.query(
    `DELETE FROM conversation_project
      WHERE conversation_id = $1 AND owner_scope = $2 AND workspace_scope = $3`,
    [conversationId, scope.owner, scope.workspace],
  );
}
