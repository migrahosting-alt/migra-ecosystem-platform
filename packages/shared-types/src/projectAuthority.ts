/*
 * WHERE WORK MAY ACTUALLY HAPPEN.
 *
 * SURFACE IS NOT CAPABILITY. AUTHORITY IS CAPABILITY.
 *
 * The consumer currently cannot build, and the reason must be recorded as "this
 * caller presented no project authority" rather than "this is the consumer".
 * Those two statements behave identically today and diverge permanently: the
 * first becomes capable the moment a repo is connected, the second hard-codes
 * "consumer = planner, extension = builder" into the architecture and never
 * recovers.
 *
 * So an authority is DECLARED by the caller and evaluated by the Brain. The
 * Brain never infers what a surface can do from which surface it is.
 */

export type ProjectAuthorityKind =
  /** The VS Code extension, executing against the user's local workspace. */
  | 'vscode-workspace'
  /** A repository the platform may operate on server-side, under explicit grant. */
  | 'connected-repo'
  /** A project the platform itself hosts and manages. */
  | 'platform-project'
  /** No project is available to this caller for this turn. */
  | 'none';

/**
 * What a caller may do with the project it holds.
 *
 * Three separate permissions, because they are three separate risks: reading a
 * repository, proposing a change, and writing it are routinely granted apart
 * from one another, and collapsing them into one boolean is how a read-only
 * connection ends up applying a changeset.
 */
export interface ProjectAuthority {
  kind: ProjectAuthorityKind;
  /** Stable id of the project, when one exists. Never a path from the client. */
  id?: string;
  /** Human-readable, for an explanation the user can act on. */
  label: string;
  canRead: boolean;
  canPropose: boolean;
  canApply: boolean;
}

export const NO_AUTHORITY: ProjectAuthority = {
  kind: 'none',
  label: 'no project',
  canRead: false,
  canPropose: false,
  canApply: false,
};

/** The VS Code extension's authority over the folder the user has open. */
export function vscodeWorkspaceAuthority(rootPath: string): ProjectAuthority {
  return {
    kind: 'vscode-workspace',
    id: rootPath,
    label: 'the workspace open in VS Code',
    canRead: true,
    canPropose: true,
    // Applying still passes the operator gate at execution time; this says the
    // authority PERMITS it, not that any write happens without a human.
    canApply: true,
  };
}

/** Does this authority satisfy what a step needs? */
export function authoritySatisfies(
  authority: ProjectAuthority,
  need: { read?: boolean; propose?: boolean; apply?: boolean },
): boolean {
  if (need.read && !authority.canRead) return false;
  if (need.propose && !authority.canPropose) return false;
  if (need.apply && !authority.canApply) return false;
  return true;
}

/** What to tell a user whose authority cannot carry the outcome they asked for. */
export function authorityShortfall(authority: ProjectAuthority): string {
  if (authority.kind === 'none') {
    return 'no project is connected to this conversation';
  }
  if (!authority.canRead) return `${authority.label} cannot be read`;
  if (!authority.canPropose) return `${authority.label} is read-only, so no changes can be proposed`;
  return `${authority.label} cannot apply changes`;
}
