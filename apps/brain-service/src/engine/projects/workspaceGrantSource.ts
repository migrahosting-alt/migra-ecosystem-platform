/**
 * THE FIRST REAL GRANT SOURCE — the Workspace Manager registry.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS REGISTRY AND NOT A FILESYSTEM BROWSER
 *
 * A grant source has to answer "which projects may this user actually use", and
 * it has to answer it from something the platform ALREADY KNOWS rather than
 * from something a caller says. `workspaces` is that thing: a durable, scoped
 * table the engine writes and owns, carrying an id, a name, a root, git
 * provenance and a permission list, with a unique index on (owner, workspace).
 *
 * A filesystem browser would have been the other option and it is the wrong
 * one. Enumerating directories would make "what counts as a project" a
 * question about the server's disk rather than about entitlement, and the
 * answer would include everything the process can read.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SOURCE WILL NOT ACCEPT
 *
 * It takes a scope and a project id. There is no parameter for a root path, a
 * permission, or an authority kind, and there is nowhere to put one — the
 * `ProjectGrantSource` interface has no such argument. Every field of the grant
 * is read from the durable row.
 *
 * ---------------------------------------------------------------------------
 * 🚨 A HONEST LIMIT, RECORDED RATHER THAN GLOSSED
 *
 * `POST /api/ai/workspaces` registers a workspace with a `root` THE CALLER
 * SUPPLIES. That is deliberate and correct for the extension — a user pointing
 * the product at a folder on their own machine — and it predates this lane.
 *
 * So the boundary this source enforces is precise, and worth stating exactly:
 * a caller may connect only to workspaces ALREADY REGISTERED IN THEIR OWN
 * SCOPE, and the root comes from that row rather than from the connect request.
 * It does NOT make every root platform-owned. A deployment where registration
 * is open to clients inherits that property from the workspace route, and
 * closing it is a change to registration, not to this file.
 * ---------------------------------------------------------------------------
 * 🚨 THE PERMISSION COLUMN HAS NO WRITER YET, and that is worth knowing.
 *
 * `workspaces.permissions` exists in the schema and on the record, but the
 * manager's `patch` does not accept it and no route sets it. So TODAY every
 * workspace resolves with `permissions === undefined`, which this file reads as
 * read-yes / propose-no — matching what the product already does with these
 * workspaces, and matching this lane's read-only scope exactly.
 *
 * The mapping honours an explicit list precisely, so the day the registry
 * starts recording finer grants it takes effect here without a change. Writing
 * that column is a registry concern and is not in this lane.
 * ---------------------------------------------------------------------------
 */

import type { Scope } from '../memory/conversationStore.js';
import type { WorkspaceManager, WorkspaceRecord } from '../workspace/workspaceManager.js';
import type { ProjectGrant, ProjectGrantSource } from './projectGrants.js';

/**
 * Permission strings the registry may carry, and what they mean here.
 *
 * The column is a free-form list, so an unrecognised entry grants NOTHING —
 * defaulting an unknown permission to "allowed" is how a typo becomes access.
 */
const READ_PERMISSIONS = new Set(['read', 'inspect', 'project:read']);
const PROPOSE_PERMISSIONS = new Set(['propose', 'changeset:propose', 'project:propose']);

export function grantFor(record: WorkspaceRecord): ProjectGrant {
  const permissions = record.permissions;

  /*
   * NO PERMISSION LIST MEANS READ.
   *
   * Every workspace in this table was registered by its own owner, in their own
   * scope, and the product's entire existing behaviour — indexing it, answering
   * from it, inspecting it from the extension — already treats that as read
   * access. Refusing to read it here would not be safer; it would be a
   * different answer to the same question from a second place, and the two
   * would drift.
   *
   * An EXPLICIT list is honoured exactly, which is how a registry that starts
   * recording finer permissions takes effect without changing this file.
   */
  const canRead = permissions === undefined || permissions.some((p) => READ_PERMISSIONS.has(p));
  const canPropose = permissions !== undefined && permissions.some((p) => PROPOSE_PERMISSIONS.has(p));

  return {
    projectId: record.id,
    // The name the user gave it. Never the id, and never the root — a path is
    // infrastructure detail and, on a server, information they should not have.
    label: record.name || record.gitRepo || 'Untitled project',
    kind: record.gitRepo ? 'connected-repo' : 'platform-project',
    canRead,
    canPropose,
    rootPath: record.root,
  };
}

export class WorkspaceProjectGrantSource implements ProjectGrantSource {
  constructor(private readonly workspaces: WorkspaceManager) {}

  /**
   * Only this scope's workspaces, and only after hydrating that scope.
   *
   * The manager holds durable state in memory per scope and a global load is
   * invalid under row-level security, so the hydrate is not an optimisation —
   * without it a fresh process lists nothing and the user is told they have no
   * projects when they have several.
   */
  async listGrants(scope: Scope): Promise<ProjectGrant[]> {
    await this.workspaces.hydrate(scope);
    return this.workspaces.list(scope).map(grantFor);
  }

  async resolveGrant(projectId: string, scope: Scope): Promise<ProjectGrant | null> {
    await this.workspaces.hydrate(scope);
    /*
     * `get` is scope-checked by the manager, so a project id belonging to
     * another owner resolves to nothing — which the caller sees as
     * "unavailable", never as a refusal that would confirm it exists.
     */
    const record = this.workspaces.get(projectId, scope);
    return record ? grantFor(record) : null;
  }
}
