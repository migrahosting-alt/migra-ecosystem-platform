/**
 * WHICH PROJECT A CONVERSATION IS WORKING WITH.
 *
 * ---------------------------------------------------------------------------
 * SHARED PRODUCT STATE, NOT A CLIENT STORE
 *
 * The binding lives with the conversation, on the server, for the same reason
 * the conversation's attached files do: it is something the user did to a
 * THREAD, and a reload must not change what that thread knows. A browser-local
 * "I picked a repo once" is not a project connection — it is a preference on
 * one device that silently disappears, and it cannot be recovered from another
 * client or after a session ends.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS STORED, AND WHAT DELIBERATELY IS NOT
 *
 * Stored:  the project ID, who bound it, and when.
 * NOT stored: canRead, canPropose, canApply, or any other permission.
 *
 * A binding is a POINTER, not a permission. Recording what the user was allowed
 * to do at connect time would make the row a snapshot of a grant, and a snapshot
 * of a grant is how a revoked user keeps working — the check would pass because
 * it was true once. Permissions are resolved on every use, in `projectGrants`.
 * ---------------------------------------------------------------------------
 */

import type { Scope } from '../memory/conversationStore.js';

export interface ProjectBinding {
  conversationId: string;
  projectId: string;
  /** The actor who connected it, for the provenance trail. */
  boundBy: string;
  boundAt: number;
}

export interface ProjectBindingStore {
  /** The project this conversation points at, or null. */
  get(conversationId: string, scope: Scope): Promise<ProjectBinding | null>;
  /**
   * Point the conversation at a project. Replaces any previous binding.
   *
   * Idempotent by nature — binding the same project twice is the same state —
   * so this needs no idempotency key. Rebinding to a DIFFERENT project is a
   * real change and is recorded with a new timestamp.
   */
  bind(binding: ProjectBinding, scope: Scope): Promise<void>;
  /** Stop using a project. The project itself is untouched. */
  unbind(conversationId: string, scope: Scope): Promise<void>;
}

export const PROJECT_BINDING_SCHEMA = `
CREATE TABLE IF NOT EXISTS conversation_project (
  conversation_id TEXT NOT NULL,
  owner_scope     TEXT NOT NULL,
  workspace_scope TEXT NOT NULL,
  project_id      TEXT NOT NULL,
  bound_by        TEXT NOT NULL,
  bound_at        INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, owner_scope, workspace_scope)
);
`;

/**
 * In-memory binding store.
 *
 * Scoped by (conversation, owner, workspace) exactly like the durable table, so
 * a test cannot pass by ignoring an isolation rule the database enforces.
 */
export class InMemoryProjectBindingStore implements ProjectBindingStore {
  private readonly rows = new Map<string, ProjectBinding>();

  private static key(conversationId: string, scope: Scope): string {
    return JSON.stringify([conversationId, scope.owner, scope.workspace]);
  }

  async get(conversationId: string, scope: Scope): Promise<ProjectBinding | null> {
    return this.rows.get(InMemoryProjectBindingStore.key(conversationId, scope)) ?? null;
  }

  async bind(binding: ProjectBinding, scope: Scope): Promise<void> {
    this.rows.set(InMemoryProjectBindingStore.key(binding.conversationId, scope), binding);
  }

  async unbind(conversationId: string, scope: Scope): Promise<void> {
    this.rows.delete(InMemoryProjectBindingStore.key(conversationId, scope));
  }
}
