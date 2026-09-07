/**
 * THE CANONICAL SOURCE OF WHICH PROJECTS AN ACTOR MAY USE.
 *
 * ---------------------------------------------------------------------------
 * 🚨 A CLIENT NEVER MANUFACTURES AUTHORITY
 *
 * The rule this module exists to enforce: a caller may say WHICH project it
 * wants, and nothing else. It may not say what it is allowed to do with it.
 *
 * That distinction is the whole design. `ProjectAuthority` carries `canRead`,
 * `canPropose` and `canApply` — if a client could send those, "connect a
 * project" would be a self-service write grant, and every client would end up
 * with its own authorization model that agrees with the others until the day it
 * does not. So the wire carries a project ID and the grant is looked up here.
 *
 * ---------------------------------------------------------------------------
 * 🚨 AUTHORITY IS RESOLVED AT USE, NEVER STORED AS BOOLEANS
 *
 * A binding records THAT a conversation points at a project. It does not record
 * what may be done with it. Every inspect resolves the grant again, so:
 *
 *   · access revoked after connecting fails the NEXT inspect, not eventually;
 *   · a cached connection can never become permanent authority;
 *   · a widened grant takes effect without reconnecting.
 *
 * Storing the booleans at connect time would make the binding a snapshot of a
 * permission, which is exactly how a revoked user keeps working.
 * ---------------------------------------------------------------------------
 */

import type { Scope } from '../memory/conversationStore.js';
import {
  connectedRepoAuthority,
  platformProjectAuthority,
  type ProjectAuthority,
} from '@migrapilot/shared-types/project-authority';

/** What the grant source knows about one project, for one actor. */
export interface ProjectGrant {
  projectId: string;
  /** Human-readable. The only field that may reach a screen. */
  label: string;
  kind: 'connected-repo' | 'platform-project';
  canRead: boolean;
  /** Granted separately and rarely. Never implied by connecting. */
  canPropose: boolean;
  /**
   * WHERE the project actually is, resolved by the grant source.
   *
   * 🚨 NEVER FROM THE CLIENT. The existing inspect route takes a `rootPath`
   * from the request body, which is right for the extension — it is describing
   * the folder the user has open on their own machine. It would be a
   * path-traversal hole for a web caller, who would be naming a directory on
   * the server. The client says WHICH project; the grant source says where.
   */
  rootPath: string;
}

/**
 * The port onto whatever actually owns project authorization.
 *
 * Deliberately narrow. A directory of projects, a VCS integration and a hosted
 * workspace registry can each implement this without any of them learning about
 * conversations, and no client learns about any of them.
 */
export interface ProjectGrantSource {
  /** Projects this actor may use, in this scope. May be empty — that is a real answer. */
  listGrants(scope: Scope): Promise<ProjectGrant[]>;
  /** One grant, resolved fresh. `null` when it is gone or no longer permitted. */
  resolveGrant(projectId: string, scope: Scope): Promise<ProjectGrant | null>;
}

/** Why a bound project cannot be used right now. Each needs different words. */
export type ProjectResolution =
  | { state: 'usable'; authority: ProjectAuthority; grant: ProjectGrant }
  /** Bound, still exists, but this actor may no longer read it. */
  | { state: 'not-permitted'; projectId: string }
  /** Bound to something the grant source no longer knows about. */
  | { state: 'unavailable'; projectId: string }
  /** Nothing is bound to this conversation. */
  | { state: 'none' };

/**
 * Turn a grant into an authority for THIS slice.
 *
 * 🚨 `canApply` is FALSE unconditionally here, whatever the grant says. Writing
 * is gated behind the durable idempotency primitive and an explicit
 * authorization decision, and neither is wired yet. A grant that permits
 * applying must still not produce an authority that can, or the gate is a
 * comment rather than a mechanism.
 *
 * `canPropose` follows the grant, because proposing is a real read-side
 * capability — a proposal is a description of a change, not a change.
 */
export function authorityFromGrant(grant: ProjectGrant): ProjectAuthority {
  const base =
    grant.kind === 'connected-repo'
      ? connectedRepoAuthority(grant.projectId, grant.label)
      : platformProjectAuthority(grant.projectId, grant.label);
  return {
    ...base,
    canRead: grant.canRead,
    canPropose: grant.canPropose,
    // Not `grant.canApply`: this slice has no write path at all.
    canApply: false,
  };
}

/**
 * Resolve what a conversation's bound project can do, right now.
 *
 * The distinction between `not-permitted` and `unavailable` is the point. A
 * revoked user told "that project is missing" goes looking for a deleted
 * repository; a user whose project really was deleted told "ask for access"
 * files a request nobody can grant. They are different facts and the grant
 * source is the only thing that can tell them apart.
 */
export async function resolveBoundProject(
  boundProjectId: string | undefined,
  scope: Scope,
  source: ProjectGrantSource,
): Promise<ProjectResolution> {
  if (!boundProjectId) return { state: 'none' };

  const grant = await source.resolveGrant(boundProjectId, scope);
  if (!grant) return { state: 'unavailable', projectId: boundProjectId };
  if (!grant.canRead) return { state: 'not-permitted', projectId: boundProjectId };

  return { state: 'usable', authority: authorityFromGrant(grant), grant };
}

/**
 * What the user should be offered, and what they should be told.
 *
 * 🚨 NO IDS, NO KINDS, NO GRANT REFERENCES. The project's LABEL is the only
 * identifier a person sees. `repo_7f3a`, `connected-repo` and a grant id are
 * internal vocabulary, and the last time internal vocabulary reached a screen it
 * was `workspace.inspect` in a refusal.
 */
export interface ProjectPrompt {
  message: string;
  remedy: 'connect-project' | 'request-read-access' | 'select-project';
}

export function promptFor(resolution: ProjectResolution, eligible: number): ProjectPrompt {
  switch (resolution.state) {
    case 'usable':
      return { message: '', remedy: 'select-project' };
    case 'not-permitted':
      /*
       * REVOKED IS NOT MISSING. The project is there and the door closed, so the
       * action that helps is asking for access — never reconnecting, which will
       * fail the same way and teach the user the product is broken.
       */
      return {
        message: 'You no longer have access to the project this conversation uses.',
        remedy: 'request-read-access',
      };
    case 'unavailable':
      return {
        message: 'The project this conversation was using is no longer available.',
        remedy: 'connect-project',
      };
    case 'none':
      return eligible === 0
        ? {
            // A truthful empty state. A Connect control that opens an empty list
            // is a dead control, and it reads as a broken product.
            message: 'No projects are available to connect yet.',
            remedy: 'connect-project',
          }
        : { message: 'Connect a project to this conversation to work with its files.', remedy: 'connect-project' };
  }
}
