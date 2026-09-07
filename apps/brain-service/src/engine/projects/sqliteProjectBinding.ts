/**
 * The DURABLE binding — SQLite.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE SCHEMA ENFORCES THE POINTER-ONLY RULE
 *
 * There is no `can_read`, no `can_propose`, no `can_apply` column, and adding
 * one would be the defect rather than a feature. A binding that stored what the
 * user was allowed to do at connect time is a SNAPSHOT OF A GRANT, and a
 * snapshot of a grant is how a revoked user keeps working: the check passes
 * because it was true once.
 *
 * The columns are the pointer and its provenance. Nothing here can answer "may
 * they?", which is exactly why every use has to go and ask.
 * ---------------------------------------------------------------------------
 */

import type { DatabaseSync } from 'node:sqlite';

import type { Scope } from '../memory/conversationStore.js';
import {
  PROJECT_BINDING_SCHEMA,
  type ProjectBinding,
  type ProjectBindingStore,
} from './projectBinding.js';

interface Row {
  conversation_id: string;
  project_id: string;
  bound_by: string;
  bound_at: number;
}

export class SqliteProjectBindingStore implements ProjectBindingStore {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(PROJECT_BINDING_SCHEMA);
  }

  async get(conversationId: string, scope: Scope): Promise<ProjectBinding | null> {
    const row = this.db
      .prepare(
        `SELECT conversation_id, project_id, bound_by, bound_at
           FROM conversation_project
          WHERE conversation_id = ? AND owner_scope = ? AND workspace_scope = ?`,
      )
      .get(conversationId, scope.owner, scope.workspace) as Row | undefined;
    if (!row) return null;
    return {
      conversationId: row.conversation_id,
      projectId: row.project_id,
      boundBy: row.bound_by,
      boundAt: row.bound_at,
    };
  }

  /**
   * Replace whatever this conversation pointed at.
   *
   * An upsert rather than delete-then-insert: rebinding is one state change,
   * and a window where the conversation points at nothing would let a
   * concurrent inspect see "no project connected" for a thread that has one.
   */
  async bind(binding: ProjectBinding, scope: Scope): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO conversation_project
           (conversation_id, owner_scope, workspace_scope, project_id, bound_by, bound_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(conversation_id, owner_scope, workspace_scope) DO UPDATE SET
           project_id = excluded.project_id,
           bound_by   = excluded.bound_by,
           bound_at   = excluded.bound_at`,
      )
      .run(
        binding.conversationId,
        scope.owner,
        scope.workspace,
        binding.projectId,
        binding.boundBy,
        binding.boundAt,
      );
  }

  async unbind(conversationId: string, scope: Scope): Promise<void> {
    this.db
      .prepare(
        `DELETE FROM conversation_project
          WHERE conversation_id = ? AND owner_scope = ? AND workspace_scope = ?`,
      )
      .run(conversationId, scope.owner, scope.workspace);
  }
}
